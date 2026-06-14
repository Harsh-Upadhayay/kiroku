// Package handlers contains the HTTP handlers for the API. Handlers are intentionally thin:
// they decode the request, delegate to a service (auth, sync) or the store, map the result
// to a status code, and write the JSON response. The business logic lives in those lower
// layers, not here.
package handlers

import (
	"database/sql"
	"errors"
	"io"
	"kiroku-api/internal/anki"
	"kiroku-api/internal/auth"
	"kiroku-api/internal/config"
	"kiroku-api/internal/models"
	"kiroku-api/internal/store"
	"kiroku-api/internal/sync"
	"net/http"
	"os"
	"path/filepath"
)

// Handler carries the dependencies every HTTP handler needs. It is intentionally minimal —
// the store and service layers are built on demand from these two fields (see authService),
// which keeps construction in main.go and the tests a simple struct literal.
type Handler struct {
	DB     *sql.DB
	Config *config.Config
}

// authService builds an auth.Service backed by the database. It is cheap to construct, so
// each handler makes one as needed rather than holding it as state.
func (h *Handler) authService() *auth.Service {
	return auth.NewService(store.New(h.DB), h.Config.BCryptCost, store.DefaultUserState)
}

// syncService builds a sync.Service backed by the database.
func (h *Handler) syncService() *sync.Service {
	return sync.NewService(store.New(h.DB))
}

// Health reports service health: it checks the database connection and that it accepts
// writes. GET /healthz.
func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	if err := h.DB.Ping(); err != nil {
		h.WriteError(w, http.StatusServiceUnavailable, "database unavailable", err)
		return
	}
	if err := store.New(h.DB).CheckWritable(r.Context()); err != nil {
		h.WriteError(w, http.StatusServiceUnavailable, "database not writable", err)
		return
	}

	h.WriteJSON(w, http.StatusOK, models.APIResponse{Success: true})
}

// Register creates a new account. POST /api/auth/register.
func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	req, err := decodeJSON[registerReq](r)
	if err != nil {
		h.WriteError(w, http.StatusBadRequest, "Invalid request", err)
		return
	}

	resp, err := h.authService().Register(r.Context(), req.Email, req.Password)
	switch {
	case errors.Is(err, auth.ErrWeakPassword):
		h.WriteError(w, http.StatusBadRequest, "Invalid email or password (min 8 chars)", err)
	case errors.Is(err, auth.ErrHashFailed):
		h.WriteError(w, http.StatusInternalServerError, "Failed to process password", err)
	case errors.Is(err, auth.ErrUserExists):
		h.WriteError(w, http.StatusConflict, "User already exists or registration failed", err)
	case err != nil:
		h.WriteError(w, http.StatusInternalServerError, "Registration failed", err)
	default:
		h.WriteJSON(w, http.StatusCreated, models.APIResponse{Success: true, Data: resp})
	}
}

// Login authenticates an account and returns its public view. POST /api/auth/login.
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	req, err := decodeJSON[loginReq](r)
	if err != nil {
		h.WriteError(w, http.StatusBadRequest, "Invalid request", err)
		return
	}

	resp, err := h.authService().Login(r.Context(), req.Email, req.Password)
	if err != nil {
		h.WriteError(w, http.StatusUnauthorized, "Invalid email or password", err)
		return
	}

	h.WriteJSON(w, http.StatusOK, models.APIResponse{Success: true, Data: resp})
}

// SyncPush merges the client's state into the server's and returns the merged result.
// POST /api/sync/push.
func (h *Handler) SyncPush(w http.ResponseWriter, r *http.Request) {
	req, err := decodeJSON[syncPushReq](r)
	if err != nil {
		h.WriteError(w, http.StatusBadRequest, "Invalid request", err)
		return
	}

	email := auth.NormalizeEmail(req.Email)
	final, ignored, err := h.syncService().Push(r.Context(), email, req.State, auth.NowMillis())
	if err != nil {
		h.WriteError(w, http.StatusInternalServerError, "Failed to save state", err)
		return
	}
	if ignored {
		h.WriteJSON(w, http.StatusOK, models.APIResponse{Success: true, Data: map[string]bool{"ignored": true}})
		return
	}

	h.WriteJSON(w, http.StatusOK, models.APIResponse{Success: true, Data: final})
}

// SyncPull returns the server's stored state for a user (data is null if none). POST /api/sync/pull.
func (h *Handler) SyncPull(w http.ResponseWriter, r *http.Request) {
	req, err := decodeJSON[syncPullReq](r)
	if err != nil {
		h.WriteError(w, http.StatusBadRequest, "Invalid request", err)
		return
	}

	email := auth.NormalizeEmail(req.Email)
	state, err := h.syncService().Pull(r.Context(), email)
	if err != nil {
		h.WriteError(w, http.StatusInternalServerError, "Failed to fetch state", err)
		return
	}
	if state == nil {
		h.WriteJSON(w, http.StatusOK, models.APIResponse{Success: true, Data: nil})
		return
	}

	h.WriteJSON(w, http.StatusOK, models.APIResponse{Success: true, Data: state})
}

// ImportAnkiPackage parses an uploaded .apkg file and returns its structured contents.
// POST /api/import-anki-package.
func (h *Handler) ImportAnkiPackage(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, h.Config.MaxBodyBytes)
	defer r.Body.Close()

	result, err := anki.ImportAPKG(r.Body, h.Config.MaxBodyBytes)
	if err != nil {
		h.WriteError(w, http.StatusBadRequest, "Failed to import Anki package", err)
		return
	}

	h.WriteJSON(w, http.StatusOK, models.APIResponse{Success: true, Data: result})
}

// ImportedPackageMedia serves a media blob cached from a prior import, by import ID and hash.
func (h *Handler) ImportedPackageMedia(w http.ResponseWriter, r *http.Request) {
	importID := r.PathValue("importID")
	hash := r.PathValue("hash")
	fileName, contentType, bytes, ok := anki.ImportedMedia(importID, hash)
	if !ok {
		h.WriteError(w, http.StatusNotFound, "Imported media not found", nil)
		return
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", `inline; filename="`+fileName+`"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(bytes)
}

// MediaBlob dispatches GET/PUT for a media blob identified by its content hash.
func (h *Handler) MediaBlob(w http.ResponseWriter, r *http.Request) {
	hash := r.PathValue("hash")
	if !validMediaHash(hash) {
		h.WriteError(w, http.StatusBadRequest, "Invalid media hash", nil)
		return
	}

	switch r.Method {
	case http.MethodGet:
		h.GetMediaBlob(w, r, hash)
	case http.MethodPut:
		h.PutMediaBlob(w, r, hash)
	default:
		w.Header().Set("Allow", "GET, PUT")
		h.WriteError(w, http.StatusMethodNotAllowed, "Unsupported media method", nil)
	}
}

// GetMediaBlob serves a stored media file from disk by its content hash.
func (h *Handler) GetMediaBlob(w http.ResponseWriter, r *http.Request, hash string) {
	path := filepath.Join(h.Config.DataDir, "media", hash)
	bytes, err := os.ReadFile(path)
	if err != nil {
		h.WriteError(w, http.StatusNotFound, "Media not found", err)
		return
	}
	contentType := http.DetectContentType(bytes)
	w.Header().Set("Content-Type", contentType)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(bytes)
}

// PutMediaBlob stores an uploaded media file on disk under its content hash.
func (h *Handler) PutMediaBlob(w http.ResponseWriter, r *http.Request, hash string) {
	r.Body = http.MaxBytesReader(w, r.Body, h.Config.MaxBodyBytes)
	defer r.Body.Close()

	bytes, err := io.ReadAll(r.Body)
	if err != nil {
		h.WriteError(w, http.StatusBadRequest, "Failed to read media", err)
		return
	}
	dir := filepath.Join(h.Config.DataDir, "media")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		h.WriteError(w, http.StatusInternalServerError, "Failed to create media directory", err)
		return
	}
	if err := os.WriteFile(filepath.Join(dir, hash), bytes, 0o644); err != nil {
		h.WriteError(w, http.StatusInternalServerError, "Failed to store media", err)
		return
	}
	h.WriteJSON(w, http.StatusOK, models.APIResponse{Success: true})
}

// ChangePassword updates a user's password after verifying the old one. POST /api/auth/change-password.
func (h *Handler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	req, err := decodeJSON[changePasswordReq](r)
	if err != nil {
		h.WriteError(w, http.StatusBadRequest, "Invalid request", err)
		return
	}

	err = h.authService().ChangePassword(r.Context(), req.Email, req.OldPassword, req.NewPassword)
	switch {
	case errors.Is(err, auth.ErrInvalidCredentials):
		h.WriteError(w, http.StatusUnauthorized, "Invalid old password", err)
	case errors.Is(err, auth.ErrWeakPassword):
		h.WriteError(w, http.StatusBadRequest, "New password must be at least 8 characters", err)
	case errors.Is(err, auth.ErrHashFailed):
		h.WriteError(w, http.StatusInternalServerError, "Failed to process new password", err)
	case err != nil:
		h.WriteError(w, http.StatusInternalServerError, "Failed to update password", err)
	default:
		h.WriteJSON(w, http.StatusOK, models.APIResponse{Success: true})
	}
}

// DeleteAccount removes a user's account after verifying their password. POST /api/auth/delete-account.
func (h *Handler) DeleteAccount(w http.ResponseWriter, r *http.Request) {
	req, err := decodeJSON[deleteAccountReq](r)
	if err != nil {
		h.WriteError(w, http.StatusBadRequest, "Invalid request", err)
		return
	}

	err = h.authService().DeleteAccount(r.Context(), req.Email, req.Password)
	switch {
	case errors.Is(err, auth.ErrInvalidCredentials):
		h.WriteError(w, http.StatusUnauthorized, "Invalid password", err)
	case err != nil:
		h.WriteError(w, http.StatusInternalServerError, "Failed to delete account", err)
	default:
		h.WriteJSON(w, http.StatusOK, models.APIResponse{Success: true})
	}
}
