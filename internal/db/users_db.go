package db

import (
	"context"
	"fmt"
	"time"

	"gorm.io/gorm"
)

// User is an authenticated account (backed by GitHub OAuth, or the DEV user).
type User struct {
	ID          int64     `json:"id" gorm:"primaryKey;autoIncrement"`
	GitHubID    string    `json:"githubId" gorm:"column:github_id;type:text;uniqueIndex;default:''"`
	GitHubLogin string    `json:"githubLogin" gorm:"column:github_login;type:text;not null;default:''"`
	DisplayName string    `json:"displayName" gorm:"type:text;not null;default:''"`
	AvatarURL   string    `json:"avatarUrl" gorm:"type:text;not null;default:''"`
	Email       string    `json:"email" gorm:"type:text;not null;default:''"`
	RoleID      int64     `json:"roleId" gorm:"not null;index"`
	IsActive    bool      `json:"isActive" gorm:"not null;default:true"`
	CreatedAt   time.Time `json:"createdAt" gorm:"autoCreateTime"`
	Role        Role      `json:"role" gorm:"foreignKey:RoleID"`
}

func (User) TableName() string { return "users" }

// UserStore provides CRUD operations for users.
type UserStore struct {
	db *gorm.DB
}

func NewUserStore(db *gorm.DB) *UserStore {
	return &UserStore{db: db}
}

func (s *UserStore) FindByGitHubID(ctx context.Context, githubID string) (*User, error) {
	if githubID == "" {
		return nil, nil
	}
	var u User
	err := s.db.WithContext(ctx).Preload("Role").Where("github_id = ?", githubID).First(&u).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("find user by github id: %w", err)
	}
	return &u, nil
}

func (s *UserStore) FindByID(ctx context.Context, id int64) (*User, error) {
	var u User
	err := s.db.WithContext(ctx).Preload("Role").First(&u, id).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("find user %d: %w", id, err)
	}
	return &u, nil
}

func (s *UserStore) Create(ctx context.Context, u *User) error {
	if err := s.db.WithContext(ctx).Create(u).Error; err != nil {
		return fmt.Errorf("create user: %w", err)
	}
	return nil
}

func (s *UserStore) List(ctx context.Context) ([]User, error) {
	var users []User
	err := s.db.WithContext(ctx).Preload("Role").Order("created_at ASC").Find(&users).Error
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	if users == nil {
		users = []User{}
	}
	return users, nil
}

func (s *UserStore) UpdateRole(ctx context.Context, id, roleID int64) error {
	if err := s.db.WithContext(ctx).Model(&User{}).Where("id = ?", id).Update("role_id", roleID).Error; err != nil {
		return fmt.Errorf("update user role: %w", err)
	}
	return nil
}

func (s *UserStore) SetActive(ctx context.Context, id int64, active bool) error {
	if err := s.db.WithContext(ctx).Model(&User{}).Where("id = ?", id).Update("is_active", active).Error; err != nil {
		return fmt.Errorf("set user active: %w", err)
	}
	return nil
}

// Count returns the total number of users (used to grant admin to the first user).
func (s *UserStore) Count(ctx context.Context) (int64, error) {
	var n int64
	if err := s.db.WithContext(ctx).Model(&User{}).Count(&n).Error; err != nil {
		return 0, fmt.Errorf("count users: %w", err)
	}
	return n, nil
}

// CountByRole returns how many users reference the given role.
func (s *UserStore) CountByRole(ctx context.Context, roleID int64) (int64, error) {
	var n int64
	if err := s.db.WithContext(ctx).Model(&User{}).Where("role_id = ?", roleID).Count(&n).Error; err != nil {
		return 0, fmt.Errorf("count users by role: %w", err)
	}
	return n, nil
}
