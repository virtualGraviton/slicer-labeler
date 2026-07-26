package handler

import (
	"net/http"
	"strconv"

	"github.com/labstack/echo/v4"

	"slicer-labeler/internal/repository"
	"slicer-labeler/internal/service"
)

type AudioHandler struct {
	entryRepo *repository.EntryRepo
	storage   *service.StorageService
}

func NewAudioHandler(entryRepo *repository.EntryRepo, storage *service.StorageService) *AudioHandler {
	return &AudioHandler{entryRepo: entryRepo, storage: storage}
}

func (h *AudioHandler) GetAudio(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("entryId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid entryId"})
	}

	entry, err := h.entryRepo.GetByID(c.Request().Context(), id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if entry == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "entry not found"})
	}

	url := h.storage.GenerateURL(entry.WavPath)
	return c.Redirect(http.StatusFound, url)
}
