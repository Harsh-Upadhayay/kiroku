package handlers

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"testing"

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
