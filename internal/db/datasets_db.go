package db

import (
	"context"
	"fmt"
	"time"

	"gorm.io/gorm"
)

// Dataset groups entries for a specific model.
type Dataset struct {
	ID          int64     `json:"id" gorm:"primaryKey;autoIncrement"`
	ModelID     int64     `json:"model_id" gorm:"not null;index;constraint:OnDelete:CASCADE"`
	Name        string    `json:"name" gorm:"type:text;not null"`
	Description string    `json:"description" gorm:"type:text;not null;default:''"`
	OwnerID     int64     `json:"ownerId" gorm:"not null;default:0;index"`
	CreatedAt   time.Time `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt   time.Time `json:"updated_at" gorm:"autoUpdateTime"`
	Model       Model     `json:"-" gorm:"foreignKey:ModelID;constraint:OnDelete:CASCADE"`

	// Computed fields (not persisted): capabilities for the requesting user.
	CanRead   bool `json:"canRead" gorm:"-"`
	CanWrite  bool `json:"canWrite" gorm:"-"`
	CanDelete bool `json:"canDelete" gorm:"-"`
	CanManage bool `json:"canManage" gorm:"-"`

	// Computed fields (not persisted): annotation progress.
	EntryCount    int64 `json:"entryCount" gorm:"-"`
	VerifiedCount int64 `json:"verifiedCount" gorm:"-"`
}

func (Dataset) TableName() string { return "datasets" }

// DatasetStore provides CRUD operations for datasets.
type DatasetStore struct {
	db *gorm.DB
}

func NewDatasetStore(db *gorm.DB) *DatasetStore {
	return &DatasetStore{db: db}
}

func (s *DatasetStore) ListByModel(ctx context.Context, modelID int64) ([]Dataset, error) {
	var datasets []Dataset
	err := s.db.WithContext(ctx).
		Where("model_id = ?", modelID).
		Order("created_at DESC").
		Find(&datasets).Error
	if err != nil {
		return nil, fmt.Errorf("list datasets for model %d: %w", modelID, err)
	}
	if datasets == nil {
		datasets = []Dataset{}
	}
	return datasets, nil
}

func (s *DatasetStore) Get(ctx context.Context, id int64) (*Dataset, error) {
	var d Dataset
	err := s.db.WithContext(ctx).First(&d, id).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get dataset %d: %w", id, err)
	}
	return &d, nil
}

func (s *DatasetStore) Create(ctx context.Context, modelID, ownerID int64, name, description string) (*Dataset, error) {
	d := Dataset{ModelID: modelID, Name: name, Description: description, OwnerID: ownerID}
	if err := s.db.WithContext(ctx).Create(&d).Error; err != nil {
		return nil, fmt.Errorf("create dataset: %w", err)
	}
	return &d, nil
}

func (s *DatasetStore) Update(ctx context.Context, id int64, name, description string) (*Dataset, error) {
	result := s.db.WithContext(ctx).Model(&Dataset{}).Where("id = ?", id).
		Updates(map[string]interface{}{
			"name":        name,
			"description": description,
		})
	if result.RowsAffected == 0 {
		return nil, nil
	}
	if result.Error != nil {
		return nil, fmt.Errorf("update dataset %d: %w", id, result.Error)
	}
	return s.Get(ctx, id)
}

func (s *DatasetStore) Delete(ctx context.Context, id int64) (bool, error) {
	result := s.db.WithContext(ctx).Delete(&Dataset{}, id)
	if result.Error != nil {
		return false, fmt.Errorf("delete dataset %d: %w", id, result.Error)
	}
	return result.RowsAffected > 0, nil
}

// BackfillOwner assigns ownerless (owner_id = 0) rows to ownerID.
func (s *DatasetStore) BackfillOwner(ctx context.Context, ownerID int64) error {
	return s.db.WithContext(ctx).Model(&Dataset{}).Where("owner_id = 0").Update("owner_id", ownerID).Error
}
