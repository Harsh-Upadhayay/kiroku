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
	"kiroku-api/internal/vocab"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
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

// uploadsRoot is the on-disk directory holding in-progress chunked upload sessions.
func (h *Handler) uploadsRoot() string {
	return filepath.Join(h.Config.DataDir, "uploads")
}

// writeUploadError maps an upload-session error to the appropriate status code. It exists so
// every chunked-upload handler reports invalid ids, unknown sessions, and incomplete uploads
// consistently instead of collapsing them all to 500.
func (h *Handler) writeUploadError(w http.ResponseWriter, msg string, err error) {
	switch {
	case errors.Is(err, anki.ErrInvalidUploadID):
		h.WriteError(w, http.StatusBadRequest, "Invalid upload id", err)
	case errors.Is(err, anki.ErrChunkOutOfRange):
		h.WriteError(w, http.StatusBadRequest, "Chunk index out of range", err)
	case errors.Is(err, anki.ErrIncompleteUpload):
		h.WriteError(w, http.StatusConflict, "Upload is incomplete", err)
	case errors.Is(err, os.ErrNotExist):
		h.WriteError(w, http.StatusNotFound, "Upload session not found", err)
	default:
		h.WriteError(w, http.StatusInternalServerError, msg, err)
	}
}

// UploadInit starts or resumes a chunked .apkg upload. When an incomplete session already
// matches the file's fingerprint it returns that session and the chunks already received, so
// the client uploads only what is missing. POST /api/import-anki-package/upload/init.
func (h *Handler) UploadInit(w http.ResponseWriter, r *http.Request) {
	req, err := decodeJSON[uploadInitReq](r)
	if err != nil {
		h.WriteError(w, http.StatusBadRequest, "Invalid request", err)
		return
	}
	if req.TotalSize <= 0 || req.TotalChunks <= 0 {
		h.WriteError(w, http.StatusBadRequest, "totalSize and totalChunks must be positive", nil)
		return
	}
	if req.TotalSize > h.Config.MaxUploadBytes {
		h.WriteError(w, http.StatusRequestEntityTooLarge, "File exceeds maximum upload size", nil)
		return
	}

	root := h.uploadsRoot()
	if meta, ok, findErr := anki.FindSessionByFingerprint(root, req.Fingerprint); findErr == nil && ok {
		received, recvErr := anki.ReceivedChunks(root, meta.UploadID)
		if recvErr == nil {
			h.WriteJSON(w, http.StatusOK, models.APIResponse{Success: true,
				Data: uploadInitResp{UploadID: meta.UploadID, ReceivedChunks: received}})
			return
		}
		// Session metadata was found but its chunks could not be listed; fall through and start
		// a fresh session rather than failing the import.
	}

	meta, err := anki.CreateSession(root, anki.UploadMeta{
		Fingerprint: req.Fingerprint,
		FileName:    req.FileName,
		TotalSize:   req.TotalSize,
		TotalChunks: req.TotalChunks,
		ChunkSize:   req.ChunkSize,
	})
	if err != nil {
		h.WriteError(w, http.StatusInternalServerError, "Failed to start upload", err)
		return
	}
	h.WriteJSON(w, http.StatusOK, models.APIResponse{Success: true,
		Data: uploadInitResp{UploadID: meta.UploadID, ReceivedChunks: []int{}}})
}

// UploadChunk stores one chunk of an in-progress upload. The body is a raw octet-stream
// capped at MaxBodyBytes (chunks are well under it). Writes are idempotent so retries are
// safe. PUT /api/import-anki-package/upload/{uploadID}/chunk/{index}.
func (h *Handler) UploadChunk(w http.ResponseWriter, r *http.Request) {
	uploadID := r.PathValue("uploadID")
	index, err := strconv.Atoi(r.PathValue("index"))
	if err != nil {
		h.WriteError(w, http.StatusBadRequest, "Invalid chunk index", err)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, h.Config.MaxBodyBytes)
	defer r.Body.Close()

	if err := anki.WriteChunk(h.uploadsRoot(), uploadID, index, r.Body); err != nil {
		h.writeUploadError(w, "Failed to store chunk", err)
		return
	}
	h.WriteJSON(w, http.StatusOK, models.APIResponse{Success: true})
}

// UploadComplete reassembles a finished upload and runs it through the normal import parser,
// returning the same result as the single-shot /api/import-anki-package endpoint. The session
// is discarded whether the parse succeeds or fails. POST
// /api/import-anki-package/upload/{uploadID}/complete.
func (h *Handler) UploadComplete(w http.ResponseWriter, r *http.Request) {
	uploadID := r.PathValue("uploadID")
	root := h.uploadsRoot()

	path, err := anki.AssembleSession(root, uploadID)
	if err != nil {
		// A missing chunk is recoverable (client resends), so leave the session in place.
		h.writeUploadError(w, "Failed to assemble upload", err)
		return
	}

	result, err := anki.ImportPackageFile(path)
	// The reassembled archive is either parsed or unusable; either way the session's job is
	// done, so reclaim its disk now.
	_ = anki.DiscardSession(root, uploadID)
	if err != nil {
		h.WriteError(w, http.StatusBadRequest, "Failed to import Anki package", err)
		return
	}
	h.WriteJSON(w, http.StatusOK, models.APIResponse{Success: true, Data: result})
}

// ImportVocabImage runs local OCR over a textbook vocabulary page image and returns
// editable vocab rows. It deliberately uses local tooling only; no uploaded image is sent
// to a hosted LLM or third-party OCR service.
func (h *Handler) ImportVocabImage(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, h.Config.MaxBodyBytes)
	defer r.Body.Close()

	if err := r.ParseMultipartForm(h.Config.MaxBodyBytes); err != nil {
		h.WriteError(w, http.StatusBadRequest, "Invalid image upload", err)
		return
	}

	file, header, err := r.FormFile("image")
	if err != nil {
		h.WriteError(w, http.StatusBadRequest, "Image file is required", err)
		return
	}
	defer file.Close()

	bytes, err := io.ReadAll(file)
	if err != nil {
		h.WriteError(w, http.StatusBadRequest, "Failed to read image", err)
		return
	}
	contentType := http.DetectContentType(bytes)
	if !strings.HasPrefix(contentType, "image/") {
		h.WriteError(w, http.StatusBadRequest, "Uploaded file must be an image", nil)
		return
	}

	result, err := vocab.ImportImage(r.Context(), bytes, header.Filename, vocab.Config{
		Binary:        h.Config.OCRBinary,
		Languages:     h.Config.OCRLanguages,
		PSM:           h.Config.OCRPSM,
		Timeout:       time.Duration(h.Config.OCRTimeout) * time.Second,
		OllamaURL:     h.Config.OllamaURL,
		OllamaModel:   h.Config.OllamaModel,
		OllamaTimeout: time.Duration(h.Config.OllamaTimeout) * time.Second,
	})
	switch {
	case errors.Is(err, vocab.ErrOCRUnavailable):
		h.WriteError(w, http.StatusServiceUnavailable, "Local OCR engine is not available", err)
	case errors.Is(err, vocab.ErrNoRows):
		h.WriteError(w, http.StatusUnprocessableEntity, "No vocabulary rows found in image", err)
	case err != nil:
		h.WriteError(w, http.StatusInternalServerError, "Failed to import vocabulary image", err)
	default:
		h.WriteJSON(w, http.StatusOK, models.APIResponse{Success: true, Data: result})
	}
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
