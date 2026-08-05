package handler

import (
	"context"
	"fmt"

	"slicer-labeler/internal/db"
)

// resolveNames looks up model and dataset names from a dataset ID.
func resolveNames(ctx context.Context, datasetStore *db.DatasetStore, modelStore *db.ModelStore, datasetID int64) (string, string, error) {
	d, err := datasetStore.Get(ctx, datasetID)
	if err != nil || d == nil {
		return "", "", fmt.Errorf("dataset %d not found", datasetID)
	}
	m, err := modelStore.Get(ctx, d.ModelID)
	if err != nil || m == nil {
		return "", "", fmt.Errorf("model %d not found", d.ModelID)
	}
	return m.Name, d.Name, nil
}
