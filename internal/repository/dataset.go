package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"slicer-labeler/internal/model"
)

type DatasetRepo struct {
	pool *pgxpool.Pool
}

func NewDatasetRepo(pool *pgxpool.Pool) *DatasetRepo {
	return &DatasetRepo{pool: pool}
}

func (r *DatasetRepo) ListByModel(ctx context.Context, modelID int64) ([]model.Dataset, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, model_id, name, description, created_at, updated_at FROM datasets WHERE model_id=$1 ORDER BY created_at DESC`, modelID)
	if err != nil {
		return nil, fmt.Errorf("list datasets for model %d: %w", modelID, err)
	}
	defer rows.Close()

	var datasets []model.Dataset
	for rows.Next() {
		var d model.Dataset
		if err := rows.Scan(&d.ID, &d.ModelID, &d.Name, &d.Description, &d.CreatedAt, &d.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan dataset: %w", err)
		}
		datasets = append(datasets, d)
	}
	if datasets == nil {
		datasets = []model.Dataset{}
	}
	return datasets, rows.Err()
}

func (r *DatasetRepo) Get(ctx context.Context, id int64) (*model.Dataset, error) {
	var d model.Dataset
	err := r.pool.QueryRow(ctx,
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

func (r *DatasetRepo) Create(ctx context.Context, modelID int64, name, description string) (*model.Dataset, error) {
	var d model.Dataset
	now := time.Now()
	err := r.pool.QueryRow(ctx,
		`INSERT INTO datasets (model_id, name, description, created_at, updated_at) VALUES ($1, $2, $3, $4, $5) RETURNING id, model_id, name, description, created_at, updated_at`,
		modelID, name, description, now, now,
	).Scan(&d.ID, &d.ModelID, &d.Name, &d.Description, &d.CreatedAt, &d.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create dataset: %w", err)
	}
	return &d, nil
}

func (r *DatasetRepo) Update(ctx context.Context, id int64, name, description string) (*model.Dataset, error) {
	var d model.Dataset
	err := r.pool.QueryRow(ctx,
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

func (r *DatasetRepo) Delete(ctx context.Context, id int64) (bool, error) {
	tag, err := r.pool.Exec(ctx, `DELETE FROM datasets WHERE id=$1`, id)
	if err != nil {
		return false, fmt.Errorf("delete dataset %d: %w", id, err)
	}
	return tag.RowsAffected() > 0, nil
}
