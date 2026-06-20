package anki

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/klauspost/compress/zstd"
)

// zstdMagic is the 4-byte frame magic that prefixes every zstd stream. Anki's newer
// ".anki21b" packages store both the collection and each media blob zstd-compressed.
var zstdMagic = []byte{0x28, 0xb5, 0x2f, 0xfd}

// importMediaCache holds the decoded media blobs for each completed import, keyed by
// importID then by content hash. It lets media be served on demand after an import without
// re-reading the archive. The client pulls every blob in the minutes after an import, so each
// entry is evicted after importedMediaTTL — a large deck holds hundreds of MB of decoded
// media here, and keeping every import for the life of the process would leak memory.
var importMediaCache = struct {
	sync.RWMutex
	items map[string]map[string]cachedMedia
}{items: map[string]map[string]cachedMedia{}}

// importedMediaTTL is how long an import's decoded media stays resident for the client to
// fetch before it is evicted to reclaim memory. Observed full caching of an 8k-file deck
// takes a few minutes, so this leaves comfortable headroom.
const importedMediaTTL = 30 * time.Minute

// ImportedMedia returns a cached media blob for a given import and hash. The final bool
// reports whether the blob was found (mirroring the comma-ok map idiom).
func ImportedMedia(importID, hash string) (string, string, []byte, bool) {
	importMediaCache.RLock()
	defer importMediaCache.RUnlock()
	byHash := importMediaCache.items[importID]
	item, ok := byHash[hash]
	return item.fileName, item.contentType, item.bytes, ok
}

// readMedia parses the archive's "media" manifest, reads each referenced blob, and hashes
// it with SHA-256. It returns the public manifest, a hash-keyed cache for ImportedMedia, and
// any non-fatal warnings.
//
// Anki has shipped two media layouts. The legacy ".anki2" packages store the manifest as a
// JSON object mapping the zip entry name ("0", "1", ...) to the original file name, with each
// blob stored uncompressed. The newer ".anki21b" packages (Anki 2.1.50+) store the manifest
// as a protobuf MediaEntries message — entries are ordered, the Nth entry's blob is the zip
// file named "N" — and each blob is zstd-compressed. newFormat selects which layout to expect;
// blob reads tolerate either compression so a mislabeled archive still imports.
func readMedia(zipReader *zip.Reader, newFormat bool) ([]MediaRef, map[string]cachedMedia, []string) {
	warnings := []string{}
	raw, err := readZipFile(zipReader, []string{"media"})
	if err != nil {
		return nil, nil, nil
	}

	entries, err := parseMediaManifest(raw, newFormat)
	if err != nil {
		warnings = append(warnings, "media map could not be parsed: "+err.Error())
		return nil, nil, warnings
	}

	manifest := []MediaRef{}
	cache := map[string]cachedMedia{}
	for _, entry := range entries {
		if entry.fileName == "" {
			continue
		}
		blob, err := readZipFile(zipReader, []string{entry.entryName})
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("media entry %s (%s) missing", entry.entryName, entry.fileName))
			continue
		}
		// Newer packages zstd-compress each blob. Decompress defensively regardless of the
		// declared format so a single odd archive does not break the whole import.
		blob = maybeDecompressZstd(blob)
		sum := sha256.Sum256(blob)
		hash := hex.EncodeToString(sum[:])
		contentType := mimeTypeFor(entry.fileName)
		manifest = append(manifest, MediaRef{Hash: hash, FileName: entry.fileName, EntryName: entry.entryName, ContentType: contentType, Bytes: int64(len(blob))})
		cache[hash] = cachedMedia{fileName: entry.fileName, contentType: contentType, bytes: blob}
	}
	sort.Slice(manifest, func(i, j int) bool { return manifest[i].FileName < manifest[j].FileName })
	return manifest, cache, warnings
}

// mediaEntry pairs a zip entry name ("0", "1", ...) with the media file's original name.
type mediaEntry struct {
	entryName string
	fileName  string
}

// parseMediaManifest decodes the "media" file. It prefers the legacy JSON layout (also used
// as a fallback) and falls back to the protobuf layout for newer packages.
func parseMediaManifest(raw []byte, newFormat bool) ([]mediaEntry, error) {
	if !newFormat {
		if entries, ok := parseJSONMediaManifest(raw); ok {
			return entries, nil
		}
	}
	// Newer packages may zstd-compress the manifest itself in addition to the blobs.
	entries, err := parseProtoMediaManifest(maybeDecompressZstd(raw))
	if err == nil {
		return entries, nil
	}
	// Last resort: a package labeled "new" that actually carries a JSON manifest.
	if jsonEntries, ok := parseJSONMediaManifest(raw); ok {
		return jsonEntries, nil
	}
	return nil, err
}

// parseJSONMediaManifest decodes the legacy {"0": "file.mp3", ...} object. The ok return
// distinguishes a genuine JSON manifest from bytes that merely failed to parse.
func parseJSONMediaManifest(raw []byte) ([]mediaEntry, bool) {
	var media map[string]string
	if err := json.Unmarshal(raw, &media); err != nil {
		return nil, false
	}
	entries := make([]mediaEntry, 0, len(media))
	for entryName, fileName := range media {
		entries = append(entries, mediaEntry{entryName: entryName, fileName: fileName})
	}
	return entries, true
}

// parseProtoMediaManifest decodes the protobuf MediaEntries message used by ".anki21b"
// packages. Only the file name of each entry is needed; the Nth entry maps to the zip file
// named "N". A minimal hand-rolled reader avoids pulling in the full protobuf toolchain for
// this single message shape:
//
//	message MediaEntries { repeated MediaEntry entries = 1; }
//	message MediaEntry  { string name = 1; uint32 size = 2; bytes sha1 = 3; }
func parseProtoMediaManifest(raw []byte) ([]mediaEntry, error) {
	entries := []mediaEntry{}
	index := 0
	r := raw
	for len(r) > 0 {
		fieldNum, wireType, rest, err := readProtoTag(r)
		if err != nil {
			return nil, err
		}
		r = rest
		// Field 1 (entries) is the only field we care about; skip anything else.
		if fieldNum == 1 && wireType == 2 {
			var msg []byte
			msg, r, err = readProtoBytes(r)
			if err != nil {
				return nil, err
			}
			name, err := readMediaEntryName(msg)
			if err != nil {
				return nil, err
			}
			entries = append(entries, mediaEntry{entryName: strconv.Itoa(index), fileName: name})
			index++
			continue
		}
		if r, err = skipProtoField(r, wireType); err != nil {
			return nil, err
		}
	}
	return entries, nil
}

// readMediaEntryName extracts field 1 (name) from a single MediaEntry message.
func readMediaEntryName(msg []byte) (string, error) {
	r := msg
	for len(r) > 0 {
		fieldNum, wireType, rest, err := readProtoTag(r)
		if err != nil {
			return "", err
		}
		r = rest
		if fieldNum == 1 && wireType == 2 {
			name, _, err := readProtoBytes(r)
			return string(name), err
		}
		if r, err = skipProtoField(r, wireType); err != nil {
			return "", err
		}
	}
	return "", nil
}

// readProtoTag reads a field tag varint and splits it into field number and wire type.
func readProtoTag(b []byte) (fieldNum uint64, wireType uint64, rest []byte, err error) {
	tag, n := binary.Uvarint(b)
	if n <= 0 {
		return 0, 0, nil, fmt.Errorf("malformed protobuf tag")
	}
	return tag >> 3, tag & 0x7, b[n:], nil
}

// readProtoBytes reads a length-delimited (wire type 2) value.
func readProtoBytes(b []byte) (value []byte, rest []byte, err error) {
	length, n := binary.Uvarint(b)
	if n <= 0 || uint64(len(b[n:])) < length {
		return nil, nil, fmt.Errorf("malformed protobuf length-delimited field")
	}
	start := n
	end := n + int(length)
	return b[start:end], b[end:], nil
}

// skipProtoField advances past a field whose value we do not need, by wire type.
func skipProtoField(b []byte, wireType uint64) ([]byte, error) {
	switch wireType {
	case 0: // varint
		_, n := binary.Uvarint(b)
		if n <= 0 {
			return nil, fmt.Errorf("malformed protobuf varint")
		}
		return b[n:], nil
	case 1: // 64-bit
		if len(b) < 8 {
			return nil, fmt.Errorf("truncated protobuf 64-bit field")
		}
		return b[8:], nil
	case 2: // length-delimited
		_, rest, err := readProtoBytes(b)
		return rest, err
	case 5: // 32-bit
		if len(b) < 4 {
			return nil, fmt.Errorf("truncated protobuf 32-bit field")
		}
		return b[4:], nil
	default:
		return nil, fmt.Errorf("unsupported protobuf wire type %d", wireType)
	}
}

// maybeDecompressZstd returns the zstd-decompressed form of b when it carries the zstd frame
// magic, or b unchanged otherwise. Decompression failures fall back to the original bytes so
// a malformed stream degrades to "unreadable media" rather than a failed import.
func maybeDecompressZstd(b []byte) []byte {
	if len(b) < len(zstdMagic) || !bytes.HasPrefix(b, zstdMagic) {
		return b
	}
	decoder, err := zstd.NewReader(bytes.NewReader(b))
	if err != nil {
		return b
	}
	defer decoder.Close()
	decoded, err := io.ReadAll(decoder)
	if err != nil {
		return b
	}
	return decoded
}

func cacheImportedMedia(importID string, media map[string]cachedMedia) {
	importMediaCache.Lock()
	importMediaCache.items[importID] = media
	importMediaCache.Unlock()
	// Evict this import's media once the client has had time to pull it, so large decks don't
	// pin hundreds of MB in memory for the life of the process.
	time.AfterFunc(importedMediaTTL, func() { evictImportedMedia(importID) })
}

// evictImportedMedia drops a single import's cached media. Safe to call for an unknown id.
func evictImportedMedia(importID string) {
	importMediaCache.Lock()
	defer importMediaCache.Unlock()
	delete(importMediaCache.items, importID)
}

// mimeTypeFor guesses a content type from a file extension, with explicit overrides for
// audio/video types the standard library's mime table doesn't reliably know about.
func mimeTypeFor(fileName string) string {
	ext := strings.ToLower(filepath.Ext(fileName))
	if m := mime.TypeByExtension(ext); m != "" {
		return m
	}
	switch ext {
	case ".mp3":
		return "audio/mpeg"
	case ".m4a":
		return "audio/mp4"
	case ".mp4":
		return "video/mp4"
	case ".webm":
		return "video/webm"
	}
	return "application/octet-stream"
}

// DataURL encodes bytes as a base64 "data:" URL using the file's inferred content type.
func DataURL(fileName string, bytes []byte) string {
	return fmt.Sprintf("data:%s;base64,%s", mimeTypeFor(fileName), base64.StdEncoding.EncodeToString(bytes))
}
