package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"slicer-labeler/internal/model"
)

type ModelRepo struct {
	pool *pgxpool.Pool
}

func NewModelRepo(pool *pgxpool.Pool) *ModelRepo {
	return &ModelRepo{pool: pool}
}

func (r *ModelRepo) List(ctx context.Context) ([]model.Model, error) {
	rows, err := r.pool.Query(ctx, `SELECT id, name, description, created_at, updated_at FROM models ORDER BY created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("list models: %w", err)
	}
	defer rows.Close()

	var models []model.Model
	for rows.Next() {
		var m model.Model
		if err := rows.Scan(&m.ID, &m.Name, &m.Description, &m.CreatedAt, &m.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan model: %w", err)
		}
		models = append(models, m)
	}
	if models == nil {
		models = []model.Model{}
	}
	return models, rows.Err()
}

func (r *ModelRepo) Get(ctx context.Context, id int64) (*model.Model, error) {
	var m model.Model
	err := r.pool.QueryRow(ctx, `SELECT id, name, description, created_at, updated_at FROM models WHERE id=$1`, id).
		Scan(&m.ID, &m.Name, &m.Description, &m.CreatedAt, &m.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get model %d: %w", id, err)
	}
	return &m, nil
}

func (r *ModelRepo) Create(ctx context.Context, name, description string) (*model.Model, error) {
	var m model.Model
	now := time.Now()
	err := r.pool.QueryRow(ctx,
		`INSERT INTO models (name, description, created_at, updated_at) VALUES ($1, $2, $3, $4) RETURNING id, name, description, created_at, updated_at`,
		name, description, now, now,
	).Scan(&m.ID, &m.Name, &m.Description, &m.CreatedAt, &m.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create model: %w", err)
	}
	return &m, nil
}

func (r *ModelRepo) Update(ctx context.Context, id int64, name, description string) (*model.Model, error) {
	var m model.Model
	err := r.pool.QueryRow(ctx,
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

func (r *ModelRepo) Delete(ctx context.Context, id int64) (bool, error) {
	tag, err := r.pool.Exec(ctx, `DELETE FROM models WHERE id=$1`, id)
	if err != nil {
		return false, fmt.Errorf("delete model %d: %w", id, err)
	}
	return tag.RowsAffected() > 0, nil
}
