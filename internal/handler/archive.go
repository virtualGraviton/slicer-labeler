package handler

import (
	"fmt"
	"log"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"

	"slicer-labeler/internal/db"
	"slicer-labeler/internal/model"
	"slicer-labeler/internal/service"
)

// ArchiveHandler writes a dataset back to the inference-machine layout
// (output/slicer_opt/*.wav + output/asr_opt/*.list) inside object storage.
type ArchiveHandler struct {
	entryStore   *db.EntryStore
	datasetStore *db.DatasetStore
	modelStore   *db.ModelStore
	storage      *service.StorageService
}

func NewArchiveHandler(entryStore *db.EntryStore, datasetStore *db.DatasetStore, modelStore *db.ModelStore, storage *service.StorageService) *ArchiveHandler {
	return &ArchiveHandler{
		entryStore:   entryStore,
		datasetStore: datasetStore,
		modelStore:   modelStore,
		storage:      storage,
	}
}

// Archive copies all valid (non-deleted) entries of a dataset to the archived
// area via server-side CopyObject, and writes the companion .list file.
func (h *ArchiveHandler) Archive(c echo.Context) error {
	datasetID, err := strconv.ParseInt(c.Param("datasetId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid datasetId"})
	}

	ctx := c.Request().Context()
	modelName, datasetName, err := resolveNames(ctx, h.datasetStore, h.modelStore, datasetID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	// Fetch all valid entries in sort order (paginated).
	const pageSize = 100000
	var all []db.Entry
	for page := 1; ; page++ {
		entries, total, err := h.entryStore.ListByDataset(ctx, datasetID, page, pageSize)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		all = append(all, entries...)
		if len(entries) == 0 || int64(page)*pageSize >= total {
			break
		}
	}

	start := time.Now()
	var sb strings.Builder
	for _, e := range all {
		src := h.storage.ObjectKey(modelName, datasetName, e.WavPath)
		dst := h.storage.ArchiveWavKey(modelName, datasetName, e.WavPath)
		if err := h.storage.CopyObject(ctx, src, dst); err != nil {
			log.Printf("[archive] dataset=%d copy %s failed: %v", datasetID, e.WavPath, err)
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		sb.WriteString(fmt.Sprintf("output/slicer_opt/%s|%s|%s|%s\n",
			filepath.Base(e.WavPath), e.Speaker, e.Language, e.Text))
	}

	listKey := h.storage.ArchiveListKey(modelName, datasetName)
	if err := h.storage.PutString(ctx, listKey, sb.String()); err != nil {
		log.Printf("[archive] dataset=%d write list failed: %v", datasetID, err)
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	log.Printf("[archive] dataset=%d done: %d entries -> %s (%s)", datasetID, len(all), listKey, time.Since(start).Round(time.Millisecond))

	return c.JSON(http.StatusOK, model.ArchiveResponse{
		Success:  true,
		Count:    len(all),
		Prefix:   fmt.Sprintf("%s/archived/%s/%s", h.storage.Prefix(), modelName, datasetName),
		ListPath: listKey,
	})
}
