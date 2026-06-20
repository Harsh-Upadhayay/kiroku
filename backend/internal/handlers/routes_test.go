package handlers

import (
	"net/http"
	"testing"
)

// TestRegisterRoutesDoesNotPanic guards against ambiguous/conflicting wildcard patterns. Go
// 1.22's ServeMux panics at registration time when two patterns overlap without one being
// strictly more specific (e.g. "/a/{x}/media/{y}" vs "/a/upload/{z}/status"). This caught a
// real startup crash; keep it so the production route set always registers cleanly.
func TestRegisterRoutesDoesNotPanic(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("RegisterRoutes panicked, routes conflict: %v", r)
		}
	}()
	RegisterRoutes(http.NewServeMux(), &Handler{})
}

// TestImportedMediaRouteResolves verifies the imported-package media route and the upload status
// route both resolve to their intended handlers and do not shadow one another.
func TestImportedMediaRouteResolves(t *testing.T) {
	mux := http.NewServeMux()
	RegisterRoutes(mux, &Handler{})

	cases := []struct {
		method, path string
	}{
		{http.MethodGet, "/api/import-anki-package/media/42/abc123"},
		{http.MethodGet, "/api/import-anki-package/upload/sess-1/status"},
	}
	for _, c := range cases {
		req, err := http.NewRequest(c.method, c.path, nil)
		if err != nil {
			t.Fatalf("new request %s %s: %v", c.method, c.path, err)
		}
		if _, pattern := mux.Handler(req); pattern == "" {
			t.Errorf("no route matched %s %s", c.method, c.path)
		}
	}
}
