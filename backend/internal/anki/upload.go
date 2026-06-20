package anki

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Chunked uploads let large .apkg files cross a proxy (e.g. Cloudflare) that caps individual
// request bodies. The client splits a file into fixed-size chunks and PUTs them one request
// at a time; this package persists each session on disk so an interrupted upload can resume.
//
// On-disk layout, rooted at the uploads directory the handler passes in:
//
//	{root}/{uploadID}/meta.json          session metadata (UploadMeta)
//	{root}/{uploadID}/chunk-000000        one file per received chunk, named by index
//	{root}/{uploadID}/assembled.apkg      concatenated archive, created by AssembleSession
//
// uploadID is always a UUID, which both names the session and (because uuid.Parse rejects
// anything else) guards against path traversal from a client-supplied id.

const (
	metaFileName      = "meta.json"
	assembledFileName = "assembled.apkg"
	chunkPrefix       = "chunk-"
)

// Exported sentinels so handlers can map session errors to the right status code with
// errors.Is rather than inspecting strings.
var (
	// ErrInvalidUploadID means the upload id is not a well-formed UUID (client error, 400).
	ErrInvalidUploadID = errors.New("invalid upload id")
	// ErrChunkOutOfRange means a chunk index falls outside the session's declared range (400).
	ErrChunkOutOfRange = errors.New("chunk index out of range")
	// ErrIncompleteUpload means reassembly found a missing chunk or a size mismatch (409): the
	// client should send the remaining chunks before completing again.
	ErrIncompleteUpload = errors.New("incomplete upload")
)

// UploadMeta describes an in-progress chunked upload session. It is written to meta.json when
// the session is created and read back to validate chunk indices and reassemble the file.
type UploadMeta struct {
	UploadID    string `json:"uploadId"`
	Fingerprint string `json:"fingerprint"`
	FileName    string `json:"fileName"`
	TotalSize   int64  `json:"totalSize"`
	TotalChunks int    `json:"totalChunks"`
	ChunkSize   int64  `json:"chunkSize"`
	CreatedAt   int64  `json:"createdAt"`
}

// sessionDir returns the on-disk directory for an upload, validating that uploadID is a UUID
// so a hostile id cannot escape root.
func sessionDir(root, uploadID string) (string, error) {
	if _, err := uuid.Parse(uploadID); err != nil {
		return "", ErrInvalidUploadID
	}
	return filepath.Join(root, uploadID), nil
}

func chunkFileName(index int) string {
	return fmt.Sprintf("%s%06d", chunkPrefix, index)
}

// CreateSession allocates a new upload id, persists meta.json, and returns the populated
// metadata. CreatedAt is stamped here; the caller supplies the rest.
func CreateSession(root string, meta UploadMeta) (UploadMeta, error) {
	meta.UploadID = uuid.NewString()
	meta.CreatedAt = time.Now().UnixMilli()
	dir := filepath.Join(root, meta.UploadID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return UploadMeta{}, err
	}
	if err := writeMeta(dir, meta); err != nil {
		return UploadMeta{}, err
	}
	return meta, nil
}

func writeMeta(dir string, meta UploadMeta) error {
	data, err := json.Marshal(meta)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, metaFileName), data, 0o644)
}

// LoadSessionMeta reads the metadata for an existing session.
func LoadSessionMeta(root, uploadID string) (UploadMeta, error) {
	dir, err := sessionDir(root, uploadID)
	if err != nil {
		return UploadMeta{}, err
	}
	return readMeta(dir)
}

func readMeta(dir string) (UploadMeta, error) {
	var meta UploadMeta
	data, err := os.ReadFile(filepath.Join(dir, metaFileName))
	if err != nil {
		return UploadMeta{}, err
	}
	if err := json.Unmarshal(data, &meta); err != nil {
		return UploadMeta{}, err
	}
	return meta, nil
}

// FindSessionByFingerprint scans root for an incomplete session whose fingerprint matches,
// so a client re-selecting the same file resumes instead of restarting. The bool reports
// whether a match was found.
func FindSessionByFingerprint(root, fingerprint string) (UploadMeta, bool, error) {
	if fingerprint == "" {
		return UploadMeta{}, false, nil
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return UploadMeta{}, false, nil
		}
		return UploadMeta{}, false, err
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		meta, err := readMeta(filepath.Join(root, entry.Name()))
		if err != nil {
			continue // ignore half-written or unrelated directories
		}
		if meta.Fingerprint == fingerprint {
			return meta, true, nil
		}
	}
	return UploadMeta{}, false, nil
}

// WriteChunk stores one chunk for a session. index must be within the session's declared
// range. Writing is atomic (temp file + rename) so a retried or concurrent PUT never leaves a
// truncated chunk behind, which keeps the operation idempotent.
func WriteChunk(root, uploadID string, index int, r io.Reader) error {
	dir, err := sessionDir(root, uploadID)
	if err != nil {
		return err
	}
	meta, err := readMeta(dir)
	if err != nil {
		return err
	}
	if index < 0 || index >= meta.TotalChunks {
		return fmt.Errorf("%w: %d not in [0,%d)", ErrChunkOutOfRange, index, meta.TotalChunks)
	}
	tmp, err := os.CreateTemp(dir, chunkFileName(index)+"-*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	if _, err := io.Copy(tmp, r); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return err
	}
	return os.Rename(tmpPath, filepath.Join(dir, chunkFileName(index)))
}

// ReceivedChunks returns the sorted indices of chunks already stored for a session, letting
// the client skip what it has already uploaded.
func ReceivedChunks(root, uploadID string) ([]int, error) {
	dir, err := sessionDir(root, uploadID)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	indices := []int{}
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasPrefix(name, chunkPrefix) || strings.Contains(name, ".tmp") {
			continue
		}
		index, err := strconv.Atoi(strings.TrimPrefix(name, chunkPrefix))
		if err != nil {
			continue
		}
		indices = append(indices, index)
	}
	sort.Ints(indices)
	return indices, nil
}

// AssembleSession concatenates all chunks in order into a single archive and returns its
// path. It fails if any chunk is missing or the reassembled size does not match the declared
// total, so a partial or corrupted upload is never handed to the parser.
func AssembleSession(root, uploadID string) (string, error) {
	dir, err := sessionDir(root, uploadID)
	if err != nil {
		return "", err
	}
	meta, err := readMeta(dir)
	if err != nil {
		return "", err
	}

	out, err := os.Create(filepath.Join(dir, assembledFileName))
	if err != nil {
		return "", err
	}
	defer out.Close()

	var written int64
	for i := 0; i < meta.TotalChunks; i++ {
		chunkPath := filepath.Join(dir, chunkFileName(i))
		in, err := os.Open(chunkPath)
		if err != nil {
			if os.IsNotExist(err) {
				return "", fmt.Errorf("%w: missing chunk %d of %d", ErrIncompleteUpload, i, meta.TotalChunks)
			}
			return "", err
		}
		n, copyErr := io.Copy(out, in)
		in.Close()
		if copyErr != nil {
			return "", copyErr
		}
		written += n
	}
	if meta.TotalSize > 0 && written != meta.TotalSize {
		return "", fmt.Errorf("%w: reassembled size %d does not match declared %d", ErrIncompleteUpload, written, meta.TotalSize)
	}
	if err := out.Sync(); err != nil {
		return "", err
	}
	return out.Name(), nil
}

// DiscardSession removes a session and all its chunks. It is safe to call on a missing
// session.
func DiscardSession(root, uploadID string) error {
	dir, err := sessionDir(root, uploadID)
	if err != nil {
		return err
	}
	return os.RemoveAll(dir)
}

// SweepStaleSessions deletes session directories older than maxAge, reclaiming disk from
// uploads that were started but never completed. It is best-effort: a single unreadable
// session does not abort the sweep.
func SweepStaleSessions(root string, maxAge time.Duration) error {
	entries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	cutoff := time.Now().Add(-maxAge).UnixMilli()
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		dir := filepath.Join(root, entry.Name())
		meta, err := readMeta(dir)
		switch {
		case err == nil && meta.CreatedAt < cutoff:
			os.RemoveAll(dir)
		case err != nil:
			// No readable meta: fall back to the directory's own modification time.
			if info, statErr := os.Stat(dir); statErr == nil && info.ModTime().UnixMilli() < cutoff {
				os.RemoveAll(dir)
			}
		}
	}
	return nil
}
