package handler

import (
	"net/http"
	"net/url"

	"github.com/labstack/echo/v4"

	"slicer-labeler/internal/config"
	"slicer-labeler/internal/db"
	"slicer-labeler/internal/service"
)

const oauthStateCookie = "oauth_state"

// AuthHandler implements login flows and the current-user endpoint.
type AuthHandler struct {
	auth *service.AuthService
	cfg  *config.Config
}

func NewAuthHandler(auth *service.AuthService, cfg *config.Config) *AuthHandler {
	return &AuthHandler{auth: auth, cfg: cfg}
}

// Login redirects the browser to GitHub's authorization page.
func (h *AuthHandler) Login(c echo.Context) error {
	if h.cfg.GitHubClientID == "" {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "GitHub OAuth 未配置"})
	}
	state := randHex(16)
	c.SetCookie(&http.Cookie{
		Name:     oauthStateCookie,
		Value:    state,
		Path:     "/api/auth",
		MaxAge:   300,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	return c.Redirect(http.StatusFound, h.auth.LoginURL(state))
}

// Callback exchanges the OAuth code, upserts the user and redirects back to the
// frontend with a JWT in the URL fragment (?token=...).
func (h *AuthHandler) Callback(c echo.Context) error {
	state := c.QueryParam("state")
	code := c.QueryParam("code")
	if state == "" || code == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "missing state or code"})
	}
	cookie, err := c.Cookie(oauthStateCookie)
	if err != nil || cookie.Value != state {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "state 校验失败"})
	}

	gu, err := h.auth.ExchangeCode(code)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "GitHub 登录失败: " + err.Error()})
	}
	user, err := h.auth.EnsureGitHubUser(c.Request().Context(), gu)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "用户创建失败: " + err.Error()})
	}
	token, err := h.auth.SignToken(user.ID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "签发令牌失败"})
	}

	front := h.cfg.PublicURL
	if front == "" {
		front = "/"
	}
	return c.Redirect(http.StatusFound, front+"/login?token="+url.QueryEscape(token))
}

// DevLogin returns a token for the DEV user (only when DEV_MODE is on).
func (h *AuthHandler) DevLogin(c echo.Context) error {
	if !h.cfg.DevMode {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "not found"})
	}
	user, err := h.auth.EnsureDevUser(c.Request().Context())
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	token, err := h.auth.SignToken(user.ID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "签发令牌失败"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{
		"token":       token,
		"user":        user,
		"permissions": user.Role.Permissions,
	})
}

// Me returns the current user with their role permissions.
func (h *AuthHandler) Me(c echo.Context) error {
	user, _ := c.Get("user").(*db.User)
	return c.JSON(http.StatusOK, map[string]interface{}{
		"user":        user,
		"permissions": user.Role.Permissions,
	})
}

// Logout is stateless (JWT); the client drops the token. Endpoint exists for symmetry.
func (h *AuthHandler) Logout(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]interface{}{"success": true})
}
