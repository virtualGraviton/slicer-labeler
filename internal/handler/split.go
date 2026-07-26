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
	entryStore   *db.EntryStore
	datasetStore *db.DatasetStore
	modelStore   *db.ModelStore
	audio        *service.AudioService
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

	ctx := c.Request().Context()

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

	// Split text
	text1 := strings.TrimSpace(req.Text[:req.SplitTextIndex])
	text2 := strings.TrimSpace(req.Text[req.SplitTextIndex:])

	resp := model.SplitResponse{
		Success: true,
		First: model.EntryInput{
			WavPath:  firstKey,
			Speaker:  req.Speaker,
			Language: req.Language,
			Text:     text1,
		},
		Second: model.EntryInput{
			WavPath:  secondKey,
			Speaker:  req.Speaker,
			Language: req.Language,
			Text:     text2,
		},
	}

	return c.JSON(http.StatusOK, resp)
}
