package handler

import (
	"fmt"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/labstack/echo/v4"

	"slicer-labeler/internal/model"
	"slicer-labeler/internal/repository"
	"slicer-labeler/internal/service"
)

type MergeHandler struct {
	entryRepo *repository.EntryRepo
	audio     *service.AudioService
	deepseek  *service.DeepSeekService
}

func NewMergeHandler(entryRepo *repository.EntryRepo, audio *service.AudioService, deepseek *service.DeepSeekService) *MergeHandler {
	return &MergeHandler{entryRepo: entryRepo, audio: audio, deepseek: deepseek}
}

func (h *MergeHandler) Merge(c echo.Context) error {
	var req model.MergeRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	if len(req.Entries) < 2 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Need at least 2 entries"})
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

	firstAbs, err := h.audio.ResolvePath(req.Entries[0].WavPath)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	outputDir := filepath.Dir(firstAbs)
	outputPath := filepath.Join(outputDir, mergedBasename+".wav")

	var inputPaths []string
	for _, e := range req.Entries {
		abs, err := h.audio.ResolvePath(e.WavPath)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		inputPaths = append(inputPaths, abs)
	}

	if err := h.audio.Merge(inputPaths, outputPath); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	dataDir := strings.TrimRight(h.audio.DataDir(), "/")
	mergedRel := strings.TrimPrefix(strings.ReplaceAll(outputPath, "\\", "/"), dataDir)
	mergedRel = strings.TrimPrefix(mergedRel, "/")

	resp := model.MergeResponse{
		Success: true,
		Merged: model.EntryInput{
			WavPath:  mergedRel,
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
