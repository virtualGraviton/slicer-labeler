package db

import (
	"context"
	"fmt"
	"time"

	"gorm.io/gorm"
)

// Role is a named bundle of permission strings. Roles act purely as a routing
// layer to the underlying semantic permissions (e.g. dataset-read-all).
type Role struct {
	ID          int64     `json:"id" gorm:"primaryKey;autoIncrement"`
	Name        string    `json:"name" gorm:"type:text;not null;uniqueIndex"`
	Description string    `json:"description" gorm:"type:text;not null;default:''"`
	Permissions []string  `json:"permissions" gorm:"type:jsonb;not null;default:'[]';serializer:json"`
	IsSystem    bool      `json:"isSystem" gorm:"not null;default:false"`
	CreatedAt   time.Time `json:"createdAt" gorm:"autoCreateTime"`
}

func (Role) TableName() string { return "roles" }

// RoleStore provides CRUD operations for roles.
type RoleStore struct {
	db *gorm.DB
}

func NewRoleStore(db *gorm.DB) *RoleStore {
	return &RoleStore{db: db}
}

func (s *RoleStore) List(ctx context.Context) ([]Role, error) {
	var roles []Role
	err := s.db.WithContext(ctx).Order("id ASC").Find(&roles).Error
	if err != nil {
		return nil, fmt.Errorf("list roles: %w", err)
	}
	if roles == nil {
		roles = []Role{}
	}
	return roles, nil
}

func (s *RoleStore) FindByName(ctx context.Context, name string) (*Role, error) {
	var r Role
	err := s.db.WithContext(ctx).Where("name = ?", name).First(&r).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("find role %s: %w", name, err)
	}
	return &r, nil
}

func (s *RoleStore) FindByID(ctx context.Context, id int64) (*Role, error) {
	var r Role
	err := s.db.WithContext(ctx).First(&r, id).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("find role %d: %w", id, err)
	}
	return &r, nil
}

func (s *RoleStore) Create(ctx context.Context, r *Role) error {
	if err := s.db.WithContext(ctx).Create(r).Error; err != nil {
		return fmt.Errorf("create role: %w", err)
	}
	return nil
}

func (s *RoleStore) Update(ctx context.Context, id int64, name, description string, permissions []string) (*Role, error) {
	if err := s.db.WithContext(ctx).Model(&Role{}).Where("id = ?", id).Updates(map[string]interface{}{
		"name":        name,
		"description": description,
		"permissions": permissions,
	}).Error; err != nil {
		return nil, fmt.Errorf("update role %d: %w", id, err)
	}
	return s.FindByID(ctx, id)
}

func (s *RoleStore) Delete(ctx context.Context, id int64) (bool, error) {
	result := s.db.WithContext(ctx).Delete(&Role{}, id)
	if result.Error != nil {
		return false, fmt.Errorf("delete role %d: %w", id, result.Error)
	}
	return result.RowsAffected > 0, nil
}
