package handlers

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"kiroku-api/internal/config"
)

// newMediaTestHandler builds a handler with a temp data dir and a realistic body cap. The
// media handlers never touch the database, so DB stays nil.
func newMediaTestHandler(t *testing.T) *Handler {
	t.Helper()
	return &Handler{Config: &config.Config{
		DataDir:      t.TempDir(),
		MaxBodyBytes: 100 << 20,
	}}
}

// putBlob drives PutMediaBlob the way the real mux would, supplying the {hash} path value.
func putBlob(h *Handler, hash string, body []byte) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPut, "/api/media/"+hash, bytes.NewReader(body))
	req.SetPathValue("hash", hash)
	w := httptest.NewRecorder()
	h.PutMediaBlob(w, req)
	return w
}

func getBlob(h *Handler, hash string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/api/media/"+hash, nil)
	req.SetPathValue("hash", hash)
	w := httptest.NewRecorder()
	h.GetMediaBlob(w, req)
	return w
}

func hashOf(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func TestPutMediaBlobStoresVerifiedContent(t *testing.T) {
	h := newMediaTestHandler(t)
	content := []byte("fake-audio-bytes")
	hash := hashOf(content)

	if w := putBlob(h, hash, content); w.Code != http.StatusCreated {
		t.Fatalf("PUT returned %d, body=%s", w.Code, w.Body.String())
	}

	stored, err := os.ReadFile(filepath.Join(h.Config.DataDir, "media", hash))
	if err != nil {
		t.Fatalf("blob not on disk after PUT: %v", err)
	}
	if !bytes.Equal(stored, content) {
		t.Fatalf("stored bytes differ from uploaded bytes")
	}

	if w := getBlob(h, hash); w.Code != http.StatusOK || !bytes.Equal(w.Body.Bytes(), content) {
		t.Fatalf("GET after PUT: code=%d", w.Code)
	}
}

func TestPutMediaBlobRejectsMismatchedContent(t *testing.T) {
	h := newMediaTestHandler(t)
	// A valid-shaped hash that is NOT the digest of the body.
	wrongHash := hashOf([]byte("something else entirely"))

	w := putBlob(h, wrongHash, []byte("actual body"))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("mismatched PUT returned %d, want 400", w.Code)
	}

	// Neither the final blob nor any leftover temp file may survive a rejected upload —
	// temp junk would accumulate forever, a mismatched blob would poison the store.
	entries, err := os.ReadDir(filepath.Join(h.Config.DataDir, "media"))
	if err != nil {
		t.Fatalf("read media dir: %v", err)
	}
	for _, e := range entries {
		t.Errorf("unexpected file left in media dir after rejected upload: %s", e.Name())
	}
}

func TestPutMediaBlobIdempotentWhenAlreadyStored(t *testing.T) {
	h := newMediaTestHandler(t)
	content := []byte("stored once")
	hash := hashOf(content)

	if w := putBlob(h, hash, content); w.Code != http.StatusCreated {
		t.Fatalf("first PUT returned %d", w.Code)
	}
	// Second upload of the same hash short-circuits: 200 (not 201), even with a garbage
	// body — the store already holds verified content for this hash and must keep it.
	if w := putBlob(h, hash, []byte("garbage that is never read")); w.Code != http.StatusOK {
		t.Fatalf("repeat PUT returned %d, want 200", w.Code)
	}
	stored, _ := os.ReadFile(filepath.Join(h.Config.DataDir, "media", hash))
	if !bytes.Equal(stored, content) {
		t.Fatalf("repeat PUT overwrote verified content")
	}
}

func TestPutMediaBlobRejectsInvalidHashAndOversizeBody(t *testing.T) {
	h := newMediaTestHandler(t)

	for _, bad := range []string{"not-a-hash", "ABCDEF", strings.Repeat("g", 64)} {
		if w := putBlob(h, bad, []byte("x")); w.Code != http.StatusBadRequest {
			t.Errorf("PUT with hash %q returned %d, want 400", bad, w.Code)
		}
	}

	h.Config.MaxBodyBytes = 8
	big := []byte("definitely more than eight bytes")
	if w := putBlob(h, hashOf(big), big); w.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("oversize PUT returned %d, want 413", w.Code)
	}
}

func TestMediaCheckReportsMissingHashes(t *testing.T) {
	h := newMediaTestHandler(t)
	present := []byte("i am here")
	presentHash := hashOf(present)
	if w := putBlob(h, presentHash, present); w.Code != http.StatusCreated {
		t.Fatalf("seed PUT returned %d", w.Code)
	}
	missingHash := hashOf([]byte("i am not"))

	body, _ := json.Marshal(map[string][]string{
		// A malformed hash is definitionally missing; it must not fail the whole batch.
		"hashes": {presentHash, missingHash, "malformed"},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/media/check", bytes.NewReader(body))
	w := httptest.NewRecorder()
	h.MediaCheck(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("check returned %d, body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		Data struct {
			Missing []string `json:"missing"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode check response: %v", err)
	}
	want := []string{missingHash, "malformed"}
	if len(resp.Data.Missing) != len(want) {
		t.Fatalf("missing = %v, want %v", resp.Data.Missing, want)
	}
	for i := range want {
		if resp.Data.Missing[i] != want[i] {
			t.Fatalf("missing = %v, want %v", resp.Data.Missing, want)
		}
	}
}

// TestMediaRoutesResolve pins the method-specific media routes to their handlers so a future
// route reshuffle cannot silently drop PUT or the bulk check.
func TestMediaRoutesResolve(t *testing.T) {
	mux := http.NewServeMux()
	RegisterRoutes(mux, &Handler{})

	for _, c := range []struct{ method, path string }{
		{http.MethodGet, "/api/media/" + strings.Repeat("a", 64)},
		{http.MethodHead, "/api/media/" + strings.Repeat("a", 64)},
		{http.MethodPut, "/api/media/" + strings.Repeat("a", 64)},
		{http.MethodPost, "/api/media/check"},
	} {
		req := httptest.NewRequest(c.method, c.path, nil)
		if _, pattern := mux.Handler(req); pattern == "" {
			t.Errorf("no route matched %s %s", c.method, c.path)
		}
	}
}
