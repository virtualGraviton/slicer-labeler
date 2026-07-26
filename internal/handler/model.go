package handler

import (
	"net/http"
	"strconv"

	"github.com/labstack/echo/v4"

	"slicer-labeler/internal/db"
	"slicer-labeler/internal/model"
)

type ModelHandler struct {
	store *db.ModelStore
}

func NewModelHandler(store *db.ModelStore) *ModelHandler {
	return &ModelHandler{store: store}
}

func (h *ModelHandler) List(c echo.Context) error {
	models, err := h.store.List(c.Request().Context())
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, models)
}

func (h *ModelHandler) Get(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("modelId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid modelId"})
	}
	m, err := h.store.Get(c.Request().Context(), id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if m == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "model not found"})
	}
	return c.JSON(http.StatusOK, m)
}

func (h *ModelHandler) Create(c echo.Context) error {
	var req model.CreateModelRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	if req.Name == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "name is required"})
	}
	m, err := h.store.Create(c.Request().Context(), req.Name, req.Description)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.JSON(http.StatusCreated, m)
}

func (h *ModelHandler) Update(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("modelId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid modelId"})
	}
	var req model.UpdateModelRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	m, err := h.store.Update(c.Request().Context(), id, req.Name, req.Description)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if m == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "model not found"})
	}
	return c.JSON(http.StatusOK, m)
}

func (h *ModelHandler) Delete(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("modelId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid modelId"})
	}
	deleted, err := h.store.Delete(c.Request().Context(), id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if !deleted {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "model not found"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"success": true})
}
