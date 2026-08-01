package db

import (
	"context"
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// AudioInfo stores audio boundary analysis results.
type AudioInfo struct {
	DurationSec        float64  `json:"durationSec"`
	LeadingSilenceMs   int      `json:"leadingSilenceMs"`
	TrailingSilenceMs  int      `json:"trailingSilenceMs"`
	SilenceEvents      int      `json:"silenceEvents"`
	TailWindowMs       int      `json:"tailWindowMs"`
	TailMeanDb         *float64 `json:"tailMeanDb"`
	TailMaxDb          *float64 `json:"tailMaxDb"`
	TailEnergyHigh     bool     `json:"tailEnergyHigh"`
	BoundarySuspicious bool     `json:"boundarySuspicious"`
	Reasons            []string `json:"reasons"`
}

// TextRisk stores DeepSeek text analysis results.
type TextRisk struct {
	TextComplete          bool    `json:"textComplete"`
	CurrentTextUnfinished bool    `json:"currentTextUnfinished"`
	ShouldMergeNext       bool    `json:"shouldMergeNext"`
	NextIsContinuation    bool    `json:"nextIsContinuation"`
	Confidence            float64 `json:"confidence"`
	Reason                string  `json:"reason"`
}

// QualityResult is the AI quality check result for an entry.
type QualityResult struct {
	ID        int64      `json:"id" gorm:"primaryKey;autoIncrement"`
	EntryID   int64      `json:"entry_id" gorm:"not null;uniqueIndex;constraint:OnDelete:CASCADE"`
	WavPath   string     `json:"wavPath" gorm:"-"`
	Status    string     `json:"status" gorm:"type:text;not null;default:'pending'"`
	Risk      string     `json:"risk" gorm:"type:text;not null;default:'low';index"`
	CheckedAt *time.Time `json:"checked_at"`
	Model     string     `json:"model" gorm:"type:text;not null;default:''"`
	TextHash  string     `json:"text_hash" gorm:"type:text;not null;default:''"`
	Summary   string     `json:"summary" gorm:"type:text;not null;default:''"`
	Reasons   []string   `json:"reasons" gorm:"type:jsonb;serializer:json;default:'[]'"`
	Audio     AudioInfo  `json:"audio" gorm:"type:jsonb;serializer:json;default:'{}'"`
	TextRisk  TextRisk   `json:"text_risk" gorm:"type:jsonb;serializer:json;default:'{}'"`
	CreatedAt time.Time  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt time.Time  `json:"updated_at" gorm:"autoUpdateTime"`
	Entry     Entry      `json:"-" gorm:"foreignKey:EntryID;constraint:OnDelete:CASCADE"`
}

func (QualityResult) TableName() string { return "quality_results" }

// QualityStore provides CRUD operations for quality results.
type QualityStore struct {
	db *gorm.DB
}

func NewQualityStore(db *gorm.DB) *QualityStore {
	return &QualityStore{db: db}
}

func (s *QualityStore) GetByEntryID(ctx context.Context, entryID int64) (*QualityResult, error) {
	var q QualityResult
	err := s.db.WithContext(ctx).Where("entry_id = ?", entryID).First(&q).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get quality result for entry %d: %w", entryID, err)
	}
	if q.Reasons == nil {
		q.Reasons = []string{}
	}
	return &q, nil
}

func (s *QualityStore) Upsert(ctx context.Context, q *QualityResult) error {
	err := s.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "entry_id"}},
		UpdateAll: true,
	}).Create(q).Error
	if err != nil {
		return fmt.Errorf("upsert quality result: %w", err)
	}
	return nil
}

func (s *QualityStore) ListByDataset(ctx context.Context, datasetID int64, page, pageSize int) ([]QualityResult, int64, error) {
	var total int64
	if err := s.db.WithContext(ctx).
		Table("quality_results").
		Joins("JOIN entries ON entries.id = quality_results.entry_id").
		Where("entries.dataset_id = ?", datasetID).
		Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count quality results: %w", err)
	}

	var results []QualityResult
	err := s.db.WithContext(ctx).
		Table("quality_results").
		Select("quality_results.*, entries.wav_path").
		Joins("JOIN entries ON entries.id = quality_results.entry_id").
		Where("entries.dataset_id = ?", datasetID).
		Order("entries.id ASC").
		Limit(pageSize).
		Offset((page - 1) * pageSize).
		Find(&results).Error
	if err != nil {
		return nil, 0, fmt.Errorf("list quality results: %w", err)
	}
	for i := range results {
		if results[i].Reasons == nil {
			results[i].Reasons = []string{}
		}
	}
	return results, total, nil
}

func (s *QualityStore) DeleteByEntryID(ctx context.Context, entryID int64) error {
	err := s.db.WithContext(ctx).Where("entry_id = ?", entryID).Delete(&QualityResult{}).Error
	if err != nil {
		return fmt.Errorf("delete quality result for entry %d: %w", entryID, err)
	}
	return nil
}
