package handler

import (
	"context"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/labstack/echo/v4"

	"slicer-labeler/internal/db"
	"slicer-labeler/internal/model"
	"slicer-labeler/internal/service"
)

type MergeHandler struct {
	entryStore   *db.EntryStore
	datasetStore *db.DatasetStore
	modelStore   *db.ModelStore
	audio        *service.AudioService
	deepseek     *service.DeepSeekService
}

// MergeResponse returns the merged entry.
type MergeResponse struct {
	Success bool      `json:"success"`
	Merged  *db.Entry `json:"merged"`
	Total   int64     `json:"total"`
}

func NewMergeHandler(entryStore *db.EntryStore, datasetStore *db.DatasetStore, modelStore *db.ModelStore, audio *service.AudioService, deepseek *service.DeepSeekService) *MergeHandler {
	return &MergeHandler{entryStore: entryStore, datasetStore: datasetStore, modelStore: modelStore, audio: audio, deepseek: deepseek}
}

func (h *MergeHandler) Merge(c echo.Context) error {
	var req model.MergeRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	if len(req.Entries) < 2 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Need at least 2 entries"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Minute)
	defer cancel()

	// Resolve model/dataset from the first entry (look up by wav path)
	datasetID, modelName, datasetName, err := h.resolveFromFirstEntry(ctx, req.Entries)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	firstBasename := filepath.Base(req.Entries[0].WavPath)
	firstBasename = strings.TrimSuffix(firstBasename, filepath.Ext(firstBasename))
	lastBasename := filepath.Base(req.Entries[len(req.Entries)-1].WavPath)
	lastBasename = strings.TrimSuffix(lastBasename, filepath.Ext(lastBasename))

	bvid, p, ch, date, timePart, start, _, ok := service.ParseFilename(firstBasename)
	if !ok {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Cannot parse filename: " + firstBasename})
	}
	_, _, _, _, _, _, end, ok2 := service.ParseFilename(lastBasename)
	if !ok2 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Cannot parse filename: " + lastBasename})
	}

	mergedBasename := fmt.Sprintf("vocal_%s-p%s_ch%s_%s_%s.m4a_10.wav_%s_%s", bvid, p, ch, date, timePart, start, end)

	var wavPaths []string
	for _, e := range req.Entries {
		wavPaths = append(wavPaths, e.WavPath)
	}

	mergedKey, err := h.audio.MergeAndUpload(ctx, modelName, datasetName, wavPaths, mergedBasename)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	// Resolve source entry ids and persist the merge atomically (remove sources).
	var sourceIDs []int64
	for _, e := range req.Entries {
		src, err := h.entryStore.FindByWavPath(ctx, filepath.Base(e.WavPath))
		if err == nil && src != nil {
			sourceIDs = append(sourceIDs, src.ID)
		}
	}
	mergedBase := filepath.Base(mergedKey)
	mergedEntry, err := h.entryStore.MergeReplace(ctx, datasetID, sourceIDs, model.EntryInput{
		WavPath:  mergedBase,
		Speaker:  req.Speaker,
		Language: req.Language,
		Text:     req.MergedText,
		MetaData: service.ParseEntryMetaData(mergedBase),
	})
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	total, _ := h.entryStore.CountByDataset(ctx, datasetID)

	return c.JSON(http.StatusOK, MergeResponse{
		Success: true,
		Merged:  mergedEntry,
		Total:   total,
	})
}

func (h *MergeHandler) Polish(c echo.Context) error {
	var req model.PolishMergeRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	if len(req.Entries) < 2 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Need at least 2 entries"})
	}

	polished, explanation, err := h.deepseek.PolishMergeText(req.Entries, req.HardMergedText, req.Speaker, req.Language)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	resp := model.PolishMergeResponse{
		PolishedText:  polished,
		ExplanationZh: explanation,
		Model:         h.deepseek.GetModel(),
	}

	return c.JSON(http.StatusOK, resp)
}

func (h *MergeHandler) resolveFromFirstEntry(ctx context.Context, entries []model.EntryInput) (datasetID int64, modelName, datasetName string, err error) {
	first := entries[0]
	filename := filepath.Base(first.WavPath)

	entry, err := h.entryStore.FindByWavPath(ctx, filename)
	if err != nil || entry == nil {
		return 0, "", "", fmt.Errorf("cannot resolve dataset for %s", filename)
	}
	modelName, datasetName, err = resolveNames(ctx, h.datasetStore, h.modelStore, entry.DatasetID)
	if err != nil {
		return 0, "", "", err
	}
	return entry.DatasetID, modelName, datasetName, nil
}
