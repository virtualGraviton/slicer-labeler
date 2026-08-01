package handler

import (
	"net/http"
	"strconv"

	"github.com/labstack/echo/v4"

	"slicer-labeler/internal/db"
	"slicer-labeler/internal/model"
	"slicer-labeler/internal/service"
)

type QualityHandler struct {
	entryStore   *db.EntryStore
	qualityStore *db.QualityStore
	datasetStore *db.DatasetStore
	modelStore   *db.ModelStore
	qualitySvc   *service.QualityService
}

func NewQualityHandler(
	entryStore *db.EntryStore,
	qualityStore *db.QualityStore,
	datasetStore *db.DatasetStore,
	modelStore *db.ModelStore,
	qualitySvc *service.QualityService,
) *QualityHandler {
	return &QualityHandler{
		entryStore:   entryStore,
		qualityStore: qualityStore,
		datasetStore: datasetStore,
		modelStore:   modelStore,
		qualitySvc:   qualitySvc,
	}
}

func (h *QualityHandler) Check(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("entryId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid entryId"})
	}

	var req model.CheckQualityRequest
	c.Bind(&req)

	entry, err := h.entryStore.GetByID(c.Request().Context(), id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if entry == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "entry not found"})
	}

	modelName, datasetName, err := resolveNames(c.Request().Context(), h.datasetStore, h.modelStore, entry.DatasetID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	nextEntry, _ := h.entryStore.GetNext(c.Request().Context(), id, entry.DatasetID)

	result, err := h.qualitySvc.RunQualityCheck(c.Request().Context(), entry, nextEntry, modelName, datasetName, req.Force)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"result": result})
}

func (h *QualityHandler) Cache(c echo.Context) error {
	datasetID, err := strconv.ParseInt(c.Param("datasetId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid datasetId"})
	}

	page, _ := strconv.Atoi(c.QueryParam("page"))
	if page < 1 {
		page = 1
	}
	pageSize, _ := strconv.Atoi(c.QueryParam("page_size"))
	if pageSize < 1 || pageSize > 500 {
		pageSize = 10
	}

	results, total, err := h.qualityStore.ListByDataset(c.Request().Context(), datasetID, page, pageSize)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	valid := make([]db.QualityResult, 0, len(results))
	for _, r := range results {
		if r.Status == "ok" {
			valid = append(valid, r)
		}
	}

	return c.JSON(http.StatusOK, model.PaginatedResponse{Data: valid, Total: total, Page: page, PageSize: pageSize})
}

func (h *QualityHandler) BatchCheck(c echo.Context) error {
	datasetID, err := strconv.ParseInt(c.Param("datasetId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid datasetId"})
	}

	modelName, datasetName, err := resolveNames(c.Request().Context(), h.datasetStore, h.modelStore, datasetID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	entries, _, err := h.entryStore.ListByDataset(c.Request().Context(), datasetID, 1, 10000)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	checked := 0
	failed := 0
	for i, entry := range entries {
		var nextEntry *db.Entry
		if i+1 < len(entries) {
			nextEntry = &entries[i+1]
		}

		_, err := h.qualitySvc.RunQualityCheck(c.Request().Context(), &entry, nextEntry, modelName, datasetName, false)
		if err != nil {
			failed++
			continue
		}
		checked++
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"checked": checked,
		"failed":  failed,
		"total":   len(entries),
	})
}
