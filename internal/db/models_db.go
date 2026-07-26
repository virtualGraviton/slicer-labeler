package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ModelTable name constant.
const ModelTable = "models"

// ModelColumn constants.
const (
	ModelColID          = "id"
	ModelColName        = "name"
	ModelColDescription = "description"
	ModelColCreatedAt   = "created_at"
	ModelColUpdatedAt   = "updated_at"
)

// ModelColumns defines every column that should exist on the models table.
// Adding a field here will be auto-migrated as ALTER TABLE ... ADD COLUMN IF NOT EXISTS.
var ModelColumns = []ColumnDef{
	{ColumnSQL: `name TEXT NOT NULL`},
	{ColumnSQL: `description TEXT NOT NULL DEFAULT ''`},
	{ColumnSQL: `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`},
	{ColumnSQL: `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`},
}

// ModelIndex definitions.
var ModelIndexes = []Index{
	{Table: ModelTable, Name: "idx_models_created_at", DDL: `CREATE INDEX IF NOT EXISTS idx_models_created_at ON ` + ModelTable + ` (` + ModelColCreatedAt + `)`},
}

// Model DDL statement.
const ModelDDL = `
CREATE TABLE IF NOT EXISTS ` + ModelTable + ` (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`

// Model represents a training model/project that datasets belong to.
type Model struct {
	ID          int64     `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// ModelStore provides CRUD operations for models.
type ModelStore struct {
	pool *pgxpool.Pool
}

func NewModelStore(pool *pgxpool.Pool) *ModelStore {
	return &ModelStore{pool: pool}
}

func (s *ModelStore) List(ctx context.Context) ([]Model, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, name, description, created_at, updated_at FROM models ORDER BY created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("list models: %w", err)
	}
	defer rows.Close()

	var models []Model
	for rows.Next() {
		var m Model
		if err := rows.Scan(&m.ID, &m.Name, &m.Description, &m.CreatedAt, &m.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan model: %w", err)
		}
		models = append(models, m)
	}
	if models == nil {
		models = []Model{}
	}
	return models, rows.Err()
}

func (s *ModelStore) Get(ctx context.Context, id int64) (*Model, error) {
	var m Model
	err := s.pool.QueryRow(ctx, `SELECT id, name, description, created_at, updated_at FROM models WHERE id=$1`, id).
		Scan(&m.ID, &m.Name, &m.Description, &m.CreatedAt, &m.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get model %d: %w", id, err)
	}
	return &m, nil
}

func (s *ModelStore) Create(ctx context.Context, name, description string) (*Model, error) {
	var m Model
	now := time.Now()
	err := s.pool.QueryRow(ctx,
		`INSERT INTO models (name, description, created_at, updated_at) VALUES ($1, $2, $3, $4) RETURNING id, name, description, created_at, updated_at`,
		name, description, now, now,
	).Scan(&m.ID, &m.Name, &m.Description, &m.CreatedAt, &m.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create model: %w", err)
	}
	return &m, nil
}

func (s *ModelStore) Update(ctx context.Context, id int64, name, description string) (*Model, error) {
	var m Model
	err := s.pool.QueryRow(ctx,
		`UPDATE models SET name=$1, description=$2, updated_at=NOW() WHERE id=$3 RETURNING id, name, description, created_at, updated_at`,
		name, description, id,
	).Scan(&m.ID, &m.Name, &m.Description, &m.CreatedAt, &m.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("update model %d: %w", id, err)
	}
	return &m, nil
}

func (s *ModelStore) Delete(ctx context.Context, id int64) (bool, error) {
	tag, err := s.pool.Exec(ctx, `DELETE FROM models WHERE id=$1`, id)
	if err != nil {
		return false, fmt.Errorf("delete model %d: %w", id, err)
	}
	return tag.RowsAffected() > 0, nil
}
