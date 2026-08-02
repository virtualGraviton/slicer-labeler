package handler

import (
	"context"
	"fmt"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"

	"slicer-labeler/internal/db"
	"slicer-labeler/internal/model"
	"slicer-labeler/internal/service"
)

type SplitHandler struct {
	entryStore   *db.EntryStore
	datasetStore *db.DatasetStore
	modelStore   *db.ModelStore
	audio        *service.AudioService
}

// SplitResponse returns the two new entries from a split operation.
type SplitResponse struct {
	Success bool     `json:"success"`
	First   db.Entry `json:"first"`
	Second  db.Entry `json:"second"`
	Total   int64    `json:"total"`
}

func NewSplitHandler(entryStore *db.EntryStore, datasetStore *db.DatasetStore, modelStore *db.ModelStore, audio *service.AudioService) *SplitHandler {
	return &SplitHandler{entryStore: entryStore, datasetStore: datasetStore, modelStore: modelStore, audio: audio}
}

func (h *SplitHandler) Split(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("entryId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid entryId"})
	}

	var req model.SplitRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Minute)
	defer cancel()

	entry, err := h.entryStore.GetByID(ctx, id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if entry == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "entry not found"})
	}

	modelName, datasetName, err := resolveNames(ctx, h.datasetStore, h.modelStore, entry.DatasetID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	// Parse filename to compute new filenames
	basename := filepath.Base(entry.WavPath)
	basename = strings.TrimSuffix(basename, filepath.Ext(basename))

	bvid, p, ch, date, timePart, start, end, ok := service.ParseFilename(basename)
	if !ok {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "cannot parse filename: " + basename})
	}

	originalStart, _ := strconv.Atoi(start)
	originalEnd, _ := strconv.Atoi(end)
	sampleRate := 32000
	splitSamples := int(req.SplitTime * float64(sampleRate))

	firstStart := originalStart
	firstEnd := originalStart + splitSamples
	secondStart := originalStart + splitSamples
	secondEnd := originalEnd

	firstBasename := fmt.Sprintf("vocal_%s-p%s_ch%s_%s_%s.m4a_10.wav_%010d_%010d", bvid, p, ch, date, timePart, firstStart, firstEnd)
	secondBasename := fmt.Sprintf("vocal_%s-p%s_ch%s_%s_%s.m4a_10.wav_%010d_%010d", bvid, p, ch, date, timePart, secondStart, secondEnd)

	firstKey, secondKey, err := h.audio.SplitAndUpload(ctx, modelName, datasetName, entry.WavPath,
		firstBasename, secondBasename, req.SplitTime)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	// Split text by runes so multi-byte (e.g. Chinese) characters are not cut mid-sequence.
	runes := []rune(req.Text)
	splitIdx := req.SplitTextIndex
	if splitIdx < 0 {
		splitIdx = 0
	}
	if splitIdx > len(runes) {
		splitIdx = len(runes)
	}
	text1 := strings.TrimSpace(string(runes[:splitIdx]))
	text2 := strings.TrimSpace(string(runes[splitIdx:]))

	// Persist both halves and remove the original entry atomically.
	// Entries store the bare filename; the object path is derived from it.
	firstBase := filepath.Base(firstKey)
	secondBase := filepath.Base(secondKey)
	entries, err := h.entryStore.SplitReplace(ctx, entry.DatasetID, entry.ID, model.EntryInput{
		WavPath:  firstBase,
		Speaker:  req.Speaker,
		Language: req.Language,
		Text:     text1,
		MetaData: service.ParseEntryMetaData(firstBase),
	}, model.EntryInput{
		WavPath:  secondBase,
		Speaker:  req.Speaker,
		Language: req.Language,
		Text:     text2,
		MetaData: service.ParseEntryMetaData(secondBase),
	})
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	total, _ := h.entryStore.CountByDataset(ctx, entry.DatasetID)

	return c.JSON(http.StatusOK, SplitResponse{
		Success: true,
		First:   entries[0],
		Second:  entries[1],
		Total:   total,
	})
}
