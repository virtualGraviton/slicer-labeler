package handler

import (
	"net/http"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

type HealthHandler struct {
	db *gorm.DB
}

func NewHealthHandler(db *gorm.DB) *HealthHandler {
	return &HealthHandler{db: db}
}

func (h *HealthHandler) GetHealth(c echo.Context) error {
	sqlDB, err := h.db.DB()
	dbOk := err == nil
	if dbOk {
		dbOk = sqlDB.Ping() == nil
	}
	return c.JSON(http.StatusOK, map[string]interface{}{
		"ok":      dbOk,
		"db":      dbOk,
		"version": "0.1.0",
	})
}
