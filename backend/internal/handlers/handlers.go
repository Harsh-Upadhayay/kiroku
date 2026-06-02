package handlers

import (
	"database/sql"
	"encoding/json"
	"kiroku-api/internal/anki"
	"kiroku-api/internal/auth"
	"kiroku-api/internal/config"
	"kiroku-api/internal/db"
	"kiroku-api/internal/models"
	"kiroku-api/internal/sync"
	"log/slog"
	"net/http"
)

type Handler struct {
	DB     *sql.DB
	Config *config.Config
}

func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	if err := h.DB.Ping(); err != nil {
		h.WriteError(w, http.StatusServiceUnavailable, "database unavailable", err)
		return
	}

	// Check writability
	_, err := h.DB.Exec(`CREATE TABLE IF NOT EXISTS health_check (id INTEGER PRIMARY KEY, ts INTEGER);
	INSERT INTO health_check (ts) VALUES (?);
	DELETE FROM health_check WHERE ts = ?`, auth.NowMillis(), auth.NowMillis())
	if err != nil {
		h.WriteError(w, http.StatusServiceUnavailable, "database not writable", err)
		return
	}

	h.WriteJSON(w, http.StatusOK, models.APIResponse{Success: true})
}

func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.WriteError(w, http.StatusBadRequest, "Invalid request", err)
		return
	}

	email := auth.NormalizeEmail(req.Email)
	if email == "" || !auth.ValidatePassword(req.Password) {
		h.WriteError(w, http.StatusBadRequest, "Invalid email or password (min 8 chars)", nil)
		return
	}

	hash, err := auth.HashPassword(req.Password, h.Config.BCryptCost)
	if err != nil {
		h.WriteError(w, http.StatusInternalServerError, "Failed to process password", err)
		return
	}

	joined := auth.NowMillis()
	defaultState := `{"srs_cards_list":[],"active_rows":["hiragana:vowels"],"streak_info":{"current":0,"highest":0,"updatedAt":0},"anki_decks":[],"anki_cards":[],"_meta":{"schemaVersion":1,"generatedAt":0}}`

	err = db.CreateUser(h.DB, email, hash, joined, defaultState)
	if err != nil {
		h.WriteError(w, http.StatusConflict, "User already exists or registration failed", err)
		return
	}

	h.WriteJSON(w, http.StatusCreated, models.APIResponse{
		Success: true,
		Data: models.UserResponse{
			Email:  email,
			Joined: joined,
		},
	})
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.WriteError(w, http.StatusBadRequest, "Invalid request", err)
		return
	}

	email := auth.NormalizeEmail(req.Email)
	hash, joined, err := db.GetUser(h.DB, email)
	if err != nil || !auth.CheckPassword(req.Password, hash) {
		h.WriteError(w, http.StatusUnauthorized, "Invalid email or password", err)
		return
	}

	h.WriteJSON(w, http.StatusOK, models.APIResponse{
		Success: true,
		Data: models.UserResponse{
			Email:  email,
			Joined: joined,
		},
	})
}

func (h *Handler) SyncPush(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email string           `json:"email"`
		State models.SyncState `json:"state"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.WriteError(w, http.StatusBadRequest, "Invalid request", err)
		return
	}

	email := auth.NormalizeEmail(req.Email)
	var existingRaw []byte
	err := h.DB.QueryRow(`SELECT state_json FROM user_states WHERE email = ?`, email).Scan(&existingRaw)
	if err != nil && err != sql.ErrNoRows {
		h.WriteError(w, http.StatusInternalServerError, "Failed to fetch existing state", err)
		return
	}

	if err == nil && sync.IsDestructive(existingRaw, req.State) {
		h.WriteJSON(w, http.StatusOK, models.APIResponse{Success: true, Data: map[string]bool{"ignored": true}})
		return
	}

	newStateRaw, err := json.Marshal(req.State)
	if err != nil {
		h.WriteError(w, http.StatusInternalServerError, "Failed to process state", err)
		return
	}

	if len(existingRaw) > 0 {
		newStateRaw, err = sync.MergeState(existingRaw, newStateRaw)
		if err != nil {
			h.WriteError(w, http.StatusInternalServerError, "Failed to merge state", err)
			return
		}
	}

	_, err = h.DB.Exec(
		`INSERT INTO user_states(email, state_json, updated_at) VALUES(?, ?, ?)
		 ON CONFLICT(email) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`,
		email, string(newStateRaw), auth.NowMillis(),
	)
	if err != nil {
		h.WriteError(w, http.StatusInternalServerError, "Failed to save state", err)
		return
	}

	var finalState models.SyncState
	json.Unmarshal(newStateRaw, &finalState)
	h.WriteJSON(w, http.StatusOK, models.APIResponse{Success: true, Data: finalState})
}

func (h *Handler) SyncPull(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.WriteError(w, http.StatusBadRequest, "Invalid request", err)
		return
	}

	email := auth.NormalizeEmail(req.Email)
	var stateJSON string
	err := h.DB.QueryRow(`SELECT state_json FROM user_states WHERE email = ?`, email).Scan(&stateJSON)
	if err == sql.ErrNoRows {
		h.WriteJSON(w, http.StatusOK, models.APIResponse{Success: true, Data: nil})
		return
	}
	if err != nil {
		h.WriteError(w, http.StatusInternalServerError, "Failed to fetch state", err)
		return
	}

	var state models.SyncState
	if err := json.Unmarshal([]byte(stateJSON), &state); err != nil {
		h.WriteError(w, http.StatusInternalServerError, "Failed to parse state", err)
		return
	}

	h.WriteJSON(w, http.StatusOK, models.APIResponse{Success: true, Data: state})
}

func (h *Handler) ImportAPKG(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, h.Config.MaxBodyBytes)
	defer r.Body.Close()

	result, err := anki.ImportAPKG(r.Body, h.Config.MaxBodyBytes)
	if err != nil {
		h.WriteError(w, http.StatusBadRequest, "Failed to import APKG", err)
		return
	}

	h.WriteJSON(w, http.StatusOK, models.APIResponse{Success: true, Data: result})
}

func (h *Handler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email       string `json:"email"`
		OldPassword string `json:"oldPassword"`
		NewPassword string `json:"newPassword"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.WriteError(w, http.StatusBadRequest, "Invalid request", err)
		return
	}

	email := auth.NormalizeEmail(req.Email)
	hash, _, err := db.GetUser(h.DB, email)
	if err != nil || !auth.CheckPassword(req.OldPassword, hash) {
		h.WriteError(w, http.StatusUnauthorized, "Invalid old password", err)
		return
	}

	if !auth.ValidatePassword(req.NewPassword) {
		h.WriteError(w, http.StatusBadRequest, "New password must be at least 8 characters", nil)
		return
	}

	newHash, err := auth.HashPassword(req.NewPassword, h.Config.BCryptCost)
	if err != nil {
		h.WriteError(w, http.StatusInternalServerError, "Failed to process new password", err)
		return
	}

	_, err = h.DB.Exec(`UPDATE users SET password_hash = ? WHERE email = ?`, newHash, email)
	if err != nil {
		h.WriteError(w, http.StatusInternalServerError, "Failed to update password", err)
		return
	}

	h.WriteJSON(w, http.StatusOK, models.APIResponse{Success: true})
}

func (h *Handler) DeleteAccount(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.WriteError(w, http.StatusBadRequest, "Invalid request", err)
		return
	}

	email := auth.NormalizeEmail(req.Email)
	hash, _, err := db.GetUser(h.DB, email)
	if err != nil || !auth.CheckPassword(req.Password, hash) {
		h.WriteError(w, http.StatusUnauthorized, "Invalid password", err)
		return
	}

	_, err = h.DB.Exec(`DELETE FROM users WHERE email = ?`, email)
	if err != nil {
		h.WriteError(w, http.StatusInternalServerError, "Failed to delete account", err)
		return
	}

	h.WriteJSON(w, http.StatusOK, models.APIResponse{Success: true})
}

func (h *Handler) WriteJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func (h *Handler) WriteError(w http.ResponseWriter, status int, msg string, err error) {
	slog.Error(msg, "error", err, "status", status)
	h.WriteJSON(w, status, models.APIResponse{Success: false, Error: msg})
}
