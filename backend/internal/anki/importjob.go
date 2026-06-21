package anki

import (
	"log/slog"
	"sync"
	"time"
)

// Import job statuses reported to the client while a deck parses in the background.
const (
	ImportJobPending = "pending"
	ImportJobDone    = "done"
	ImportJobError   = "error"
)

// ImportJob is the state of one background deck-parse. The job id is the upload id, so the
// status endpoint can find both the job and (for cleanup) its on-disk session from a single
// path value.
type ImportJob struct {
	Status string        `json:"status"`
	Result *ImportResult `json:"result,omitempty"`
	Err    string        `json:"error,omitempty"`
}

// importJobs holds in-flight and recently finished parse jobs keyed by upload id. Parsing a
// large deck takes longer than Cloudflare's ~100s proxy timeout, so /complete enqueues a job
// here and returns immediately while the client polls for the result. Finished jobs are
// evicted after importJobTTL so a client that never picks up its result does not pin the parsed
// collection (which can be hundreds of MB) for the life of the process.
var importJobs = struct {
	sync.Mutex
	items map[string]*ImportJob
}{items: map[string]*ImportJob{}}

// importJobTTL is how long a finished job's result stays resident for the client to fetch. It
// mirrors importedMediaTTL since the client pulls the result and its media in the same window.
const importJobTTL = 30 * time.Minute

// StartImportJob registers a pending parse for an assembled upload and runs it in the
// background, returning immediately. If a job for uploadID already exists (e.g. the client
// retried /complete after a timeout) the existing job is left untouched, making /complete
// idempotent. The on-disk session is intentionally left in place: FinishImportJob discards it
// once the client has acknowledged the result, so a failed parse can be retried.
func StartImportJob(root, mediaDir, uploadID string) {
	importJobs.Lock()
	if _, exists := importJobs.items[uploadID]; exists {
		importJobs.Unlock()
		return
	}
	importJobs.items[uploadID] = &ImportJob{Status: ImportJobPending}
	importJobs.Unlock()

	go func() {
		result, err := runImport(root, uploadID)
		// Persist media to the durable disk store before reporting the job done, so the parsed
		// deck's audio/images outlive the in-memory cache TTL and are reachable from other devices.
		// Best-effort: a persistence failure must not fail an otherwise-successful import.
		if err == nil {
			if n, perr := PersistImportedMedia(mediaDir, result.ImportID); perr != nil {
				slog.Warn("Persisting imported media partially failed", "uploadID", uploadID, "persisted", n, "error", perr)
			}
		}
		importJobs.Lock()
		job := importJobs.items[uploadID]
		if job != nil {
			if err != nil {
				job.Status = ImportJobError
				job.Err = err.Error()
			} else {
				job.Status = ImportJobDone
				job.Result = result
			}
		}
		importJobs.Unlock()
		// Backstop the client ack: drop the result even if the client never fetches it.
		time.AfterFunc(importJobTTL, func() { evictImportJob(uploadID) })
	}()
}

// runImport assembles the uploaded chunks and parses the resulting archive. It is the slow
// work that used to run inside the /complete request.
func runImport(root, uploadID string) (*ImportResult, error) {
	path, err := AssembleSession(root, uploadID)
	if err != nil {
		return nil, err
	}
	return ImportPackageFile(path)
}

// GetImportJob returns a snapshot of a job's state. The final bool reports whether the job is
// known (mirroring the comma-ok map idiom).
func GetImportJob(uploadID string) (ImportJob, bool) {
	importJobs.Lock()
	defer importJobs.Unlock()
	job, ok := importJobs.items[uploadID]
	if !ok {
		return ImportJob{}, false
	}
	return *job, true
}

// FinishImportJob drops the job and reclaims its on-disk upload session. It is the client ack:
// once the client has the parsed result the session can no longer be needed for a resume.
func FinishImportJob(root, uploadID string) {
	evictImportJob(uploadID)
	_ = DiscardSession(root, uploadID)
}

// evictImportJob drops a single job's entry. Safe to call for an unknown id.
func evictImportJob(uploadID string) {
	importJobs.Lock()
	defer importJobs.Unlock()
	delete(importJobs.items, uploadID)
}
