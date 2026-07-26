package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ColumnDef describes a column that should exist on a table.
// ColumnSQL is the column definition fragment after ADD COLUMN,
// e.g. "name TEXT NOT NULL" or "description TEXT NOT NULL DEFAULT ''".
type ColumnDef struct {
	ColumnSQL string
}

// Index represents a database index definition.
type Index struct {
	Table string
	Name  string
	DDL   string
}

// TableDef describes a database table to be migrated.
type TableDef struct {
	Name     string
	TableDDL string
	Columns  []ColumnDef
	Indexes  []Index
}

// AllTables returns all table definitions in dependency order.
func AllTables() []TableDef {
	return []TableDef{
		{Name: ModelTable, TableDDL: ModelDDL, Columns: ModelColumns, Indexes: ModelIndexes},
		{Name: DatasetTable, TableDDL: DatasetDDL, Columns: DatasetColumns, Indexes: DatasetIndexes},
		{Name: EntryTable, TableDDL: EntryDDL, Columns: EntryColumns, Indexes: EntryIndexes},
		{Name: QualityResultTable, TableDDL: QualityResultDDL, Columns: QualityResultColumns, Indexes: QualityResultIndexes},
	}
}

// NewPool creates a new pgxpool connecting to the given database URL.
func NewPool(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database URL: %w", err)
	}

	config.MaxConns = 20
	config.MinConns = 2
	config.MaxConnLifetime = 30 * time.Minute
	config.MaxConnIdleTime = 5 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("create connection pool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	return pool, nil
}

// RunMigrations creates all tables, adds any missing columns, and builds indexes.
func RunMigrations(ctx context.Context, pool *pgxpool.Pool) error {
	for _, table := range AllTables() {
		if _, err := pool.Exec(ctx, table.TableDDL); err != nil {
			return fmt.Errorf("migrate table %s: %w", table.Name, err)
		}
		for _, col := range table.Columns {
			sql := fmt.Sprintf("ALTER TABLE %s ADD COLUMN IF NOT EXISTS %s", table.Name, col.ColumnSQL)
			if _, err := pool.Exec(ctx, sql); err != nil {
				return fmt.Errorf("add column to %s: %w", table.Name, err)
			}
		}
		for _, idx := range table.Indexes {
			if _, err := pool.Exec(ctx, idx.DDL); err != nil {
				return fmt.Errorf("create index %s on %s: %w", idx.Name, idx.Table, err)
			}
		}
	}
	return nil
}
