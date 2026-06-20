package handlers

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"kiroku-api/internal/config"
	_ "modernc.org/sqlite"
)

func newTestHandler(t *testing.T) (*Handler, *sql.DB) {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("failed to open in-memory sqlite: %v", err)
	}
	h := &Handler{DB: db, Config: &config.Config{}}
	return h, db
}

// newUploadTestHandler builds a handler wired for chunked-upload tests: a temp data dir for
// sessions and realistic body/upload caps. The upload handlers do not touch the database, so
// DB is left nil.
func newUploadTestHandler(t *testing.T) *Handler {
	t.Helper()
	return &Handler{Config: &config.Config{
		DataDir:        t.TempDir(),
		MaxBodyBytes:   100 << 20,
		MaxUploadBytes: 1 << 30,
	}}
}

// initUpload calls UploadInit and returns the decoded session id and received-chunks list.
func initUpload(t *testing.T, h *Handler, body string) (string, []int) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/import-anki-package/upload/init", strings.NewReader(body))
	w := httptest.NewRecorder()
	h.UploadInit(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("UploadInit returned %d, body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		Success bool `json:"success"`
		Data    struct {
			UploadID       string `json:"uploadId"`
			ReceivedChunks []int  `json:"receivedChunks"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode init response: %v", err)
	}
	return resp.Data.UploadID, resp.Data.ReceivedChunks
}

// putChunk drives UploadChunk for one chunk, routing the {uploadID}/{index} path values the
// real mux would supply.
func putChunk(h *Handler, uploadID string, index int, data []byte) *httptest.ResponseRecorder {
	url := fmt.Sprintf("/api/import-anki-package/upload/%s/chunk/%d", uploadID, index)
	req := httptest.NewRequest(http.MethodPut, url, bytes.NewReader(data))
	req.SetPathValue("uploadID", uploadID)
	req.SetPathValue("index", fmt.Sprintf("%d", index))
	w := httptest.NewRecorder()
	h.UploadChunk(w, req)
	return w
}

func completeUpload(h *Handler, uploadID string) *httptest.ResponseRecorder {
	url := fmt.Sprintf("/api/import-anki-package/upload/%s/complete", uploadID)
	req := httptest.NewRequest(http.MethodPost, url, nil)
	req.SetPathValue("uploadID", uploadID)
	w := httptest.NewRecorder()
	h.UploadComplete(w, req)
	return w
}

func statusUpload(h *Handler, uploadID string) *httptest.ResponseRecorder {
	url := fmt.Sprintf("/api/import-anki-package/upload/%s/status", uploadID)
	req := httptest.NewRequest(http.MethodGet, url, nil)
	req.SetPathValue("uploadID", uploadID)
	w := httptest.NewRecorder()
	h.UploadStatus(w, req)
	return w
}

// pollUploadStatus drives the status endpoint until the background job leaves "pending",
// mirroring what the client does. It returns the final recorder and the terminal status string.
func pollUploadStatus(t *testing.T, h *Handler, uploadID string) (*httptest.ResponseRecorder, string) {
	t.Helper()
	for attempt := 0; attempt < 600; attempt++ {
		w := statusUpload(h, uploadID)
		if w.Code != http.StatusOK {
			t.Fatalf("status returned %d, body=%s", w.Code, w.Body.String())
		}
		var resp struct {
			Data struct {
				Status string `json:"status"`
			} `json:"data"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode status response: %v", err)
		}
		if resp.Data.Status != "pending" {
			return w, resp.Data.Status
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("import job %s never left pending", uploadID)
	return nil, ""
}

func TestUploadInitValidatesParams(t *testing.T) {
	h := newUploadTestHandler(t)

	// Missing/zero totals are a client error.
	req := httptest.NewRequest(http.MethodPost, "/init", strings.NewReader(`{"totalSize":0,"totalChunks":0}`))
	w := httptest.NewRecorder()
	h.UploadInit(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("zero totals: got %d, want 400", w.Code)
	}

	// Oversized upload is rejected before any disk is touched.
	big := fmt.Sprintf(`{"totalSize":%d,"totalChunks":1}`, int64(h.Config.MaxUploadBytes)+1)
	req = httptest.NewRequest(http.MethodPost, "/init", strings.NewReader(big))
	w = httptest.NewRecorder()
	h.UploadInit(w, req)
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized upload: got %d, want 413", w.Code)
	}
}

func TestUploadInitResumesByFingerprint(t *testing.T) {
	h := newUploadTestHandler(t)

	body := `{"fingerprint":"deck.apkg:30:9","fileName":"deck.apkg","totalSize":30,"totalChunks":3,"chunkSize":10}`
	uploadID, received := initUpload(t, h, body)
	if len(received) != 0 {
		t.Fatalf("fresh session should have no chunks, got %v", received)
	}
	if w := putChunk(h, uploadID, 0, bytes.Repeat([]byte("a"), 10)); w.Code != http.StatusOK {
		t.Fatalf("putChunk 0: %d", w.Code)
	}

	// Re-initing with the same fingerprint returns the same session and the uploaded chunk.
	resumeID, resumeReceived := initUpload(t, h, body)
	if resumeID != uploadID {
		t.Fatalf("resume returned a different session: %s vs %s", resumeID, uploadID)
	}
	if len(resumeReceived) != 1 || resumeReceived[0] != 0 {
		t.Fatalf("resume should report chunk 0 received, got %v", resumeReceived)
	}
}

func TestUploadChunkRejectsInvalidID(t *testing.T) {
	h := newUploadTestHandler(t)
	w := putChunk(h, "not-a-uuid", 0, []byte("x"))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("invalid upload id: got %d, want 400", w.Code)
	}
}

func TestUploadCompleteRejectsIncomplete(t *testing.T) {
	h := newUploadTestHandler(t)
	body := `{"fingerprint":"fp","totalSize":20,"totalChunks":2,"chunkSize":10}`
	uploadID, _ := initUpload(t, h, body)
	if w := putChunk(h, uploadID, 0, bytes.Repeat([]byte("a"), 10)); w.Code != http.StatusOK {
		t.Fatalf("putChunk 0: %d", w.Code)
	}
	// Chunk 1 never sent. Completing enqueues the parse (202); the missing chunk surfaces as an
	// "error" status from the background job rather than importing a partial file, and the
	// session is left in place so the client can re-upload and retry.
	if w := completeUpload(h, uploadID); w.Code != http.StatusAccepted {
		t.Fatalf("complete with missing chunk: got %d, want 202", w.Code)
	}
	_, status := pollUploadStatus(t, h, uploadID)
	if status != "error" {
		t.Fatalf("missing-chunk job status: got %q, want error", status)
	}
	sessionDir := filepath.Join(h.uploadsRoot(), uploadID)
	if _, err := os.Stat(sessionDir); err != nil {
		t.Fatalf("session should survive a failed parse for retry, stat err: %v", err)
	}
}

// TestUploadEndToEnd drives init → chunks → complete through the handlers with a real .apkg
// and asserts the same collection payload the single-shot endpoint returns. Skipped when the
// sample deck is absent.
func TestUploadEndToEnd(t *testing.T) {
	const sample = "RRTK_Recognition_Remembering_The_Kanji.apkg"
	path := filepath.Join("..", "..", "..", sample)
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		t.Skipf("sample deck not present: %s", path)
	}
	if err != nil {
		t.Fatal(err)
	}

	h := newUploadTestHandler(t)
	const chunkSize = 10 << 20
	totalChunks := (len(raw) + chunkSize - 1) / chunkSize

	body := fmt.Sprintf(`{"fingerprint":"rrtk","fileName":%q,"totalSize":%d,"totalChunks":%d,"chunkSize":%d}`,
		sample, len(raw), totalChunks, chunkSize)
	uploadID, _ := initUpload(t, h, body)

	for i := 0; i < totalChunks; i++ {
		start := i * chunkSize
		end := start + chunkSize
		if end > len(raw) {
			end = len(raw)
		}
		if w := putChunk(h, uploadID, i, raw[start:end]); w.Code != http.StatusOK {
			t.Fatalf("putChunk %d: %d body=%s", i, w.Code, w.Body.String())
		}
	}

	if w := completeUpload(h, uploadID); w.Code != http.StatusAccepted {
		t.Fatalf("complete: got %d body=%s", w.Code, w.Body.String())
	}

	w, status := pollUploadStatus(t, h, uploadID)
	if status != "done" {
		t.Fatalf("import job status: got %q, want done", status)
	}
	var resp struct {
		Success bool `json:"success"`
		Data    struct {
			Status string `json:"status"`
			Result struct {
				ImportID   string `json:"importId"`
				Collection struct {
					Cards []json.RawMessage `json:"cards"`
				} `json:"collection"`
			} `json:"result"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode status response: %v", err)
	}
	if !resp.Success || resp.Data.Result.ImportID == "" || len(resp.Data.Result.Collection.Cards) == 0 {
		t.Fatalf("unexpected import result: success=%v importId=%q cards=%d",
			resp.Success, resp.Data.Result.ImportID, len(resp.Data.Result.Collection.Cards))
	}

	// Fetching the done result acks it: the session is reclaimed and the job forgotten.
	if _, err := os.Stat(filepath.Join(h.uploadsRoot(), uploadID)); !os.IsNotExist(err) {
		t.Fatalf("session should be discarded after the result is fetched, stat err: %v", err)
	}
	if w := statusUpload(h, uploadID); w.Code != http.StatusNotFound {
		t.Fatalf("status after ack: got %d, want 404", w.Code)
	}
}

// BUG-06: Health inserts a row with NowMillis() and deletes it with a second
// NowMillis() call. If the two calls span a millisecond boundary the DELETE
// does not match the INSERT, leaving orphaned rows that accumulate over time.
func TestHealthDoesNotOrphanRows(t *testing.T) {
	h, db := newTestHandler(t)
	defer db.Close()

	req := httptest.NewRequest(http.MethodGet, "/health", nil)

	// Call Health multiple times to amplify any orphan risk.
	for i := 0; i < 5; i++ {
		w := httptest.NewRecorder()
		h.Health(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("call %d: Health returned %d, expected 200", i+1, w.Code)
		}
	}

	// BUG-06: each call should leave zero rows in health_check.
	var count int
	err := db.QueryRow("SELECT COUNT(*) FROM health_check").Scan(&count)
	if err != nil {
		// Table may not exist if the multi-statement Exec is silently ignored by the driver.
		t.Logf("health_check table query failed (may not exist): %v", err)
		return
	}
	if count != 0 {
		t.Errorf("BUG-06: Health left %d orphaned row(s) in health_check table after 5 calls, expected 0", count)
	}
}

// BUG-06: A single Health call must leave the table clean.
func TestHealthSingleCallNoOrphans(t *testing.T) {
	h, db := newTestHandler(t)
	defer db.Close()

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	h.Health(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Health returned %d, expected 200", w.Code)
	}

	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM health_check").Scan(&count); err != nil {
		t.Logf("health_check table not found (driver may not support multi-statement Exec): %v", err)
		return
	}
	if count != 0 {
		t.Errorf("BUG-06: single Health call left %d row(s) in health_check, expected 0", count)
	}
}

// BUG-06: Health must respond 200 even when the table already exists (idempotent).
func TestHealthIdempotent(t *testing.T) {
	h, db := newTestHandler(t)
	defer db.Close()

	for i := 0; i < 3; i++ {
		req := httptest.NewRequest(http.MethodGet, "/health", nil)
		w := httptest.NewRecorder()
		h.Health(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("Health call %d returned %d, expected 200", i+1, w.Code)
		}
	}
}
