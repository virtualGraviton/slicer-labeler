package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DatasetTable name constant.
const DatasetTable = "datasets"

// DatasetColumn constants.
const (
	DatasetColID          = "id"
	DatasetColModelID     = "model_id"
	DatasetColName        = "name"
	DatasetColDescription = "description"
	DatasetColCreatedAt   = "created_at"
	DatasetColUpdatedAt   = "updated_at"
)

// DatasetColumns defines every column that should exist on the datasets table.
var DatasetColumns = []ColumnDef{
	{ColumnSQL: `model_id BIGINT NOT NULL`},
	{ColumnSQL: `name TEXT NOT NULL`},
	{ColumnSQL: `description TEXT NOT NULL DEFAULT ''`},
	{ColumnSQL: `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`},
	{ColumnSQL: `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`},
}

// DatasetIndex definitions.
var DatasetIndexes = []Index{
	{Table: DatasetTable, Name: "idx_datasets_model_id", DDL: `CREATE INDEX IF NOT EXISTS idx_datasets_model_id ON ` + DatasetTable + ` (` + DatasetColModelID + `)`},
}

// Dataset DDL statement.
const DatasetDDL = `
CREATE TABLE IF NOT EXISTS ` + DatasetTable + ` (
    id          BIGSERIAL PRIMARY KEY,
    model_id    BIGINT NOT NULL REFERENCES ` + ModelTable + `(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`

// Dataset groups entries for a specific model.
type Dataset struct {
	ID          int64     `json:"id"`
	ModelID     int64     `json:"model_id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// DatasetStore provides CRUD operations for datasets.
type DatasetStore struct {
	pool *pgxpool.Pool
}

func NewDatasetStore(pool *pgxpool.Pool) *DatasetStore {
	return &DatasetStore{pool: pool}
}

func (s *DatasetStore) ListByModel(ctx context.Context, modelID int64) ([]Dataset, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, model_id, name, description, created_at, updated_at FROM datasets WHERE model_id=$1 ORDER BY created_at DESC`, modelID)
	if err != nil {
		return nil, fmt.Errorf("list datasets for model %d: %w", modelID, err)
	}
	defer rows.Close()

	var datasets []Dataset
	for rows.Next() {
		var d Dataset
		if err := rows.Scan(&d.ID, &d.ModelID, &d.Name, &d.Description, &d.CreatedAt, &d.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan dataset: %w", err)
		}
		datasets = append(datasets, d)
	}
	if datasets == nil {
		datasets = []Dataset{}
	}
	return datasets, rows.Err()
}

func (s *DatasetStore) Get(ctx context.Context, id int64) (*Dataset, error) {
	var d Dataset
	err := s.pool.QueryRow(ctx,
		`SELECT id, model_id, name, description, created_at, updated_at FROM datasets WHERE id=$1`, id,
	).Scan(&d.ID, &d.ModelID, &d.Name, &d.Description, &d.CreatedAt, &d.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get dataset %d: %w", id, err)
	}
	return &d, nil
}

func (s *DatasetStore) Create(ctx context.Context, modelID int64, name, description string) (*Dataset, error) {
	var d Dataset
	now := time.Now()
	err := s.pool.QueryRow(ctx,
		`INSERT INTO datasets (model_id, name, description, created_at, updated_at) VALUES ($1, $2, $3, $4, $5) RETURNING id, model_id, name, description, created_at, updated_at`,
		modelID, name, description, now, now,
	).Scan(&d.ID, &d.ModelID, &d.Name, &d.Description, &d.CreatedAt, &d.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create dataset: %w", err)
	}
	return &d, nil
}

func (s *DatasetStore) Update(ctx context.Context, id int64, name, description string) (*Dataset, error) {
	var d Dataset
	err := s.pool.QueryRow(ctx,
		`UPDATE datasets SET name=$1, description=$2, updated_at=NOW() WHERE id=$3 RETURNING id, model_id, name, description, created_at, updated_at`,
		name, description, id,
	).Scan(&d.ID, &d.ModelID, &d.Name, &d.Description, &d.CreatedAt, &d.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("update dataset %d: %w", id, err)
	}
	return &d, nil
}

func (s *DatasetStore) Delete(ctx context.Context, id int64) (bool, error) {
	tag, err := s.pool.Exec(ctx, `DELETE FROM datasets WHERE id=$1`, id)
	if err != nil {
		return false, fmt.Errorf("delete dataset %d: %w", id, err)
	}
	return tag.RowsAffected() > 0, nil
}
