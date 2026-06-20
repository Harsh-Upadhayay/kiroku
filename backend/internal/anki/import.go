package anki

import (
	"archive/zip"
	"bytes"
	"database/sql"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

// ImportPackage parses an in-memory .apkg archive (raw) and returns the structured result.
// packageKind is a free-form label echoed back in the report (e.g. "apkg").
func ImportPackage(raw []byte, packageKind string) (*ImportResult, error) {
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return nil, err
	}
	return importFromZipReader(reader, packageKind)
}

// ImportPackageFile parses an .apkg archive read directly from a file on disk. It is the
// streaming counterpart to ImportPackage: an *os.File satisfies io.ReaderAt, so zip.Reader
// seeks within it instead of the whole archive being buffered in memory. This matters for
// large chunk-reassembled uploads that can be hundreds of megabytes.
func ImportPackageFile(path string) (*ImportResult, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	reader, err := zip.NewReader(file, info.Size())
	if err != nil {
		return nil, err
	}
	return importFromZipReader(reader, "apkg")
}

// importFromZipReader is the shared parsing pipeline behind ImportPackage and
// ImportPackageFile. It opens the ZIP's SQLite collection, spills it to a temp file (the
// driver needs a path), then reads metadata, notes, cards, review logs and media out of it.
// Non-fatal problems are collected as warnings rather than failing the whole import.
func importFromZipReader(reader *zip.Reader, packageKind string) (*ImportResult, error) {
	collection, collectionKind, err := readCollection(reader)
	if err != nil {
		return nil, err
	}

	// The SQLite driver needs a file path, so spill the collection bytes to a temp file.
	temp, err := os.CreateTemp("", "kiroku-anki-*.sqlite")
	if err != nil {
		return nil, err
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if _, err = temp.Write(collection); err != nil {
		temp.Close()
		return nil, err
	}
	temp.Close()

	apkgDB, err := sql.Open("sqlite", tempPath)
	if err != nil {
		return nil, err
	}
	defer apkgDB.Close()

	importID := uuid.NewString()
	warnings := []string{}
	decks, deckConfigs, noteTypes, warnings := readMetadata(apkgDB, warnings)
	notes, noteByID, err := readNotes(apkgDB, noteTypes)
	if err != nil {
		return nil, err
	}
	cards, err := readCards(apkgDB, decks, noteTypes, noteByID)
	if err != nil {
		return nil, err
	}
	// Review logs are optional history; a failure here downgrades to a warning.
	reviewLogs, err := readReviewLogs(apkgDB)
	if err != nil {
		warnings = append(warnings, "review log import failed: "+err.Error())
	}
	// ".anki21b"/".anki2b" collections use the newer protobuf manifest + zstd-compressed blobs.
	newFormat := strings.HasSuffix(collectionKind, "b")
	mediaManifest, mediaCache, mediaWarnings := readMedia(reader, newFormat)
	warnings = append(warnings, mediaWarnings...)
	cacheImportedMedia(importID, mediaCache)

	collectionName := packageKind
	if len(decks) > 0 {
		collectionName = decks[0].Name
	}
	coll := Collection{
		ID:          "collection-" + importID,
		Name:        collectionName,
		CreatedAt:   time.Now().UnixMilli(),
		Decks:       decks,
		DeckConfigs: deckConfigs,
		NoteTypes:   noteTypes,
		Notes:       notes,
		Cards:       cards,
		ReviewLogs:  reviewLogs,
	}

	report := ImportReport{
		PackageKind: packageKind + "/" + collectionKind,
		Warnings:    warnings,
		Decks:       len(decks),
		DeckConfigs: len(deckConfigs),
		NoteTypes:   len(noteTypes),
		Notes:       len(notes),
		Cards:       len(cards),
		ReviewLogs:  len(reviewLogs),
		MediaFiles:  len(mediaManifest),
	}

	return &ImportResult{
		ImportID:      importID,
		Collection:    coll,
		MediaManifest: mediaManifest,
		Report:        report,
	}, nil
}
