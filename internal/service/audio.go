package service

import (
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
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

type AudioService struct {
	dataDir string
}

func NewAudioService(dataDir string) *AudioService {
	return &AudioService{dataDir: dataDir}
}

func (s *AudioService) DataDir() string {
	return s.dataDir
}

func (s *AudioService) ResolvePath(relPath string) (string, error) {
	absPath := filepath.Join(s.dataDir, relPath)
	absPath = filepath.Clean(absPath)

	// Security: ensure path is within dataDir
	dataDirAbs, _ := filepath.Abs(s.dataDir)
	absCheck, _ := filepath.Abs(absPath)
	if !strings.HasPrefix(absCheck, dataDirAbs) {
		return "", fmt.Errorf("path outside data directory")
	}
	return absPath, nil
}

// GetDuration returns audio duration in seconds.
func (s *AudioService) GetDuration(absPath string) (float64, error) {
	// Try ffprobe first
	out, err := exec.Command("ffprobe",
		"-v", "error",
		"-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1",
		absPath,
	).Output()
	if err == nil {
		dur, parseErr := strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
		if parseErr == nil && math.IsInf(dur, 0) == false && dur > 0 {
			return dur, nil
		}
	}

	// Fallback: parse from filename pattern _XXXXXXXXXX_XXXXXXXXXX.wav
	return durationFromFilename(absPath), nil
}

func durationFromFilename(absPath string) float64 {
	name := filepath.Base(absPath)
	re := regexp.MustCompile(`_(\d{10})_(\d{10})\.wav$`)
	matches := re.FindStringSubmatch(name)
	if len(matches) != 3 {
		return 0
	}
	start, _ := strconv.Atoi(matches[1])
	end, _ := strconv.Atoi(matches[2])
	return math.Max(0, float64(end-start)/32000)
}

type silenceResult struct {
	LeadingSilenceMs  int
	TrailingSilenceMs int
	SilenceEvents     int
}

// AnalyzeBoundary runs silencedetect and volumedetect to check audio boundaries.
func (s *AudioService) AnalyzeBoundary(absPath string) (*AudioInfo, error) {
	durationSec, err := s.GetDuration(absPath)
	if err != nil {
		durationSec = 0
	}

	silence, err := s.parseSilence(absPath, durationSec)
	if err != nil {
		return nil, fmt.Errorf("silence analysis: %w", err)
	}

	tail, err := s.analyzeTailEnergy(absPath, durationSec)
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

	// Determine boundary suspiciousness
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

func (s *AudioService) parseSilence(absPath string, durationSec float64) (*silenceResult, error) {
	out, err := exec.Command("ffmpeg",
		"-hide_banner", "-nostats",
		"-i", absPath,
		"-af", "silencedetect=noise=-35dB:d=0.02",
		"-f", "null", "-",
	).CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("silencedetect: %s", string(out))
	}

	log := string(out)
	starts := parseSilenceStarts(log)
	ends := parseSilenceEnds(log)

	result := &silenceResult{SilenceEvents: len(starts)}

	// Leading silence
	if len(starts) > 0 && starts[0] <= 0.03 {
		for _, e := range ends {
			if e.end >= starts[0] {
				result.LeadingSilenceMs = int(math.Round(e.duration * 1000))
				break
			}
		}
	}

	// Trailing silence
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

func parseSilenceStarts(log string) []float64 {
	re := regexp.MustCompile(`silence_start:\s*([\d.]+)`)
	var starts []float64
	for _, m := range re.FindAllStringSubmatch(log, -1) {
		v, _ := strconv.ParseFloat(m[1], 64)
		starts = append(starts, v)
	}
	return starts
}

type silenceEnd struct {
	end      float64
	duration float64
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

type tailEnergyResult struct {
	windowMs   int
	meanDb     *float64
	maxDb      *float64
	energyHigh bool
}

func (s *AudioService) analyzeTailEnergy(absPath string, durationSec float64) (*tailEnergyResult, error) {
	tailSec := math.Min(0.12, math.Max(0.03, durationSec))
	if tailSec < 0.03 {
		tailSec = 0.12
	}

	out, err := exec.Command("ffmpeg",
		"-hide_banner", "-nostats",
		"-sseof", fmt.Sprintf("-%0.3f", tailSec),
		"-i", absPath,
		"-af", "volumedetect",
		"-f", "null", "-",
	).CombinedOutput()
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

// Split splits an audio file at the given time point.
func (s *AudioService) Split(absPath, dir string, splitTime float64, firstBasename, secondBasename string) (string, string, error) {
	firstPath := filepath.Join(dir, firstBasename+".wav")
	secondPath := filepath.Join(dir, secondBasename+".wav")

	cmd1 := exec.Command("ffmpeg", "-y", "-i", absPath, "-t", fmt.Sprintf("%f", splitTime), "-c", "copy", firstPath)
	if out, err := cmd1.CombinedOutput(); err != nil {
		return "", "", fmt.Errorf("split first part: %s", string(out))
	}

	cmd2 := exec.Command("ffmpeg", "-y", "-i", absPath, "-ss", fmt.Sprintf("%f", splitTime), "-c", "copy", secondPath)
	if out, err := cmd2.CombinedOutput(); err != nil {
		return "", "", fmt.Errorf("split second part: %s", string(out))
	}

	return firstPath, secondPath, nil
}

// Merge merges multiple audio files using concat.
func (s *AudioService) Merge(inputPaths []string, outputPath string) error {
	// Write concat list file
	concatFile := filepath.Join(filepath.Dir(outputPath), "_concat_temp.txt")
	var lines []string
	for _, p := range inputPaths {
		lines = append(lines, fmt.Sprintf("file '%s'", strings.ReplaceAll(p, "\\", "/")))
	}
	if err := os.WriteFile(concatFile, []byte(strings.Join(lines, "\n")), 0644); err != nil {
		return fmt.Errorf("write concat file: %w", err)
	}
	defer os.Remove(concatFile)

	cmd := exec.Command("ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concatFile, "-c", "copy", outputPath)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("concat merge: %s", string(out))
	}

	return nil
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
