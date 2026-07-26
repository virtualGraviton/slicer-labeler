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
	ID        int64     `json:"id" gorm:"primaryKey;autoIncrement"`
	DatasetID int64     `json:"dataset_id" gorm:"not null;index;uniqueIndex:idx_dataset_wav;constraint:OnDelete:CASCADE"`
	WavPath   string    `json:"wav_path" gorm:"type:text;not null;uniqueIndex:idx_dataset_wav"`
	Speaker   string    `json:"speaker" gorm:"type:text;not null;default:''"`
	Language  string    `json:"language" gorm:"type:text;not null;default:''"`
	Text      string    `json:"text" gorm:"type:text;not null;default:''"`
	CreatedAt time.Time `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt time.Time `json:"updated_at" gorm:"autoUpdateTime"`
	Dataset   Dataset   `json:"-" gorm:"foreignKey:DatasetID;constraint:OnDelete:CASCADE"`
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
	if err := s.db.WithContext(ctx).Model(&Entry{}).Where("dataset_id = ?", datasetID).Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count entries: %w", err)
	}

	offset := (page - 1) * pageSize
	var entries []Entry
	err := s.db.WithContext(ctx).
		Where("dataset_id = ?", datasetID).
		Order("id ASC").
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
	entries := make([]Entry, len(inputs))
	for i, in := range inputs {
		entries[i] = Entry{
			DatasetID: datasetID,
			WavPath:   in.WavPath,
			Speaker:   in.Speaker,
			Language:  in.Language,
			Text:      in.Text,
		}
	}

	result := s.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "dataset_id"}, {Name: "wav_path"}},
		DoUpdates: clause.AssignmentColumns([]string{"speaker", "language", "text", "updated_at"}),
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

func (s *EntryStore) Delete(ctx context.Context, id int64) (bool, error) {
	result := s.db.WithContext(ctx).Delete(&Entry{}, id)
	if result.Error != nil {
		return false, fmt.Errorf("delete entry %d: %w", id, result.Error)
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

func (s *EntryStore) GetNext(ctx context.Context, entryID, datasetID int64) (*Entry, error) {
	var e Entry
	err := s.db.WithContext(ctx).
		Where("dataset_id = ? AND id > ?", datasetID, entryID).
		Order("id ASC").
		First(&e).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get next entry: %w", err)
	}
	return &e, nil
}
