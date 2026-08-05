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
	auth         *service.AuthService
}

func NewAudioHandler(
	entryStore *db.EntryStore,
	datasetStore *db.DatasetStore,
	modelStore *db.ModelStore,
	storage *service.StorageService,
	auth *service.AuthService,
) *AudioHandler {
	return &AudioHandler{
		entryStore:   entryStore,
		datasetStore: datasetStore,
		modelStore:   modelStore,
		storage:      storage,
		auth:         auth,
	}
}

func (h *AudioHandler) GetAudio(c echo.Context) error {
	ctx := c.Request().Context()
	user, _ := c.Get("user").(*db.User)
	id, err := strconv.ParseInt(c.Param("entryId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid entryId"})
	}

	entry, err := h.entryStore.GetByID(ctx, id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if entry == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "entry not found"})
	}
	if !h.auth.CanReadDataset(ctx, user, entry.DatasetID) {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "entry not found"})
	}

	dataset, err := h.datasetStore.Get(ctx, entry.DatasetID)
	if err != nil || dataset == nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "dataset not found"})
	}

	model, err := h.modelStore.Get(ctx, dataset.ModelID)
	if err != nil || model == nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "model not found"})
	}

	reader, err := h.storage.DownloadStream(ctx, model.Name, dataset.Name, entry.WavPath)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to fetch audio: " + err.Error()})
	}
	defer reader.Close()

	return c.Stream(http.StatusOK, "audio/wav", reader)
}
