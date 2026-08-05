package handler

import (
	"log"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"

	"slicer-labeler/internal/config"
	"slicer-labeler/internal/db"
	appmw "slicer-labeler/internal/middleware"
	"slicer-labeler/internal/service"
)

// RegisterRoutes sets up all API routes on the Echo instance.
func RegisterRoutes(e *echo.Echo, gormDB *gorm.DB, cfg *config.Config) {
	// Stores
	modelStore := db.NewModelStore(gormDB)
	datasetStore := db.NewDatasetStore(gormDB)
	entryStore := db.NewEntryStore(gormDB)
	userStore := db.NewUserStore(gormDB)
	roleStore := db.NewRoleStore(gormDB)
	grantStore := db.NewGrantStore(gormDB)

	// Services
	storageSvc, err := service.NewStorageService(cfg.StorageEndpoint, cfg.StorageBucket, cfg.StorageAccessKey, cfg.StorageSecretKey, cfg.StoragePrefix, cfg.TmpDir)
	if err != nil {
		log.Fatalf("Failed to init storage: %v", err)
	}
	audioSvc := service.NewAudioService(storageSvc)
	deepseekSvc := service.NewDeepSeekService(cfg.DeepSeekAPIKey, cfg.DeepSeekAPIURL, cfg.DeepSeekModel)
	authSvc := service.NewAuthService(cfg, userStore, roleStore, grantStore, modelStore, datasetStore)

	// TaskManager guards concurrent writes while a dataset runs a task.
	tm := NewTaskManager()

	// Handlers
	healthH := NewHealthHandler(gormDB)
	authH := NewAuthHandler(authSvc, cfg)
	userH := NewUserHandler(userStore, roleStore, authSvc)
	roleH := NewRoleHandler(roleStore, userStore, authSvc)
	grantH := NewGrantHandler(grantStore, authSvc)
	modelH := NewModelHandler(modelStore, datasetStore, tm, authSvc)
	datasetH := NewDatasetHandler(datasetStore, tm, authSvc)
	entryH := NewEntryHandler(entryStore, datasetStore, tm, authSvc)
	audioH := NewAudioHandler(entryStore, datasetStore, modelStore, storageSvc, authSvc)
	splitH := NewSplitHandler(entryStore, datasetStore, modelStore, audioSvc, tm, authSvc)
	mergeH := NewMergeHandler(entryStore, datasetStore, modelStore, audioSvc, deepseekSvc, tm, authSvc)
	importH := NewImportHandler(entryStore, datasetStore, modelStore, storageSvc, tm, authSvc)
	archiveH := NewArchiveHandler(entryStore, datasetStore, modelStore, storageSvc, tm, authSvc)
	taskH := NewTaskHandler(tm, authSvc)

	api := e.Group("/api")

	// Public endpoints
	api.GET("/health", healthH.GetHealth)
	authPublic := api.Group("/auth", appmw.RateLimit(20, time.Minute))
	authPublic.GET("/login", authH.Login)
	authPublic.GET("/callback", authH.Callback)
	authPublic.POST("/dev-login", authH.DevLogin)

	// Everything below requires authentication.
	sec := api.Group("", appmw.RequireAuth(authSvc))

	// Auth (current user)
	sec.GET("/auth/me", authH.Me)
	sec.POST("/auth/logout", authH.Logout)

	// Users / Roles / Grants
	sec.GET("/users", userH.List)
	sec.GET("/users/directory", userH.Directory)
	sec.PUT("/users/:userId/role", userH.UpdateRole)
	sec.PUT("/users/:userId/active", userH.ToggleActive)
	sec.GET("/roles", roleH.List)
	sec.POST("/roles", roleH.Create)
	sec.PUT("/roles/:roleId", roleH.Update)
	sec.DELETE("/roles/:roleId", roleH.Delete)
	sec.GET("/grants", grantH.List)
	sec.POST("/grants", grantH.Add)
	sec.DELETE("/grants", grantH.Remove)

	// Models
	sec.GET("/models", modelH.List)
	sec.POST("/models", modelH.Create)
	sec.GET("/models/:modelId", modelH.Get)
	sec.PUT("/models/:modelId", modelH.Update)
	sec.DELETE("/models/:modelId", modelH.Delete)

	// Datasets
	sec.GET("/models/:modelId/datasets", datasetH.List)
	sec.POST("/models/:modelId/datasets", datasetH.Create)
	sec.GET("/datasets/:datasetId", datasetH.Get)
	sec.PUT("/datasets/:datasetId", datasetH.Update)
	sec.DELETE("/datasets/:datasetId", datasetH.Delete)

	// Entries
	sec.GET("/datasets/:datasetId/entries", entryH.List)
	sec.POST("/datasets/:datasetId/entries", entryH.BatchUpsert)
	sec.PUT("/entries/:entryId", entryH.Update)
	sec.DELETE("/entries/:entryId", entryH.Delete)

	// Audio
	sec.GET("/entries/:entryId/audio", audioH.GetAudio)

	// Split
	sec.POST("/entries/:entryId/split", splitH.Split)

	// Merge
	sec.POST("/entries/merge", mergeH.Merge)
	sec.POST("/entries/merge/polish", mergeH.Polish)

	// Import / Archive (async tasks)
	sec.POST("/datasets/:datasetId/import", importH.Import)
	sec.POST("/datasets/:datasetId/archive", archiveH.Archive)

	// Tasks
	sec.GET("/tasks", taskH.List)
	sec.GET("/tasks/events", taskH.Events)
	sec.GET("/tasks/:taskId/stream", taskH.Stream)
}
