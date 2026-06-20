package anki

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

// newChunks splits data into n-byte chunks for driving the session helpers.
func newChunks(data []byte, size int) [][]byte {
	var chunks [][]byte
	for start := 0; start < len(data); start += size {
		end := start + size
		if end > len(data) {
			end = len(data)
		}
		chunks = append(chunks, data[start:end])
	}
	return chunks
}

func TestUploadSessionRoundTrip(t *testing.T) {
	root := t.TempDir()
	data := bytes.Repeat([]byte("kiroku"), 1000) // 6000 bytes
	chunks := newChunks(data, 2048)              // 3 chunks: 2048, 2048, 1904

	meta, err := CreateSession(root, UploadMeta{
		Fingerprint: "deck.apkg:6000:42",
		FileName:    "deck.apkg",
		TotalSize:   int64(len(data)),
		TotalChunks: len(chunks),
		ChunkSize:   2048,
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if meta.UploadID == "" {
		t.Fatal("CreateSession returned empty upload id")
	}

	for i, chunk := range chunks {
		if err := WriteChunk(root, meta.UploadID, i, bytes.NewReader(chunk)); err != nil {
			t.Fatalf("WriteChunk %d: %v", i, err)
		}
	}

	received, err := ReceivedChunks(root, meta.UploadID)
	if err != nil {
		t.Fatalf("ReceivedChunks: %v", err)
	}
	if !reflect.DeepEqual(received, []int{0, 1, 2}) {
		t.Fatalf("ReceivedChunks = %v, want [0 1 2]", received)
	}

	path, err := AssembleSession(root, meta.UploadID)
	if err != nil {
		t.Fatalf("AssembleSession: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read assembled: %v", err)
	}
	if !bytes.Equal(got, data) {
		t.Fatalf("assembled bytes do not match original (%d vs %d)", len(got), len(data))
	}

	if err := DiscardSession(root, meta.UploadID); err != nil {
		t.Fatalf("DiscardSession: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, meta.UploadID)); !os.IsNotExist(err) {
		t.Fatalf("session directory still present after discard: %v", err)
	}
}

func TestWriteChunkIdempotentAndResumes(t *testing.T) {
	root := t.TempDir()
	data := bytes.Repeat([]byte("x"), 5000)
	chunks := newChunks(data, 2048) // 3 chunks

	meta, err := CreateSession(root, UploadMeta{
		Fingerprint: "fp",
		TotalSize:   int64(len(data)),
		TotalChunks: len(chunks),
		ChunkSize:   2048,
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	// Write chunk 0 twice (a retry): must remain a single, correct chunk.
	if err := WriteChunk(root, meta.UploadID, 0, bytes.NewReader(chunks[0])); err != nil {
		t.Fatalf("WriteChunk 0 (first): %v", err)
	}
	if err := WriteChunk(root, meta.UploadID, 0, bytes.NewReader(chunks[0])); err != nil {
		t.Fatalf("WriteChunk 0 (retry): %v", err)
	}
	// Skip chunk 1, write chunk 2.
	if err := WriteChunk(root, meta.UploadID, 2, bytes.NewReader(chunks[2])); err != nil {
		t.Fatalf("WriteChunk 2: %v", err)
	}

	received, err := ReceivedChunks(root, meta.UploadID)
	if err != nil {
		t.Fatalf("ReceivedChunks: %v", err)
	}
	if !reflect.DeepEqual(received, []int{0, 2}) {
		t.Fatalf("ReceivedChunks = %v, want [0 2] (resume should report the gap)", received)
	}

	// Completing before chunk 1 arrives must fail as incomplete, not corrupt the import.
	if _, err := AssembleSession(root, meta.UploadID); !errors.Is(err, ErrIncompleteUpload) {
		t.Fatalf("AssembleSession with gap: got %v, want ErrIncompleteUpload", err)
	}

	// Fill the gap and assemble successfully.
	if err := WriteChunk(root, meta.UploadID, 1, bytes.NewReader(chunks[1])); err != nil {
		t.Fatalf("WriteChunk 1: %v", err)
	}
	path, err := AssembleSession(root, meta.UploadID)
	if err != nil {
		t.Fatalf("AssembleSession after fill: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read assembled: %v", err)
	}
	if !bytes.Equal(got, data) {
		t.Fatal("assembled bytes do not match original after resume")
	}
}

func TestWriteChunkRejectsOutOfRange(t *testing.T) {
	root := t.TempDir()
	meta, err := CreateSession(root, UploadMeta{Fingerprint: "fp", TotalSize: 10, TotalChunks: 2, ChunkSize: 5})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if err := WriteChunk(root, meta.UploadID, 2, bytes.NewReader([]byte("x"))); !errors.Is(err, ErrChunkOutOfRange) {
		t.Fatalf("WriteChunk out of range: got %v, want ErrChunkOutOfRange", err)
	}
}

func TestSessionRejectsInvalidUploadID(t *testing.T) {
	root := t.TempDir()
	// A traversal attempt is not a valid UUID, so every entry point must reject it.
	bad := "../../etc/passwd"
	if err := WriteChunk(root, bad, 0, bytes.NewReader([]byte("x"))); !errors.Is(err, ErrInvalidUploadID) {
		t.Fatalf("WriteChunk invalid id: got %v, want ErrInvalidUploadID", err)
	}
	if _, err := ReceivedChunks(root, bad); !errors.Is(err, ErrInvalidUploadID) {
		t.Fatalf("ReceivedChunks invalid id: got %v, want ErrInvalidUploadID", err)
	}
	if _, err := AssembleSession(root, bad); !errors.Is(err, ErrInvalidUploadID) {
		t.Fatalf("AssembleSession invalid id: got %v, want ErrInvalidUploadID", err)
	}
}

func TestSizeMismatchIsIncomplete(t *testing.T) {
	root := t.TempDir()
	// Declare a larger total than the chunks actually carry: reassembly must reject it.
	meta, err := CreateSession(root, UploadMeta{Fingerprint: "fp", TotalSize: 9999, TotalChunks: 1, ChunkSize: 5})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if err := WriteChunk(root, meta.UploadID, 0, bytes.NewReader([]byte("short"))); err != nil {
		t.Fatalf("WriteChunk: %v", err)
	}
	if _, err := AssembleSession(root, meta.UploadID); !errors.Is(err, ErrIncompleteUpload) {
		t.Fatalf("AssembleSession size mismatch: got %v, want ErrIncompleteUpload", err)
	}
}

func TestFindSessionByFingerprint(t *testing.T) {
	root := t.TempDir()
	meta, err := CreateSession(root, UploadMeta{Fingerprint: "deck.apkg:100:7", TotalSize: 100, TotalChunks: 1, ChunkSize: 100})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	found, ok, err := FindSessionByFingerprint(root, "deck.apkg:100:7")
	if err != nil {
		t.Fatalf("FindSessionByFingerprint: %v", err)
	}
	if !ok || found.UploadID != meta.UploadID {
		t.Fatalf("expected to resume session %s, got ok=%v id=%s", meta.UploadID, ok, found.UploadID)
	}

	if _, ok, _ := FindSessionByFingerprint(root, "other"); ok {
		t.Fatal("unexpected match for unknown fingerprint")
	}
	if _, ok, _ := FindSessionByFingerprint(root, ""); ok {
		t.Fatal("empty fingerprint must never match")
	}
}

func TestSweepStaleSessions(t *testing.T) {
	root := t.TempDir()
	fresh, err := CreateSession(root, UploadMeta{Fingerprint: "fresh", TotalSize: 1, TotalChunks: 1, ChunkSize: 1})
	if err != nil {
		t.Fatalf("CreateSession fresh: %v", err)
	}
	stale, err := CreateSession(root, UploadMeta{Fingerprint: "stale", TotalSize: 1, TotalChunks: 1, ChunkSize: 1})
	if err != nil {
		t.Fatalf("CreateSession stale: %v", err)
	}
	// Backdate the stale session's metadata so the sweeper treats it as expired.
	staleMeta, _ := LoadSessionMeta(root, stale.UploadID)
	staleMeta.CreatedAt = time.Now().Add(-48 * time.Hour).UnixMilli()
	if err := writeMeta(filepath.Join(root, stale.UploadID), staleMeta); err != nil {
		t.Fatalf("rewrite stale meta: %v", err)
	}

	if err := SweepStaleSessions(root, 24*time.Hour); err != nil {
		t.Fatalf("SweepStaleSessions: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, stale.UploadID)); !os.IsNotExist(err) {
		t.Fatal("stale session should have been swept")
	}
	if _, err := os.Stat(filepath.Join(root, fresh.UploadID)); err != nil {
		t.Fatalf("fresh session should survive sweep: %v", err)
	}
}

// TestChunkedImportMatchesDirect drives the full chunk → assemble → parse path against a real
// .apkg and asserts it yields the same parse as a direct in-memory ImportPackage. It is
// skipped when the sample deck is not checked out.
func TestChunkedImportMatchesDirect(t *testing.T) {
	const sample = "RRTK_Recognition_Remembering_The_Kanji.apkg"
	path := filepath.Join("..", "..", "..", sample)
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		t.Skipf("sample deck not present: %s", path)
	}
	if err != nil {
		t.Fatal(err)
	}

	direct, err := ImportPackage(raw, "apkg")
	if err != nil {
		t.Fatalf("direct ImportPackage: %v", err)
	}

	root := t.TempDir()
	const chunkSize = 10 << 20
	chunks := newChunks(raw, chunkSize)
	meta, err := CreateSession(root, UploadMeta{
		Fingerprint: "rrtk",
		FileName:    sample,
		TotalSize:   int64(len(raw)),
		TotalChunks: len(chunks),
		ChunkSize:   chunkSize,
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	for i, chunk := range chunks {
		if err := WriteChunk(root, meta.UploadID, i, bytes.NewReader(chunk)); err != nil {
			t.Fatalf("WriteChunk %d: %v", i, err)
		}
	}
	assembled, err := AssembleSession(root, meta.UploadID)
	if err != nil {
		t.Fatalf("AssembleSession: %v", err)
	}
	streamed, err := ImportPackageFile(assembled)
	if err != nil {
		t.Fatalf("ImportPackageFile: %v", err)
	}

	if len(streamed.Collection.Notes) != len(direct.Collection.Notes) ||
		len(streamed.Collection.Cards) != len(direct.Collection.Cards) {
		t.Fatalf("chunked import mismatch: notes %d/%d cards %d/%d",
			len(streamed.Collection.Notes), len(direct.Collection.Notes),
			len(streamed.Collection.Cards), len(direct.Collection.Cards))
	}
	if !strings.HasPrefix(streamed.Report.PackageKind, "apkg/") {
		t.Fatalf("unexpected package kind %q", streamed.Report.PackageKind)
	}
}
