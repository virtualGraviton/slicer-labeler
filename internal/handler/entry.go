package handler

import (
	"net/http"
	"strconv"

	"github.com/labstack/echo/v4"

	"slicer-labeler/internal/db"
	"slicer-labeler/internal/model"
)

type EntryHandler struct {
	store       *db.EntryStore
	qualityStore *db.QualityStore
}

func NewEntryHandler(store *db.EntryStore, qualityStore *db.QualityStore) *EntryHandler {
	return &EntryHandler{store: store, qualityStore: qualityStore}
}

func (h *EntryHandler) List(c echo.Context) error {
	datasetID, err := strconv.ParseInt(c.Param("datasetId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid datasetId"})
	}

	page, _ := strconv.Atoi(c.QueryParam("page"))
	if page < 1 {
		page = 1
	}
	pageSize, _ := strconv.Atoi(c.QueryParam("page_size"))
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	entries, total, err := h.store.ListByDataset(c.Request().Context(), datasetID, page, pageSize)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, model.PaginatedResponse{
		Data:     entries,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	})
}

func (h *EntryHandler) BatchUpsert(c echo.Context) error {
	datasetID, err := strconv.ParseInt(c.Param("datasetId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid datasetId"})
	}

	var req model.BatchUpsertEntriesRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	count, err := h.store.BatchUpsert(c.Request().Context(), datasetID, req.Entries)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"count":   count,
	})
}

func (h *EntryHandler) Update(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("entryId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid entryId"})
	}

	var req model.UpdateEntryRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	entry, err := h.store.UpdateText(c.Request().Context(), id, req.Text)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if entry == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "entry not found"})
	}

	return c.JSON(http.StatusOK, entry)
}

func (h *EntryHandler) Delete(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("entryId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid entryId"})
	}

	// Delete quality result first (cascade handles this, but explicit is safer)
	_ = h.qualityStore.DeleteByEntryID(c.Request().Context(), id)

	deleted, err := h.store.Delete(c.Request().Context(), id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if !deleted {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "entry not found"})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"success": true})
}
