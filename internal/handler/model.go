package handler

import (
	"net/http"
	"strconv"

	"github.com/labstack/echo/v4"

	"slicer-labeler/internal/db"
	"slicer-labeler/internal/model"
	"slicer-labeler/internal/service"
)

type ModelHandler struct {
	store        *db.ModelStore
	datasetStore *db.DatasetStore
	tm           *TaskManager
	auth         *service.AuthService
}

func NewModelHandler(store *db.ModelStore, datasetStore *db.DatasetStore, tm *TaskManager, auth *service.AuthService) *ModelHandler {
	return &ModelHandler{store: store, datasetStore: datasetStore, tm: tm, auth: auth}
}

func (h *ModelHandler) List(c echo.Context) error {
	ctx := c.Request().Context()
	user, _ := c.Get("user").(*db.User)

	models, err := h.store.List(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	visible, err := h.auth.VisibleModels(ctx, user)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	var out []db.Model
	if visible == nil {
		out = models
	} else {
		set := map[int64]bool{}
		for _, id := range visible {
			set[id] = true
		}
		for _, m := range models {
			if set[m.ID] {
				out = append(out, m)
			}
		}
	}
	for i := range out {
		m := &out[i]
		m.CanRead = true
		m.CanWrite = h.auth.CanWriteModel(ctx, user, m.ID)
		m.CanDelete = h.auth.CanDeleteModel(ctx, user, m.ID)
		m.CanManage = h.auth.CanManageModel(ctx, user, m.ID)
	}
	if out == nil {
		out = []db.Model{}
	}
	return c.JSON(http.StatusOK, out)
}

func (h *ModelHandler) Get(c echo.Context) error {
	ctx := c.Request().Context()
	user, _ := c.Get("user").(*db.User)
	id, err := strconv.ParseInt(c.Param("modelId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid modelId"})
	}
	m, err := h.store.Get(ctx, id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	// Hide existence from unauthorized users (enumeration guard).
	if m == nil || !h.auth.CanReadModel(ctx, user, id) {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "model not found"})
	}
	m.CanRead = true
	m.CanWrite = h.auth.CanWriteModel(ctx, user, id)
	m.CanDelete = h.auth.CanDeleteModel(ctx, user, id)
	m.CanManage = h.auth.CanManageModel(ctx, user, id)
	return c.JSON(http.StatusOK, m)
}

func (h *ModelHandler) Create(c echo.Context) error {
	ctx := c.Request().Context()
	user, _ := c.Get("user").(*db.User)
	var req model.CreateModelRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	if req.Name == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "name is required"})
	}
	m, err := h.store.Create(ctx, user.ID, req.Name, req.Description)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.JSON(http.StatusCreated, m)
}

func (h *ModelHandler) Update(c echo.Context) error {
	ctx := c.Request().Context()
	user, _ := c.Get("user").(*db.User)
	id, err := strconv.ParseInt(c.Param("modelId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid modelId"})
	}
	if !h.auth.CanWriteModel(ctx, user, id) {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "无权限"})
	}
	var req model.UpdateModelRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	m, err := h.store.Update(ctx, id, req.Name, req.Description)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if m == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "model not found"})
	}
	return c.JSON(http.StatusOK, m)
}

func (h *ModelHandler) Delete(c echo.Context) error {
	ctx := c.Request().Context()
	user, _ := c.Get("user").(*db.User)
	id, err := strconv.ParseInt(c.Param("modelId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid modelId"})
	}
	if !h.auth.CanDeleteModel(ctx, user, id) {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "无权限"})
	}

	// A model cannot be deleted while any of its datasets is running a task.
	datasets, err := h.datasetStore.ListByModel(ctx, id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	datasetIDs := make([]int64, 0, len(datasets))
	for _, d := range datasets {
		datasetIDs = append(datasetIDs, d.ID)
	}
	if h.tm.IsAnyBusy(datasetIDs) {
		return c.JSON(http.StatusConflict, map[string]string{"error": "该模型下有数据集正在执行任务，暂时无法删除"})
	}

	deleted, err := h.store.Delete(ctx, id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if !deleted {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "model not found"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"success": true})
}
