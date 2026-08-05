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

// AudioService performs ffmpeg-based audio analysis/editing on byte streams.
type AudioService struct {
	storage *StorageService
}

func NewAudioService(storage *StorageService) *AudioService {
	return &AudioService{storage: storage}
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

	firstBytes, secondBytes, err := splitBytes(ctx, data, splitTime)
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
	cmd := exec.CommandContext(ctx, "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concatPath, "-c", "copy", outPath)
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

func splitBytes(ctx context.Context, data []byte, splitTime float64) (first []byte, second []byte, err error) {
	// First part
	cmd1 := exec.CommandContext(ctx, "ffmpeg", "-y", "-i", "pipe:0", "-t", fmt.Sprintf("%f", splitTime), "-f", "wav", "pipe:1")
	cmd1.Stdin = bytes.NewReader(data)
	var buf1 bytes.Buffer
	var errBuf1 bytes.Buffer
	cmd1.Stdout = &buf1
	cmd1.Stderr = &errBuf1
	if err := cmd1.Run(); err != nil {
		return nil, nil, fmt.Errorf("split first part: %s (%v)", strings.TrimSpace(errBuf1.String()), err)
	}
	first, err = io.ReadAll(&buf1)
	if err != nil {
		return nil, nil, fmt.Errorf("read first part: %w", err)
	}

	// Second part
	cmd2 := exec.CommandContext(ctx, "ffmpeg", "-y", "-i", "pipe:0", "-ss", fmt.Sprintf("%f", splitTime), "-f", "wav", "pipe:1")
	cmd2.Stdin = bytes.NewReader(data)
	var buf2 bytes.Buffer
	var errBuf2 bytes.Buffer
	cmd2.Stdout = &buf2
	cmd2.Stderr = &errBuf2
	if err := cmd2.Run(); err != nil {
		return nil, nil, fmt.Errorf("split second part: %s (%v)", strings.TrimSpace(errBuf2.String()), err)
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
