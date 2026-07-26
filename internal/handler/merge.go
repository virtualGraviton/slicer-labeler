package handler

import (
	"context"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"

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

	ctx := c.Request().Context()

	// Resolve model/dataset from the first entry (look up by wav path)
	modelName, datasetName, err := h.resolveFromFirstEntry(ctx, req.Entries)
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

	resp := model.MergeResponse{
		Success: true,
		Merged: model.EntryInput{
			WavPath:  mergedKey,
			Speaker:  req.Speaker,
			Language: req.Language,
			Text:     req.MergedText,
		},
	}

	return c.JSON(http.StatusOK, resp)
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

func (h *MergeHandler) resolveFromFirstEntry(ctx context.Context, entries []model.EntryInput) (modelName, datasetName string, err error) {
	first := entries[0]
	filename := filepath.Base(first.WavPath)

	entry, err := h.entryStore.FindByWavPath(ctx, filename)
	if err != nil || entry == nil {
		return "", "", fmt.Errorf("cannot resolve dataset for %s", filename)
	}
	return resolveNames(ctx, h.datasetStore, h.modelStore, entry.DatasetID)
}
