package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"slicer-labeler/internal/model"
)

type QualityRepo struct {
	pool *pgxpool.Pool
}

func NewQualityRepo(pool *pgxpool.Pool) *QualityRepo {
	return &QualityRepo{pool: pool}
}

func (r *QualityRepo) GetByEntryID(ctx context.Context, entryID int64) (*model.QualityResult, error) {
	var q model.QualityResult
	var reasonsBytes, audioBytes, textRiskBytes []byte

	err := r.pool.QueryRow(ctx,
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

func (r *QualityRepo) Upsert(ctx context.Context, q *model.QualityResult) error {
	reasonsBytes, _ := json.Marshal(q.Reasons)
	audioBytes, _ := json.Marshal(q.Audio)
	textRiskBytes, _ := json.Marshal(q.TextRisk)

	now := time.Now()
	_, err := r.pool.Exec(ctx,
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

func (r *QualityRepo) ListByDataset(ctx context.Context, datasetID int64) ([]model.QualityResult, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT qr.id, qr.entry_id, qr.status, qr.risk, qr.checked_at, qr.model, qr.text_hash, qr.summary, qr.reasons, qr.audio, qr.text_risk, qr.created_at, qr.updated_at
		 FROM quality_results qr
		 JOIN entries e ON qr.entry_id = e.id
		 WHERE e.dataset_id = $1
		 ORDER BY qr.id ASC`, datasetID)
	if err != nil {
		return nil, fmt.Errorf("list quality results for dataset %d: %w", datasetID, err)
	}
	defer rows.Close()

	var results []model.QualityResult
	for rows.Next() {
		var q model.QualityResult
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
		results = []model.QualityResult{}
	}
	return results, rows.Err()
}

func (r *QualityRepo) DeleteByEntryID(ctx context.Context, entryID int64) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM quality_results WHERE entry_id=$1`, entryID)
	if err != nil {
		return fmt.Errorf("delete quality result for entry %d: %w", entryID, err)
	}
	return nil
}
