package handler

import (
	"net/http"
	"strconv"

	"github.com/labstack/echo/v4"

	"slicer-labeler/internal/db"
	"slicer-labeler/internal/service"
)

// UserHandler manages users (requires user-manage-all).
type UserHandler struct {
	userStore *db.UserStore
	roleStore *db.RoleStore
	auth      *service.AuthService
}

func NewUserHandler(userStore *db.UserStore, roleStore *db.RoleStore, auth *service.AuthService) *UserHandler {
	return &UserHandler{userStore: userStore, roleStore: roleStore, auth: auth}
}

func (h *UserHandler) List(c echo.Context) error {
	user, _ := c.Get("user").(*db.User)
	if err := h.auth.Authorize(c.Request().Context(), user, "user-manage-all", "", 0); err != nil {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "无权限"})
	}
	users, err := h.userStore.List(c.Request().Context())
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"data": users})
}

// Directory returns a minimal user list for the grant UI. Any authenticated
// user may read it (it only exposes safe profile fields, no roles/emails).
func (h *UserHandler) Directory(c echo.Context) error {
	users, err := h.userStore.List(c.Request().Context())
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	type dirUser struct {
		ID          int64  `json:"id"`
		DisplayName string `json:"displayName"`
		GitHubLogin string `json:"githubLogin"`
		AvatarURL   string `json:"avatarUrl"`
	}
	out := make([]dirUser, 0, len(users))
	for _, u := range users {
		out = append(out, dirUser{ID: u.ID, DisplayName: u.DisplayName, GitHubLogin: u.GitHubLogin, AvatarURL: u.AvatarURL})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"data": out})
}

func (h *UserHandler) UpdateRole(c echo.Context) error {
	user, _ := c.Get("user").(*db.User)
	if err := h.auth.Authorize(c.Request().Context(), user, "user-manage-all", "", 0); err != nil {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "无权限"})
	}
	id, err := strconv.ParseInt(c.Param("userId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid userId"})
	}
	var req struct {
		RoleID int64 `json:"roleId"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	role, err := h.roleStore.FindByID(c.Request().Context(), req.RoleID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if role == nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "角色不存在"})
	}
	if err := h.userStore.UpdateRole(c.Request().Context(), id, req.RoleID); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"success": true})
}

func (h *UserHandler) ToggleActive(c echo.Context) error {
	user, _ := c.Get("user").(*db.User)
	if err := h.auth.Authorize(c.Request().Context(), user, "user-manage-all", "", 0); err != nil {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "无权限"})
	}
	id, err := strconv.ParseInt(c.Param("userId"), 10, 64)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid userId"})
	}
	if id == user.ID {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "不能停用自己的账号"})
	}
	var req struct {
		Active bool `json:"active"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	if err := h.userStore.SetActive(c.Request().Context(), id, req.Active); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"success": true})
}
