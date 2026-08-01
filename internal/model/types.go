package model

// --- Model Request/Response ---

// CreateModelRequest is the body for POST /api/models.
type CreateModelRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// UpdateModelRequest is the body for PUT /api/models/:id.
type UpdateModelRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// --- Dataset Request/Response ---

// CreateDatasetRequest is the body for POST /api/models/:modelId/datasets.
type CreateDatasetRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// UpdateDatasetRequest is the body for PUT /api/datasets/:id.
type UpdateDatasetRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// --- Entry Request/Response ---

// EntryInput represents a single entry to upsert.
type EntryInput struct {
	WavPath  string `json:"wavPath"`
	Speaker  string `json:"speaker"`
	Language string `json:"language"`
	Text     string `json:"text"`
}

// BatchUpsertEntriesRequest is the body for POST /api/datasets/:datasetId/entries.
type BatchUpsertEntriesRequest struct {
	Entries []EntryInput `json:"entries"`
}

// UpdateEntryRequest is the body for PUT /api/entries/:id.
type UpdateEntryRequest struct {
	Text string `json:"text"`
}

// --- Split Request/Response ---

// SplitRequest is the body for POST /api/entries/:entryId/split.
type SplitRequest struct {
	SplitTime      float64 `json:"splitTime"`
	Text           string  `json:"text"`
	SplitTextIndex int     `json:"splitTextIndex"`
	Speaker        string  `json:"speaker"`
	Language       string  `json:"language"`
}

// SplitResponse and MergeResponse are defined in the handler package because
// they reference internal/db.Entry (importing db from model would create a cycle).

// --- Merge Request/Response ---

// MergeRequest is the body for POST /api/entries/merge.
type MergeRequest struct {
	Entries    []EntryInput `json:"entries"`
	MergedText string       `json:"mergedText"`
	Speaker    string       `json:"speaker"`
	Language   string       `json:"language"`
}

// PolishMergeRequest is the body for POST /api/entries/merge/polish.
type PolishMergeRequest struct {
	Entries        []EntryInput `json:"entries"`
	HardMergedText string       `json:"hardMergedText"`
	Speaker        string       `json:"speaker"`
	Language       string       `json:"language"`
}

// PolishMergeResponse returns the polished text.
type PolishMergeResponse struct {
	PolishedText  string `json:"polishedText"`
	ExplanationZh string `json:"explanationZh"`
	Model         string `json:"model"`
}

// --- Common ---

// PaginatedResponse wraps a paginated list response.
type PaginatedResponse struct {
	Data     interface{} `json:"data"`
	Total    int64       `json:"total"`
	Page     int         `json:"page"`
	PageSize int         `json:"page_size"`
}
