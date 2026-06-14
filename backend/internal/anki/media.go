package anki

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"mime"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// importMediaCache holds the decoded media blobs for each completed import, keyed by
// importID then by content hash. It lets media be served on demand after an import
// without re-reading the archive. It is process-global and never evicted, which is fine
// for this app's short-lived import flow but worth revisiting if imports become long-lived.
var importMediaCache = struct {
	sync.RWMutex
	items map[string]map[string]cachedMedia
}{items: map[string]map[string]cachedMedia{}}

// ImportedMedia returns a cached media blob for a given import and hash. The final bool
// reports whether the blob was found (mirroring the comma-ok map idiom).
func ImportedMedia(importID, hash string) (string, string, []byte, bool) {
	importMediaCache.RLock()
	defer importMediaCache.RUnlock()
	byHash := importMediaCache.items[importID]
	item, ok := byHash[hash]
	return item.fileName, item.contentType, item.bytes, ok
}

// readMedia parses the archive's "media" manifest (a JSON map of entry name -> file name),
// reads each referenced blob, and hashes it with SHA-256. It returns the public manifest,
// a hash-keyed cache for ImportedMedia, and any non-fatal warnings.
func readMedia(zipReader *zip.Reader) ([]MediaRef, map[string]cachedMedia, []string) {
	warnings := []string{}
	raw, err := readZipFile(zipReader, []string{"media"})
	if err != nil {
		return nil, nil, nil
	}
	var media map[string]string
	if err := json.Unmarshal(raw, &media); err != nil {
		warnings = append(warnings, "media map could not be parsed: "+err.Error())
		return nil, nil, warnings
	}
	manifest := []MediaRef{}
	cache := map[string]cachedMedia{}
	for entryName, fileName := range media {
		if fileName == "" {
			continue
		}
		bytes, err := readZipFile(zipReader, []string{entryName})
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("media entry %s (%s) missing", entryName, fileName))
			continue
		}
		sum := sha256.Sum256(bytes)
		hash := hex.EncodeToString(sum[:])
		contentType := mimeTypeFor(fileName)
		manifest = append(manifest, MediaRef{Hash: hash, FileName: fileName, EntryName: entryName, ContentType: contentType, Bytes: int64(len(bytes))})
		cache[hash] = cachedMedia{fileName: fileName, contentType: contentType, bytes: bytes}
	}
	sort.Slice(manifest, func(i, j int) bool { return manifest[i].FileName < manifest[j].FileName })
	return manifest, cache, warnings
}

func cacheImportedMedia(importID string, media map[string]cachedMedia) {
	importMediaCache.Lock()
	defer importMediaCache.Unlock()
	importMediaCache.items[importID] = media
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
