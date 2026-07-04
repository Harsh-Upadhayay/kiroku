package handlers

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"

	"kiroku-api/internal/models"
)

// This file holds the content-addressed media store's HTTP surface. Blobs live on disk at
// {DataDir}/media/{sha256-hex}; the hash in the URL *is* the identity of the content, so the
// server verifies it on upload rather than trusting the client — otherwise one buggy client
// could poison the store for every device that later fetches that hash.

// GetMediaBlob serves a stored media file from disk by its content hash.
// GET /api/media/{hash}. (A "GET" ServeMux pattern also matches HEAD, so existence
// probes for a single blob come for free.)
func (h *Handler) GetMediaBlob(w http.ResponseWriter, r *http.Request) {
	hash := r.PathValue("hash")
	if !validMediaHash(hash) {
		h.WriteError(w, http.StatusBadRequest, "Invalid media hash", nil)
		return
	}

	bytes, err := os.ReadFile(filepath.Join(h.mediaRoot(), hash))
	if err != nil {
		h.WriteError(w, http.StatusNotFound, "Media not found", err)
		return
	}
	w.Header().Set("Content-Type", http.DetectContentType(bytes))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(bytes)
}

// PutMediaBlob stores an uploaded media blob under its content hash. PUT /api/media/{hash}.
//
// The body is streamed to a temp file while a SHA-256 runs over it via io.MultiWriter, so a
// hundreds-of-MB blob never sits in memory the way io.ReadAll would put it there. Only after
// the computed digest matches the URL's hash is the temp file renamed into place — rename on
// the same filesystem is atomic, so a concurrent GET sees either no file or a complete,
// verified one, never a half-written blob.
//
// The store is content-addressed, which makes uploads naturally idempotent: if the hash is
// already present the handler returns 200 immediately without reading the body. Retries and
// concurrent uploads of the same blob are therefore always safe.
func (h *Handler) PutMediaBlob(w http.ResponseWriter, r *http.Request) {
	hash := r.PathValue("hash")
	if !validMediaHash(hash) {
		h.WriteError(w, http.StatusBadRequest, "Invalid media hash", nil)
		return
	}

	final := filepath.Join(h.mediaRoot(), hash)
	if _, err := os.Stat(final); err == nil {
		// Already stored. Returning without draining the body costs this connection its
		// keep-alive, but that beats reading megabytes just to throw them away.
		h.WriteJSON(w, http.StatusOK, models.APIResponse{Success: true})
		return
	}

	if err := os.MkdirAll(h.mediaRoot(), 0o755); err != nil {
		h.WriteError(w, http.StatusInternalServerError, "Failed to create media directory", err)
		return
	}

	// The temp file lives in the media dir itself (not os.TempDir) so the final rename never
	// crosses a filesystem boundary, which is what keeps it atomic. The dot prefix keeps
	// in-flight uploads from ever matching a hash lookup.
	tmp, err := os.CreateTemp(h.mediaRoot(), ".upload-*")
	if err != nil {
		h.WriteError(w, http.StatusInternalServerError, "Failed to store media", err)
		return
	}
	// Cleanup for every early return below. After a successful rename the Remove is a no-op
	// (the temp name no longer exists) and the second Close returns ErrClosed; both ignored.
	defer os.Remove(tmp.Name())
	defer tmp.Close()

	r.Body = http.MaxBytesReader(w, r.Body, h.Config.MaxBodyBytes)
	hasher := sha256.New()
	if _, err := io.Copy(io.MultiWriter(tmp, hasher), r.Body); err != nil {
		// MaxBytesReader surfaces an oversize body as *http.MaxBytesError mid-copy; report
		// that as 413 so the client knows retrying the same blob is pointless.
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			h.WriteError(w, http.StatusRequestEntityTooLarge, "Media exceeds size limit", err)
			return
		}
		h.WriteError(w, http.StatusBadRequest, "Failed to read media", err)
		return
	}

	if sum := hex.EncodeToString(hasher.Sum(nil)); sum != hash {
		h.WriteError(w, http.StatusBadRequest, "Media content does not match hash", nil)
		return
	}

	// Close before rename: on some platforms renaming an open file works, but flushing and
	// releasing the handle first is the portable order of operations.
	if err := tmp.Close(); err != nil {
		h.WriteError(w, http.StatusInternalServerError, "Failed to store media", err)
		return
	}
	if err := os.Rename(tmp.Name(), final); err != nil {
		h.WriteError(w, http.StatusInternalServerError, "Failed to store media", err)
		return
	}

	h.WriteJSON(w, http.StatusCreated, models.APIResponse{Success: true})
}

// mediaCheckReq is the body of POST /api/media/check: the hashes a client is about to upload
// or wants to download.
type mediaCheckReq struct {
	Hashes []string `json:"hashes"`
}

// maxMediaCheckHashes bounds a single check request. The largest real decks hold ~10k media
// files; anything far beyond that is a malformed or hostile request, not a bigger deck.
const maxMediaCheckHashes = 50_000

// MediaCheck reports which of the given content hashes are NOT in the store, so a client with
// thousands of files makes one request instead of one HEAD per file. POST /api/media/check.
func (h *Handler) MediaCheck(w http.ResponseWriter, r *http.Request) {
	req, err := decodeJSON[mediaCheckReq](r)
	if err != nil {
		h.WriteError(w, http.StatusBadRequest, "Invalid request", err)
		return
	}
	if len(req.Hashes) > maxMediaCheckHashes {
		h.WriteError(w, http.StatusBadRequest, "Too many hashes in one check", nil)
		return
	}

	// A malformed hash can never be stored, so it is definitionally missing. Folding it into
	// the missing list (rather than failing the whole batch) keeps one bad manifest entry
	// from blocking an otherwise valid 8k-file upload plan.
	missing := make([]string, 0, len(req.Hashes))
	for _, hash := range req.Hashes {
		if !validMediaHash(hash) {
			missing = append(missing, hash)
			continue
		}
		if _, err := os.Stat(filepath.Join(h.mediaRoot(), hash)); err != nil {
			missing = append(missing, hash)
		}
	}

	h.WriteJSON(w, http.StatusOK, models.APIResponse{Success: true, Data: map[string][]string{"missing": missing}})
}
