package db

import (
	"fmt"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// NewDB opens a PostgreSQL connection with GORM.
func NewDB(dsn string) (*gorm.DB, error) {
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		return nil, fmt.Errorf("connect database: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("get sql.DB: %w", err)
	}

	sqlDB.SetMaxIdleConns(5)
	sqlDB.SetMaxOpenConns(20)
	sqlDB.SetConnMaxLifetime(30 * time.Minute)
	sqlDB.SetConnMaxIdleTime(5 * time.Minute)

	return db, nil
}

// AllPermissions is the complete set of semantic permission strings the
// platform knows about. System roles (admin) are seeded from this list.
var AllPermissions = []string{
	"model-read-all",
	"model-write-all",
	"model-delete-all",
	"model-manage-all",
	"dataset-read-all",
	"dataset-write-all",
	"dataset-delete-all",
	"dataset-manage-all",
	"task-read-all",
	"admin-config-read",
	"admin-config-write",
	"user-manage-all",
}

// SeedRoles creates the built-in admin/user roles on first startup.
func SeedRoles(db *gorm.DB) error {
	var n int64
	if err := db.Model(&Role{}).Count(&n).Error; err != nil {
		return fmt.Errorf("count roles: %w", err)
	}
	if n > 0 {
		return nil
	}
	admin := Role{Name: "admin", Description: "平台管理员，拥有全部权限", Permissions: AllPermissions, IsSystem: true}
	user := Role{Name: "user", Description: "普通用户，可管理自己创建的资源", Permissions: []string{}, IsSystem: true}
	if err := db.Create(&admin).Error; err != nil {
		return fmt.Errorf("seed admin role: %w", err)
	}
	if err := db.Create(&user).Error; err != nil {
		return fmt.Errorf("seed user role: %w", err)
	}
	return nil
}

// AutoMigrate creates or updates tables to match the model structs.
func AutoMigrate(db *gorm.DB) error {
	if err := db.AutoMigrate(&Role{}, &User{}, &ResourceGrant{}, &Model{}, &Dataset{}, &Entry{}); err != nil {
		return err
	}
	// Backfill sort_order for rows that predate the column (they get id order).
	if err := db.Exec(`UPDATE entries SET sort_order = id WHERE sort_order = 0`).Error; err != nil {
		return err
	}
	// Ensure CHECK constraint exists on entries.language (GORM tag may or may not apply it)
	return db.Exec(`
		DO $$ BEGIN
			IF NOT EXISTS (
				SELECT 1 FROM pg_constraint WHERE conname = 'language_valid'
			) THEN
				ALTER TABLE entries ADD CONSTRAINT language_valid
					CHECK (language = '' OR language ~ '^[A-Z]{2}$');
			END IF;
		END $$;
	`).Error
}
