package handler

import (
	"log"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"slicer-labeler/internal/config"
	"slicer-labeler/internal/db"
	"slicer-labeler/internal/service"
)

// RegisterRoutes sets up all API routes on the Echo instance.
func RegisterRoutes(e *echo.Echo, gormDB *gorm.DB, cfg *config.Config) {
	// Stores
	modelStore := db.NewModelStore(gormDB)
	datasetStore := db.NewDatasetStore(gormDB)
	entryStore := db.NewEntryStore(gormDB)

	// Services
	storageSvc, err := service.NewStorageService(cfg.StorageEndpoint, cfg.StorageBucket, cfg.StorageAccessKey, cfg.StorageSecretKey, cfg.StoragePrefix)
	if err != nil {
		log.Fatalf("Failed to init storage: %v", err)
	}
	audioSvc := service.NewAudioService(storageSvc)
	deepseekSvc := service.NewDeepSeekService(cfg.DeepSeekAPIKey, cfg.DeepSeekAPIURL, cfg.DeepSeekModel)

	// Handlers
	healthH := NewHealthHandler(gormDB)
	modelH := NewModelHandler(modelStore)
	datasetH := NewDatasetHandler(datasetStore)
	entryH := NewEntryHandler(entryStore)
	audioH := NewAudioHandler(entryStore, datasetStore, modelStore, storageSvc)
	splitH := NewSplitHandler(entryStore, datasetStore, modelStore, audioSvc)
	mergeH := NewMergeHandler(entryStore, datasetStore, modelStore, audioSvc, deepseekSvc)

	api := e.Group("/api")

	// Health
	api.GET("/health", healthH.GetHealth)

	// Models
	api.GET("/models", modelH.List)
	api.POST("/models", modelH.Create)
	api.GET("/models/:modelId", modelH.Get)
	api.PUT("/models/:modelId", modelH.Update)
	api.DELETE("/models/:modelId", modelH.Delete)

	// Datasets
	api.GET("/models/:modelId/datasets", datasetH.List)
	api.POST("/models/:modelId/datasets", datasetH.Create)
	api.GET("/datasets/:datasetId", datasetH.Get)
	api.PUT("/datasets/:datasetId", datasetH.Update)
	api.DELETE("/datasets/:datasetId", datasetH.Delete)

	// Entries
	api.GET("/datasets/:datasetId/entries", entryH.List)
	api.POST("/datasets/:datasetId/entries", entryH.BatchUpsert)
	api.PUT("/entries/:entryId", entryH.Update)
	api.DELETE("/entries/:entryId", entryH.Delete)

	// Audio
	api.GET("/entries/:entryId/audio", audioH.GetAudio)

	// Split
	api.POST("/entries/:entryId/split", splitH.Split)

	// Merge
	api.POST("/entries/merge", mergeH.Merge)
	api.POST("/entries/merge/polish", mergeH.Polish)
}
