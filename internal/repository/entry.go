package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"slicer-labeler/internal/model"
)

type EntryRepo struct {
	pool *pgxpool.Pool
}

func NewEntryRepo(pool *pgxpool.Pool) *EntryRepo {
	return &EntryRepo{pool: pool}
}

func (r *EntryRepo) ListByDataset(ctx context.Context, datasetID int64, page, pageSize int) ([]model.Entry, int64, error) {
	// Count total
	var total int64
	if err := r.pool.QueryRow(ctx, `SELECT COUNT(*) FROM entries WHERE dataset_id=$1`, datasetID).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count entries: %w", err)
	}

	offset := (page - 1) * pageSize
	rows, err := r.pool.Query(ctx,
		`SELECT id, dataset_id, wav_path, speaker, language, text, created_at, updated_at FROM entries WHERE dataset_id=$1 ORDER BY id ASC LIMIT $2 OFFSET $3`,
		datasetID, pageSize, offset,
	)
	if err != nil {
		return nil, 0, fmt.Errorf("list entries: %w", err)
	}
	defer rows.Close()

	var entries []model.Entry
	for rows.Next() {
		var e model.Entry
		if err := rows.Scan(&e.ID, &e.DatasetID, &e.WavPath, &e.Speaker, &e.Language, &e.Text, &e.CreatedAt, &e.UpdatedAt); err != nil {
			return nil, 0, fmt.Errorf("scan entry: %w", err)
		}
		entries = append(entries, e)
	}
	if entries == nil {
		entries = []model.Entry{}
	}
	return entries, total, rows.Err()
}

func (r *EntryRepo) GetByID(ctx context.Context, id int64) (*model.Entry, error) {
	var e model.Entry
	err := r.pool.QueryRow(ctx,
		`SELECT id, dataset_id, wav_path, speaker, language, text, created_at, updated_at FROM entries WHERE id=$1`, id,
	).Scan(&e.ID, &e.DatasetID, &e.WavPath, &e.Speaker, &e.Language, &e.Text, &e.CreatedAt, &e.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get entry %d: %w", id, err)
	}
	return &e, nil
}

func (r *EntryRepo) GetByDatasetAndWavPath(ctx context.Context, datasetID int64, wavPath string) (*model.Entry, error) {
	var e model.Entry
	err := r.pool.QueryRow(ctx,
		`SELECT id, dataset_id, wav_path, speaker, language, text, created_at, updated_at FROM entries WHERE dataset_id=$1 AND wav_path=$2`,
		datasetID, wavPath,
	).Scan(&e.ID, &e.DatasetID, &e.WavPath, &e.Speaker, &e.Language, &e.Text, &e.CreatedAt, &e.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get entry by path: %w", err)
	}
	return &e, nil
}

func (r *EntryRepo) BatchUpsert(ctx context.Context, datasetID int64, inputs []model.EntryInput) (int, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	now := time.Now()
	count := 0
	for _, input := range inputs {
		tag, err := tx.Exec(ctx,
			`INSERT INTO entries (dataset_id, wav_path, speaker, language, text, created_at, updated_at) 
			 VALUES ($1, $2, $3, $4, $5, $6, $7)
			 ON CONFLICT (dataset_id, wav_path) DO UPDATE SET speaker=$3, language=$4, text=$5, updated_at=$7`,
			datasetID, input.WavPath, input.Speaker, input.Language, input.Text, now, now,
		)
		if err != nil {
			return count, fmt.Errorf("upsert entry %s: %w", input.WavPath, err)
		}
		count += int(tag.RowsAffected())
	}

	if err := tx.Commit(ctx); err != nil {
		return count, fmt.Errorf("commit tx: %w", err)
	}
	return count, nil
}

func (r *EntryRepo) UpdateText(ctx context.Context, id int64, text string) (*model.Entry, error) {
	var e model.Entry
	err := r.pool.QueryRow(ctx,
		`UPDATE entries SET text=$1, updated_at=NOW() WHERE id=$2 RETURNING id, dataset_id, wav_path, speaker, language, text, created_at, updated_at`,
		text, id,
	).Scan(&e.ID, &e.DatasetID, &e.WavPath, &e.Speaker, &e.Language, &e.Text, &e.CreatedAt, &e.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("update entry text %d: %w", id, err)
	}
	return &e, nil
}

func (r *EntryRepo) Delete(ctx context.Context, id int64) (bool, error) {
	tag, err := r.pool.Exec(ctx, `DELETE FROM entries WHERE id=$1`, id)
	if err != nil {
		return false, fmt.Errorf("delete entry %d: %w", id, err)
	}
	return tag.RowsAffected() > 0, nil
}

func (r *EntryRepo) GetNext(ctx context.Context, entryID, datasetID int64) (*model.Entry, error) {
	var e model.Entry
	err := r.pool.QueryRow(ctx,
		`SELECT id, dataset_id, wav_path, speaker, language, text, created_at, updated_at 
		 FROM entries WHERE dataset_id=$1 AND id > $2 ORDER BY id ASC LIMIT 1`,
		datasetID, entryID,
	).Scan(&e.ID, &e.DatasetID, &e.WavPath, &e.Speaker, &e.Language, &e.Text, &e.CreatedAt, &e.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get next entry: %w", err)
	}
	return &e, nil
}
