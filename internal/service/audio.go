package service

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
)

// AudioInfo contains audio analysis results.
type AudioInfo struct {
	DurationSec        float64
	LeadingSilenceMs   int
	TrailingSilenceMs  int
	SilenceEvents      int
	TailWindowMs       int
	TailMeanDb         *float64
	TailMaxDb          *float64
	TailEnergyHigh     bool
	BoundarySuspicious bool
	Reasons            []string
}

// AudioService performs ffmpeg-based audio analysis/editing on byte streams.
type AudioService struct {
	storage *StorageService
}

func NewAudioService(storage *StorageService) *AudioService {
	return &AudioService{storage: storage}
}

// --- Analysis (pure in-memory via pipe) ---

// AnalyzeBoundary downloads audio from storage and runs silence + energy analysis fully in memory.
func (s *AudioService) AnalyzeBoundary(ctx context.Context, modelName, datasetName, wavPath string) (*AudioInfo, error) {
	data, err := s.storage.DownloadBytes(ctx, modelName, datasetName, wavPath)
	if err != nil {
		return nil, fmt.Errorf("download: %w", err)
	}

	durationSec, err := getDurationFromBytes(data, wavPath)
	if err != nil {
		durationSec = 0
	}

	silence, err := parseSilenceBytes(data, durationSec)
	if err != nil {
		return nil, fmt.Errorf("silence analysis: %w", err)
	}

	tail, err := analyzeTailEnergyBytes(data, durationSec)
	if err != nil {
		return nil, fmt.Errorf("tail energy analysis: %w", err)
	}

	info := &AudioInfo{
		DurationSec:       math.Round(durationSec*1000) / 1000,
		LeadingSilenceMs:  silence.LeadingSilenceMs,
		TrailingSilenceMs: silence.TrailingSilenceMs,
		SilenceEvents:     silence.SilenceEvents,
		TailWindowMs:      tail.windowMs,
		TailMeanDb:        tail.meanDb,
		TailMaxDb:         tail.maxDb,
		TailEnergyHigh:    tail.energyHigh,
	}

	info.BoundarySuspicious = silence.TrailingSilenceMs < 100 && tail.energyHigh

	var reasons []string
	if info.BoundarySuspicious {
		reasons = append(reasons, fmt.Sprintf("尾部静音 %dms 且尾部能量偏高", silence.TrailingSilenceMs))
	}
	if silence.LeadingSilenceMs < 40 {
		reasons = append(reasons, fmt.Sprintf("句首停顿较短 (%dms)", silence.LeadingSilenceMs))
	}
	info.Reasons = reasons

	return info, nil
}

// --- Split: download → pipe → upload two WAVs ---

// SplitAndUpload downloads, splits at splitTime, uploads both parts, returns their storage keys.
func (s *AudioService) SplitAndUpload(ctx context.Context, modelName, datasetName string,
	wavPath, firstBasename, secondBasename string, splitTime float64,
) (firstKey, secondKey string, err error) {
	data, err := s.storage.DownloadBytes(ctx, modelName, datasetName, wavPath)
	if err != nil {
		return "", "", fmt.Errorf("download: %w", err)
	}

	firstBytes, secondBytes, err := splitBytes(data, splitTime)
	if err != nil {
		return "", "", err
	}

	firstKey, err = s.storage.UploadBytes(ctx, modelName, datasetName, firstBasename+".wav", firstBytes)
	if err != nil {
		return "", "", fmt.Errorf("upload first part: %w", err)
	}
	secondKey, err = s.storage.UploadBytes(ctx, modelName, datasetName, secondBasename+".wav", secondBytes)
	if err != nil {
		return "", "", fmt.Errorf("upload second part: %w", err)
	}

	return firstKey, secondKey, nil
}

// --- Merge: download to temp → ffmpeg concat → upload ---

// MergeAndUpload downloads multiple WAVs, concat-merges, uploads result, cleans up temp.
func (s *AudioService) MergeAndUpload(ctx context.Context, modelName, datasetName string,
	wavPaths []string, mergedBasename string,
) (mergedKey string, err error) {
	// Download all inputs to temp files (required by ffmpeg concat demuxer)
	tmpDir, err := os.MkdirTemp("", "slicer-merge-")
	if err != nil {
		return "", fmt.Errorf("create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	var tmpPaths []string
	for i, wp := range wavPaths {
		data, err := s.storage.DownloadBytes(ctx, modelName, datasetName, wp)
		if err != nil {
			return "", fmt.Errorf("download %s: %w", wp, err)
		}
		tmpPath := fmt.Sprintf("%s/in_%d.wav", tmpDir, i)
		if err := os.WriteFile(tmpPath, data, 0644); err != nil {
			return "", fmt.Errorf("write temp: %w", err)
		}
		tmpPaths = append(tmpPaths, tmpPath)
	}

	// Write concat list
	concatPath := tmpDir + "/concat.txt"
	var lines []string
	for _, p := range tmpPaths {
		lines = append(lines, fmt.Sprintf("file '%s'", strings.ReplaceAll(p, "\\", "/")))
	}
	if err := os.WriteFile(concatPath, []byte(strings.Join(lines, "\n")), 0644); err != nil {
		return "", fmt.Errorf("write concat list: %w", err)
	}

	// Run ffmpeg concat
	outPath := tmpDir + "/merged.wav"
	cmd := exec.Command("ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concatPath, "-c", "copy", outPath)
	if out, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("concat merge: %s", string(out))
	}

	mergedBytes, err := os.ReadFile(outPath)
	if err != nil {
		return "", fmt.Errorf("read merged output: %w", err)
	}

	return s.storage.UploadBytes(ctx, modelName, datasetName, mergedBasename+".wav", mergedBytes)
}

// --- Low-level in-memory ffmpeg operations ---

func getDurationFromBytes(data []byte, wavPath string) (float64, error) {
	cmd := exec.Command("ffprobe", "-v", "error", "-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1", "pipe:0")
	cmd.Stdin = bytes.NewReader(data)
	out, err := cmd.Output()
	if err == nil {
		dur, parseErr := strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
		if parseErr == nil && !math.IsInf(dur, 0) && dur > 0 {
			return dur, nil
		}
	}
	// Fallback to filename-based estimation
	return durationFromFilename(wavPath), nil
}

func parseSilenceBytes(data []byte, durationSec float64) (*silenceResult, error) {
	cmd := exec.Command("ffmpeg", "-hide_banner", "-nostats",
		"-i", "pipe:0",
		"-af", "silencedetect=noise=-35dB:d=0.02",
		"-f", "null", "-")
	cmd.Stdin = bytes.NewReader(data)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("silencedetect: %s", string(out))
	}

	log := string(out)
	starts := parseSilenceStarts(log)
	ends := parseSilenceEnds(log)

	result := &silenceResult{SilenceEvents: len(starts)}

	if len(starts) > 0 && starts[0] <= 0.03 {
		for _, e := range ends {
			if e.end >= starts[0] {
				result.LeadingSilenceMs = int(math.Round(e.duration * 1000))
				break
			}
		}
	}

	if len(starts) > 0 {
		lastStart := starts[len(starts)-1]
		var endAfter *silenceEnd
		for i := range ends {
			if ends[i].end >= lastStart {
				endAfter = &ends[i]
			}
		}
		if endAfter == nil {
			result.TrailingSilenceMs = int(math.Max(0, math.Round((durationSec-lastStart)*1000)))
		} else if durationSec-endAfter.end <= 0.05 {
			result.TrailingSilenceMs = int(math.Round(endAfter.duration * 1000))
		}
	}
	return result, nil
}

func analyzeTailEnergyBytes(data []byte, durationSec float64) (*tailEnergyResult, error) {
	tailSec := math.Min(0.12, math.Max(0.03, durationSec))
	if tailSec < 0.03 {
		tailSec = 0.12
	}

	cmd := exec.Command("ffmpeg", "-hide_banner", "-nostats",
		"-sseof", fmt.Sprintf("-%0.3f", tailSec),
		"-i", "pipe:0",
		"-af", "volumedetect",
		"-f", "null", "-")
	cmd.Stdin = bytes.NewReader(data)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("volumedetect: %s", string(out))
	}

	log := string(out)
	result := &tailEnergyResult{windowMs: int(math.Round(tailSec * 1000))}

	if m := regexp.MustCompile(`mean_volume:\s*(-?[\d.]+)\s*dB`).FindStringSubmatch(log); len(m) > 1 {
		v, _ := strconv.ParseFloat(m[1], 64)
		result.meanDb = &v
	}
	if m := regexp.MustCompile(`max_volume:\s*(-?[\d.]+)\s*dB`).FindStringSubmatch(log); len(m) > 1 {
		v, _ := strconv.ParseFloat(m[1], 64)
		result.maxDb = &v
	}

	meanHigh := result.meanDb != nil && *result.meanDb > -38
	maxHigh := result.maxDb != nil && *result.maxDb > -16
	result.energyHigh = meanHigh || maxHigh

	return result, nil
}

func splitBytes(data []byte, splitTime float64) (first []byte, second []byte, err error) {
	// First part
	cmd1 := exec.Command("ffmpeg", "-y", "-i", "pipe:0", "-t", fmt.Sprintf("%f", splitTime), "-f", "wav", "pipe:1")
	cmd1.Stdin = bytes.NewReader(data)
	var buf1 bytes.Buffer
	cmd1.Stdout = &buf1
	if out, err := cmd1.CombinedOutput(); err != nil {
		// stderr on error
		return nil, nil, fmt.Errorf("split first part: %s", string(out))
	}
	first, err = io.ReadAll(&buf1)
	if err != nil {
		return nil, nil, fmt.Errorf("read first part: %w", err)
	}

	// Second part
	cmd2 := exec.Command("ffmpeg", "-y", "-i", "pipe:0", "-ss", fmt.Sprintf("%f", splitTime), "-f", "wav", "pipe:1")
	cmd2.Stdin = bytes.NewReader(data)
	var buf2 bytes.Buffer
	cmd2.Stdout = &buf2
	if out, err := cmd2.CombinedOutput(); err != nil {
		return nil, nil, fmt.Errorf("split second part: %s", string(out))
	}
	second, err = io.ReadAll(&buf2)
	if err != nil {
		return nil, nil, fmt.Errorf("read second part: %w", err)
	}

	return first, second, nil
}

// --- Pure text helpers (no filesystem) ---

func durationFromFilename(absPath string) float64 {
	name := absPath
	if idx := strings.LastIndex(name, "/"); idx >= 0 {
		name = name[idx+1:]
	}
	re := regexp.MustCompile(`_(\d{10})_(\d{10})\.wav$`)
	matches := re.FindStringSubmatch(name)
	if len(matches) != 3 {
		return 0
	}
	start, _ := strconv.Atoi(matches[1])
	end, _ := strconv.Atoi(matches[2])
	return math.Max(0, float64(end-start)/32000)
}

// ParseFilename extracts components from a slicer filename.
// Format: vocal_BVID-pX_chY_MMDD_HHMMSS.m4a_10.wav_START_END
func ParseFilename(basename string) (bvid, p, ch, date, timePart, start, end string, ok bool) {
	re := regexp.MustCompile(`^vocal_(BV\w+)-p(\d+)_ch(\d+)_(\d{6})_(\d{6})\.m4a_10\.wav_(\d{10})_(\d{10})$`)
	matches := re.FindStringSubmatch(basename)
	if len(matches) != 8 {
		return "", "", "", "", "", "", "", false
	}
	return matches[1], matches[2], matches[3], matches[4], matches[5], matches[6], matches[7], true
}

// --- Internal types ---

type silenceResult struct {
	LeadingSilenceMs  int
	TrailingSilenceMs int
	SilenceEvents     int
}

type silenceEnd struct {
	end      float64
	duration float64
}

type tailEnergyResult struct {
	windowMs   int
	meanDb     *float64
	maxDb      *float64
	energyHigh bool
}

func parseSilenceStarts(log string) []float64 {
	re := regexp.MustCompile(`silence_start:\s*([\d.]+)`)
	var starts []float64
	for _, m := range re.FindAllStringSubmatch(log, -1) {
		v, _ := strconv.ParseFloat(m[1], 64)
		starts = append(starts, v)
	}
	return starts
}

func parseSilenceEnds(log string) []silenceEnd {
	re := regexp.MustCompile(`silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)`)
	var ends []silenceEnd
	for _, m := range re.FindAllStringSubmatch(log, -1) {
		end, _ := strconv.ParseFloat(m[1], 64)
		dur, _ := strconv.ParseFloat(m[2], 64)
		ends = append(ends, silenceEnd{end: end, duration: dur})
	}
	return ends
}
