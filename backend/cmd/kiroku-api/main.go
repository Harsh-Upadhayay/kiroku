package main

import (
	"archive/zip"
	"bytes"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"
)

const maxBodyBytes = 100 << 20

type app struct {
	db      *sql.DB
	dataDir string
}

type userRecord struct {
	Email        string `json:"email"`
	PasswordHash string `json:"passwordHash"`
	Joined       int64  `json:"joined"`
}

type userResponse struct {
	Email  string `json:"email"`
	Joined int64  `json:"joined"`
}

type syncState map[string]any

type legacyDB struct {
	Users      []userRecord               `json:"users"`
	UserStates map[string]json.RawMessage `json:"user_states"`
}

func main() {
	dataDir := getenv("DATA_DIR", "/app/data")
	if len(os.Args) > 1 && os.Args[1] == "-healthcheck" {
		db, err := sql.Open("sqlite", filepath.Join(dataDir, "kiroku.db"))
		if err != nil {
			os.Exit(1)
		}
		defer db.Close()
		if err := db.Ping(); err != nil {
			os.Exit(1)
		}
		return
	}

	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		log.Fatalf("create data dir: %v", err)
	}
	if err := migrateLegacySQLite(dataDir); err != nil {
		log.Printf("legacy SQLite migration skipped/failed: %v", err)
	}

	dbPath := filepath.Join(dataDir, "kiroku.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		log.Fatalf("open sqlite: %v", err)
	}
	defer db.Close()

	db.SetMaxOpenConns(1)
	if err := initDB(db); err != nil {
		log.Fatalf("init sqlite: %v", err)
	}
	if err := migrateLegacyJSON(db, filepath.Join(dataDir, "db.json")); err != nil {
		log.Printf("legacy JSON migration skipped/failed: %v", err)
	}

	a := &app{db: db, dataDir: dataDir}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", a.health)
	mux.HandleFunc("GET /api/healthz", a.health)
	mux.HandleFunc("POST /api/auth/register", a.register)
	mux.HandleFunc("POST /api/auth/login", a.login)
	mux.HandleFunc("POST /api/sync/push", a.syncPush)
	mux.HandleFunc("POST /api/sync/pull", a.syncPull)
	mux.HandleFunc("POST /api/import-apkg", a.importAPKG)

	port := getenv("PORT", "8080")
	log.Printf("Kiroku API listening on :%s", port)
	if err := http.ListenAndServe("0.0.0.0:"+port, withCommonHeaders(mux)); err != nil {
		log.Fatal(err)
	}
}

func initDB(db *sql.DB) error {
	stmts := []string{
		`PRAGMA journal_mode=WAL`,
		`PRAGMA synchronous=NORMAL`,
		`CREATE TABLE IF NOT EXISTS users (
			email TEXT PRIMARY KEY,
			password_hash TEXT NOT NULL,
			joined INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS user_states (
			email TEXT PRIMARY KEY,
			state_json TEXT NOT NULL,
			updated_at INTEGER NOT NULL,
			FOREIGN KEY(email) REFERENCES users(email) ON DELETE CASCADE
		)`,
	}
	for _, stmt := range stmts {
		if _, err := db.Exec(stmt); err != nil {
			return err
		}
	}
	return nil
}

func migrateLegacySQLite(dataDir string) error {
	target := filepath.Join(dataDir, "kiroku.db")
	if _, err := os.Stat(target); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}

	for _, suffix := range []string{"", "-wal", "-shm"} {
		legacy := filepath.Join(dataDir, "myanki.db"+suffix)
		next := filepath.Join(dataDir, "kiroku.db"+suffix)
		if err := os.Rename(legacy, next); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return nil
}

func migrateLegacyJSON(db *sql.DB, path string) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	var legacy legacyDB
	if err := json.Unmarshal(raw, &legacy); err != nil {
		return err
	}

	for _, user := range legacy.Users {
		email := normalizeEmail(user.Email)
		if email == "" || user.PasswordHash == "" {
			continue
		}
		hash := user.PasswordHash
		if !strings.HasPrefix(hash, "$2a$") && !strings.HasPrefix(hash, "$2b$") && !strings.HasPrefix(hash, "$2y$") {
			bcryptHash, err := bcrypt.GenerateFromPassword([]byte(hash), bcrypt.DefaultCost)
			if err != nil {
				return err
			}
			hash = string(bcryptHash)
		}
		joined := user.Joined
		if joined == 0 {
			joined = nowMillis()
		}
		if _, err := db.Exec(
			`INSERT INTO users(email, password_hash, joined) VALUES(?, ?, ?)
			 ON CONFLICT(email) DO NOTHING`,
			email, hash, joined,
		); err != nil {
			return err
		}
	}

	for email, state := range legacy.UserStates {
		normalized := normalizeEmail(email)
		if normalized == "" || len(state) == 0 || string(state) == "null" {
			continue
		}
		if _, err := db.Exec(
			`INSERT INTO user_states(email, state_json, updated_at) VALUES(?, ?, ?)
			 ON CONFLICT(email) DO NOTHING`,
			normalized, string(state), nowMillis(),
		); err != nil {
			return err
		}
	}
	return nil
}

func (a *app) health(w http.ResponseWriter, _ *http.Request) {
	if err := a.db.Ping(); err != nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *app) register(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	email := normalizeEmail(req.Email)
	if email == "" || len(req.Password) < 4 {
		writeError(w, http.StatusBadRequest, "Email and a password of at least 4 characters are required.")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not prepare password.")
		return
	}

	joined := nowMillis()
	tx, err := a.db.Begin()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Registration failed.")
		return
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`INSERT INTO users(email, password_hash, joined) VALUES(?, ?, ?)`, email, string(hash), joined); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") || strings.Contains(strings.ToLower(err.Error()), "constraint") {
			writeError(w, http.StatusBadRequest, "This email address is already registered on the server.")
			return
		}
		writeError(w, http.StatusInternalServerError, "Registration failed on server.")
		return
	}
	if _, err = tx.Exec(
		`INSERT INTO user_states(email, state_json, updated_at) VALUES(?, ?, ?)`,
		email,
		defaultStateJSON(),
		joined,
	); err != nil {
		writeError(w, http.StatusInternalServerError, "Registration failed on server.")
		return
	}
	if err = tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "Registration failed on server.")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"user":    userResponse{Email: email, Joined: joined},
	})
}

func (a *app) login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	email := normalizeEmail(req.Email)
	if email == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "Email and password are required inputs.")
		return
	}

	var hash string
	var joined int64
	err := a.db.QueryRow(`SELECT password_hash, joined FROM users WHERE email = ?`, email).Scan(&hash, &joined)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusUnauthorized, "Invalid email or password.")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Login failed on server.")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password)) != nil {
		writeError(w, http.StatusUnauthorized, "Invalid email or password.")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"user":    userResponse{Email: email, Joined: joined},
	})
}

func (a *app) syncPush(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email string          `json:"email"`
		State json.RawMessage `json:"state"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	email := normalizeEmail(req.Email)
	if email == "" || !json.Valid(req.State) || string(req.State) == "null" {
		writeError(w, http.StatusBadRequest, "Missing email or sync state contents.")
		return
	}

	if shouldIgnoreDestructiveDefaultPush(a.db, email, req.State) {
		writeJSON(w, http.StatusOK, map[string]any{"success": true, "ignored": true})
		return
	}

	stateToStore := string(req.State)
	if existing, err := loadExistingState(a.db, email); err == nil && len(existing) > 0 {
		merged, err := mergeStateJSON(existing, req.State)
		if err != nil {
			writeError(w, http.StatusBadRequest, "Could not merge sync payload.")
			return
		}
		stateToStore = string(merged)
	}

	if _, err := a.db.Exec(
		`INSERT INTO user_states(email, state_json, updated_at) VALUES(?, ?, ?)
		 ON CONFLICT(email) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`,
		email,
		stateToStore,
		nowMillis(),
	); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to push statistics sync to backend.")
		return
	}
	var decoded json.RawMessage = []byte(stateToStore)
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "state": decoded})
}

func (a *app) syncPull(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email string `json:"email"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	email := normalizeEmail(req.Email)
	if email == "" {
		writeError(w, http.StatusBadRequest, "Email parameter is required.")
		return
	}

	var state string
	err := a.db.QueryRow(`SELECT state_json FROM user_states WHERE email = ?`, email).Scan(&state)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusOK, map[string]any{"success": true, "state": nil})
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to pull statistics synchronization from backend.")
		return
	}

	var decoded json.RawMessage = []byte(state)
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "state": decoded})
}

func (a *app) importAPKG(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	defer r.Body.Close()

	raw, err := io.ReadAll(r.Body)
	if err != nil || len(raw) == 0 {
		writeError(w, http.StatusBadRequest, "Empty or oversized APKG upload.")
		return
	}

	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid APKG zip file.")
		return
	}

	collection, err := readZipFile(reader, []string{"collection.anki2", "collection.anki21"})
	if err != nil {
		writeError(w, http.StatusBadRequest, "Apkg file invalid: collection.anki2 SQLite file not found.")
		return
	}

	temp, err := os.CreateTemp("", "kiroku-apkg-*.sqlite")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not prepare APKG parser.")
		return
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if _, err = temp.Write(collection); err != nil {
		temp.Close()
		writeError(w, http.StatusInternalServerError, "Could not cache APKG collection.")
		return
	}
	temp.Close()

	apkgDB, err := sql.Open("sqlite", tempPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not open APKG collection.")
		return
	}
	defer apkgDB.Close()

	deckNames, modelFields := readAnkiMetadata(apkgDB)
	mediaMap := readMediaMap(reader)
	cards, err := extractCards(apkgDB, reader, mediaMap, deckNames, modelFields)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to extract cards table rows.")
		return
	}

	decks := make([]map[string]string, 0, len(deckNames))
	for id, name := range deckNames {
		decks = append(decks, map[string]string{"id": id, "name": name})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success":    true,
		"totalCards": len(cards),
		"cards":      cards,
		"decks":      decks,
	})
}

type modelInfo struct {
	Name   string
	Fields []string
}

func readAnkiMetadata(db *sql.DB) (map[string]string, map[string]modelInfo) {
	deckNames := map[string]string{}
	modelFields := map[string]modelInfo{}

	var decksRaw, modelsRaw string
	if err := db.QueryRow(`SELECT decks, models FROM col LIMIT 1`).Scan(&decksRaw, &modelsRaw); err != nil {
		return deckNames, modelFields
	}

	var deckPayload map[string]struct {
		Name string `json:"name"`
	}
	if json.Unmarshal([]byte(decksRaw), &deckPayload) == nil {
		for id, deck := range deckPayload {
			if deck.Name != "" {
				deckNames[id] = deck.Name
			}
		}
	}

	var modelPayload map[string]struct {
		Name string `json:"name"`
		Flds []struct {
			Name string `json:"name"`
		} `json:"flds"`
	}
	if json.Unmarshal([]byte(modelsRaw), &modelPayload) == nil {
		for id, model := range modelPayload {
			fields := make([]string, 0, len(model.Flds))
			for i, field := range model.Flds {
				name := field.Name
				if name == "" {
					name = fmt.Sprintf("Field %d", i+1)
				}
				fields = append(fields, name)
			}
			modelFields[id] = modelInfo{Name: fallback(model.Name, "Imported Note"), Fields: fields}
		}
	}
	return deckNames, modelFields
}

func extractCards(db *sql.DB, zipReader *zip.Reader, mediaMap map[string]string, deckNames map[string]string, models map[string]modelInfo) ([]map[string]any, error) {
	rows, err := db.Query(`SELECT cards.id, cards.did, cards.nid, notes.mid, notes.flds, notes.tags FROM cards JOIN notes ON cards.nid = notes.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	cards := []map[string]any{}
	for rows.Next() {
		var cardID, did, noteID, mid, flds, tagsRaw string
		if err := rows.Scan(&cardID, &did, &noteID, &mid, &flds, &tagsRaw); err != nil {
			return nil, err
		}

		rawFields := strings.Split(flds, "\x1f")
		for i := range rawFields {
			rawFields[i] = sanitizeCardHTML(resolveMediaRefs(rawFields[i], zipReader, mediaMap))
		}

		model := models[mid]
		fieldOrder := model.Fields
		if len(fieldOrder) == 0 {
			fieldOrder = make([]string, len(rawFields))
			for i := range rawFields {
				fieldOrder[i] = fmt.Sprintf("Field %d", i+1)
			}
		}

		fieldRecord := map[string]string{}
		for i, value := range rawFields {
			name := fmt.Sprintf("Field %d", i+1)
			if i < len(fieldOrder) {
				name = fieldOrder[i]
			}
			fieldRecord[name] = value
		}

		plainFields := make([]string, 0, len(rawFields))
		for _, field := range rawFields {
			plain := cleanHTML(field)
			if plain != "" && !regexp.MustCompile(`^\d+$`).MatchString(plain) {
				plainFields = append(plainFields, plain)
			}
		}

		front, back := pickFrontBack(plainFields)
		if front == "" {
			front = cleanHTML(first(rawFields))
		}
		if back == "" {
			back = cleanHTML(secondOrFirst(rawFields))
		}
		if front == "" || back == "" {
			continue
		}

		mnemonic := pickField(fieldRecord, regexp.MustCompile(`(?i)mnemonic|story|koohii|heisig|rtk|remember|primitive|hint`))
		strokeInfo := pickField(fieldRecord, regexp.MustCompile(`(?i)stroke|diagram|writing|kanjivg|order`))
		strokeCount := parseStrokeCount(fieldRecord)
		deckName := fallback(deckNames[did], "Imported Deck")

		card := map[string]any{
			"id":          fmt.Sprintf("anki-imported-%s-%d", cardID, time.Now().UnixNano()),
			"deckId":      did,
			"deckName":    deckName,
			"front":       front,
			"back":        back,
			"noteId":      noteID,
			"modelName":   fallback(model.Name, "Imported Note"),
			"fieldOrder":  fieldOrder,
			"fields":      fieldRecord,
			"rawFields":   rawFields,
			"tags":        splitTags(tagsRaw),
			"added":       nowMillis(),
			"mnemonic":    emptyToNil(mnemonic),
			"strokeInfo":  emptyToNil(strokeInfo),
			"strokeCount": strokeCount,
		}
		cards = append(cards, card)
	}
	return cards, rows.Err()
}

func shouldIgnoreDestructiveDefaultPush(db *sql.DB, email string, incoming json.RawMessage) bool {
	existing, err := loadExistingState(db, email)
	if err != nil {
		return false
	}
	return stateLooksSubstantial(existing) && stateLooksEmpty(incoming)
}

func loadExistingState(db *sql.DB, email string) ([]byte, error) {
	var existing string
	if err := db.QueryRow(`SELECT state_json FROM user_states WHERE email = ?`, email).Scan(&existing); err != nil {
		return nil, err
	}
	return []byte(existing), nil
}

func mergeStateJSON(existingRaw, incomingRaw json.RawMessage) (json.RawMessage, error) {
	var existing map[string]any
	var incoming map[string]any
	if err := json.Unmarshal(existingRaw, &existing); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(incomingRaw, &incoming); err != nil {
		return nil, err
	}

	result := map[string]any{}
	for key, value := range existing {
		result[key] = value
	}

	existingDeleted := stringSlice(existing["deleted_deck_ids"])
	incomingDeleted := stringSlice(incoming["deleted_deck_ids"])
	deletedDeckIDs := unionStrings(existingDeleted, incomingDeleted)
	deletedDeckSet := makeSet(deletedDeckIDs)

	result["_meta"] = mergeMeta(asMap(existing["_meta"]), asMap(incoming["_meta"]))
	activeRows, activeRowsInfo := mergeActiveRows(existing, incoming)
	result["active_rows"] = activeRows
	result["active_rows_info"] = activeRowsInfo
	result["streak_info"] = mergeStreak(asMap(existing["streak_info"]), asMap(incoming["streak_info"]))
	result["srs_cards_list"] = mergeObjectArray(existing["srs_cards_list"], incoming["srs_cards_list"], "char", nil, mergeSRSCard)
	result["deleted_deck_ids"] = deletedDeckIDs
	result["anki_decks"] = mergeObjectArray(existing["anki_decks"], incoming["anki_decks"], "id", deletedDeckSet, preferNewerObject)
	result["anki_cards"] = mergeObjectArray(existing["anki_cards"], incoming["anki_cards"], "id", deletedDeckSet, mergeAnkiCard)

	encoded, err := json.Marshal(result)
	if err != nil {
		return nil, err
	}
	return encoded, nil
}

func mergeMeta(existing, incoming map[string]any) map[string]any {
	result := map[string]any{}
	for key, value := range existing {
		result[key] = value
	}
	for key, value := range incoming {
		result[key] = value
	}
	result["schemaVersion"] = maxFloat(asFloat(existing["schemaVersion"]), asFloat(incoming["schemaVersion"]), 2)
	result["generatedAt"] = maxFloat(asFloat(existing["generatedAt"]), asFloat(incoming["generatedAt"]), float64(nowMillis()))
	result["mergedAt"] = nowMillis()
	return result
}

func mergeActiveRows(existing, incoming map[string]any) ([]string, map[string]any) {
	existingRows := normalizeActiveRows(stringSlice(existing["active_rows"]))
	incomingRows := normalizeActiveRows(stringSlice(incoming["active_rows"]))
	existingInfo := asMap(existing["active_rows_info"])
	incomingInfo := asMap(incoming["active_rows_info"])
	existingUpdatedAt := updatedAt(existingInfo)
	incomingUpdatedAt := updatedAt(incomingInfo)

	if incomingUpdatedAt > existingUpdatedAt {
		return incomingRows, mergeActiveRowsInfo(incomingInfo, incomingUpdatedAt)
	}
	if existingUpdatedAt > incomingUpdatedAt {
		return existingRows, mergeActiveRowsInfo(existingInfo, existingUpdatedAt)
	}
	if incomingUpdatedAt > 0 {
		return incomingRows, mergeActiveRowsInfo(incomingInfo, incomingUpdatedAt)
	}

	return normalizeActiveRows(unionStrings(existingRows, incomingRows)), mergeActiveRowsInfo(map[string]any{}, 0)
}

func mergeActiveRowsInfo(info map[string]any, updatedAtValue float64) map[string]any {
	result := cloneMap(info)
	if updatedAtValue > 0 {
		result["updatedAt"] = updatedAtValue
	}
	return result
}

func mergeStreak(existing, incoming map[string]any) map[string]any {
	result := map[string]any{}
	for key, value := range preferNewerObject(existing, incoming) {
		result[key] = value
	}
	result["current"] = maxFloat(asFloat(existing["current"]), asFloat(incoming["current"]), 0)
	result["highest"] = maxFloat(asFloat(existing["highest"]), asFloat(incoming["highest"]), 0)
	result["updatedAt"] = maxFloat(updatedAt(existing), updatedAt(incoming), float64(nowMillis()))
	return result
}

func mergeSRSCard(existing, incoming map[string]any) map[string]any {
	if existing == nil {
		return cloneMap(incoming)
	}
	if incoming == nil {
		return cloneMap(existing)
	}
	base := preferNewerObject(existing, incoming)
	result := cloneMap(base)
	result["box"] = maxFloat(asFloat(existing["box"]), asFloat(incoming["box"]), asFloat(base["box"]))
	result["streak"] = maxFloat(asFloat(existing["streak"]), asFloat(incoming["streak"]), asFloat(base["streak"]))
	result["nextReview"] = maxFloat(asFloat(existing["nextReview"]), asFloat(incoming["nextReview"]), asFloat(base["nextReview"]))
	result["updatedAt"] = maxFloat(updatedAt(existing), updatedAt(incoming), float64(nowMillis()))
	return result
}

func mergeAnkiCard(existing, incoming map[string]any) map[string]any {
	if existing == nil {
		return cloneMap(incoming)
	}
	if incoming == nil {
		return cloneMap(existing)
	}
	base := preferNewerObject(existing, incoming)
	result := cloneMap(base)
	result["reps"] = maxFloat(asFloat(existing["reps"]), asFloat(incoming["reps"]), asFloat(base["reps"]))
	result["lapses"] = maxFloat(asFloat(existing["lapses"]), asFloat(incoming["lapses"]), asFloat(base["lapses"]))
	result["lastReviewed"] = maxFloat(asFloat(existing["lastReviewed"]), asFloat(incoming["lastReviewed"]), asFloat(base["lastReviewed"]))
	result["totalAnswerSeconds"] = maxFloat(asFloat(existing["totalAnswerSeconds"]), asFloat(incoming["totalAnswerSeconds"]), asFloat(base["totalAnswerSeconds"]))
	result["updatedAt"] = maxFloat(updatedAt(existing), updatedAt(incoming), float64(nowMillis()))
	return result
}

func mergeObjectArray(existingValue, incomingValue any, idKey string, deletedDeckSet map[string]bool, merge func(map[string]any, map[string]any) map[string]any) []map[string]any {
	merged := map[string]map[string]any{}
	for _, item := range objectArray(existingValue) {
		id := stringValue(item[idKey])
		if id == "" || isDeletedDeckScoped(item, deletedDeckSet) {
			continue
		}
		merged[id] = item
	}
	for _, item := range objectArray(incomingValue) {
		id := stringValue(item[idKey])
		if id == "" || isDeletedDeckScoped(item, deletedDeckSet) {
			continue
		}
		merged[id] = merge(merged[id], item)
	}
	out := make([]map[string]any, 0, len(merged))
	for _, item := range merged {
		out = append(out, item)
	}
	return out
}

func isDeletedDeckScoped(item map[string]any, deletedDeckSet map[string]bool) bool {
	if len(deletedDeckSet) == 0 {
		return false
	}
	id := stringValue(item["id"])
	deckID := stringValue(item["deckId"])
	return deletedDeckSet[id] || deletedDeckSet[deckID]
}

func preferNewerObject(existing, incoming map[string]any) map[string]any {
	if incoming == nil {
		return cloneMap(existing)
	}
	if existing == nil {
		return cloneMap(incoming)
	}
	if updatedAt(incoming) >= updatedAt(existing) {
		return cloneMap(incoming)
	}
	return cloneMap(existing)
}

func updatedAt(item map[string]any) float64 {
	if item == nil {
		return 0
	}
	if value := asFloat(item["updatedAt"]); value > 0 {
		return value
	}
	if value := asFloat(item["lastReviewed"]); value > 0 {
		return value
	}
	if value := asFloat(item["added"]); value > 0 {
		return value
	}
	if value := asFloat(item["created"]); value > 0 {
		return value
	}
	return 0
}

func objectArray(value any) []map[string]any {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	out := []map[string]any{}
	for _, item := range items {
		if mapped, ok := item.(map[string]any); ok {
			out = append(out, mapped)
		}
	}
	return out
}

func asMap(value any) map[string]any {
	if mapped, ok := value.(map[string]any); ok {
		return mapped
	}
	return map[string]any{}
}

func cloneMap(value map[string]any) map[string]any {
	out := map[string]any{}
	for key, item := range value {
		out[key] = item
	}
	return out
}

func stringSlice(value any) []string {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	out := []string{}
	for _, item := range items {
		if text := stringValue(item); text != "" {
			out = append(out, text)
		}
	}
	return out
}

func normalizeActiveRows(rows []string) []string {
	if len(rows) == 0 {
		return []string{"hiragana:vowels"}
	}

	known := map[string]bool{
		"hiragana:vowels": true, "hiragana:k-row": true, "hiragana:s-row": true, "hiragana:t-row": true,
		"hiragana:n-row": true, "hiragana:h-row": true, "hiragana:m-row": true, "hiragana:y-row": true,
		"hiragana:r-row": true, "hiragana:w-row": true, "hiragana:dakuten": true, "hiragana:handakuten": true,
		"katakana:vowels": true, "katakana:k-row": true, "katakana:s-row": true, "katakana:t-row": true,
		"katakana:n-row": true, "katakana:h-row": true, "katakana:m-row": true, "katakana:y-row": true,
		"katakana:r-row": true, "katakana:w-row": true, "katakana:dakuten": true, "katakana:handakuten": true,
	}
	legacyHiragana := map[string]string{
		"Vowels": "hiragana:vowels", "K-row": "hiragana:k-row", "S-row": "hiragana:s-row",
		"T-row": "hiragana:t-row", "N-row": "hiragana:n-row", "H-row": "hiragana:h-row",
		"M-row": "hiragana:m-row", "Y-row": "hiragana:y-row", "R-row": "hiragana:r-row",
		"W-row": "hiragana:w-row", "Dakuten": "hiragana:dakuten", "Handakuten": "hiragana:handakuten",
	}

	normalized := []string{}
	for _, row := range rows {
		if known[row] {
			normalized = append(normalized, row)
			continue
		}
		if canonical, ok := legacyHiragana[row]; ok {
			normalized = append(normalized, canonical)
		}
	}

	unique := unionStrings(normalized, nil)
	if len(unique) == 0 {
		return []string{"hiragana:vowels"}
	}
	return unique
}

func stringValue(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	return ""
}

func unionStrings(a, b []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range append(a, b...) {
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

func makeSet(items []string) map[string]bool {
	out := map[string]bool{}
	for _, item := range items {
		out[item] = true
	}
	return out
}

func maxFloat(values ...float64) float64 {
	var max float64
	for i, value := range values {
		if i == 0 || value > max {
			max = value
		}
	}
	return max
}

func stateLooksSubstantial(raw []byte) bool {
	var state map[string]json.RawMessage
	if json.Unmarshal(raw, &state) != nil {
		return false
	}
	return arrayLength(state["anki_decks"]) > 0 ||
		arrayLength(state["anki_cards"]) > 0 ||
		hasProgress(state["srs_cards_list"]) ||
		streakCurrent(state["streak_info"]) > 0
}

func stateLooksEmpty(raw []byte) bool {
	var state map[string]json.RawMessage
	if json.Unmarshal(raw, &state) != nil {
		return false
	}
	return arrayLength(state["anki_decks"]) == 0 &&
		arrayLength(state["anki_cards"]) == 0 &&
		!hasProgress(state["srs_cards_list"]) &&
		streakCurrent(state["streak_info"]) == 0
}

func hasProgress(raw json.RawMessage) bool {
	var cards []map[string]any
	if json.Unmarshal(raw, &cards) != nil {
		return false
	}
	for _, card := range cards {
		if asFloat(card["box"]) > 1 || asFloat(card["streak"]) > 0 {
			return true
		}
	}
	return false
}

func arrayLength(raw json.RawMessage) int {
	var arr []any
	if json.Unmarshal(raw, &arr) != nil {
		return 0
	}
	return len(arr)
}

func streakCurrent(raw json.RawMessage) float64 {
	var streak map[string]any
	if json.Unmarshal(raw, &streak) != nil {
		return 0
	}
	return asFloat(streak["current"])
}

func asFloat(value any) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case int:
		return float64(v)
	case string:
		n, _ := strconv.ParseFloat(v, 64)
		return n
	default:
		return 0
	}
}

func pickFrontBack(fields []string) (string, string) {
	if len(fields) == 0 {
		return "", ""
	}
	japanese := []string{}
	english := []string{}
	for _, field := range fields {
		if regexp.MustCompile(`[\x{4e00}-\x{9faf}\x{3040}-\x{309f}\x{30a0}-\x{30ff}\x{ff00}-\x{ff9f}]`).MatchString(field) {
			japanese = append(japanese, field)
		} else {
			english = append(english, field)
		}
	}
	if len(japanese) > 0 {
		back := first(english)
		if back == "" && len(japanese) > 1 {
			back = japanese[1]
		}
		if back == "" {
			back = japanese[0]
		}
		return japanese[0], back
	}
	return fields[0], secondOrFirst(fields)
}

func pickField(fields map[string]string, matcher *regexp.Regexp) string {
	for name, value := range fields {
		if matcher.MatchString(name) && cleanHTML(value) != "" {
			return value
		}
	}
	for _, value := range fields {
		if matcher.MatchString(cleanHTML(value)) {
			return value
		}
	}
	return ""
}

func parseStrokeCount(fields map[string]string) any {
	for name, value := range fields {
		if regexp.MustCompile(`(?i)stroke.*count|strokes`).MatchString(name) {
			match := regexp.MustCompile(`\d+`).FindString(cleanHTML(value))
			if match != "" {
				if n, err := strconv.Atoi(match); err == nil {
					return n
				}
			}
		}
	}
	return nil
}

func resolveMediaRefs(input string, zipReader *zip.Reader, mediaMap map[string]string) string {
	imgRe := regexp.MustCompile(`(?i)<img\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*)>`)
	return imgRe.ReplaceAllStringFunc(input, func(match string) string {
		parts := imgRe.FindStringSubmatch(match)
		if len(parts) != 4 {
			return match
		}
		src := parts[2]
		entryName := ""
		for key, name := range mediaMap {
			if name == src {
				entryName = key
				break
			}
		}
		if entryName == "" {
			return match
		}
		bytes, err := readZipFile(zipReader, []string{entryName})
		if err != nil {
			return match
		}
		dataURL := fmt.Sprintf("data:%s;base64,%s", mimeTypeFor(src), base64.StdEncoding.EncodeToString(bytes))
		return fmt.Sprintf(`<img%ssrc="%s"%s>`, parts[1], dataURL, parts[3])
	})
}

func readMediaMap(zipReader *zip.Reader) map[string]string {
	raw, err := readZipFile(zipReader, []string{"media"})
	if err != nil {
		return map[string]string{}
	}
	var media map[string]string
	if json.Unmarshal(raw, &media) != nil {
		return map[string]string{}
	}
	return media
}

func readZipFile(zipReader *zip.Reader, names []string) ([]byte, error) {
	for _, file := range zipReader.File {
		for _, name := range names {
			if file.Name != name {
				continue
			}
			rc, err := file.Open()
			if err != nil {
				return nil, err
			}
			defer rc.Close()
			return io.ReadAll(rc)
		}
	}
	return nil, os.ErrNotExist
}

func cleanHTML(input string) string {
	noBreaks := regexp.MustCompile(`(?i)<br\s*/?>|</p>|</div>`).ReplaceAllString(input, "\n")
	noTags := regexp.MustCompile(`<[^>]+>`).ReplaceAllString(noBreaks, "")
	return strings.TrimSpace(html.UnescapeString(noTags))
}

func sanitizeCardHTML(input string) string {
	output := regexp.MustCompile(`(?is)<script[\s\S]*?</script>`).ReplaceAllString(input, "")
	output = regexp.MustCompile(`(?is)<style[\s\S]*?</style>`).ReplaceAllString(output, "")
	output = regexp.MustCompile(`(?i)\son\w+=("[^"]*"|'[^']*'|[^\s>]+)`).ReplaceAllString(output, "")
	output = regexp.MustCompile(`(?i)\s(href|src)=["']javascript:[^"']*["']`).ReplaceAllString(output, "")
	return strings.TrimSpace(output)
}

func mimeTypeFor(fileName string) string {
	ext := strings.ToLower(filepath.Ext(fileName))
	if m := mime.TypeByExtension(ext); m != "" {
		return m
	}
	switch ext {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".svg":
		return "image/svg+xml"
	default:
		return "image/png"
	}
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(dst); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON request.")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		log.Printf("write json: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func withCommonHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}

func defaultStateJSON() string {
	return `{"srs_cards_list":[],"active_rows":["hiragana:vowels"],"streak_info":{"current":0,"highest":0},"anki_decks":[],"anki_cards":[]}`
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func getenv(key, fallbackValue string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallbackValue
	}
	return value
}

func nowMillis() int64 {
	return time.Now().UnixMilli()
}

func splitTags(input string) []string {
	parts := strings.Fields(input)
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func fallback(value, fallbackValue string) string {
	if strings.TrimSpace(value) == "" {
		return fallbackValue
	}
	return value
}

func first(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func secondOrFirst(values []string) string {
	if len(values) > 1 {
		return values[1]
	}
	return first(values)
}

func emptyToNil(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}
