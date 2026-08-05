package handler

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/labstack/echo/v4"

	"slicer-labeler/internal/db"
	"slicer-labeler/internal/service"
)

// allowedGrantPerms is the whitelist of permissions that can be granted on a
// resource. Manage rights are reserved to owners and global role permissions.
var allowedGrantPerms = map[string]bool{
	"model-read": true, "model-write": true, "model-delete": true,
	"dataset-read": true, "dataset-write": true, "dataset-delete": true,
}

// GrantHandler manages resource-level grants (requires -manage on the resource).
type GrantHandler struct {
	grantStore *db.GrantStore
	auth       *service.AuthService
}

func NewGrantHandler(grantStore *db.GrantStore, auth *service.AuthService) *GrantHandler {
	return &GrantHandler{grantStore: grantStore, auth: auth}
}

func parseResource(c echo.Context) (resType string, resID int64, err error) {
	resType = c.QueryParam("resourceType")
	resID, convErr := strconv.ParseInt(c.QueryParam("resourceId"), 10, 64)
	if resType != "model" && resType != "dataset" {
		return "", 0, fmt.Errorf("resourceType must be model or dataset")
	}
	if convErr != nil || resID <= 0 {
		return "", 0, fmt.Errorf("invalid resourceId")
	}
	return resType, resID, nil
}

func (h *GrantHandler) checkManage(c echo.Context, user *db.User, resType string, resID int64) error {
	if resType == "model" && !h.auth.CanManageModel(c.Request().Context(), user, resID) {
		return service.ErrForbidden
	}
	if resType == "dataset" && !h.auth.CanManageDataset(c.Request().Context(), user, resID) {
		return service.ErrForbidden
	}
	return nil
}

func (h *GrantHandler) List(c echo.Context) error {
	user, _ := c.Get("user").(*db.User)
	resType, resID, err := parseResource(c)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	if err := h.checkManage(c, user, resType, resID); err != nil {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "无权限"})
	}
	grants, err := h.grantStore.ListByResource(c.Request().Context(), resType, resID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"data": grants})
}

func (h *GrantHandler) Add(c echo.Context) error {
	user, _ := c.Get("user").(*db.User)
	resType, resID, err := parseResource(c)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	if err := h.checkManage(c, user, resType, resID); err != nil {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "无权限"})
	}
	var req struct {
		UserID     int64  `json:"userId"`
		Permission string `json:"permission"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	if !allowedGrantPerms[req.Permission] {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "非法权限"})
	}
	g := &db.ResourceGrant{
		UserID:       req.UserID,
		ResourceType: resType,
		ResourceID:   resID,
		Permission:   req.Permission,
		CreatedBy:    user.ID,
	}
	if err := h.grantStore.Add(c.Request().Context(), g); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "授权已存在或写入失败"})
	}
	return c.JSON(http.StatusOK, g)
}

func (h *GrantHandler) Remove(c echo.Context) error {
	user, _ := c.Get("user").(*db.User)
	resType, resID, err := parseResource(c)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	if err := h.checkManage(c, user, resType, resID); err != nil {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "无权限"})
	}
	var req struct {
		UserID     int64  `json:"userId"`
		Permission string `json:"permission"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	if err := h.grantStore.Remove(c.Request().Context(), req.UserID, resType, resID, req.Permission); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"success": true})
}
