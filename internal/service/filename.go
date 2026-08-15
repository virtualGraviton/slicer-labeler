package service

import (
	"path/filepath"
	"strconv"
	"strings"
)

// SampleRate is the fixed audio sample rate of slicer outputs (verified against
// actual wav headers). Coordinate fields in filenames are samples at this rate.
const SampleRate = 32000

// ParseEntryMetaData extracts structured metadata from a slicer wav filename:
//
//	vocal_{bv}-p{part}_ch{ch}_{chStart}_{chEnd}.m4a_10.wav_{startSample}_{endSample}.wav
//
// The middle hop segments (m4a number, extra .wav hops) may vary; see
// audio.ParseFilename for the exact pattern.
//
// The second coordinate pair is relative to the first-level chunk (ch), so
// absolute time in the original video = chStartSec + startSample/SampleRate.
// Accepts the basename with or without the trailing ".wav".
// Returns nil when the filename is not parseable (legacy/foreign data).
func ParseEntryMetaData(basename string) map[string]interface{} {
	base := strings.TrimSuffix(basename, filepath.Ext(basename))
	bvid, p, ch, chStart, chEnd, start, end, ok := ParseFilename(base)
	if !ok {
		return nil
	}
	startN := atoiSafe(start)
	endN := atoiSafe(end)
	return map[string]interface{}{
		"bvid":        bvid,
		"part":        atoiSafe(p),
		"ch":          atoiSafe(ch),
		"chStart":     chStart,
		"chEnd":       chEnd,
		"chStartSec":  hhmmssToSeconds(chStart),
		"chEndSec":    hhmmssToSeconds(chEnd),
		"sampleRate":  SampleRate,
		"startSample": startN,
		"endSample":   endN,
		"durationSec": float64(endN-startN) / float64(SampleRate),
	}
}

func hhmmssToSeconds(s string) int {
	if len(s) < 6 {
		return 0
	}
	return atoiSafe(s[0:2])*3600 + atoiSafe(s[2:4])*60 + atoiSafe(s[4:6])
}

func atoiSafe(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}
