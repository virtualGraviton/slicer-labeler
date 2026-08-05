package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/labstack/echo/v4"

	"slicer-labeler/internal/db"
	"slicer-labeler/internal/model"
	"slicer-labeler/internal/service"
)

// Task is the in-memory runtime state of one import/archive job.
type Task struct {
	ID          string
	Type        model.TaskType
	ModelID     int64
	ModelName   string
	DatasetID   int64
	DatasetName string
	Status      model.TaskStatus
	Stage       string
	Progress    int
	Imported    int
	Missing     []string
	Orphans     []string
	Count       int
	ListPath    string
	Error       string
	CreatedAt   time.Time
	Done        chan struct{}

	mu      sync.Mutex
	version int
}

// update mutates fields, bumping the version so SSE consumers can skip no-op ticks.
func (t *Task) update(status model.TaskStatus, stage string, progress, imported, count int, missing, orphans []string, listPath, errMsg string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if status != "" {
		t.Status = status
	}
	if stage != "" {
		t.Stage = stage
	}
	if progress >= 0 {
		t.Progress = progress
	}
	if imported >= 0 {
		t.Imported = imported
	}
	if count >= 0 {
		t.Count = count
	}
	if missing != nil {
		t.Missing = missing
	}
	if orphans != nil {
		t.Orphans = orphans
	}
	if listPath != "" {
		t.ListPath = listPath
	}
	if errMsg != "" {
		t.Error = errMsg
	}
	t.version++
}

func (t *Task) buildInfo() model.TaskInfo {
	missing := make([]string, len(t.Missing))
	copy(missing, t.Missing)
	orphans := make([]string, len(t.Orphans))
	copy(orphans, t.Orphans)
	return model.TaskInfo{
		ID:          t.ID,
		Type:        t.Type,
		ModelID:     t.ModelID,
		ModelName:   t.ModelName,
		DatasetID:   t.DatasetID,
		DatasetName: t.DatasetName,
		Status:      t.Status,
		Stage:       t.Stage,
		Progress:    t.Progress,
		Imported:    t.Imported,
		Missing:     missing,
		Orphans:     orphans,
		Count:       t.Count,
		ListPath:    t.ListPath,
		Error:       t.Error,
		CreatedAt:   t.CreatedAt,
	}
}

func (t *Task) snapshot() model.TaskInfo {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.buildInfo()
}

func (t *Task) versionedSnapshot() (model.TaskInfo, int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.buildInfo(), t.version
}

// TaskManager keeps all in-memory tasks and the per-dataset running lock.
// The lock (locks[datasetID] -> taskID) is the concurrency guard: a dataset can
// run at most one task at a time, and writes are rejected while it is locked.
type TaskManager struct {
	mu    sync.Mutex
	tasks map[string]*Task
	locks map[int64]string // datasetID -> running taskID

	subMu   sync.Mutex
	subs    map[int64]*subscriber
	nextSub int64
}

func NewTaskManager() *TaskManager {
	return &TaskManager{
		tasks: map[string]*Task{},
		locks: map[int64]string{},
		subs:  map[int64]*subscriber{},
	}
}

// TryLock creates a task and locks its dataset. Returns an error when the
// dataset already has a running task.
func (m *TaskManager) TryLock(datasetID, modelID int64, modelName, datasetName string, typ model.TaskType) (*Task, error) {
	m.mu.Lock()
	if id, ok := m.locks[datasetID]; ok {
		m.mu.Unlock()
		return nil, fmt.Errorf("dataset %d is busy with task %s", datasetID, id)
	}
	t := &Task{
		ID:          fmt.Sprintf("%d-%s", time.Now().UnixNano(), randHex(4)),
		Type:        typ,
		ModelID:     modelID,
		ModelName:   modelName,
		DatasetID:   datasetID,
		DatasetName: datasetName,
		Status:      model.TaskStatusProcessing,
		CreatedAt:   time.Now(),
		Done:        make(chan struct{}),
	}
	m.tasks[t.ID] = t
	m.locks[datasetID] = t.ID
	m.mu.Unlock()

	info := t.snapshot()
	m.broadcast(model.TaskEvent{Type: "task_created", Task: &info})
	return t, nil
}

// Unlock releases the dataset lock, but only if it still belongs to taskID.
func (m *TaskManager) Unlock(datasetID int64, taskID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if id, ok := m.locks[datasetID]; ok && id == taskID {
		delete(m.locks, datasetID)
	}
}

func (m *TaskManager) Get(id string) *Task {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.tasks[id]
}

// List returns all tasks, newest first.
func (m *TaskManager) List() []model.TaskInfo {
	m.mu.Lock()
	tasks := make([]*Task, 0, len(m.tasks))
	for _, t := range m.tasks {
		tasks = append(tasks, t)
	}
	m.mu.Unlock()

	sort.Slice(tasks, func(i, j int) bool { return tasks[i].CreatedAt.After(tasks[j].CreatedAt) })
	out := make([]model.TaskInfo, len(tasks))
	for i, t := range tasks {
		out[i] = t.snapshot()
	}
	return out
}

func (m *TaskManager) IsBusy(datasetID int64) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.locks[datasetID]
	return ok
}

// IsAnyBusy reports whether any of the given datasets has a running task.
func (m *TaskManager) IsAnyBusy(datasetIDs []int64) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, id := range datasetIDs {
		if _, ok := m.locks[id]; ok {
			return true
		}
	}
	return false
}

// Subscribe registers a global event consumer with an optional visibility
// filter (nil means see everything). The returned cancel function must be
// called when the consumer goes away.
func (m *TaskManager) Subscribe(filter func(*Task) bool) (<-chan model.TaskEvent, func()) {
	m.subMu.Lock()
	defer m.subMu.Unlock()
	m.nextSub++
	id := m.nextSub
	ch := make(chan model.TaskEvent, 64)
	m.subs[id] = &subscriber{ch: ch, filter: filter}
	cancel := func() {
		m.subMu.Lock()
		delete(m.subs, id)
		m.subMu.Unlock()
	}
	return ch, cancel
}

func (m *TaskManager) broadcast(ev model.TaskEvent) {
	m.subMu.Lock()
	defer m.subMu.Unlock()
	for _, s := range m.subs {
		if s.filter != nil && ev.Task != nil {
			m.mu.Lock()
			t, ok := m.tasks[ev.Task.ID]
			m.mu.Unlock()
			if ok && !s.filter(t) {
				continue
			}
		}
		select {
		case s.ch <- ev:
		default: // drop for slow consumers; snapshot covers reconnects
		}
	}
}

type subscriber struct {
	ch     chan model.TaskEvent
	filter func(*Task) bool
}

// datasetBusy returns a 409 when the dataset has a running task. Used by every
// write handler as the concurrency guard.
func datasetBusy(tm *TaskManager, datasetID int64) error {
	if tm.IsBusy(datasetID) {
		return echo.NewHTTPError(http.StatusConflict, "数据集正在执行任务，暂时无法进行该操作")
	}
	return nil
}

// --- TaskHandler: task listing + SSE streams ---

type TaskHandler struct {
	tm   *TaskManager
	auth *service.AuthService
}

func NewTaskHandler(tm *TaskManager, auth *service.AuthService) *TaskHandler {
	return &TaskHandler{tm: tm, auth: auth}
}

// visibleTasks filters the global task list down to what the user may see:
// task-read-all grants everything; otherwise a task is visible when the user
// can read its dataset.
func (h *TaskHandler) visibleTasks(user *db.User) []model.TaskInfo {
	all := h.tm.List()
	if user != nil && h.auth.HasPerm(user, "task-read-all") {
		return all
	}
	ctx := context.Background()
	var out []model.TaskInfo
	for _, t := range all {
		if user != nil && h.auth.CanReadDataset(ctx, user, t.DatasetID) {
			out = append(out, t)
		}
	}
	if out == nil {
		out = []model.TaskInfo{}
	}
	return out
}

// canReadTask builds a per-subscriber filter for the global events stream.
func (h *TaskHandler) canReadTask(user *db.User) func(*Task) bool {
	if user != nil && h.auth.HasPerm(user, "task-read-all") {
		return nil
	}
	ctx := context.Background()
	return func(t *Task) bool {
		return h.auth.CanReadDataset(ctx, user, t.DatasetID)
	}
}

// List returns the tasks visible to the requesting user (newest first).
func (h *TaskHandler) List(c echo.Context) error {
	user, _ := c.Get("user").(*db.User)
	return c.JSON(http.StatusOK, map[string]interface{}{"data": h.visibleTasks(user)})
}

// Events is a long-lived SSE stream of global task events. On connect it first
// pushes a full snapshot (filtered to the user), then forwards every
// task_created event the user is allowed to see.
func (h *TaskHandler) Events(c echo.Context) error {
	user, _ := c.Get("user").(*db.User)
	w := c.Response()
	sseHeaders(w)
	w.WriteHeader(http.StatusOK)

	ssePush(w, model.TaskEvent{Type: "snapshot", Tasks: h.visibleTasks(user)})

	ch, cancel := h.tm.Subscribe(h.canReadTask(user))
	defer cancel()

	ticker := time.NewTicker(25 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-c.Request().Context().Done():
			return nil
		case ev := <-ch:
			if err := ssePush(w, ev); err != nil {
				return err
			}
		case <-ticker.C:
			if _, err := fmt.Fprintf(w, ": keepalive\n\n"); err != nil {
				return err
			}
			w.Flush()
		}
	}
}

// Stream pushes progress of a single task until it reaches a terminal state.
func (h *TaskHandler) Stream(c echo.Context) error {
	user, _ := c.Get("user").(*db.User)
	t := h.tm.Get(c.Param("taskId"))
	if t == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "task not found"})
	}
	if user == nil || (!h.auth.HasPerm(user, "task-read-all") && !h.auth.CanReadDataset(context.Background(), user, t.DatasetID)) {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "无权限"})
	}

	w := c.Response()
	sseHeaders(w)
	w.WriteHeader(http.StatusOK)

	lastVersion := -1
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-c.Request().Context().Done():
			return nil
		case <-t.Done:
			ev, _ := t.versionedSnapshot()
			return ssePush(w, ev)
		case <-ticker.C:
			ev, v := t.versionedSnapshot()
			if v == lastVersion {
				continue
			}
			lastVersion = v
			if err := ssePush(w, ev); err != nil {
				return err
			}
		}
	}
}

func sseHeaders(w *echo.Response) {
	w.Header().Set(echo.HeaderContentType, "text/event-stream")
	w.Header().Set(echo.HeaderCacheControl, "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
}

func ssePush(w *echo.Response, ev interface{}) error {
	data, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "data: %s\n\n", data); err != nil {
		return err
	}
	w.Flush()
	return nil
}
