package anki

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"testing"

	"github.com/klauspost/compress/zstd"
)

// protoString encodes a length-delimited (wire type 2) string field with the given number.
func protoString(fieldNum int, value string) []byte {
	out := protoVarint(uint64(fieldNum)<<3 | 2)
	out = append(out, protoVarint(uint64(len(value)))...)
	return append(out, value...)
}

func protoVarint(v uint64) []byte {
	buf := make([]byte, binary.MaxVarintLen64)
	n := binary.PutUvarint(buf, v)
	return buf[:n]
}

// mediaEntriesProto builds a MediaEntries protobuf message from ordered file names.
func mediaEntriesProto(names ...string) []byte {
	var out []byte
	for _, name := range names {
		entry := protoString(1, name)             // MediaEntry.name = 1
		out = append(out, protoVarint(1<<3|2)...) // MediaEntries.entries = 1
		out = append(out, protoVarint(uint64(len(entry)))...)
		out = append(out, entry...)
	}
	return out
}

func zstdCompress(t *testing.T, raw []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	enc, err := zstd.NewWriter(&buf)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := enc.Write(raw); err != nil {
		t.Fatal(err)
	}
	if err := enc.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestParseMediaManifestLegacyJSON(t *testing.T) {
	raw := []byte(`{"0":"hello.mp3","1":"world.png"}`)
	entries, err := parseMediaManifest(raw, false)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, e := range entries {
		got[e.entryName] = e.fileName
	}
	if got["0"] != "hello.mp3" || got["1"] != "world.png" {
		t.Fatalf("unexpected entries: %#v", got)
	}
}

func TestParseMediaManifestProtobuf(t *testing.T) {
	raw := mediaEntriesProto("first.mp3", "second.png", "third.webp")
	entries, err := parseMediaManifest(raw, true)
	if err != nil {
		t.Fatal(err)
	}
	want := []mediaEntry{
		{entryName: "0", fileName: "first.mp3"},
		{entryName: "1", fileName: "second.png"},
		{entryName: "2", fileName: "third.webp"},
	}
	if len(entries) != len(want) {
		t.Fatalf("got %d entries, want %d", len(entries), len(want))
	}
	for i, e := range entries {
		if e != want[i] {
			t.Fatalf("entry %d = %#v, want %#v", i, e, want[i])
		}
	}
}

// A newer package may zstd-compress the manifest itself; parseMediaManifest must still decode it.
func TestParseMediaManifestProtobufZstd(t *testing.T) {
	raw := zstdCompress(t, mediaEntriesProto("audio.mp3"))
	entries, err := parseMediaManifest(raw, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].fileName != "audio.mp3" || entries[0].entryName != "0" {
		t.Fatalf("unexpected entries: %#v", entries)
	}
}

func TestMaybeDecompressZstd(t *testing.T) {
	original := []byte("the quick brown fox jumps over the lazy dog")
	if got := maybeDecompressZstd(zstdCompress(t, original)); !bytes.Equal(got, original) {
		t.Fatalf("decompressed = %q, want %q", got, original)
	}
	// Plain (non-zstd) bytes must pass through untouched.
	plain := []byte("not compressed")
	if got := maybeDecompressZstd(plain); !bytes.Equal(got, plain) {
		t.Fatalf("plain bytes changed: %q", got)
	}
}

// readMedia must decode a newer-format archive end to end: protobuf manifest plus
// zstd-compressed blobs, hashing the decompressed contents.
func TestReadMediaNewFormat(t *testing.T) {
	audio := []byte("ID3 fake mp3 payload")
	image := []byte("\x89PNG fake png payload")

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	write := func(name string, data []byte) {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	write("media", mediaEntriesProto("clip.mp3", "pic.png"))
	write("0", zstdCompress(t, audio))
	write("1", zstdCompress(t, image))
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}

	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatal(err)
	}
	manifest, cache, warnings := readMedia(zr, true)
	if len(warnings) != 0 {
		t.Fatalf("unexpected warnings: %v", warnings)
	}
	if len(manifest) != 2 {
		t.Fatalf("manifest len = %d, want 2", len(manifest))
	}
	// Manifest is sorted by file name: clip.mp3 then pic.png.
	if manifest[0].FileName != "clip.mp3" || manifest[1].FileName != "pic.png" {
		t.Fatalf("unexpected manifest order: %s, %s", manifest[0].FileName, manifest[1].FileName)
	}
	// Cached bytes must be the decompressed payloads.
	if got := cache[manifest[0].Hash].bytes; !bytes.Equal(got, audio) {
		t.Fatalf("clip.mp3 cached bytes = %q, want %q", got, audio)
	}
	if got := cache[manifest[1].Hash].bytes; !bytes.Equal(got, image) {
		t.Fatalf("pic.png cached bytes = %q, want %q", got, image)
	}
}

// TestEvictImportedMedia covers the memory-reclaiming eviction that backs importedMediaTTL:
// a cached import is served until evicted, after which lookups miss. (The TTL itself is wired
// via time.AfterFunc in cacheImportedMedia; here we exercise the eviction directly.)
func TestEvictImportedMedia(t *testing.T) {
	const importID = "import-evict-test"
	const hash = "abc123"
	importMediaCache.Lock()
	importMediaCache.items[importID] = map[string]cachedMedia{
		hash: {fileName: "a.png", contentType: "image/png", bytes: []byte("x")},
	}
	importMediaCache.Unlock()

	if _, _, _, ok := ImportedMedia(importID, hash); !ok {
		t.Fatal("expected cached media to be served before eviction")
	}

	evictImportedMedia(importID)

	if _, _, _, ok := ImportedMedia(importID, hash); ok {
		t.Fatal("expected media lookup to miss after eviction")
	}
	// Evicting an unknown id must be a no-op, not a panic.
	evictImportedMedia("never-existed")
}
