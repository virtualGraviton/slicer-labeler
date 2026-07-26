package handler

import (
	"net/http"
	"strconv"

	"github.com/labstack/echo/v4"

	"slicer-labeler/internal/db"
	"slicer-labeler/internal/service"
)

type AudioHandler struct {
	entryStore   *db.EntryStore
	datasetStore *db.DatasetStore
	modelStore   *db.ModelStore
	storage      *service.StorageService
}

func NewAudioHandler(
	entryStore *db.EntryStore,
	datasetStore *db.DatasetStore,
	modelStore *db.ModelStore,
	storage *service.StorageService,
) *AudioHandler {
	return &AudioHandler{
		entryStore:   entryStore,
		datasetStore: datasetStore,
		modelStore:   modelStore,
		storage:      storage,
	}
}

func (h *AudioHandler) GetAudio(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("entryId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid entryId"})
	}

	entry, err := h.entryStore.GetByID(c.Request().Context(), id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if entry == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "entry not found"})
	}

	dataset, err := h.datasetStore.Get(c.Request().Context(), entry.DatasetID)
	if err != nil || dataset == nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "dataset not found"})
	}

	model, err := h.modelStore.Get(c.Request().Context(), dataset.ModelID)
	if err != nil || model == nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "model not found"})
	}

	url := h.storage.GenerateURL(model.Name, dataset.Name, entry.WavPath)
	return c.Redirect(http.StatusFound, url)
}
