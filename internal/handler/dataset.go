package handler

import (
	"net/http"
	"strconv"

	"github.com/labstack/echo/v4"

	"slicer-labeler/internal/db"
	"slicer-labeler/internal/model"
)

type DatasetHandler struct {
	store *db.DatasetStore
}

func NewDatasetHandler(store *db.DatasetStore) *DatasetHandler {
	return &DatasetHandler{store: store}
}

func (h *DatasetHandler) List(c echo.Context) error {
	modelID, err := strconv.ParseInt(c.Param("modelId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid modelId"})
	}
	datasets, err := h.store.ListByModel(c.Request().Context(), modelID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, datasets)
}

func (h *DatasetHandler) Get(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("datasetId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid datasetId"})
	}
	d, err := h.store.Get(c.Request().Context(), id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if d == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "dataset not found"})
	}
	return c.JSON(http.StatusOK, d)
}

func (h *DatasetHandler) Create(c echo.Context) error {
	modelID, err := strconv.ParseInt(c.Param("modelId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid modelId"})
	}
	var req model.CreateDatasetRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	if req.Name == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "name is required"})
	}
	d, err := h.store.Create(c.Request().Context(), modelID, req.Name, req.Description)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.JSON(http.StatusCreated, d)
}

func (h *DatasetHandler) Update(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("datasetId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid datasetId"})
	}
	var req model.UpdateDatasetRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	d, err := h.store.Update(c.Request().Context(), id, req.Name, req.Description)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if d == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "dataset not found"})
	}
	return c.JSON(http.StatusOK, d)
}

func (h *DatasetHandler) Delete(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("datasetId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid datasetId"})
	}
	deleted, err := h.store.Delete(c.Request().Context(), id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if !deleted {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "dataset not found"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"success": true})
}
