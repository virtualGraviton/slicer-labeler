package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"slicer-labeler/internal/model"
)

// EntryTable name constant.
const EntryTable = "entries"

// EntryColumn constants.
const (
	EntryColID        = "id"
	EntryColDatasetID = "dataset_id"
	EntryColWavPath   = "wav_path"
	EntryColSpeaker   = "speaker"
	EntryColLanguage  = "language"
	EntryColText      = "text"
	EntryColCreatedAt = "created_at"
	EntryColUpdatedAt = "updated_at"
)

// EntryColumns defines every column that should exist on the entries table.
var EntryColumns = []ColumnDef{
	{ColumnSQL: `dataset_id BIGINT NOT NULL`},
	{ColumnSQL: `wav_path TEXT NOT NULL`},
	{ColumnSQL: `speaker TEXT NOT NULL DEFAULT ''`},
	{ColumnSQL: `language TEXT NOT NULL DEFAULT ''`},
	{ColumnSQL: `text TEXT NOT NULL DEFAULT ''`},
	{ColumnSQL: `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`},
	{ColumnSQL: `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`},
}

// EntryIndex definitions.
var EntryIndexes = []Index{
	{Table: EntryTable, Name: "idx_entries_dataset_id", DDL: `CREATE INDEX IF NOT EXISTS idx_entries_dataset_id ON ` + EntryTable + ` (` + EntryColDatasetID + `)`},
	{Table: EntryTable, Name: "idx_entries_wav_path", DDL: `CREATE INDEX IF NOT EXISTS idx_entries_wav_path ON ` + EntryTable + ` (` + EntryColWavPath + `)`},
}

// Entry DDL statement.
const EntryDDL = `
CREATE TABLE IF NOT EXISTS ` + EntryTable + ` (
    id          BIGSERIAL PRIMARY KEY,
    dataset_id  BIGINT NOT NULL REFERENCES ` + DatasetTable + `(id) ON DELETE CASCADE,
    wav_path    TEXT NOT NULL,
    speaker     TEXT NOT NULL DEFAULT '',
    language    TEXT NOT NULL DEFAULT '',
    text        TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(dataset_id, wav_path)
);`

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

// EntryStore provides CRUD operations for entries.
type EntryStore struct {
	pool *pgxpool.Pool
}

func NewEntryStore(pool *pgxpool.Pool) *EntryStore {
	return &EntryStore{pool: pool}
}

func (s *EntryStore) ListByDataset(ctx context.Context, datasetID int64, page, pageSize int) ([]Entry, int64, error) {
	var total int64
	if err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM entries WHERE dataset_id=$1`, datasetID).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count entries: %w", err)
	}

	offset := (page - 1) * pageSize
	rows, err := s.pool.Query(ctx,
		`SELECT id, dataset_id, wav_path, speaker, language, text, created_at, updated_at FROM entries WHERE dataset_id=$1 ORDER BY id ASC LIMIT $2 OFFSET $3`,
		datasetID, pageSize, offset,
	)
	if err != nil {
		return nil, 0, fmt.Errorf("list entries: %w", err)
	}
	defer rows.Close()

	var entries []Entry
	for rows.Next() {
		var e Entry
		if err := rows.Scan(&e.ID, &e.DatasetID, &e.WavPath, &e.Speaker, &e.Language, &e.Text, &e.CreatedAt, &e.UpdatedAt); err != nil {
			return nil, 0, fmt.Errorf("scan entry: %w", err)
		}
		entries = append(entries, e)
	}
	if entries == nil {
		entries = []Entry{}
	}
	return entries, total, rows.Err()
}

func (s *EntryStore) GetByID(ctx context.Context, id int64) (*Entry, error) {
	var e Entry
	err := s.pool.QueryRow(ctx,
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

func (s *EntryStore) GetByDatasetAndWavPath(ctx context.Context, datasetID int64, wavPath string) (*Entry, error) {
	var e Entry
	err := s.pool.QueryRow(ctx,
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

func (s *EntryStore) BatchUpsert(ctx context.Context, datasetID int64, inputs []model.EntryInput) (int, error) {
	tx, err := s.pool.Begin(ctx)
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

func (s *EntryStore) UpdateText(ctx context.Context, id int64, text string) (*Entry, error) {
	var e Entry
	err := s.pool.QueryRow(ctx,
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

func (s *EntryStore) Delete(ctx context.Context, id int64) (bool, error) {
	tag, err := s.pool.Exec(ctx, `DELETE FROM entries WHERE id=$1`, id)
	if err != nil {
		return false, fmt.Errorf("delete entry %d: %w", id, err)
	}
	return tag.RowsAffected() > 0, nil
}

func (s *EntryStore) GetNext(ctx context.Context, entryID, datasetID int64) (*Entry, error) {
	var e Entry
	err := s.pool.QueryRow(ctx,
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
