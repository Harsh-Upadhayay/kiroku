package handlers

import (
	"encoding/json"
	"kiroku-api/internal/models"
	"log/slog"
	"net/http"
	"regexp"
)

// Request body shapes, one named type per endpoint. Naming them (instead of declaring an
// anonymous struct inside each handler) lets the generic decodeJSON below infer the type
// and keeps the handlers focused on logic rather than field definitions.
type (
	registerReq struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	loginReq struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	syncPushReq struct {
		Email string           `json:"email"`
		State models.SyncState `json:"state"`
	}
	syncPullReq struct {
		Email string `json:"email"`
	}
	changePasswordReq struct {
		Email       string `json:"email"`
		OldPassword string `json:"oldPassword"`
		NewPassword string `json:"newPassword"`
	}
	deleteAccountReq struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
)

// decodeJSON decodes the request body into a value of type T. The generic type parameter
// removes the per-handler "var req struct{...}; json.NewDecoder(...).Decode(&req)" boilerplate
// that was repeated in every endpoint.
func decodeJSON[T any](r *http.Request) (T, error) {
	var v T
	err := json.NewDecoder(r.Body).Decode(&v)
	return v, err
}

// mediaHashRe matches a 64-character lowercase hex SHA-256 digest. It is compiled once at
// package load rather than on every request.
var mediaHashRe = regexp.MustCompile(`^[a-f0-9]{64}$`)

// validMediaHash reports whether hash is a well-formed media content hash.
func validMediaHash(hash string) bool {
	return mediaHashRe.MatchString(hash)
}

// WriteJSON writes data as a JSON response with the given status code.
func (h *Handler) WriteJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// WriteError logs the underlying error and writes a standard APIResponse error body. The
// message is what clients see; err is for the server log only.
func (h *Handler) WriteError(w http.ResponseWriter, status int, msg string, err error) {
	slog.Error(msg, "error", err, "status", status)
	h.WriteJSON(w, status, models.APIResponse{Success: false, Error: msg})
}
