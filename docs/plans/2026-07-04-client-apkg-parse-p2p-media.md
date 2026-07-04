# Plan: Client-side .apkg parsing + P2P media transfer + live sync relay

Date: 2026-07-04 · Status: proposed (rev 2 — adds live progress-sync relay and third-device seeding)

## Goals

1. Parse `.apkg` files entirely in the browser, eliminating the upload → server-parse → download roundtrip (and the chunked-upload/Cloudflare-timeout machinery it exists to serve).
2. Move imported media to a second device **peer-to-peer** (WebRTC DataChannel) as the *primary* path, with the backend content-addressed store as the *fallback*. Backend's only P2P role: signaling (SDP/ICE relay).
3. **Live progress sync**: a review on one device is visible on the other within ~1–2s. Data still flows device → Go (merge) → device — the existing merge logic stays the single source of truth — but the 15s poll is replaced by immediate push + a server-sent-events nudge. The 15s poll remains as the fallback transport.
4. **Third-device seeding**: a fresh device/session gets the user's media from an online peer first (same transfer machinery, roles reversed), cloud as fallback.
5. UI makes the tradeoff visible where it exists (bulk media): "keep both devices online now for the fastest, most reliable transfer," with live progress. Progress sync needs **no** prompt — the relay design has no co-presence requirement (see §5).
6. Backend Go stays minimal, idiomatic, well-commented (it doubles as Go learning material). **No existing backend code is removed** — chunked-upload parse and the 15s poll both stay as fallbacks.

## Non-goals

- True device↔device progress-state merging. That would require porting `backend/internal/sync/sync.go`'s field-merge strategies to TS (a second implementation that *will* drift) and would reintroduce a both-online requirement for the common async case (phone reviews at lunch, laptop opens at night). The relay design in §5 delivers the same UX with one merge implementation and full offline tolerance.
- TURN server. Direct-connection failures fall back to the cloud path by design.
- Media store GC (pre-existing gap, unchanged).
- Auth hardening. Signaling rooms and SSE streams are scoped by email, same trust model as `/api/sync/*` today. Noted in §11.

## Architecture: before → after

**Today:**
```
Import:   A chunk-uploads apkg → server parses → A polls & downloads result → merge → sync push
Progress: A pushes on 15s tick → Go merges → B pulls on its own 15s tick (worst case ~30s lag)
Media:    B lazily fetches /api/media/{hash} (only exists because server parsed the apkg)
```

**After:**
```
Import:   A parses in a Web Worker (zip.js + sql.js + fzstd) → media hashed into IndexedDB
          → collection merged + pushed (unchanged)
          → media transfer: PRIMARY  WebRTC DataChannel to B (Go = signaling only)
                            FALLBACK PUT blobs to /api/media/{hash}
Progress: A pushes immediately after a change (debounced ~1s) → Go merges (logic unchanged)
          → SSE nudge to A's other connected devices → B pulls within ~1–2s
          FALLBACK: the existing 15s poll, kept as the safety net / SSE-unavailable path
Seeding:  new device C pulls canonical state from Go, then requests media P2P from any
          online peer; cloud fills whatever it happens to have as fallback
```

Parse fallback: if the worker throws (old browser, WASM OOM), `importAnkiPackage` transparently falls back to the existing chunked-upload server path.

---

## Part 1 — Client-side .apkg parsing

### 1.1 Dependencies (frontend only)

| dep | why | notes |
|---|---|---|
| `@zip.js/zip.js` | unzip | `BlobReader` gives random access into the `File` without buffering the whole 361 MB archive; entries decompressed on demand |
| `sql.js` | SQLite in WASM | read-only, one-shot; synchronous API is fine inside a worker; `.wasm` asset via Vite `?url` import |
| `fzstd` | zstd decompress | needed for `.anki21b` collections and per-file media compression |
| *(none)* | protobuf | `MediaEntries` is one tiny message (`repeated {name, size, sha1}`); hand-write a ~50-line varint decoder rather than pulling in protobufjs. Port field numbers from `backend/internal/anki/media.go`. |

### 1.2 New files

```
src/utils/apkg/worker.ts    – Web Worker entry: message protocol, progress events
src/utils/apkg/parse.ts     – open archive, pick collection file, run queries → ImportResponse
src/utils/apkg/media.ts     – manifest decode (JSON legacy / protobuf .anki21b),
                              zstd, SHA-256 (crypto.subtle), direct IndexedDB writes
src/utils/apkg/proto.ts     – minimal MediaEntries protobuf reader + test
```

### 1.3 Parsing steps (mirror of `backend/internal/anki/import.go`)

1. Open `File` with `BlobReader`; locate collection entry preferring `collection.anki21b` > `.anki21` > `.anki2` (same precedence as Go).
2. `.anki21b` is zstd-compressed SQLite → decompress fully in memory (the DB is small relative to media), then `new SQL.Database(bytes)`.
3. Port the SQL from `backend/internal/anki/queries.go` and the coercions from `coerce.go` verbatim — decks, deck configs, note types, notes, cards, revlog.
4. Build the exact `ImportResponse` shape from `src/utils/anki-v3.ts:205` (`importId` = client UUID; `AnkiMediaRef.importId` stays unset so `getMediaBlob`'s fallback chain goes IDB → `/api/media/{hash}`).
5. Media pass, one entry at a time (peak memory ≈ largest single file): decode manifest → read from zip → zstd if `.anki21b` → `crypto.subtle.digest("SHA-256")` (hex, identical addressing to the Go store) → content-type sniff (port from `media.go`) → write into the `anki_media` IndexedDB store from inside the worker (avoids postMessage-ing hundreds of MB).
6. Post progress throughout: `{stage: "open"|"collection"|"notes"|"cards"|"revlog"|"media", current, total}`.

### 1.4 Integration & fallback

- `importAnkiPackage()` in `anki-v3.ts`: try worker parse → on **any** worker error, log and fall back to the existing `uploadInit/chunk/complete/status` flow untouched.
- Feature flag `localStorage["myanki:clientParse"]` (default on) to force either path during rollout.
- `mergeImportedCollection` and everything downstream is unchanged — that's the point of ImportResponse parity.

### 1.5 Parity test

- Commit two tiny fixtures: `fixtures/tiny-legacy.apkg` (`.anki2`, JSON manifest) and `fixtures/tiny-modern.apkg` (`.anki21b`, zstd + protobuf manifest), ~5 notes + 2 media files each.
- Go test in `backend/internal/anki` writes golden `ImportResponse` JSON for both; vitest runs the worker parse in Node (sql.js works there) and deep-compares (modulo `importId`).
- Local-only (skipped in CI): parse the 38 MB RRTK and 361 MB Core2k/6k decks; assert counts + spot-check hashes against a server parse.

---

## Part 2 — Backend additions (Go, minimal)

Three independent pieces, all in the existing house style: thin handlers that decode → delegate → map errors, logic in its own `internal/` package, doc comments explaining *why*.

### 2.1 Media upload (completes the cloud-fallback path)

The server no longer parses, so the client must be able to push blobs into the content-addressed store at `{dataDir}/media/{hash}`.

Routes (split the current method-less `/api/media/{hash}` registration):
```go
mux.HandleFunc("GET /api/media/{hash}", h.MediaBlob)      // existing handler; GET also matches HEAD
mux.HandleFunc("PUT /api/media/{hash}", h.MediaUpload)    // new
mux.HandleFunc("POST /api/media/check", h.MediaCheck)     // new: {hashes:[...]} → {missing:[...]}
```

`MediaUpload` (`internal/handlers/media_upload.go`):
- `os.Stat` first — hash already present → 200, done (content-addressed).
- `http.MaxBytesReader` (100 MB/blob) → stream body through `io.TeeReader` into `sha256.New()` and a temp file → compare computed hash to the path param → `os.Rename` into place (atomic) → 201. Mismatch → 400 + remove temp.
- `MediaCheck` so an 8k-file client sends one POST, not 8k HEADs. Doubles as the cloud-side "want list" for both fallback upload and seeding.

*Go notes for comments:* streaming hash via `io.TeeReader` (never buffer the body), temp-file+rename atomicity, `http.MaxBytesReader` as the idiomatic size guard, sentinel-error → status mapping per the existing `writeUploadError` pattern.

### 2.2 Signaling: `backend/internal/signal`

In-memory mailbox; short-polling (1s, handshake-only — seconds of traffic), no WebSockets.

```go
type Message struct {
    From    string          `json:"from"`    // client-generated device id
    Seq     int             `json:"seq"`     // per-room monotonic, assigned under the lock
    Kind    string          `json:"kind"`    // "offer" | "answer" | "ice" | "bye" | "provider-hello"
    Payload json.RawMessage `json:"payload"` // opaque — SDP/ICE pass through untouched
}

// Room meta carries Mode: "push" (import: source offers media to whoever joins)
// or "pull" (seeding: a new device requests media from whoever has it).
type Registry struct {
    mu    sync.Mutex // plain Mutex: ops are map+slice touches, RWMutex would be noise
    rooms map[string]*Room
    ttl   time.Duration
}

func NewRegistry(ttl time.Duration) *Registry
func (r *Registry) Create(email string, meta RoomMeta) *Room
func (r *Registry) OpenRooms(email string) []RoomMeta                 // discovery for both modes
func (r *Registry) Append(roomID string, m Message) (int, error)
func (r *Registry) After(roomID, from string, since int) ([]Message, error)
func (r *Registry) Close(roomID string)
func (r *Registry) Run(ctx context.Context)                           // TTL janitor, exits on ctx.Done()
```

Routes + thin handlers (`internal/handlers/p2p.go`):
```go
mux.HandleFunc("POST   /api/p2p/rooms", h.P2PCreateRoom)   // {email, mode, deckName?, mediaCount, totalBytes} → {roomId}
mux.HandleFunc("GET    /api/p2p/rooms", h.P2PListRooms)    // ?email= → open rooms (polled on the sync tick)
mux.HandleFunc("POST   /api/p2p/rooms/{roomID}/messages", h.P2PPostMessage)
mux.HandleFunc("GET    /api/p2p/rooms/{roomID}/messages", h.P2PGetMessages) // ?from=&since=
mux.HandleFunc("DELETE /api/p2p/rooms/{roomID}", h.P2PCloseRoom)
```

Wiring: one `*signal.Registry` on `Handler`, `go registry.Run(ctx)` in `main()` on the server's shutdown context.

*Go notes for comments:* mutex-guarded map as the default concurrency tool (channels would be over-engineering), janitor lifecycle via `context`, `json.RawMessage` pass-through, why seq assignment must sit under the lock, sentinel `ErrRoomNotFound` → 404.

### 2.3 Sync event hub: `backend/internal/events` (powers live progress sync, §5)

A fan-out of "state changed" pokes to a user's connected devices, delivered over **SSE** — plain HTTP, ~40 lines of handler, no dependencies, and `EventSource` on the client reconnects automatically.

```go
// Hub fans out "your state changed" pokes to a user's connected devices. Events
// carry no state — just the origin device id and a timestamp — so a lost event
// costs nothing: the receiver's next poll (the permanent safety net) catches up.
type Event struct {
    Origin string `json:"origin"` // device id that pushed, so it can ignore its own echo
    At     int64  `json:"at"`
}

type Hub struct {
    mu   sync.Mutex
    subs map[string]map[chan Event]struct{} // email → subscriber set
}

func (h *Hub) Subscribe(email string) (<-chan Event, func())  // returns cancel; caller defers it
func (h *Hub) Publish(email string, e Event)                  // non-blocking send: a slow
                                                              // subscriber misses the poke, and
                                                              // that's fine — polling covers it
```

Handler `GET /api/sync/events?email=&device=`:
- Set `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`; grab `http.Flusher`.
- Loop: `select` on subscriber channel / heartbeat `time.Ticker` (~25s, keeps Cloudflare's ~100s idle timeout at bay) / `r.Context().Done()`.
- `SyncPush` publishes to the hub after a successful merge — one added line in the existing handler.

*Go notes for comments:* non-blocking channel send with `select`+`default` and why dropping is correct here, `http.Flusher` and why SSE needs it, tying connection lifetime to `r.Context()`, `defer cancel()` for subscriber cleanup.

---

## Part 3 — P2P media transfer (frontend)

### 3.1 New files

```
src/utils/p2p/signaling.ts – REST client for §2.2; 1s poll during handshake only
src/utils/p2p/peer.ts      – ~120-line RTCPeerConnection wrapper (no simple-peer dep):
                             trickle ICE via the mailbox, STUN = stun.l.google.com:19302 (+1 backup),
                             connect timeout, clean close
src/utils/p2p/transfer.ts  – DataChannel protocol; takes a role ("send" | "receive") so the same
                             code serves import-push (§3) and seeding-pull (§6)
```

### 3.2 Discovery

- Import (push mode): Device A creates a `mode:"push"` room after parsing; polls it.
- Device B discovers rooms via `GET /api/p2p/rooms?email=` **on the existing 15s sync tick** in `src/utils/sync.ts` — no new polling loop. Rooms are in-memory with short TTL, so stale offers vanish on their own.
- Worst-case discovery ≈ 15s; UI frames it as "waiting for your other device…". (Cheap later upgrade: 3s poll only while a transfer panel is open.)

### 3.3 DataChannel protocol (reliable/ordered, default config)

```
sender → {t:"manifest", files:[{hash,size,fileName,contentType}]}
recv   → {t:"want", hashes:[...]}                  // diffed against its anki_media IDB store;
                                                   // chunked as {t:"want-part", i, n, hashes} if large
sender → per wanted file:
           {t:"file", hash, size}
           <binary chunks, 64 KiB>                 // pause while dc.bufferedAmount > 8 MiB,
                                                   // resume on bufferedamountlow (threshold 1 MiB)
           {t:"file-end", hash}
recv   → {t:"ack", hash}                           // after SHA-256 verify + IDB write; drives progress
sender → {t:"done"} → both sides DELETE the room and close
```

- Receiver re-hashes every blob before storing; corrupt/truncated files are re-requested, never persisted.
- Reconnect/resume is free: a fresh `want` diff excludes whatever already landed in IDB.

### 3.4 Import-source state machine (drives the UI in §7)

```
parsing → announcing ──peer joined──→ connecting ──dc open──→ transferring → done
             │                            │ 20s ICE timeout        │ peer lost
             │ user clicks "use cloud"    ▼                        ▼
             └──────────────────────→ cloud-fallback ──→ uploading → done
```

- `announcing` has no hard timeout; after ~60s the UI promotes the "Upload to cloud instead" button.
- `cloud-fallback`: `POST /api/media/check` → `PUT /api/media/{hash}` for missing blobs, concurrency 3, per-file retry, resumable by construction. Also used to top up a partial P2P transfer (un-acked remainder only).
- Full P2P success uploads **nothing** to the backend (cloud is fallback only). `myanki:cloudBackfill` flag (default off) exists if third-device durability ever becomes a complaint — though §6 seeding is the intended answer.

---

## Part 4 — (Reserved: merged into Part 3 in rev 2.)

## Part 5 — Live progress sync (device → Go merge → device, streaming)

**Design decision:** progress state (SRS cards, revlogs, streaks, N5 progress) keeps flowing *through* Go, because that's where the field-merge logic lives and must stay single-sourced. This is not device↔device P2P — the win over today is latency, not topology. Crucially, because Go durably stores the merged state as it relays, there is **no co-presence requirement**: an offline device simply catches up on next connect. So the UI never needs a "keep your other device online" prompt for progress — only bulk media (Parts 3/6) needs that.

Client changes (`src/utils/sync.ts`):
1. **Immediate push**: extend the existing on-demand triggers so every local mutation (review commit, deck edit, settings change) schedules a push debounced ~1s. The 15s tick remains as the catch-all.
2. **Live pull**: open an `EventSource` on `/api/sync/events?email=&device=`. On an event whose `origin` isn't this device → pull immediately. On EventSource `open` (incl. auto-reconnect) → pull once to catch anything missed while disconnected.
3. **Fallback = the current way**: if SSE errors persistently (old browser, hostile proxy), nothing breaks — the 15s poll is still running. When SSE is healthy, the poll interval can stretch to 60s to cut idle traffic.

End-to-end latency: review on phone → ~1s debounce → push+merge → SSE poke → laptop pulls: **~1–2s**, vs up to ~30s today. Events are content-free pokes, so ordering/loss are non-issues — the pull always fetches the canonical merged state.

## Part 6 — Third-device seeding (new device gets everything, P2P-first)

Two kinds of data, deliberately treated differently:

- **Progress/collection state**: pulled from Go on login — *not* P2P. The cloud copy is the canonical merged result of every device's pushes; any single peer's local state may be behind it, and it's a few hundred KB at most. Fetching it P2P-first would risk seeding stale state for zero bandwidth win. (This is the one place "P2P-first" is intentionally not applied.)
- **Media** (the actual bulk): P2P-first via the same machinery as import transfer, roles reversed.

Flow on a fresh device C:
1. Login → sync pull → collection renders (cards work, media placeholders pending).
2. C diffs `mediaManifest` hashes against its (empty) `anki_media` store → creates a `mode:"pull"` room: "I need 3,940 files / 610 MB".
3. Any online device with the app open sees the room on its sync tick and auto-responds (setting "Automatically share media between my devices", default on — same account on both ends; a toast shows "Sending 610 MB to your new device…"). First `provider-hello` wins; C ignores later ones.
4. Transfer runs per §3.3 with C sending the `want` list. Resume-by-diff if interrupted.
5. **Cloud fallback**: if no provider appears within ~30s, C calls `POST /api/media/check` and fetches whatever the cloud has (concurrency 4) — which may be everything (past fallback uploads) or nothing (P2P-only history). The pull room stays open while the app is open, so a provider coming online later tops up the remainder. Cards with still-missing media keep the existing lazy-fetch placeholder behavior.

## Part 7 — UI

### 7.1 Import flow, source device (`AnkiCloneWorkspace.tsx`)

1. **Parse step** (replaces upload progress): stage-by-stage from the worker — "Reading archive… / 4,213 notes / 8,011 cards / media 512 / 3,940".
2. **Transfer step** — new `MediaTransferPanel.tsx`:
   - Header: **"Send this deck's media to your other devices"**
   - Explainer: *"Direct device-to-device transfer is the fastest and most reliable way to move media. Open myAnki on your other device now and keep both devices online until the transfer finishes."*
   - Status mapped 1:1 to §3.4: `Waiting for your other device…` → `Connecting…` → `Transferring — 1,204 / 3,940 files · 212 MB / 610 MB · 4.1 MB/s` → `Done ✓`
   - Fallbacks: secondary "Upload to cloud instead" (promoted after ~60s); on P2P failure an inline *"Couldn't connect directly — uploading to the cloud instead"* with its own progress bar.
   - Dismissible; continues in background with a compact persistent pill.

### 7.2 Receiving device — `ReceiveTransferBanner.tsx`

App-wide banner when the tick poll finds a push room: *"『Core 2k/6k』 is being imported on your other device — receive 610 MB of media now?"* → [Receive] [Later]; progress bar; success: "Media received — fully available offline."

### 7.3 New-device seeding — `SeedMediaPanel.tsx`

After first pull, if missing media > 0: *"Get your media: open myAnki on a device that has your decks — direct transfer is fastest. We'll also fetch what's available from the cloud."* Live counts: `2,101 / 3,940 files · from your other device`, cloud-fetched count shown separately; a quiet "still waiting for a device with 412 files" residual state.

### 7.4 Progress sync

**No prompt, by design** (§5). Optional nicety: a subtle "synced just now" indicator flip when an SSE-triggered pull lands.

## Part 8 — Testing

| layer | what |
|---|---|
| TS unit | protobuf reader, manifest decode (both formats), hash hex parity, transfer framing with a mock DataChannel pair, want-diff logic |
| TS golden | worker parse of both fixtures vs Go-emitted goldens (§1.5) |
| Go unit | signal registry (create/append/after/TTL expiry), media upload table tests, events.Hub (subscribe/publish/slow-subscriber drop), SSE handler with `httptest` + context cancel, route-registration consistency |
| E2E (Playwright, two browser contexts) | (a) A imports fixture → B banner → real loopback WebRTC → B renders card with media; (b) B never accepts → A falls back → PUT lands → B lazy-fetches; (c) review a card in A → B's due count updates within ~3s (SSE path); (d) fresh context C → seeding pulls media from A |
| Manual | 361 MB deck on desktop; RRTK on mid-range Android; UDP-blocked network to prove media fallback; SSE behind the real Cloudflare setup (heartbeat/idle) |

## Part 9 — PR breakdown (issue → branch → PR "Closes #N" → merge)

| PR | scope | size | depends on |
|---|---|---|---|
| 1 | `feat(anki): parse .apkg client-side in a worker` — Part 1, flag default-on, auto server fallback, fixtures + goldens | L | — |
| 2 | `feat(media): client blob upload to content-addressed store` — §2.1 + tests | S | — |
| 3 | `feat(anki): cloud media upload after client-side import` — fallback path wired as the (temporary) only path; roundtrip elimination fully shipped here | M | 1, 2 |
| 4 | `feat(sync): live sync via SSE nudge + immediate push` — §2.3 + §5; fully independent of P2P, can land any time | M | — |
| 5 | `feat(p2p): signaling registry and routes` — §2.2 + tests | M | — |
| 6 | `feat(p2p): direct media transfer over WebRTC` — Part 3 behind `myanki:p2p` flag | L | 3, 5 |
| 7 | `feat(ui): transfer panel, receive banner, P2P as primary` — §7.1–7.2, flag removed | M | 6 |
| 8 | `feat(p2p): seed media to new devices` — Part 6 + §7.3 (reuses 5+6 machinery) | M | 7 |
| 9 (opt) | counters (p2p success rate, parse-fallback rate, SSE uptime), docs | S | — |

Suggested order: 1 → 2 → 3 ships the roundtrip win early; 4 is independent and high-value (can even go first); 5 → 6 → 7 → 8 layer P2P on top.

## Part 10 — Risks & mitigations

- **WASM memory on mobile Safari** (~1–1.5 GB): media streamed entry-by-entry, only the SQLite DB fully resident; worker OOM → automatic legacy server-parse fallback.
- **sql.js needs the whole DB in memory**: accepted; escape hatch is wa-sqlite + OPFS later, confined to `parse.ts`.
- **Symmetric NAT / UDP-blocked networks**: by design → cloud fallback, surfaced honestly in the UI.
- **iOS backgrounding kills a transfer**: resume is inherent (`want` re-diff); copy says keep the app open.
- **SSE through Cloudflare**: idle timeout handled by the 25s heartbeat; if a proxy buffers anyway, `EventSource` errors and the poll fallback silently carries on. Browsers cap HTTP/1 connections per origin (~6) — one SSE stream is fine.
- **Missed SSE events**: impossible to lose data — events are pokes, state comes from the pull, and the poll safety net plus pull-on-reconnect cover gaps.
- **Zip64 / >4 GB apkgs**: zip.js supports zip64; parse fallback covers pathological cases.

## Part 11 — Known limitations (explicit, accepted)

1. **Security**: signaling rooms and the SSE stream are scoped by bare email, matching the existing `/api/sync/*` trust model. Real fix is session auth across the whole API — separate effort.
2. **Durability**: after P2P-only media transfers, the cloud may hold no media copy. Mitigated (not eliminated) by §6 seeding — a new device can pull from any online peer; if no peer ever comes online again, media is gone. `cloudBackfill` flag is the opt-in insurance.
3. **Media store GC**: still absent; fallback uploads add to an unbounded store. Pre-existing, unchanged.
