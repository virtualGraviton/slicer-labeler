package handler

import (
	"context"
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

const (
	archiveStageCopy  = "copy"
	archiveStageWrite = "write"
)

// ArchiveHandler writes a dataset back to the inference-machine layout
// (output/slicer_opt/*.wav + output/asr_opt/*.list) inside object storage.
// The operation runs as an async task (CopyObject loop + list write).
type ArchiveHandler struct {
	entryStore   *db.EntryStore
	datasetStore *db.DatasetStore
	modelStore   *db.ModelStore
	storage      *service.StorageService
	tm           *TaskManager
	auth         *service.AuthService
}

func NewArchiveHandler(entryStore *db.EntryStore, datasetStore *db.DatasetStore, modelStore *db.ModelStore, storage *service.StorageService, tm *TaskManager, auth *service.AuthService) *ArchiveHandler {
	return &ArchiveHandler{
		entryStore:   entryStore,
		datasetStore: datasetStore,
		modelStore:   modelStore,
		storage:      storage,
		tm:           tm,
		auth:         auth,
	}
}

// Archive starts an async archive task and returns its jobId immediately.
func (h *ArchiveHandler) Archive(c echo.Context) error {
	datasetID, err := strconv.ParseInt(c.Param("datasetId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid datasetId"})
	}

	ctx := c.Request().Context()
	d, err := h.datasetStore.Get(ctx, datasetID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if d == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "dataset not found"})
	}
	user, _ := c.Get("user").(*db.User)
	if !h.auth.CanWriteDataset(ctx, user, datasetID) {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "无权限"})
	}

	modelName, datasetName, err := resolveNames(ctx, h.datasetStore, h.modelStore, datasetID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	task, err := h.tm.TryLock(datasetID, d.ModelID, modelName, datasetName, model.TaskTypeArchive)
	if err != nil {
		return c.JSON(http.StatusConflict, map[string]string{"error": fmt.Sprintf("数据集「%s」正在执行任务，请稍后再试", datasetName)})
	}

	log.Printf("[archive] task=%s dataset=%d start (%s/%s)", task.ID, datasetID, modelName, datasetName)
	go h.runArchiveTask(task, datasetID, modelName, datasetName)

	return c.JSON(http.StatusOK, map[string]string{"jobId": task.ID})
}

func (h *ArchiveHandler) runArchiveTask(task *Task, datasetID int64, modelName, datasetName string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	defer close(task.Done)
	defer h.tm.Unlock(datasetID, task.ID)

	defer func() {
		if r := recover(); r != nil {
			log.Printf("[archive] task=%s panic: %v", task.ID, r)
			task.update(model.TaskStatusError, "", -1, -1, -1, nil, nil, "", "internal error: "+fmt.Sprint(r))
		}
	}()

	start := time.Now()

	// Fetch all valid entries in sort order (paginated).
	const pageSize = 100000
	var all []db.Entry
	for page := 1; ; page++ {
		entries, total, err := h.entryStore.ListByDataset(ctx, datasetID, page, pageSize)
		if err != nil {
			log.Printf("[archive] task=%s list entries failed: %v", task.ID, err)
			task.update(model.TaskStatusError, archiveStageCopy, -1, -1, -1, nil, nil, "", "读取条目失败: "+err.Error())
			return
		}
		all = append(all, entries...)
		if len(entries) == 0 || int64(page)*pageSize >= total {
			break
		}
	}
	log.Printf("[archive] task=%s fetched %d entries", task.ID, len(all))

	// Stage 1: server-side copy each wav to the archived layout.
	var sb strings.Builder
	task.update("", archiveStageCopy, 0, -1, -1, nil, nil, "", "")
	for i, e := range all {
		src := h.storage.ObjectKey(modelName, datasetName, e.WavPath)
		dst := h.storage.ArchiveWavKey(modelName, datasetName, e.WavPath)
		if err := h.storage.CopyObject(ctx, src, dst); err != nil {
			log.Printf("[archive] task=%s copy %s failed: %v", task.ID, e.WavPath, err)
			task.update(model.TaskStatusError, archiveStageCopy, -1, -1, -1, nil, nil, "", "复制失败 "+e.WavPath+": "+err.Error())
			return
		}
		sb.WriteString(fmt.Sprintf("output/slicer_opt/%s|%s|%s|%s\n",
			filepath.Base(e.WavPath), e.Speaker, e.Language, e.Text))
		if i%50 == 0 || i == len(all)-1 {
			p := 0
			if len(all) > 0 {
				p = int(float64(i+1) / float64(len(all)) * 90)
			}
			task.update("", archiveStageCopy, p, -1, i+1, nil, nil, "", "")
		}
	}
	log.Printf("[archive] task=%s copied %d files", task.ID, len(all))

	// Stage 2: write the companion .list file.
	task.update("", archiveStageWrite, 95, -1, len(all), nil, nil, "", "")
	listKey := h.storage.ArchiveListKey(modelName, datasetName)
	if err := h.storage.PutString(ctx, listKey, sb.String()); err != nil {
		log.Printf("[archive] task=%s write list failed: %v", task.ID, err)
		task.update(model.TaskStatusError, archiveStageWrite, -1, -1, -1, nil, nil, "", "写入 list 失败: "+err.Error())
		return
	}

	task.update(model.TaskStatusDone, archiveStageWrite, 100, -1, len(all), nil, nil, listKey, "")
	log.Printf("[archive] task=%s done: %d entries -> %s (%s)", task.ID, len(all), listKey, time.Since(start).Round(time.Millisecond))
}
