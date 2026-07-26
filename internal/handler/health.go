package handler

import (
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

type HealthHandler struct {
	pool *pgxpool.Pool
}

func NewHealthHandler(pool *pgxpool.Pool) *HealthHandler {
	return &HealthHandler{pool: pool}
}

func (h *HealthHandler) GetHealth(c echo.Context) error {
	err := h.pool.Ping(c.Request().Context())
	dbOk := err == nil
	return c.JSON(http.StatusOK, map[string]interface{}{
		"ok":      dbOk,
		"db":      dbOk,
		"version": "0.1.0",
	})
}
