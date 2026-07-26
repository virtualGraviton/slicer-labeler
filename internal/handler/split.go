package handler

import (
	"fmt"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"

	"slicer-labeler/internal/db"
	"slicer-labeler/internal/model"
	"slicer-labeler/internal/service"
)

type SplitHandler struct {
	entryStore *db.EntryStore
	audio      *service.AudioService
}

func NewSplitHandler(entryStore *db.EntryStore, audio *service.AudioService) *SplitHandler {
	return &SplitHandler{entryStore: entryStore, audio: audio}
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

	entry, err := h.entryStore.GetByID(c.Request().Context(), id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if entry == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "entry not found"})
	}

	absPath, err := h.audio.ResolvePath(entry.WavPath)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	// Parse filename
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

	outputDir := filepath.Dir(absPath)
	firstPath, secondPath, err := h.audio.Split(absPath, outputDir, req.SplitTime, firstBasename, secondBasename)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	// Compute relative paths from data dir
	dataDir := strings.TrimRight(h.audio.DataDir(), "/")
	firstRel := strings.TrimPrefix(strings.ReplaceAll(firstPath, "\\", "/"), dataDir)
	firstRel = strings.TrimPrefix(firstRel, "/")
	secondRel := strings.TrimPrefix(strings.ReplaceAll(secondPath, "\\", "/"), dataDir)
	secondRel = strings.TrimPrefix(secondRel, "/")

	// Split text
	text1 := strings.TrimSpace(req.Text[:req.SplitTextIndex])
	text2 := strings.TrimSpace(req.Text[req.SplitTextIndex:])

	resp := model.SplitResponse{
		Success: true,
		First: model.EntryInput{
			WavPath:  firstRel,
			Speaker:  req.Speaker,
			Language: req.Language,
			Text:     text1,
		},
		Second: model.EntryInput{
			WavPath:  secondRel,
			Speaker:  req.Speaker,
			Language: req.Language,
			Text:     text2,
		},
	}

	return c.JSON(http.StatusOK, resp)
}
