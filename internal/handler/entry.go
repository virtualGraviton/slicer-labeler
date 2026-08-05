package handler

import (
	"net/http"
	"strconv"

	"github.com/labstack/echo/v4"

	"slicer-labeler/internal/db"
	"slicer-labeler/internal/model"
	"slicer-labeler/internal/service"
)

type EntryHandler struct {
	store        *db.EntryStore
	datasetStore *db.DatasetStore
	tm           *TaskManager
	auth         *service.AuthService
}

func NewEntryHandler(store *db.EntryStore, datasetStore *db.DatasetStore, tm *TaskManager, auth *service.AuthService) *EntryHandler {
	return &EntryHandler{store: store, datasetStore: datasetStore, tm: tm, auth: auth}
}

func (h *EntryHandler) List(c echo.Context) error {
	ctx := c.Request().Context()
	user, _ := c.Get("user").(*db.User)
	datasetID, err := strconv.ParseInt(c.Param("datasetId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid datasetId"})
	}
	if !h.auth.CanReadDataset(ctx, user, datasetID) {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "dataset not found"})
	}

	page, _ := strconv.Atoi(c.QueryParam("page"))
	if page < 1 {
		page = 1
	}
	pageSize, _ := strconv.Atoi(c.QueryParam("page_size"))
	if pageSize < 1 || pageSize > 100000 {
		pageSize = 20
	}

	entries, total, err := h.store.ListByDataset(ctx, datasetID, page, pageSize)
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
	ctx := c.Request().Context()
	user, _ := c.Get("user").(*db.User)
	datasetID, err := strconv.ParseInt(c.Param("datasetId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid datasetId"})
	}
	if !h.auth.CanWriteDataset(ctx, user, datasetID) {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "无权限"})
	}
	if err := datasetBusy(h.tm, datasetID); err != nil {
		return err
	}

	var req model.BatchUpsertEntriesRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	count, err := h.store.BatchUpsert(ctx, datasetID, req.Entries)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"success": true,
		"count":   count,
	})
}

func (h *EntryHandler) Update(c echo.Context) error {
	ctx := c.Request().Context()
	user, _ := c.Get("user").(*db.User)
	id, err := strconv.ParseInt(c.Param("entryId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid entryId"})
	}

	var req model.UpdateEntryRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	entry, err := h.store.GetByID(ctx, id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if entry == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "entry not found"})
	}
	if !h.auth.CanWriteDataset(ctx, user, entry.DatasetID) {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "无权限"})
	}
	if err := datasetBusy(h.tm, entry.DatasetID); err != nil {
		return err
	}

	updated, err := h.store.UpdateText(ctx, id, req.Text)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, updated)
}

func (h *EntryHandler) Delete(c echo.Context) error {
	ctx := c.Request().Context()
	user, _ := c.Get("user").(*db.User)
	id, err := strconv.ParseInt(c.Param("entryId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid entryId"})
	}

	entry, err := h.store.GetByID(ctx, id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if entry == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "entry not found"})
	}
	if !h.auth.CanWriteDataset(ctx, user, entry.DatasetID) {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "无权限"})
	}
	if err := datasetBusy(h.tm, entry.DatasetID); err != nil {
		return err
	}

	deleted, err := h.store.Delete(ctx, id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if !deleted {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "entry not found"})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"success": true})
}
