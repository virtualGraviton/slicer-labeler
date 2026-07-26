package db

import (
	"context"
	"fmt"
	"time"

	"gorm.io/gorm"
)

// Model represents a training model/project that datasets belong to.
type Model struct {
	ID          int64     `json:"id" gorm:"primaryKey;autoIncrement"`
	Name        string    `json:"name" gorm:"type:text;not null"`
	Description string    `json:"description" gorm:"type:text;not null;default:''"`
	CreatedAt   time.Time `json:"created_at" gorm:"autoCreateTime;index"`
	UpdatedAt   time.Time `json:"updated_at" gorm:"autoUpdateTime"`
}

func (Model) TableName() string { return "models" }

// ModelStore provides CRUD operations for models.
type ModelStore struct {
	db *gorm.DB
}

func NewModelStore(db *gorm.DB) *ModelStore {
	return &ModelStore{db: db}
}

func (s *ModelStore) List(ctx context.Context) ([]Model, error) {
	var models []Model
	err := s.db.WithContext(ctx).Order("created_at DESC").Find(&models).Error
	if err != nil {
		return nil, fmt.Errorf("list models: %w", err)
	}
	if models == nil {
		models = []Model{}
	}
	return models, nil
}

func (s *ModelStore) Get(ctx context.Context, id int64) (*Model, error) {
	var m Model
	err := s.db.WithContext(ctx).First(&m, id).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get model %d: %w", id, err)
	}
	return &m, nil
}

func (s *ModelStore) Create(ctx context.Context, name, description string) (*Model, error) {
	m := Model{Name: name, Description: description}
	if err := s.db.WithContext(ctx).Create(&m).Error; err != nil {
		return nil, fmt.Errorf("create model: %w", err)
	}
	return &m, nil
}

func (s *ModelStore) Update(ctx context.Context, id int64, name, description string) (*Model, error) {
	result := s.db.WithContext(ctx).Model(&Model{}).Where("id = ?", id).
		Updates(map[string]interface{}{
			"name":        name,
			"description": description,
		})
	if result.RowsAffected == 0 {
		return nil, nil
	}
	if result.Error != nil {
		return nil, fmt.Errorf("update model %d: %w", id, result.Error)
	}
	return s.Get(ctx, id)
}

func (s *ModelStore) Delete(ctx context.Context, id int64) (bool, error) {
	result := s.db.WithContext(ctx).Delete(&Model{}, id)
	if result.Error != nil {
		return false, fmt.Errorf("delete model %d: %w", id, result.Error)
	}
	return result.RowsAffected > 0, nil
}
