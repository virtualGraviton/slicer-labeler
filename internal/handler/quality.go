package handler

import (
	"net/http"
	"strconv"

	"github.com/labstack/echo/v4"

	"slicer-labeler/internal/model"
	"slicer-labeler/internal/repository"
	"slicer-labeler/internal/service"
)

type QualityHandler struct {
	entryRepo   *repository.EntryRepo
	qualityRepo *repository.QualityRepo
	qualitySvc  *service.QualityService
}

func NewQualityHandler(
	entryRepo *repository.EntryRepo,
	qualityRepo *repository.QualityRepo,
	qualitySvc *service.QualityService,
) *QualityHandler {
	return &QualityHandler{
		entryRepo:   entryRepo,
		qualityRepo: qualityRepo,
		qualitySvc:  qualitySvc,
	}
}

func (h *QualityHandler) Check(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("entryId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid entryId"})
	}

	var req model.CheckQualityRequest
	c.Bind(&req)

	entry, err := h.entryRepo.GetByID(c.Request().Context(), id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if entry == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "entry not found"})
	}

	// Get next entry for semantic analysis
	nextEntry, _ := h.entryRepo.GetNext(c.Request().Context(), id, entry.DatasetID)

	result, err := h.qualitySvc.RunQualityCheck(c.Request().Context(), entry, nextEntry, req.Force)
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

	results, err := h.qualityRepo.ListByDataset(c.Request().Context(), datasetID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	// Filter valid results (status == ok)
	valid := make([]model.QualityResult, 0)
	for _, r := range results {
		if r.Status == "ok" {
			valid = append(valid, r)
		}
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"results": valid})
}

func (h *QualityHandler) BatchCheck(c echo.Context) error {
	datasetID, err := strconv.ParseInt(c.Param("datasetId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid datasetId"})
	}

	// Get all entries in dataset
	entries, _, err := h.entryRepo.ListByDataset(c.Request().Context(), datasetID, 1, 10000)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	checked := 0
	failed := 0
	for i, entry := range entries {
		var nextEntry *model.Entry
		if i+1 < len(entries) {
			nextEntry = &entries[i+1]
		}

		_, err := h.qualitySvc.RunQualityCheck(c.Request().Context(), &entry, nextEntry, false)
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
