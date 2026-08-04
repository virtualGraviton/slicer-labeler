package model

import "time"

// TaskType identifies what kind of job a task runs (import bundle / archive).
type TaskType string

const (
	TaskTypeImport  TaskType = "import"
	TaskTypeArchive TaskType = "archive"
)

// TaskStatus is the lifecycle state of a task.
type TaskStatus string

const (
	TaskStatusProcessing TaskStatus = "processing"
	TaskStatusDone       TaskStatus = "done"
	TaskStatusError      TaskStatus = "error"
)

// TaskInfo is the display/transport representation of a task. It carries
// dataset/model association so the frontend can group and lock by them.
type TaskInfo struct {
	ID          string                 `json:"id"`
	Type        TaskType               `json:"type"`
	ModelID     int64                  `json:"modelId"`
	ModelName   string                 `json:"modelName"`
	DatasetID   int64                  `json:"datasetId"`
	DatasetName string                 `json:"datasetName"`
	Status      TaskStatus             `json:"status"`
	Stage       string                 `json:"stage"`    // import: extract/upload/upsert; archive: copy/write
	Progress    int                    `json:"progress"` // 0-100
	Imported    int                    `json:"imported"` // import 专属：成功写入条数
	Missing     []string               `json:"missing"`  // import 专属
	Orphans     []string               `json:"orphans"`  // import 专属
	Count       int                    `json:"count"`    // archive 专属：归档条数
	ListPath    string                 `json:"listPath"` // archive 专属
	Error       string                 `json:"error"`
	CreatedAt   time.Time              `json:"createdAt"`
}

// TaskEvent is pushed over the global task events stream.
type TaskEvent struct {
	Type  string    `json:"type"`  // "snapshot" | "task_created"
	Tasks []TaskInfo `json:"tasks"` // snapshot 时全量
	Task  *TaskInfo `json:"task"`  // task_created 时单条
}
