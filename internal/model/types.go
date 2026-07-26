package model

import "time"

// Model represents a training model/project that datasets belong to.
type Model struct {
	ID          int64     `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// Dataset groups entries for a specific model.
type Dataset struct {
	ID          int64     `json:"id"`
	ModelID     int64     `json:"model_id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// Entry is a single annotated audio slice.
type Entry struct {
	ID        int64     `json:"id"`
	DatasetID int64     `json:"dataset_id"`
	WavPath   string    `json:"wav_path"`
	Speaker   string    `json:"speaker"`
	Language  string    `json:"language"`
	Text      string    `json:"text"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// QualityResult is the AI quality check result for an entry.
type QualityResult struct {
	ID        int64     `json:"id"`
	EntryID   int64     `json:"entry_id"`
	Status    string    `json:"status"`
	Risk      string    `json:"risk"`
	CheckedAt *time.Time `json:"checked_at"`
	Model     string    `json:"model"`
	TextHash  string    `json:"text_hash"`
	Summary   string    `json:"summary"`
	Reasons   []string  `json:"reasons"`
	Audio     AudioInfo `json:"audio"`
	TextRisk  TextRisk  `json:"text_risk"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// AudioInfo stores audio boundary analysis results.
type AudioInfo struct {
	DurationSec        float64 `json:"durationSec"`
	LeadingSilenceMs   int     `json:"leadingSilenceMs"`
	TrailingSilenceMs  int     `json:"trailingSilenceMs"`
	SilenceEvents      int     `json:"silenceEvents"`
	TailWindowMs       int     `json:"tailWindowMs"`
	TailMeanDb         *float64 `json:"tailMeanDb"`
	TailMaxDb          *float64 `json:"tailMaxDb"`
	TailEnergyHigh     bool    `json:"tailEnergyHigh"`
	BoundarySuspicious bool    `json:"boundarySuspicious"`
	Reasons            []string `json:"reasons"`
}

// TextRisk stores DeepSeek text analysis results.
type TextRisk struct {
	TextComplete         bool    `json:"textComplete"`
	CurrentTextUnfinished bool    `json:"currentTextUnfinished"`
	ShouldMergeNext      bool    `json:"shouldMergeNext"`
	NextIsContinuation   bool    `json:"nextIsContinuation"`
	Confidence           float64 `json:"confidence"`
	Reason               string  `json:"reason"`
}

// --- Request/Response types ---

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

// BatchUpsertEntriesRequest is the body for POST /api/datasets/:datasetId/entries.
type BatchUpsertEntriesRequest struct {
	Entries []EntryInput `json:"entries"`
}

// EntryInput represents a single entry to upsert.
type EntryInput struct {
	WavPath  string `json:"wav_path"`
	Speaker  string `json:"speaker"`
	Language string `json:"language"`
	Text     string `json:"text"`
}

// UpdateEntryRequest is the body for PUT /api/entries/:id.
type UpdateEntryRequest struct {
	Text string `json:"text"`
}

// CheckQualityRequest is the body for POST /api/entries/:entryId/quality/check.
type CheckQualityRequest struct {
	Force bool `json:"force"`
}

// SplitRequest is the body for POST /api/entries/:entryId/split.
type SplitRequest struct {
	SplitTime     float64 `json:"splitTime"`
	Text          string  `json:"text"`
	SplitTextIndex int    `json:"splitTextIndex"`
	Speaker       string  `json:"speaker"`
	Language      string  `json:"language"`
}

// SplitResponse returns the two new entries from a split operation.
type SplitResponse struct {
	Success bool       `json:"success"`
	First   EntryInput `json:"first"`
	Second  EntryInput `json:"second"`
}

// MergeRequest is the body for POST /api/entries/merge.
type MergeRequest struct {
	Entries    []EntryInput `json:"entries"`
	MergedText string       `json:"mergedText"`
	Speaker    string       `json:"speaker"`
	Language   string       `json:"language"`
}

// MergeResponse returns the merged entry.
type MergeResponse struct {
	Success bool       `json:"success"`
	Merged  EntryInput `json:"merged"`
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

// EntryWithQuality combines an entry with its quality result for list responses.
type EntryWithQuality struct {
	Entry         Entry          `json:"entry"`
	QualityResult *QualityResult `json:"quality_result,omitempty"`
}

// PaginatedResponse wraps a paginated list response.
type PaginatedResponse struct {
	Data       interface{} `json:"data"`
	Total      int64       `json:"total"`
	Page       int         `json:"page"`
	PageSize   int         `json:"page_size"`
}
