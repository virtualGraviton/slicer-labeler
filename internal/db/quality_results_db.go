package db

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// QualityResultTable name constant.
const QualityResultTable = "quality_results"

// QualityResultColumn constants.
const (
	QualityResultColID        = "id"
	QualityResultColEntryID   = "entry_id"
	QualityResultColStatus    = "status"
	QualityResultColRisk      = "risk"
	QualityResultColCheckedAt = "checked_at"
	QualityResultColModel     = "model"
	QualityResultColTextHash  = "text_hash"
	QualityResultColSummary   = "summary"
	QualityResultColReasons   = "reasons"
	QualityResultColAudio     = "audio"
	QualityResultColTextRisk  = "text_risk"
	QualityResultColCreatedAt = "created_at"
	QualityResultColUpdatedAt = "updated_at"
)

// QualityResultColumns defines every column that should exist on the quality_results table.
var QualityResultColumns = []ColumnDef{
	{ColumnSQL: `entry_id BIGINT NOT NULL`},
	{ColumnSQL: `status TEXT NOT NULL DEFAULT 'pending'`},
	{ColumnSQL: `risk TEXT NOT NULL DEFAULT 'low'`},
	{ColumnSQL: `checked_at TIMESTAMPTZ`},
	{ColumnSQL: `model TEXT NOT NULL DEFAULT ''`},
	{ColumnSQL: `text_hash TEXT NOT NULL DEFAULT ''`},
	{ColumnSQL: `summary TEXT NOT NULL DEFAULT ''`},
	{ColumnSQL: `reasons JSONB NOT NULL DEFAULT '[]'`},
	{ColumnSQL: `audio JSONB NOT NULL DEFAULT '{}'`},
	{ColumnSQL: `text_risk JSONB NOT NULL DEFAULT '{}'`},
	{ColumnSQL: `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`},
	{ColumnSQL: `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`},
}

// QualityResultIndex definitions.
var QualityResultIndexes = []Index{
	{Table: QualityResultTable, Name: "idx_quality_results_risk", DDL: `CREATE INDEX IF NOT EXISTS idx_quality_results_risk ON ` + QualityResultTable + ` (` + QualityResultColRisk + `)`},
}

// QualityResult DDL statement.
const QualityResultDDL = `
CREATE TABLE IF NOT EXISTS ` + QualityResultTable + ` (
    id          BIGSERIAL PRIMARY KEY,
    entry_id    BIGINT NOT NULL UNIQUE REFERENCES ` + EntryTable + `(id) ON DELETE CASCADE,
    status      TEXT NOT NULL DEFAULT 'pending',
    risk        TEXT NOT NULL DEFAULT 'low',
    checked_at  TIMESTAMPTZ,
    model       TEXT NOT NULL DEFAULT '',
    text_hash   TEXT NOT NULL DEFAULT '',
    summary     TEXT NOT NULL DEFAULT '',
    reasons     JSONB NOT NULL DEFAULT '[]',
    audio       JSONB NOT NULL DEFAULT '{}',
    text_risk   JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`

// AudioInfo stores audio boundary analysis results.
type AudioInfo struct {
	DurationSec        float64  `json:"durationSec"`
	LeadingSilenceMs   int      `json:"leadingSilenceMs"`
	TrailingSilenceMs  int      `json:"trailingSilenceMs"`
	SilenceEvents      int      `json:"silenceEvents"`
	TailWindowMs       int      `json:"tailWindowMs"`
	TailMeanDb         *float64 `json:"tailMeanDb"`
	TailMaxDb          *float64 `json:"tailMaxDb"`
	TailEnergyHigh     bool     `json:"tailEnergyHigh"`
	BoundarySuspicious bool     `json:"boundarySuspicious"`
	Reasons            []string `json:"reasons"`
}

// TextRisk stores DeepSeek text analysis results.
type TextRisk struct {
	TextComplete          bool    `json:"textComplete"`
	CurrentTextUnfinished bool    `json:"currentTextUnfinished"`
	ShouldMergeNext       bool    `json:"shouldMergeNext"`
	NextIsContinuation    bool    `json:"nextIsContinuation"`
	Confidence            float64 `json:"confidence"`
	Reason                string  `json:"reason"`
}

// QualityResult is the AI quality check result for an entry.
type QualityResult struct {
	ID        int64      `json:"id"`
	EntryID   int64      `json:"entry_id"`
	Status    string     `json:"status"`
	Risk      string     `json:"risk"`
	CheckedAt *time.Time `json:"checked_at"`
	Model     string     `json:"model"`
	TextHash  string     `json:"text_hash"`
	Summary   string     `json:"summary"`
	Reasons   []string   `json:"reasons"`
	Audio     AudioInfo  `json:"audio"`
	TextRisk  TextRisk   `json:"text_risk"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

// QualityStore provides CRUD operations for quality results.
type QualityStore struct {
	pool *pgxpool.Pool
}

func NewQualityStore(pool *pgxpool.Pool) *QualityStore {
	return &QualityStore{pool: pool}
}

func (s *QualityStore) GetByEntryID(ctx context.Context, entryID int64) (*QualityResult, error) {
	var q QualityResult
	var reasonsBytes, audioBytes, textRiskBytes []byte

	err := s.pool.QueryRow(ctx,
		`SELECT id, entry_id, status, risk, checked_at, model, text_hash, summary, reasons, audio, text_risk, created_at, updated_at
		 FROM quality_results WHERE entry_id=$1`, entryID,
	).Scan(&q.ID, &q.EntryID, &q.Status, &q.Risk, &q.CheckedAt, &q.Model, &q.TextHash, &q.Summary,
		&reasonsBytes, &audioBytes, &textRiskBytes, &q.CreatedAt, &q.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get quality result for entry %d: %w", entryID, err)
	}

	json.Unmarshal(reasonsBytes, &q.Reasons)
	json.Unmarshal(audioBytes, &q.Audio)
	json.Unmarshal(textRiskBytes, &q.TextRisk)

	if q.Reasons == nil {
		q.Reasons = []string{}
	}
	return &q, nil
}

func (s *QualityStore) Upsert(ctx context.Context, q *QualityResult) error {
	reasonsBytes, _ := json.Marshal(q.Reasons)
	audioBytes, _ := json.Marshal(q.Audio)
	textRiskBytes, _ := json.Marshal(q.TextRisk)

	now := time.Now()
	_, err := s.pool.Exec(ctx,
		`INSERT INTO quality_results (entry_id, status, risk, checked_at, model, text_hash, summary, reasons, audio, text_risk, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		 ON CONFLICT (entry_id) DO UPDATE SET 
		   status=$2, risk=$3, checked_at=$4, model=$5, text_hash=$6, summary=$7, reasons=$8, audio=$9, text_risk=$10, updated_at=$12`,
		q.EntryID, q.Status, q.Risk, q.CheckedAt, q.Model, q.TextHash, q.Summary,
		reasonsBytes, audioBytes, textRiskBytes, now, now,
	)
	if err != nil {
		return fmt.Errorf("upsert quality result: %w", err)
	}
	return nil
}

func (s *QualityStore) ListByDataset(ctx context.Context, datasetID int64) ([]QualityResult, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT qr.id, qr.entry_id, qr.status, qr.risk, qr.checked_at, qr.model, qr.text_hash, qr.summary, qr.reasons, qr.audio, qr.text_risk, qr.created_at, qr.updated_at
		 FROM quality_results qr
		 JOIN entries e ON qr.entry_id = e.id
		 WHERE e.dataset_id = $1
		 ORDER BY qr.id ASC`, datasetID)
	if err != nil {
		return nil, fmt.Errorf("list quality results for dataset %d: %w", datasetID, err)
	}
	defer rows.Close()

	var results []QualityResult
	for rows.Next() {
		var q QualityResult
		var reasonsBytes, audioBytes, textRiskBytes []byte
		if err := rows.Scan(&q.ID, &q.EntryID, &q.Status, &q.Risk, &q.CheckedAt, &q.Model, &q.TextHash, &q.Summary,
			&reasonsBytes, &audioBytes, &textRiskBytes, &q.CreatedAt, &q.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan quality result: %w", err)
		}
		json.Unmarshal(reasonsBytes, &q.Reasons)
		json.Unmarshal(audioBytes, &q.Audio)
		json.Unmarshal(textRiskBytes, &q.TextRisk)
		if q.Reasons == nil {
			q.Reasons = []string{}
		}
		results = append(results, q)
	}
	if results == nil {
		results = []QualityResult{}
	}
	return results, rows.Err()
}

func (s *QualityStore) DeleteByEntryID(ctx context.Context, entryID int64) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM quality_results WHERE entry_id=$1`, entryID)
	if err != nil {
		return fmt.Errorf("delete quality result for entry %d: %w", entryID, err)
	}
	return nil
}
