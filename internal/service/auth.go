package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"slicer-labeler/internal/config"
	"slicer-labeler/internal/db"
)

// --- JWT (standard-library HS256, no external deps) ---

const TokenTTL = 7 * 24 * time.Hour

// ErrForbidden is returned when a user lacks the required permission.
var ErrForbidden = errors.New("forbidden")

func (s *AuthService) SignToken(userID int64) (string, error) {
	now := time.Now()
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	payload, err := json.Marshal(map[string]interface{}{
		"sub": userID,
		"iat": now.Unix(),
		"exp": now.Add(TokenTTL).Unix(),
	})
	if err != nil {
		return "", err
	}
	body := header + "." + base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, []byte(s.cfg.JWTSecret))
	mac.Write([]byte(body))
	return body + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

func (s *AuthService) ParseToken(tokenStr string) (int64, error) {
	parts := strings.Split(tokenStr, ".")
	if len(parts) != 3 {
		return 0, fmt.Errorf("invalid token format")
	}
	body := parts[0] + "." + parts[1]
	mac := hmac.New(sha256.New, []byte(s.cfg.JWTSecret))
	mac.Write([]byte(body))
	expected := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(expected), []byte(parts[2])) {
		return 0, fmt.Errorf("invalid token signature")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return 0, err
	}
	var claims struct {
		Sub int64 `json:"sub"`
		Exp int64 `json:"exp"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return 0, err
	}
	if claims.Exp > 0 && time.Now().Unix() > claims.Exp {
		return 0, fmt.Errorf("token expired")
	}
	if claims.Sub <= 0 {
		return 0, fmt.Errorf("invalid subject")
	}
	return claims.Sub, nil
}

// AuthService handles authentication (JWT + GitHub OAuth) and authorization
// (role permissions, resource ownership and grants).
type AuthService struct {
	cfg          *config.Config
	userStore    *db.UserStore
	roleStore    *db.RoleStore
	grantStore   *db.GrantStore
	modelStore   *db.ModelStore
	datasetStore *db.DatasetStore
}

func NewAuthService(cfg *config.Config, userStore *db.UserStore, roleStore *db.RoleStore, grantStore *db.GrantStore, modelStore *db.ModelStore, datasetStore *db.DatasetStore) *AuthService {
	return &AuthService{
		cfg:          cfg,
		userStore:    userStore,
		roleStore:    roleStore,
		grantStore:   grantStore,
		modelStore:   modelStore,
		datasetStore: datasetStore,
	}
}

// --- GitHub OAuth ---

type GitHubUser struct {
	ID        int64  `json:"id"`
	Login     string `json:"login"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
	Email     string `json:"email"`
}

func (s *AuthService) LoginURL(state string) string {
	return "https://github.com/login/oauth/authorize?client_id=" + s.cfg.GitHubClientID +
		"&redirect_uri=" + url.QueryEscape(s.cfg.GitHubCallbackURL) +
		"&state=" + url.QueryEscape(state) +
		"&scope=read:user"
}

func (s *AuthService) ExchangeCode(code string) (*GitHubUser, error) {
	client := &http.Client{Timeout: 15 * time.Second}

	form := url.Values{
		"client_id":     {s.cfg.GitHubClientID},
		"client_secret": {s.cfg.GitHubClientSecret},
		"code":          {code},
		"redirect_uri":  {s.cfg.GitHubCallbackURL},
	}
	resp, err := client.PostForm("https://github.com/login/oauth/access_token", form)
	if err != nil {
		return nil, fmt.Errorf("github token exchange: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	values, err := url.ParseQuery(string(body))
	if err != nil {
		return nil, fmt.Errorf("parse github response: %w", err)
	}
	accessToken := values.Get("access_token")
	if accessToken == "" {
		return nil, fmt.Errorf("github exchange failed: %s", values.Get("error_description"))
	}

	req, err := http.NewRequest(http.MethodGet, "https://api.github.com/user", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/vnd.github+json")
	uresp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("github user fetch: %w", err)
	}
	defer uresp.Body.Close()
	if uresp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("github user fetch status %d", uresp.StatusCode)
	}
	var gu GitHubUser
	if err := json.NewDecoder(io.LimitReader(uresp.Body, 1<<20)).Decode(&gu); err != nil {
		return nil, err
	}
	return &gu, nil
}

// --- Users ---

// EnsureGitHubUser upserts a user from GitHub data. The very first user becomes
// an admin and absorbs ownerless pre-auth resources.
func (s *AuthService) EnsureGitHubUser(ctx context.Context, gu *GitHubUser) (*db.User, error) {
	ghID := fmt.Sprintf("%d", gu.ID)
	user, err := s.userStore.FindByGitHubID(ctx, ghID)
	if err != nil {
		return nil, err
	}
	if user != nil {
		return user, nil
	}

	count, err := s.userStore.Count(ctx)
	if err != nil {
		return nil, err
	}
	roleName := "user"
	if count == 0 {
		roleName = "admin"
	}
	role, err := s.roleStore.FindByName(ctx, roleName)
	if err != nil {
		return nil, err
	}
	if role == nil {
		return nil, fmt.Errorf("role %q not seeded", roleName)
	}

	displayName := gu.Name
	if displayName == "" {
		displayName = gu.Login
	}
	u := &db.User{
		GitHubID:    ghID,
		GitHubLogin: gu.Login,
		DisplayName: displayName,
		AvatarURL:   gu.AvatarURL,
		Email:       gu.Email,
		RoleID:      role.ID,
		IsActive:    true,
	}
	if err := s.userStore.Create(ctx, u); err != nil {
		return nil, err
	}
	if count == 0 {
		if err := s.backfillOwners(ctx, u.ID); err != nil {
			return nil, err
		}
	}
	return s.userStore.FindByID(ctx, u.ID)
}

// EnsureDevUser returns (creating if needed) the DEV-mode admin user.
func (s *AuthService) EnsureDevUser(ctx context.Context) (*db.User, error) {
	user, err := s.userStore.FindByGitHubID(ctx, "dev")
	if err != nil {
		return nil, err
	}
	if user != nil {
		return user, nil
	}
	role, err := s.roleStore.FindByName(ctx, "admin")
	if err != nil {
		return nil, err
	}
	if role == nil {
		return nil, fmt.Errorf("admin role not seeded")
	}
	u := &db.User{
		GitHubID:    "dev",
		GitHubLogin: "dev",
		DisplayName: "开发用户",
		RoleID:      role.ID,
		IsActive:    true,
	}
	if err := s.userStore.Create(ctx, u); err != nil {
		return nil, err
	}
	if err := s.backfillOwners(ctx, u.ID); err != nil {
		return nil, err
	}
	return s.userStore.FindByID(ctx, u.ID)
}

func (s *AuthService) GetUser(ctx context.Context, id int64) (*db.User, error) {
	return s.userStore.FindByID(ctx, id)
}

func (s *AuthService) backfillOwners(ctx context.Context, userID int64) error {
	if err := s.modelStore.BackfillOwner(ctx, userID); err != nil {
		return err
	}
	return s.datasetStore.BackfillOwner(ctx, userID)
}

// --- Permissions ---

func (s *AuthService) HasPerm(user *db.User, perm string) bool {
	if user == nil {
		return false
	}
	for _, p := range user.Role.Permissions {
		if p == perm {
			return true
		}
	}
	return false
}

// Authorize checks whether user may perform perm on a resource.
//   - resID == 0: global-only check (perm must be a full string like "user-manage-all").
//   - resID > 0: perm is resource-scoped (e.g. "dataset-read"); passes on the
//     role holding "{res}-{action}-all", on ownership, or on a matching grant.
func (s *AuthService) Authorize(ctx context.Context, user *db.User, perm, resType string, resID int64) error {
	if user == nil || !user.IsActive {
		return ErrForbidden
	}
	if s.HasPerm(user, perm) {
		return nil
	}
	if resID > 0 && resType != "" {
		if s.HasPerm(user, perm+"-all") {
			return nil
		}
		ownerID, err := s.resourceOwner(ctx, resType, resID)
		if err != nil {
			return err
		}
		if ownerID == user.ID {
			return nil
		}
		has, err := s.grantStore.HasGrant(ctx, user.ID, resType, resID, perm)
		if err != nil {
			return err
		}
		if has {
			return nil
		}
	}
	return ErrForbidden
}

// CanX helpers wrap Authorize as booleans for visibility filtering.
func (s *AuthService) CanReadModel(ctx context.Context, user *db.User, id int64) bool {
	return s.Authorize(ctx, user, "model-read", "model", id) == nil
}
func (s *AuthService) CanWriteModel(ctx context.Context, user *db.User, id int64) bool {
	return s.Authorize(ctx, user, "model-write", "model", id) == nil
}
func (s *AuthService) CanDeleteModel(ctx context.Context, user *db.User, id int64) bool {
	return s.Authorize(ctx, user, "model-delete", "model", id) == nil
}
func (s *AuthService) CanManageModel(ctx context.Context, user *db.User, id int64) bool {
	return s.Authorize(ctx, user, "model-manage", "model", id) == nil
}

func (s *AuthService) CanReadDataset(ctx context.Context, user *db.User, id int64) bool {
	return s.Authorize(ctx, user, "dataset-read", "dataset", id) == nil
}
func (s *AuthService) CanWriteDataset(ctx context.Context, user *db.User, id int64) bool {
	return s.Authorize(ctx, user, "dataset-write", "dataset", id) == nil
}
func (s *AuthService) CanDeleteDataset(ctx context.Context, user *db.User, id int64) bool {
	return s.Authorize(ctx, user, "dataset-delete", "dataset", id) == nil
}
func (s *AuthService) CanManageDataset(ctx context.Context, user *db.User, id int64) bool {
	return s.Authorize(ctx, user, "dataset-manage", "dataset", id) == nil
}

// VisibleModels returns the model IDs visible to user. A nil slice means "all".
func (s *AuthService) VisibleModels(ctx context.Context, user *db.User) ([]int64, error) {
	if s.HasPerm(user, "model-read-all") {
		return nil, nil
	}
	models, err := s.modelStore.List(ctx)
	if err != nil {
		return nil, err
	}
	grants, err := s.grantStore.ListByUser(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	granted := map[int64]bool{}
	for _, g := range grants {
		if g.ResourceType == "model" {
			granted[g.ResourceID] = true
		}
	}
	var ids []int64
	for _, m := range models {
		if m.OwnerID == user.ID || granted[m.ID] {
			ids = append(ids, m.ID)
		}
	}
	if ids == nil {
		ids = []int64{} // empty (not nil): the user sees no models
	}
	return ids, nil
}

// VisibleDatasets returns dataset IDs (within modelID) visible to user, or nil for all.
func (s *AuthService) VisibleDatasets(ctx context.Context, user *db.User, modelID int64) ([]int64, error) {
	if s.HasPerm(user, "dataset-read-all") {
		return nil, nil
	}
	datasets, err := s.datasetStore.ListByModel(ctx, modelID)
	if err != nil {
		return nil, err
	}
	grants, err := s.grantStore.ListByUser(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	granted := map[int64]bool{}
	for _, g := range grants {
		if g.ResourceType == "dataset" {
			granted[g.ResourceID] = true
		}
	}
	var ids []int64
	for _, d := range datasets {
		if d.OwnerID == user.ID || granted[d.ID] {
			ids = append(ids, d.ID)
		}
	}
	if ids == nil {
		ids = []int64{} // empty (not nil): the user sees no datasets
	}
	return ids, nil
}

func (s *AuthService) resourceOwner(ctx context.Context, resType string, resID int64) (int64, error) {
	switch resType {
	case "model":
		m, err := s.modelStore.Get(ctx, resID)
		if err != nil {
			return 0, err
		}
		if m == nil {
			return 0, nil
		}
		return m.OwnerID, nil
	case "dataset":
		d, err := s.datasetStore.Get(ctx, resID)
		if err != nil {
			return 0, err
		}
		if d == nil {
			return 0, nil
		}
		return d.OwnerID, nil
	}
	return 0, fmt.Errorf("unknown resource type %q", resType)
}

// NormalizePerm strips a "-all" suffix: "dataset-read-all" -> "dataset-read".
func NormalizePerm(perm string) string {
	return strings.TrimSuffix(perm, "-all")
}
