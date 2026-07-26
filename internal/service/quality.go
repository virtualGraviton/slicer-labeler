package service

import (
	"context"
	"fmt"
	"time"

	"slicer-labeler/internal/model"
	"slicer-labeler/internal/repository"
)

type QualityService struct {
	audio     *AudioService
	deepseek  *DeepSeekService
	qualityRepo *repository.QualityRepo
	entryRepo   *repository.EntryRepo
}

func NewQualityService(
	audio *AudioService,
	deepseek *DeepSeekService,
	qualityRepo *repository.QualityRepo,
	entryRepo *repository.EntryRepo,
) *QualityService {
	return &QualityService{
		audio:       audio,
		deepseek:    deepseek,
		qualityRepo: qualityRepo,
		entryRepo:   entryRepo,
	}
}

// RunQualityCheck performs a full quality check: audio analysis + AI text risk + risk grading.
func (s *QualityService) RunQualityCheck(ctx context.Context, entry *model.Entry, nextEntry *model.Entry, force bool) (*model.QualityResult, error) {
	// Check cache
	if !force {
		cached, err := s.qualityRepo.GetByEntryID(ctx, entry.ID)
		if err == nil && cached != nil && cached.Status == "ok" {
			return cached, nil
		}
	}

	// Resolve audio path
	absPath, err := s.audio.ResolvePath(entry.WavPath)
	if err != nil {
		return nil, fmt.Errorf("resolve audio path: %w", err)
	}

	// Run audio analysis
	audioInfo, err := s.audio.AnalyzeBoundary(absPath)
	if err != nil {
		return nil, fmt.Errorf("audio analysis: %w", err)
	}

	// Run text risk analysis via DeepSeek
	textRisk, err := s.deepseek.AnalyzeTextRisk(entry, nextEntry)
	if err != nil {
		return nil, fmt.Errorf("text analysis: %w", err)
	}

	// Determine risk level
	textSuspicious := textRisk.CurrentTextUnfinished ||
		(textRisk.ShouldMergeNext && audioInfo.TrailingSilenceMs < 100)

	risk := "low"
	reasons := make([]string, 0)

	if audioInfo.BoundarySuspicious && textSuspicious {
		risk = "high"
		reasons = append(reasons, "音频尾部边界可疑(静音<100ms且能量偏高)，且文本存在语法问题")
	} else if audioInfo.BoundarySuspicious || textSuspicious {
		risk = "medium"
		var parts []string
		if audioInfo.BoundarySuspicious {
			parts = append(parts, "音频尾部边界可疑")
		}
		if textRisk.CurrentTextUnfinished {
			parts = append(parts, "文本语法不完整")
		}
		if textRisk.ShouldMergeNext && audioInfo.TrailingSilenceMs < 100 {
			parts = append(parts, "语义连续且静音不足")
		}
		reasons = append(reasons, stringsJoinParts(parts, "，"))
	} else {
		grammarOk := !textRisk.CurrentTextUnfinished
		hasSemantic := textRisk.ShouldMergeNext
		if grammarOk && hasSemantic && audioInfo.TrailingSilenceMs >= 100 {
			reasons = append(reasons, "文本语法自闭环，语义虽连续但尾部静音充足(>=100ms)，低风险")
		} else {
			reasons = append(reasons, "文本完整，尾部边界未见明显截断风险")
		}
	}

	// Merge audio reasons
	reasons = append(reasons, audioInfo.Reasons...)
	if textRisk.Reason != "" {
		reasons = append(reasons, textRisk.Reason)
	}

	// Compute text hash
	textHash := ComputeTextHash(entry, nextEntry)

	now := time.Now()
	summary := ""
	if len(reasons) > 0 {
		summary = reasons[0]
	}

	tailMean := audioInfo.TailMeanDb
	tailMax := audioInfo.TailMaxDb

	result := &model.QualityResult{
		EntryID:   entry.ID,
		Status:    "ok",
		Risk:      risk,
		CheckedAt: &now,
		Model:     s.deepseek.model,
		TextHash:  textHash,
		Summary:   summary,
		Reasons:   reasons,
		Audio: model.AudioInfo{
			DurationSec:        audioInfo.DurationSec,
			LeadingSilenceMs:   audioInfo.LeadingSilenceMs,
			TrailingSilenceMs:  audioInfo.TrailingSilenceMs,
			SilenceEvents:      audioInfo.SilenceEvents,
			TailWindowMs:       audioInfo.TailWindowMs,
			TailMeanDb:         tailMean,
			TailMaxDb:          tailMax,
			TailEnergyHigh:     audioInfo.TailEnergyHigh,
			BoundarySuspicious: audioInfo.BoundarySuspicious,
			Reasons:            audioInfo.Reasons,
		},
		TextRisk: *textRisk,
	}

	// Persist result
	if err := s.qualityRepo.Upsert(ctx, result); err != nil {
		return nil, fmt.Errorf("save quality result: %w", err)
	}

	return result, nil
}

func stringsJoinParts(parts []string, sep string) string {
	if len(parts) == 0 {
		return ""
	}
	result := parts[0]
	for _, p := range parts[1:] {
		result += sep + p
	}
	return result
}
