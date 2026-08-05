package handler

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/labstack/echo/v4"

	"slicer-labeler/internal/db"
	"slicer-labeler/internal/service"
)

// RoleHandler manages roles (requires admin-config-*).
type RoleHandler struct {
	roleStore *db.RoleStore
	userStore *db.UserStore
	auth      *service.AuthService
}

func NewRoleHandler(roleStore *db.RoleStore, userStore *db.UserStore, auth *service.AuthService) *RoleHandler {
	return &RoleHandler{roleStore: roleStore, userStore: userStore, auth: auth}
}

func (h *RoleHandler) List(c echo.Context) error {
	user, _ := c.Get("user").(*db.User)
	if err := h.auth.Authorize(c.Request().Context(), user, "admin-config-read", "", 0); err != nil {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "无权限"})
	}
	roles, err := h.roleStore.List(c.Request().Context())
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"data": roles})
}

// validatePerms rejects any permission string outside the known whitelist.
func validatePerms(perms []string) error {
	known := make(map[string]bool, len(db.AllPermissions))
	for _, p := range db.AllPermissions {
		known[p] = true
	}
	for _, p := range perms {
		if !known[p] {
			return fmt.Errorf("非法权限: %s", p)
		}
	}
	return nil
}

func (h *RoleHandler) Create(c echo.Context) error {
	user, _ := c.Get("user").(*db.User)
	if err := h.auth.Authorize(c.Request().Context(), user, "admin-config-write", "", 0); err != nil {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "无权限"})
	}
	var req struct {
		Name        string   `json:"name"`
		Description string   `json:"description"`
		Permissions []string `json:"permissions"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	if req.Name == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "角色名不能为空"})
	}
	if err := validatePerms(req.Permissions); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	existing, err := h.roleStore.FindByName(c.Request().Context(), req.Name)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if existing != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "角色名已存在"})
	}
	role := &db.Role{Name: req.Name, Description: req.Description, Permissions: req.Permissions}
	if err := h.roleStore.Create(c.Request().Context(), role); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, role)
}

func (h *RoleHandler) Update(c echo.Context) error {
	user, _ := c.Get("user").(*db.User)
	if err := h.auth.Authorize(c.Request().Context(), user, "admin-config-write", "", 0); err != nil {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "无权限"})
	}
	id, err := strconv.ParseInt(c.Param("roleId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid roleId"})
	}
	var req struct {
		Name        string   `json:"name"`
		Description string   `json:"description"`
		Permissions []string `json:"permissions"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	role, err := h.roleStore.FindByID(c.Request().Context(), id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if role == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "角色不存在"})
	}
	if role.IsSystem {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "系统内置角色不可修改"})
	}
	if err := validatePerms(req.Permissions); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	updated, err := h.roleStore.Update(c.Request().Context(), id, req.Name, req.Description, req.Permissions)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, updated)
}

func (h *RoleHandler) Delete(c echo.Context) error {
	user, _ := c.Get("user").(*db.User)
	if err := h.auth.Authorize(c.Request().Context(), user, "admin-config-write", "", 0); err != nil {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "无权限"})
	}
	id, err := strconv.ParseInt(c.Param("roleId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid roleId"})
	}
	role, err := h.roleStore.FindByID(c.Request().Context(), id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if role == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "角色不存在"})
	}
	if role.IsSystem {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "系统内置角色不可删除"})
	}
	count, err := h.userStore.CountByRole(c.Request().Context(), id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if count > 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "仍有用户使用该角色，请先调整用户角色"})
	}
	if _, err := h.roleStore.Delete(c.Request().Context(), id); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"success": true})
}
