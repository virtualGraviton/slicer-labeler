package handler

import (
	"net/http"
	"strconv"

	"github.com/labstack/echo/v4"

	"slicer-labeler/internal/db"
	"slicer-labeler/internal/model"
	"slicer-labeler/internal/service"
)

type DatasetHandler struct {
	store *db.DatasetStore
	tm    *TaskManager
	auth  *service.AuthService
}

func NewDatasetHandler(store *db.DatasetStore, tm *TaskManager, auth *service.AuthService) *DatasetHandler {
	return &DatasetHandler{store: store, tm: tm, auth: auth}
}

func (h *DatasetHandler) List(c echo.Context) error {
	ctx := c.Request().Context()
	user, _ := c.Get("user").(*db.User)
	modelID, err := strconv.ParseInt(c.Param("modelId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid modelId"})
	}
	if !h.auth.CanReadModel(ctx, user, modelID) {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "model not found"})
	}
	datasets, err := h.store.ListByModel(ctx, modelID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	visible, err := h.auth.VisibleDatasets(ctx, user, modelID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	var out []db.Dataset
	if visible == nil {
		out = datasets
	} else {
		set := map[int64]bool{}
		for _, id := range visible {
			set[id] = true
		}
		for _, d := range datasets {
			if set[d.ID] {
				out = append(out, d)
			}
		}
	}
	for i := range out {
		d := &out[i]
		d.CanRead = true
		d.CanWrite = h.auth.CanWriteDataset(ctx, user, d.ID)
		d.CanDelete = h.auth.CanDeleteDataset(ctx, user, d.ID)
		d.CanManage = h.auth.CanManageDataset(ctx, user, d.ID)
	}
	if out == nil {
		out = []db.Dataset{}
	}
	return c.JSON(http.StatusOK, out)
}

func (h *DatasetHandler) Get(c echo.Context) error {
	ctx := c.Request().Context()
	user, _ := c.Get("user").(*db.User)
	id, err := strconv.ParseInt(c.Param("datasetId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid datasetId"})
	}
	d, err := h.store.Get(ctx, id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if d == nil || !h.auth.CanReadDataset(ctx, user, id) {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "dataset not found"})
	}
	d.CanRead = true
	d.CanWrite = h.auth.CanWriteDataset(ctx, user, id)
	d.CanDelete = h.auth.CanDeleteDataset(ctx, user, id)
	d.CanManage = h.auth.CanManageDataset(ctx, user, id)
	return c.JSON(http.StatusOK, d)
}

func (h *DatasetHandler) Create(c echo.Context) error {
	ctx := c.Request().Context()
	user, _ := c.Get("user").(*db.User)
	modelID, err := strconv.ParseInt(c.Param("modelId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid modelId"})
	}
	if !h.auth.CanWriteModel(ctx, user, modelID) {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "无权限"})
	}
	var req model.CreateDatasetRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	if req.Name == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "name is required"})
	}
	d, err := h.store.Create(ctx, modelID, user.ID, req.Name, req.Description)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.JSON(http.StatusCreated, d)
}

func (h *DatasetHandler) Update(c echo.Context) error {
	ctx := c.Request().Context()
	user, _ := c.Get("user").(*db.User)
	id, err := strconv.ParseInt(c.Param("datasetId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid datasetId"})
	}
	if !h.auth.CanWriteDataset(ctx, user, id) {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "无权限"})
	}
	if err := datasetBusy(h.tm, id); err != nil {
		return err
	}
	var req model.UpdateDatasetRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	d, err := h.store.Update(ctx, id, req.Name, req.Description)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if d == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "dataset not found"})
	}
	return c.JSON(http.StatusOK, d)
}

func (h *DatasetHandler) Delete(c echo.Context) error {
	ctx := c.Request().Context()
	user, _ := c.Get("user").(*db.User)
	id, err := strconv.ParseInt(c.Param("datasetId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid datasetId"})
	}
	if !h.auth.CanDeleteDataset(ctx, user, id) {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "无权限"})
	}
	if err := datasetBusy(h.tm, id); err != nil {
		return err
	}
	deleted, err := h.store.Delete(ctx, id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if !deleted {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "dataset not found"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"success": true})
}
