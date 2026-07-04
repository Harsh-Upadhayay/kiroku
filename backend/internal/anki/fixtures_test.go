package anki

import (
	"archive/zip"
	"bytes"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// This file builds the committed parser-parity fixtures under fixtures/anki/ and guards the
// Go parser against drifting from their golden outputs. The same fixtures + goldens are
// consumed by the TypeScript parser's tests (src/tests/apkg-parse.test.ts), which is the whole
// point: one source of truth that both implementations must reproduce, field for field.
//
// Regenerate after intentionally changing the parser's output shape:
//
//	KIROKU_GEN_FIXTURES=1 go test ./internal/anki -run TestGenerateFixtures
//
// then commit the updated files under fixtures/anki/.

// fixturesDir is the repo-root fixtures directory, relative to this package.
var fixturesDir = filepath.Join("..", "..", "..", "fixtures", "anki")

// fixtureMedia returns the two media blobs every fixture carries. The PNG is a real 1x1
// transparent image so content sniffing stays sensible; the MP3 is fake bytes — only its
// hash matters to the parser.
func fixtureMedia() (mp3 []byte, png []byte) {
	mp3 = []byte("ID3fixture-audio-bytes-not-a-real-mp3")
	png = []byte{
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
		0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
		0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
		0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
		0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
	}
	return mp3, png
}

// fixtureCollectionDB writes the fixture SQLite collection to path. The data is small but
// deliberately covers the parser's edge paths: nested decks, a note on an unknown model
// (unnamed fields), digits-only fields (preview heuristic yields empty), HTML + entities in
// fields, an out-of-range card ordinal, and a card in a filtered deck (odid set).
func fixtureCollectionDB(t *testing.T, path string) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open fixture db: %v", err)
	}
	defer db.Close()

	const schema = `
CREATE TABLE col (decks TEXT, dconf TEXT, models TEXT);
CREATE TABLE notes (id INTEGER PRIMARY KEY, guid TEXT, mid INTEGER, mod INTEGER, usn INTEGER, tags TEXT, flds TEXT, sfld TEXT);
CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER, ord INTEGER, mod INTEGER, usn INTEGER, type INTEGER, queue INTEGER, due INTEGER, ivl INTEGER, factor INTEGER, reps INTEGER, lapses INTEGER, left INTEGER, odid INTEGER, flags INTEGER, data TEXT);
CREATE TABLE revlog (id INTEGER PRIMARY KEY, cid INTEGER, usn INTEGER, ease INTEGER, ivl INTEGER, lastIvl INTEGER, factor INTEGER, time INTEGER, type INTEGER);`
	if _, err := db.Exec(schema); err != nil {
		t.Fatalf("create fixture schema: %v", err)
	}

	const decks = `{
		"1": {"name": "Default", "conf": 1, "desc": "", "dyn": 0, "mod": 0, "usn": 0},
		"1700000000101": {"name": "Kiroku Test Deck", "conf": 1, "desc": "Fixture deck for parser parity tests", "dyn": 0, "mod": 1700000100, "usn": -1},
		"1700000000102": {"name": "Kiroku Test Deck::Child", "conf": 1, "desc": "", "dyn": 0, "mod": 1700000200, "usn": -1}
	}`
	const dconf = `{"1": {"id": 1, "name": "Default", "new": {"perDay": 20}, "rev": {"perDay": 200}}}`
	const models = `{
		"1700000000001": {
			"id": 1700000000001, "name": "Kiroku Basic", "type": 0,
			"css": ".card { font-family: sans-serif; }",
			"latexPre": "\\documentclass{article}", "latexPost": "\\end{document}",
			"flds": [
				{"name": "Expression", "ord": 0, "sticky": false, "rtl": false, "font": "Arial", "size": 20, "description": "the word"},
				{"name": "Meaning", "ord": 1, "sticky": false, "rtl": false, "font": "Arial", "size": 20},
				{"name": "Reading", "ord": 2, "sticky": true, "rtl": false, "font": "Arial", "size": 16}
			],
			"tmpls": [
				{"name": "Card 1", "ord": 0, "qfmt": "{{Expression}}<br>{{#Reading}}({{Reading}}){{/Reading}}", "afmt": "{{FrontSide}}<hr id=answer>{{Meaning}} [sound:clip.mp3]", "did": null},
				{"name": "Card 2", "ord": 1, "qfmt": "{{^Meaning}}no meaning{{/Meaning}}{{Meaning}}", "afmt": "{{Expression}}"}
			]
		},
		"1700000000002": {"id": 1700000000002, "name": "Empty Model", "type": 1}
	}`
	if _, err := db.Exec(`INSERT INTO col (decks, dconf, models) VALUES (?, ?, ?)`, decks, dconf, models); err != nil {
		t.Fatalf("insert col row: %v", err)
	}

	// \x1f is Anki's field separator within flds.
	notes := [][]any{
		{1700000000201, "abc001", 1700000000001, 1700000300, -1, " japanese verb ", "食べる\x1fto eat\x1fたべる", "食べる"},
		{1700000000202, "abc002", 1700000000001, 1700000301, -1, "", "水&amp;<b>氷</b>\x1fwater &amp; ice\x1f", "水&氷"},
		{1700000000203, "abc003", 9999, 1700000302, -1, "misc", "solo field only", "solo field only"},
		{1700000000204, "abc004", 1700000000001, 1700000303, -1, "", "12345\x1f67890\x1f", "12345"},
	}
	for _, n := range notes {
		if _, err := db.Exec(`INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld) VALUES (?,?,?,?,?,?,?,?)`, n...); err != nil {
			t.Fatalf("insert note: %v", err)
		}
	}

	cards := [][]any{
		{1700000000301, 1700000000201, 1700000000101, 0, 1700000400, -1, 2, 2, 100, 15, 2500, 4, 1, 0, 0, 0, "{}"},
		{1700000000302, 1700000000201, 1700000000101, 1, 1700000401, -1, 0, 0, 201, 0, 0, 0, 0, 0, 0, 0, ""},
		{1700000000303, 1700000000202, 1700000000102, 0, 1700000402, -1, 1, 1, 0, 0, 0, 1, 0, 1001, 0, 0, ""},
		{1700000000304, 1700000000203, 1, 0, 1700000403, -1, 0, 0, 203, 0, 0, 0, 0, 0, 0, 0, ""},
		{1700000000305, 1700000000204, 1700000000101, 5, 1700000404, -1, 0, 0, 204, 0, 0, 0, 0, 0, 0, 0, ""},
		{1700000000306, 1700000000202, 1700000000101, 1, 1700000405, -1, 2, 2, 150, 30, 2100, 10, 2, 0, 1700000000102, 2, `{"pos":1}`},
	}
	for _, c := range cards {
		if _, err := db.Exec(`INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odid, flags, data) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, c...); err != nil {
			t.Fatalf("insert card: %v", err)
		}
	}

	revlogs := [][]any{
		{1700000000401, 1700000000301, -1, 3, 15, 7, 2500, 5400, 1},
		{1700000000402, 1700000000301, -1, 4, 30, 15, 2500, 3200, 1},
		{1700000000403, 1700000000306, -1, 1, -60, 30, 2100, 8000, 0},
	}
	for _, r := range revlogs {
		if _, err := db.Exec(`INSERT INTO revlog (id, cid, usn, ease, ivl, lastIvl, factor, time, type) VALUES (?,?,?,?,?,?,?,?,?)`, r...); err != nil {
			t.Fatalf("insert revlog: %v", err)
		}
	}
}

// encodeMediaEntries builds the MediaEntries protobuf message used by ".anki21b" packages,
// reusing media_test.go's proto helpers. Unlike mediaEntriesProto it also writes the size
// (field 2, varint) and a dummy sha1 (field 3, bytes) so the parser's field-skipping paths
// get exercised, not just the name field it actually reads.
func encodeMediaEntries(names []string, sizes []int) []byte {
	var out []byte
	for i, name := range names {
		entry := protoString(1, name)                 // MediaEntry.name = 1
		entry = append(entry, protoVarint(2<<3|0)...) // MediaEntry.size = 2, varint
		entry = append(entry, protoVarint(uint64(sizes[i]))...)
		entry = append(entry, protoVarint(3<<3|2)...) // MediaEntry.sha1 = 3, bytes
		entry = append(entry, protoVarint(20)...)
		entry = append(entry, bytes.Repeat([]byte{0xab}, 20)...)

		out = append(out, protoVarint(1<<3|2)...) // MediaEntries.entries = 1
		out = append(out, protoVarint(uint64(len(entry)))...)
		out = append(out, entry...)
	}
	return out
}

// writeFixtureZip assembles an .apkg (a plain ZIP) from name→content pairs, preserving order.
func writeFixtureZip(t *testing.T, path string, files [][2][]byte) {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, f := range files {
		w, err := zw.Create(string(f[0]))
		if err != nil {
			t.Fatalf("zip create %s: %v", f[0], err)
		}
		if _, err := w.Write(f[1]); err != nil {
			t.Fatalf("zip write %s: %v", f[0], err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("zip close: %v", err)
	}
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

// normalizeResult zeroes the per-run values (uuid, wall clock) so results compare across runs
// and across implementations. The TS test applies the identical normalization.
func normalizeResult(r *ImportResult) {
	r.ImportID = "IMPORT_ID"
	r.Collection.ID = "collection-IMPORT_ID"
	r.Collection.CreatedAt = 0
}

// TestGenerateFixtures rebuilds the committed fixtures and goldens. Guarded by an env var so
// a normal test run never rewrites repo files; see the file header for the invocation.
func TestGenerateFixtures(t *testing.T) {
	if os.Getenv("KIROKU_GEN_FIXTURES") == "" {
		t.Skip("set KIROKU_GEN_FIXTURES=1 to regenerate fixtures and goldens")
	}
	if err := os.MkdirAll(fixturesDir, 0o755); err != nil {
		t.Fatalf("mkdir fixtures: %v", err)
	}

	dbPath := filepath.Join(t.TempDir(), "collection.sqlite")
	fixtureCollectionDB(t, dbPath)
	dbBytes, err := os.ReadFile(dbPath)
	if err != nil {
		t.Fatalf("read fixture db: %v", err)
	}
	mp3, png := fixtureMedia()

	// Legacy layout: plain SQLite, JSON manifest, uncompressed blobs.
	legacyManifest := []byte(`{"0": "clip.mp3", "1": "pic.png"}`)
	writeFixtureZip(t, filepath.Join(fixturesDir, "tiny-legacy.apkg"), [][2][]byte{
		{[]byte("collection.anki2"), dbBytes},
		{[]byte("media"), legacyManifest},
		{[]byte("0"), mp3},
		{[]byte("1"), png},
	})

	// Modern layout (Anki 2.1.50+): everything zstd-compressed, protobuf manifest whose Nth
	// entry maps to the zip file named "N".
	modernManifest := zstdCompress(t, encodeMediaEntries(
		[]string{"clip.mp3", "pic.png"}, []int{len(mp3), len(png)},
	))
	writeFixtureZip(t, filepath.Join(fixturesDir, "tiny-modern.apkg"), [][2][]byte{
		{[]byte("collection.anki21b"), zstdCompress(t, dbBytes)},
		{[]byte("media"), modernManifest},
		{[]byte("0"), zstdCompress(t, mp3)},
		{[]byte("1"), zstdCompress(t, png)},
	})

	for _, name := range []string{"tiny-legacy", "tiny-modern"} {
		result, err := ImportPackageFile(filepath.Join(fixturesDir, name+".apkg"))
		if err != nil {
			t.Fatalf("parse generated fixture %s: %v", name, err)
		}
		normalizeResult(result)
		golden, err := json.MarshalIndent(result, "", "  ")
		if err != nil {
			t.Fatalf("marshal golden %s: %v", name, err)
		}
		golden = append(golden, '\n')
		if err := os.WriteFile(filepath.Join(fixturesDir, name+".golden.json"), golden, 0o644); err != nil {
			t.Fatalf("write golden %s: %v", name, err)
		}
	}
}

// TestFixturesMatchGoldens re-parses the committed fixtures and byte-compares the normalized
// output against the goldens. Failing here means the parser's output shape changed: either fix
// the regression, or regenerate the fixtures (see file header) if the change is intentional —
// and expect the TypeScript parser's parity test to need the same treatment.
func TestFixturesMatchGoldens(t *testing.T) {
	for _, name := range []string{"tiny-legacy", "tiny-modern"} {
		t.Run(name, func(t *testing.T) {
			apkg := filepath.Join(fixturesDir, name+".apkg")
			if _, err := os.Stat(apkg); os.IsNotExist(err) {
				t.Skipf("fixture not present: %s (run TestGenerateFixtures)", apkg)
			}
			result, err := ImportPackageFile(apkg)
			if err != nil {
				t.Fatalf("parse fixture: %v", err)
			}
			normalizeResult(result)
			got, err := json.MarshalIndent(result, "", "  ")
			if err != nil {
				t.Fatalf("marshal result: %v", err)
			}
			got = append(got, '\n')
			want, err := os.ReadFile(filepath.Join(fixturesDir, name+".golden.json"))
			if err != nil {
				t.Fatalf("read golden: %v", err)
			}
			if !bytes.Equal(got, want) {
				t.Fatalf("parsed output diverged from golden %s.golden.json\ngot:\n%s", name, got)
			}
		})
	}
}
