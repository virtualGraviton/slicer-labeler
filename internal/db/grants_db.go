package db

import (
	"context"
	"fmt"
	"time"

	"gorm.io/gorm"
)

// ResourceGrant grants a concrete permission on one specific resource to a user.
// resource_type ∈ {model, dataset}; permission ∈ {model-read, model-write,
// model-delete, dataset-read, dataset-write, dataset-delete}.
type ResourceGrant struct {
	ID           int64     `json:"id" gorm:"primaryKey;autoIncrement"`
	UserID       int64     `json:"userId" gorm:"not null;index;uniqueIndex:idx_grant_user_res"`
	ResourceType string    `json:"resourceType" gorm:"type:text;not null;uniqueIndex:idx_grant_user_res"`
	ResourceID   int64     `json:"resourceId" gorm:"not null;uniqueIndex:idx_grant_user_res"`
	Permission   string    `json:"permission" gorm:"type:text;not null;uniqueIndex:idx_grant_user_res"`
	CreatedBy    int64     `json:"createdBy" gorm:"not null"`
	CreatedAt    time.Time `json:"createdAt" gorm:"autoCreateTime"`
}

func (ResourceGrant) TableName() string { return "resource_grants" }

// GrantStore provides access to resource grants.
type GrantStore struct {
	db *gorm.DB
}

func NewGrantStore(db *gorm.DB) *GrantStore {
	return &GrantStore{db: db}
}

func (s *GrantStore) ListByResource(ctx context.Context, resourceType string, resourceID int64) ([]ResourceGrant, error) {
	var grants []ResourceGrant
	err := s.db.WithContext(ctx).
		Where("resource_type = ? AND resource_id = ?", resourceType, resourceID).
		Order("id ASC").
		Find(&grants).Error
	if err != nil {
		return nil, fmt.Errorf("list grants: %w", err)
	}
	if grants == nil {
		grants = []ResourceGrant{}
	}
	return grants, nil
}

// ListByUser returns all grants belonging to a user (for visibility filtering).
func (s *GrantStore) ListByUser(ctx context.Context, userID int64) ([]ResourceGrant, error) {
	var grants []ResourceGrant
	err := s.db.WithContext(ctx).Where("user_id = ?", userID).Find(&grants).Error
	if err != nil {
		return nil, fmt.Errorf("list grants for user: %w", err)
	}
	if grants == nil {
		grants = []ResourceGrant{}
	}
	return grants, nil
}

func (s *GrantStore) Add(ctx context.Context, g *ResourceGrant) error {
	if err := s.db.WithContext(ctx).Create(g).Error; err != nil {
		return fmt.Errorf("add grant: %w", err)
	}
	return nil
}

func (s *GrantStore) Remove(ctx context.Context, userID int64, resourceType string, resourceID int64, permission string) error {
	result := s.db.WithContext(ctx).
		Where("user_id = ? AND resource_type = ? AND resource_id = ? AND permission = ?",
			userID, resourceType, resourceID, permission).
		Delete(&ResourceGrant{})
	if result.Error != nil {
		return fmt.Errorf("remove grant: %w", result.Error)
	}
	return nil
}

func (s *GrantStore) HasGrant(ctx context.Context, userID int64, resourceType string, resourceID int64, permission string) (bool, error) {
	var n int64
	err := s.db.WithContext(ctx).Model(&ResourceGrant{}).
		Where("user_id = ? AND resource_type = ? AND resource_id = ? AND permission = ?",
			userID, resourceType, resourceID, permission).
		Count(&n).Error
	if err != nil {
		return false, fmt.Errorf("has grant: %w", err)
	}
	return n > 0, nil
}
