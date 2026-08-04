package db

import (
	"context"
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"slicer-labeler/internal/model"
)

// Entry is a single annotated audio slice.
type Entry struct {
	ID        int64                  `json:"id" gorm:"primaryKey;autoIncrement"`
	DatasetID int64                  `json:"dataset_id" gorm:"not null;index;uniqueIndex:idx_dataset_wav;constraint:OnDelete:CASCADE"`
	WavPath   string                 `json:"wavPath" gorm:"type:text;not null;uniqueIndex:idx_dataset_wav"`
	Speaker   string                 `json:"speaker" gorm:"type:text;not null;default:''"`
	Language  string                 `json:"language" gorm:"type:text;not null;default:'';check:language_valid,language = '' OR language ~ '^[A-Z]{2}$'"`
	Text      string                 `json:"text" gorm:"type:text;not null;default:''"`
	MetaData  map[string]interface{} `json:"metaData" gorm:"type:jsonb;not null;default:'{}';serializer:json"`
	Deleted   bool                   `json:"deleted" gorm:"not null;default:false"`
	SortOrder float64                `json:"sortOrder" gorm:"not null;default:0"`
	CreatedAt time.Time              `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt time.Time              `json:"updated_at" gorm:"autoUpdateTime"`
	Dataset   Dataset                `json:"-" gorm:"foreignKey:DatasetID;constraint:OnDelete:CASCADE"`
}

func (Entry) TableName() string { return "entries" }

// EntryStore provides CRUD operations for entries.
type EntryStore struct {
	db *gorm.DB
}

func NewEntryStore(db *gorm.DB) *EntryStore {
	return &EntryStore{db: db}
}

func (s *EntryStore) ListByDataset(ctx context.Context, datasetID int64, page, pageSize int) ([]Entry, int64, error) {
	var total int64
	if err := s.db.WithContext(ctx).Model(&Entry{}).Where("dataset_id = ? AND deleted = ?", datasetID, false).Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count entries: %w", err)
	}

	offset := (page - 1) * pageSize
	var entries []Entry
	err := s.db.WithContext(ctx).
		Where("dataset_id = ? AND deleted = ?", datasetID, false).
		Order("sort_order ASC, id ASC").
		Limit(pageSize).Offset(offset).
		Find(&entries).Error
	if err != nil {
		return nil, 0, fmt.Errorf("list entries: %w", err)
	}
	if entries == nil {
		entries = []Entry{}
	}
	return entries, total, nil
}

func (s *EntryStore) GetByID(ctx context.Context, id int64) (*Entry, error) {
	var e Entry
	err := s.db.WithContext(ctx).First(&e, id).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get entry %d: %w", id, err)
	}
	return &e, nil
}

func (s *EntryStore) GetByDatasetAndWavPath(ctx context.Context, datasetID int64, wavPath string) (*Entry, error) {
	var e Entry
	err := s.db.WithContext(ctx).
		Where("dataset_id = ? AND wav_path = ?", datasetID, wavPath).
		First(&e).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get entry by path: %w", err)
	}
	return &e, nil
}

func (s *EntryStore) BatchUpsert(ctx context.Context, datasetID int64, inputs []model.EntryInput) (int, error) {
	// New entries keep increasing sort order so they append after existing ones.
	var maxSort float64
	if err := s.db.WithContext(ctx).Model(&Entry{}).Where("dataset_id = ?", datasetID).
		Select("COALESCE(MAX(sort_order), 0)").Scan(&maxSort).Error; err != nil {
		return 0, fmt.Errorf("get max sort order: %w", err)
	}

	entries := make([]Entry, len(inputs))
	for i, in := range inputs {
		entries[i] = Entry{
			DatasetID: datasetID,
			WavPath:   in.WavPath,
			Speaker:   in.Speaker,
			Language:  in.Language,
			Text:      in.Text,
			MetaData:  in.MetaData,
			SortOrder: maxSort + float64(i+1),
		}
	}

	// sort_order is intentionally not part of the update columns: re-importing an
	// existing wavPath keeps its original position instead of moving to the end.
	result := s.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "dataset_id"}, {Name: "wav_path"}},
		DoUpdates: clause.AssignmentColumns([]string{"speaker", "language", "text", "meta_data", "deleted", "updated_at"}),
	}).Create(&entries)

	return int(result.RowsAffected), result.Error
}

func (s *EntryStore) UpdateText(ctx context.Context, id int64, text string) (*Entry, error) {
	result := s.db.WithContext(ctx).Model(&Entry{}).Where("id = ?", id).Update("text", text)
	if result.RowsAffected == 0 {
		return nil, nil
	}
	if result.Error != nil {
		return nil, fmt.Errorf("update entry text %d: %w", id, result.Error)
	}
	return s.GetByID(ctx, id)
}

// Delete soft-deletes an entry by marking it deleted. The audio file in object
// storage is intentionally left untouched.
func (s *EntryStore) Delete(ctx context.Context, id int64) (bool, error) {
	result := s.db.WithContext(ctx).Model(&Entry{}).Where("id = ?", id).Update("deleted", true)
	if result.Error != nil {
		return false, fmt.Errorf("soft delete entry %d: %w", id, result.Error)
	}
	return result.RowsAffected > 0, nil
}

// FindByWavPath finds the first entry matching the given wav_path (basename).
func (s *EntryStore) FindByWavPath(ctx context.Context, wavPath string) (*Entry, error) {
	var e Entry
	err := s.db.WithContext(ctx).Where("wav_path = ?", wavPath).First(&e).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("find entry by wav path: %w", err)
	}
	return &e, nil
}

// Create inserts a single entry and returns it with its generated id.
func (s *EntryStore) Create(ctx context.Context, datasetID int64, input model.EntryInput) (*Entry, error) {
	var maxSort float64
	if err := s.db.WithContext(ctx).Model(&Entry{}).Where("dataset_id = ?", datasetID).
		Select("COALESCE(MAX(sort_order), 0)").Scan(&maxSort).Error; err != nil {
		return nil, fmt.Errorf("get max sort order: %w", err)
	}
	return createEntryTx(s.db.WithContext(ctx), datasetID, input, maxSort+1)
}

// SplitReplace atomically creates two entries (first, second) and soft-deletes the
// original one. The new entries keep the original entry's position: first takes the
// original sort order and second sits between it and the next entry (mid-point), so
// consecutive splits on the same branch never collide.
func (s *EntryStore) SplitReplace(ctx context.Context, datasetID, originalID int64, first, second model.EntryInput) ([]Entry, error) {
	var out []Entry
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var orig Entry
		if err := tx.First(&orig, originalID).Error; err != nil {
			return fmt.Errorf("get original entry %d: %w", originalID, err)
		}

		var nextSort float64
		if err := tx.Model(&Entry{}).
			Where("dataset_id = ? AND deleted = ? AND sort_order > ?", datasetID, false, orig.SortOrder).
			Order("sort_order ASC").Limit(1).Pluck("sort_order", &nextSort).Error; err != nil {
			return fmt.Errorf("get next sort order: %w", err)
		}
		if nextSort == 0 {
			nextSort = orig.SortOrder + 1
		}

		f, err := createEntryTx(tx, datasetID, first, orig.SortOrder)
		if err != nil {
			return err
		}
		sc, err := createEntryTx(tx, datasetID, second, (orig.SortOrder+nextSort)/2)
		if err != nil {
			return err
		}
		if err := tx.Model(&Entry{}).Where("id = ?", originalID).Update("deleted", true).Error; err != nil {
			return fmt.Errorf("soft delete original entry %d: %w", originalID, err)
		}
		out = []Entry{*f, *sc}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// MergeReplace atomically soft-deletes the source entries and creates the merged one
// at the position of the first source entry.
func (s *EntryStore) MergeReplace(ctx context.Context, datasetID int64, sourceIDs []int64, merged model.EntryInput) (*Entry, error) {
	var out *Entry
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var minSort float64
		if len(sourceIDs) > 0 {
			if err := tx.Model(&Entry{}).Where("id IN ?", sourceIDs).
				Select("COALESCE(MIN(sort_order), 0)").Scan(&minSort).Error; err != nil {
				return fmt.Errorf("get min source sort order: %w", err)
			}
			if err := tx.Model(&Entry{}).Where("id IN ?", sourceIDs).Update("deleted", true).Error; err != nil {
				return fmt.Errorf("soft delete source entries: %w", err)
			}
		}
		m, err := createEntryTx(tx, datasetID, merged, minSort)
		if err != nil {
			return err
		}
		out = m
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (s *EntryStore) CountByDataset(ctx context.Context, datasetID int64) (int64, error) {
	var total int64
	if err := s.db.WithContext(ctx).Model(&Entry{}).Where("dataset_id = ? AND deleted = ?", datasetID, false).Count(&total).Error; err != nil {
		return 0, fmt.Errorf("count entries: %w", err)
	}
	return total, nil
}

func createEntryTx(tx *gorm.DB, datasetID int64, input model.EntryInput, sortOrder float64) (*Entry, error) {
	entry := Entry{
		DatasetID: datasetID,
		WavPath:   input.WavPath,
		Speaker:   input.Speaker,
		Language:  input.Language,
		Text:      input.Text,
		MetaData:  input.MetaData,
		SortOrder: sortOrder,
	}
	if err := tx.Create(&entry).Error; err != nil {
		return nil, fmt.Errorf("create entry: %w", err)
	}
	return &entry, nil
}
