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

// AutoMigrate creates or updates tables to match the model structs.
func AutoMigrate(db *gorm.DB) error {
	if err := db.AutoMigrate(&Model{}, &Dataset{}, &Entry{}); err != nil {
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
