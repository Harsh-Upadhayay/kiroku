# Kiroku Project Handover

## Main Goal

Kiroku is an offline-first Japanese study app for kana practice and imported Anki decks. The product goal is to let a learner study immediately in the browser, keep progress locally even without network access, and later reconcile that progress to a small Go backend so the same account can continue from another browser or device.

The app is intentionally not built around a live server session. The browser is the primary study runtime. The backend is a sync, auth, import, and persistence service.

## Current User-Facing Features

- Kana study for Hiragana and Katakana groups.
- Kana speed sheets with timed typing grids, accuracy, CPM, sound feedback, and a two-grid practice flow.
- Kana SRS review using a simple Leitner-style box model.
- Active kana group selection through the glossary/setup flow.
- Local streak and mastery tracking.
- Anki package import through the Go backend.
- Imported Anki deck review, browsing, basic note creation, filtered decks, media preview, and stats.
- FSRS scheduling for Anki review actions through `ts-fsrs`.
- Account registration/login with online backend auth when available.
- Offline login/register fallback using local browser profile storage.
- Browser-to-browser sync for logged-in users when the backend is reachable.
- PWA app shell caching through `public/sw.js`.

## Tech Stack

Frontend:

- React 19
- Vite
- TypeScript
- Tailwind CSS v4
- `lucide-react` icons
- `motion/react`
- `ts-fsrs` for Anki-style scheduling
- IndexedDB and localStorage for offline persistence

Backend:

- Go 1.22
- Standard `net/http` router
- SQLite through `modernc.org/sqlite`
- bcrypt password hashing
- APKG parsing using zip/sqlite/zstd helpers

Runtime:

- `server.ts` runs the frontend server and proxies `/api` to the Go backend in local development.
- `Dockerfile` builds/runs the frontend server.
- `Dockerfile.api` builds/runs the Go API.
- `docker-compose.yml` deploys both services behind the external `traefik` network for `kiroku.neovara.uk`.

## Key Files

- `src/App.tsx`: main app shell, tab navigation, startup data loading, and background sync scheduling.
- `src/components/AuthCenter.tsx`: login/register UI, online auth calls, and offline auth fallback.
- `src/components/SpeedSheet.tsx`: timed kana grid practice.
- `src/components/SrsQuiz.tsx`: kana SRS quiz flow.
- `src/components/CharDictionary.tsx`: kana glossary and active group setup.
- `src/components/AnkiPage.tsx`: wrapper for the Anki workspace.
- `src/components/AnkiCloneWorkspace.tsx`: imported Anki deck workspace, review, browsing, editing, media, options, and stats.
- `src/utils/db.ts`: IndexedDB stores, user-scoped storage behavior, autosave sync trigger.
- `src/utils/srs.ts`: kana data normalization, Leitner box update rules, local fallback storage.
- `src/utils/sync.ts`: sync document collection, dirty flag tracking, push/pull/reconcile flow.
- `src/utils/anki-v3.ts`: local Anki collection model, import merge, media cache, template rendering, FSRS grading.
- `src/utils/auth.ts`: current user session and local offline profile helpers.
- `backend/cmd/kiroku-api/main.go`: API routes and healthcheck mode.
- `backend/internal/handlers/handlers.go`: auth, sync, health, import, media, and account handlers.
- `backend/internal/sync/sync.go`: server-side merge logic for incoming sync state.
- `backend/internal/anki/anki.go`: APKG import parser and temporary imported media cache.
- `backend/internal/db/db.go`: SQLite initialization and migrations.
- `public/sw.js`: service worker app shell caching and API-cache bypass.

## Data Model and Local Persistence

The browser stores study data first.

IndexedDB database:

- Name: `hiragana_flow_pwa_db`
- Version: `3`
- Stores:
  - `cards`: legacy/default card store keyed by `char`.
  - `review_actions`: review action audit log with auto-increment IDs.
  - `settings`: general persisted state such as active rows, streaks, Anki collection, deleted deck IDs, and local profiles.
  - `anki_media`: imported media blobs keyed by hash.
  - `anki_review_logs`: available store for Anki review logs.

Important settings keys:

- `srs_cards_list`: normalized kana SRS cards for the current logged-in user.
- `active_rows`: selected kana groups.
- `active_rows_info`: timestamp metadata for resolving active row changes.
- `streak_info`: current/highest streak plus update timestamp.
- `anki_v3_collection`: the imported Anki collection JSON model.
- `deleted_deck_ids`: local tombstones for deck deletion behavior.
- `local_registered_users_v1`: offline-only local auth profiles.

localStorage is still used for:

- `current_logged_in_user_v1`: active session identity.
- sync dirty/client/last push/pull markers.
- legacy kana progress fallback and migration compatibility.
- user-prefixed fallback keys for SRS cards, active rows, and streaks.

## Offline First, Sync Later Workflow

The intended workflow is:

1. The user studies in the browser. UI actions update local React state and local browser storage first.
2. Local writes go to IndexedDB and sometimes localStorage fallback keys.
3. `src/utils/db.ts` marks the sync state dirty when a logged-in user changes persisted study data.
4. If the browser is online, a debounced background push attempts to send the latest local state to `/api/sync/push`.
5. If the browser is offline or the backend is unreachable, the app keeps working from local storage and leaves the dirty marker set.
6. On startup/login and every 15 seconds for logged-in users, `reconcileOnStartup(email)` runs.
7. Reconciliation pushes dirty local state first, then pulls the latest backend state.
8. Pull writes remote state back into IndexedDB while suppressing recursive sync triggers, then emits a sync event so mounted views refresh from local storage.

The push-before-pull behavior is important. It prevents offline work from being overwritten by an older backend copy when the user comes back online.

## Sync Payload

The frontend builds one sync document in `src/utils/sync.ts`:

```ts
{
  _meta: {
    schemaVersion,
    clientId,
    generatedAt,
    dirtySince
  },
  srs_cards_list,
  active_rows,
  active_rows_info,
  streak_info,
  anki_v3_collection,
  deleted_deck_ids
}
```

The backend stores this document in SQLite as `user_states.state_json`, keyed by email.

Server-side merge behavior in `backend/internal/sync/sync.go`:

- `_meta`: keeps max schema/generated timestamp and stamps `mergedAt`.
- `active_rows`: last-writer-wins by `active_rows_info.updatedAt`.
- `streak_info`: last-writer-wins by `updatedAt`.
- `deleted_deck_ids`: union of IDs.
- `srs_cards_list`: merged per kana character by `updatedAt`.
- `anki_v3_collection`: currently coarse last-writer-wins by sync document generation time.
- destructive empty pushes are ignored when the server already has substantial SRS or Anki data.

This means kana SRS sync is relatively granular, but Anki collection sync is not. A future agent should be careful before adding multi-device concurrent Anki editing because the current merge is collection-level.

## Auth Behavior

Online auth:

- `/api/auth/register` creates a backend user and default sync document.
- `/api/auth/login` verifies email/password against the backend.
- Passwords are hashed server-side with bcrypt.
- `/api/auth/change-password` and `/api/auth/delete-account` exist on the backend.

Offline fallback:

- If the backend is unreachable, `AuthCenter` can register/login against `local_registered_users_v1` in browser storage.
- The local fallback stores a plain text `passwordHash` field despite the name.
- Treat the offline fallback as convenience-only local profile isolation, not strong authentication.

## Anki Import and Review

Import path:

1. The browser posts the APKG file bytes to `/api/import-anki-package`.
2. The Go backend extracts the Anki collection SQLite file from the package, including compressed `collection.anki21b` / `collection.anki2b` variants.
3. The backend reads decks, deck configs, note types, notes, cards, review logs, and media manifest.
4. The frontend fetches imported media blobs from `/api/import-anki-package/{importID}/media/{hash}`.
5. The frontend stores media blobs in IndexedDB `anki_media`.
6. The frontend merges imported collection data into `anki_v3_collection`.

Review path:

- Anki cards render from note templates in `src/utils/anki-v3.ts`.
- The renderer supports common Anki template constructs such as field tokens, conditionals, cloze, hints, media references, and simple filters.
- HTML is sanitized by stripping script tags, inline event handlers, and `javascript:` URLs.
- Review grading uses FSRS through `ts-fsrs`, writes updated card scheduling state, and appends an Anki review log.

Important limitation:

- The main sync payload includes `anki_v3_collection`, including the media manifest, but not the actual media blob contents from `anki_media`.
- The backend has `/api/media/{hash}` GET/PUT handlers, but the current main frontend import path does not appear to upload cached imported media blobs as part of the sync flow.
- If another device pulls an Anki collection, it may have the card/deck metadata without all media blobs unless media synchronization is completed separately.

## Backend API Summary

Health:

- `GET /healthz`
- `GET /api/healthz`

Auth:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/change-password`
- `POST /api/auth/delete-account`

Sync:

- `POST /api/sync/push`
- `POST /api/sync/pull`

Anki import/media:

- `POST /api/import-anki-package`
- `GET /api/import-anki-package/{importID}/media/{hash}`
- `GET /api/media/{hash}`
- `PUT /api/media/{hash}`

## Local Development

Install dependencies:

```bash
npm install
```

Run the frontend server:

```bash
npm run dev
```

Run the Go API directly:

```bash
cd backend
go run cmd/kiroku-api/main.go
```

Run frontend type checking:

```bash
npm run lint
```

Run backend tests:

```bash
cd backend
go test ./...
```

Build frontend/server bundle:

```bash
npm run build
```

## Deployment Notes

`docker-compose.yml` defines two services:

- `kiroku-api`: Go API on port `8080`, data mounted at `./data:/app/data`.
- `kiroku`: frontend server on port `3000`, depends on a healthy API.

Both services attach to the external `traefik` network and route under `kiroku.neovara.uk`.

The Go API has a dedicated `-healthcheck` mode. Keep this behavior intact because the Docker healthcheck runs:

```bash
/app/kiroku-api -healthcheck
```

The SQLite database lives at:

```text
data/kiroku.db
```

Backups should preserve the `data/` directory.

## Known Risks and Follow-Up Areas

- Anki collection merge is coarse last-writer-wins. This is risky for multi-device concurrent Anki edits.
- Imported Anki media blobs are local-first and not fully integrated into the main sync document.
- Offline fallback auth stores local credentials plainly and should not be treated as secure authentication.
- Some storage paths still preserve legacy names such as `hiragana_*` and `myanki_*`.
- `review_actions` logs offline kana reviews, but sync currently centers on the resulting card state rather than replaying the action log.
- Service worker skips `/api/` caching, which is correct for sync freshness, but app shell caching is minimal.
- Frontend and backend password policies differ: frontend accepts 4+ chars, backend requires 8+ chars.

## Mental Model for the Next Agent

When changing Kiroku, preserve this contract:

- Study interactions must succeed locally first.
- Network availability should improve convergence, not gate studying.
- Dirty local state should push before remote state is pulled.
- Backend state is a synchronization snapshot, not the source of every UI interaction.
- Any new persisted feature should define its IndexedDB/localStorage owner, its sync payload field, and its merge rule before implementation.

