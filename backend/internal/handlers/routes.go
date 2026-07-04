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
	mux.HandleFunc("GET /api/sync/events", h.SyncEvents)
	mux.HandleFunc("POST /api/import-anki-package/upload/init", h.UploadInit)
	mux.HandleFunc("PUT /api/import-anki-package/upload/{uploadID}/chunk/{index}", h.UploadChunk)
	mux.HandleFunc("POST /api/import-anki-package/upload/{uploadID}/complete", h.UploadComplete)
	mux.HandleFunc("GET /api/import-anki-package/upload/{uploadID}/status", h.UploadStatus)
	mux.HandleFunc("POST /api/vocab/import-image", h.ImportVocabImage)
	// Media route lives under a literal "media" prefix (not "/{importID}/media/...") so it cannot
	// structurally overlap the "upload/{uploadID}/status" route above — Go 1.22 would otherwise
	// reject the pair as ambiguous and panic at startup.
	mux.HandleFunc("GET /api/import-anki-package/media/{importID}/{hash}", h.ImportedPackageMedia)
	// Media blob routes are method-specific so the mux does the dispatch a hand-rolled switch
	// used to do (see media.go). The "GET" pattern also matches HEAD, giving cheap existence
	// probes for free. "check" is a literal segment on a different method, so it can never
	// collide with the {hash} wildcard — and a stray GET /api/media/check just fails hash
	// validation.
	mux.HandleFunc("GET /api/media/{hash}", h.GetMediaBlob)
	mux.HandleFunc("PUT /api/media/{hash}", h.PutMediaBlob)
	mux.HandleFunc("POST /api/media/check", h.MediaCheck)
	mux.HandleFunc("POST /api/auth/change-password", h.ChangePassword)
	mux.HandleFunc("POST /api/auth/delete-account", h.DeleteAccount)
}
