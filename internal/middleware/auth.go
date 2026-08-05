package middleware

import (
	"log"
	"strings"
	"sync"
	"time"

	"github.com/labstack/echo/v4"

	"slicer-labeler/internal/service"
)

// RequireAuth parses the Bearer JWT and attaches the user to the context.
// Unauthenticated requests get 401; disabled accounts get 403.
func RequireAuth(auth *service.AuthService) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			// Header for fetch/XHR; query param for EventSource and <audio> which
			// cannot send custom headers.
			token := ""
			if h := c.Request().Header.Get(echo.HeaderAuthorization); strings.HasPrefix(h, "Bearer ") {
				token = strings.TrimPrefix(h, "Bearer ")
			} else {
				token = c.QueryParam("token")
			}
			if token == "" {
				log.Printf("AUTH FAIL ip=%s %s %s: missing token", c.RealIP(), c.Request().Method, c.Request().URL.Path)
				return c.JSON(401, map[string]string{"error": "未登录"})
			}
			userID, err := auth.ParseToken(token)
			if err != nil {
				log.Printf("AUTH FAIL ip=%s %s %s: invalid token (%v)", c.RealIP(), c.Request().Method, c.Request().URL.Path, err)
				return c.JSON(401, map[string]string{"error": "登录已过期，请重新登录"})
			}
			user, err := auth.GetUser(c.Request().Context(), userID)
			if err != nil || user == nil {
				log.Printf("AUTH FAIL ip=%s %s %s: user %d not found", c.RealIP(), c.Request().Method, c.Request().URL.Path, userID)
				return c.JSON(401, map[string]string{"error": "用户不存在"})
			}
			if !user.IsActive {
				log.Printf("AUTH FAIL ip=%s %s %s: user %d (%s) disabled", c.RealIP(), c.Request().Method, c.Request().URL.Path, user.ID, user.GitHubLogin)
				return c.JSON(403, map[string]string{"error": "账号已停用，请联系管理员"})
			}
			log.Printf("AUTH OK user=%d login=%s name=%s role=%s %s %s",
				user.ID, user.GitHubLogin, user.DisplayName, user.Role.Name, c.Request().Method, c.Request().URL.Path)
			c.Set("user", user)
			return next(c)
		}
	}
}

// rateBucket tracks timestamps of recent requests for a key.
type rateBucket struct {
	mu sync.Mutex
	ts []time.Time
}

// RateLimit rejects requests exceeding max in window per client IP.
func RateLimit(max int, window time.Duration) echo.MiddlewareFunc {
	var mu sync.Mutex
	buckets := map[string]*rateBucket{}

	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			ip := c.RealIP()
			now := time.Now()

			mu.Lock()
			b, ok := buckets[ip]
			if !ok {
				b = &rateBucket{}
				buckets[ip] = b
			}
			mu.Unlock()

			b.mu.Lock()
			defer b.mu.Unlock()
			cutoff := now.Add(-window)
			kept := b.ts[:0]
			for _, t := range b.ts {
				if t.After(cutoff) {
					kept = append(kept, t)
				}
			}
			b.ts = kept
			if len(b.ts) >= max {
				return c.JSON(429, map[string]string{"error": "请求过于频繁，请稍后再试"})
			}
			b.ts = append(b.ts, now)
			return next(c)
		}
	}
}
