package handler

import (
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"

	"slicer-labeler/internal/config"
	"slicer-labeler/internal/repository"
	"slicer-labeler/internal/service"
)

// RegisterRoutes sets up all API routes on the Echo instance.
func RegisterRoutes(e *echo.Echo, pool *pgxpool.Pool, cfg *config.Config) {
	// Repositories
	modelRepo := repository.NewModelRepo(pool)
	datasetRepo := repository.NewDatasetRepo(pool)
	entryRepo := repository.NewEntryRepo(pool)
	qualityRepo := repository.NewQualityRepo(pool)

	// Services
	audioSvc := service.NewAudioService(cfg.AudioDataDir)
	storageSvc := service.NewStorageService(cfg.AudioStorageBase)
	deepseekSvc := service.NewDeepSeekService(cfg.DeepSeekAPIKey, cfg.DeepSeekAPIURL, cfg.DeepSeekModel)
	qualitySvc := service.NewQualityService(audioSvc, deepseekSvc, qualityRepo, entryRepo)

	// Handlers
	healthH := NewHealthHandler(pool)
	modelH := NewModelHandler(modelRepo)
	datasetH := NewDatasetHandler(datasetRepo)
	entryH := NewEntryHandler(entryRepo, qualityRepo)
	audioH := NewAudioHandler(entryRepo, storageSvc)
	splitH := NewSplitHandler(entryRepo, audioSvc)
	mergeH := NewMergeHandler(entryRepo, audioSvc, deepseekSvc)
	qualityH := NewQualityHandler(entryRepo, qualityRepo, qualitySvc)

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

	// Quality
	api.POST("/entries/:entryId/quality/check", qualityH.Check)
	api.GET("/datasets/:datasetId/quality/cache", qualityH.Cache)
	api.POST("/datasets/:datasetId/quality/batch-check", qualityH.BatchCheck)
}
