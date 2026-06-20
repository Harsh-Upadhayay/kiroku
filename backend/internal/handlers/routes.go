package handlers

import "net/http"

// RegisterRoutes wires every API route onto mux. It is the single source of truth for the
// server's URL surface, kept separate from main() so tests can construct the production mux and
// assert that the route set is internally consistent (Go 1.22's ServeMux panics on conflicting
// or ambiguous wildcard patterns at registration time).
func RegisterRoutes(mux *http.ServeMux, h *Handler) {
	mux.HandleFunc("GET /healthz", h.Health)
	mux.HandleFunc("GET /api/healthz", h.Health)
	mux.HandleFunc("POST /api/auth/register", h.Register)
	mux.HandleFunc("POST /api/auth/login", h.Login)
	mux.HandleFunc("POST /api/sync/push", h.SyncPush)
	mux.HandleFunc("POST /api/sync/pull", h.SyncPull)
	mux.HandleFunc("POST /api/import-anki-package/upload/init", h.UploadInit)
	mux.HandleFunc("PUT /api/import-anki-package/upload/{uploadID}/chunk/{index}", h.UploadChunk)
	mux.HandleFunc("POST /api/import-anki-package/upload/{uploadID}/complete", h.UploadComplete)
	mux.HandleFunc("GET /api/import-anki-package/upload/{uploadID}/status", h.UploadStatus)
	mux.HandleFunc("POST /api/vocab/import-image", h.ImportVocabImage)
	// Media route lives under a literal "media" prefix (not "/{importID}/media/...") so it cannot
	// structurally overlap the "upload/{uploadID}/status" route above — Go 1.22 would otherwise
	// reject the pair as ambiguous and panic at startup.
	mux.HandleFunc("GET /api/import-anki-package/media/{importID}/{hash}", h.ImportedPackageMedia)
	mux.HandleFunc("/api/media/{hash}", h.MediaBlob)
	mux.HandleFunc("POST /api/auth/change-password", h.ChangePassword)
	mux.HandleFunc("POST /api/auth/delete-account", h.DeleteAccount)
}
