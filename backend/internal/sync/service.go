package sync

import (
	"context"
	"encoding/json"

	"kiroku-api/internal/models"
)

// stateStore is the persistence the sync Service needs, declared here in the consumer.
// *store.Store satisfies it structurally — note UpdateUserState takes a plain callback over
// []byte, so this interface stays free of store-specific types and the store never has to
// import this package.
type stateStore interface {
	GetUserState(ctx context.Context, email string) (raw []byte, found bool, err error)
	UpdateUserState(ctx context.Context, email string, updatedAt int64,
		update func(existing []byte, found bool) (newState []byte, skip bool, err error)) error
}

// Service orchestrates the read-merge-write of a user's study state. The merge rules
// themselves live in MergeState / IsDestructive; the Service wires them to the store.
type Service struct {
	store stateStore
}

// NewService builds a sync Service backed by store.
func NewService(store stateStore) *Service {
	return &Service{store: store}
}

// Push merges incoming into the stored state and persists the result, atomically. It
// returns the merged state to echo back to the client. When the push is rejected as
// destructive (an empty push that would wipe existing data), it returns ignored=true and an
// empty state. updatedAt is the timestamp to record for the write.
func (s *Service) Push(ctx context.Context, email string, incoming models.SyncState, updatedAt int64) (final models.SyncState, ignored bool, err error) {
	incomingRaw, err := json.Marshal(incoming)
	if err != nil {
		return models.SyncState{}, false, err
	}

	finalRaw := incomingRaw
	err = s.store.UpdateUserState(ctx, email, updatedAt, func(existing []byte, found bool) ([]byte, bool, error) {
		if found && IsDestructive(existing, incoming) {
			ignored = true
			return nil, true, nil // skip the write
		}
		if len(existing) > 0 {
			merged, mergeErr := MergeState(existing, incomingRaw)
			if mergeErr != nil {
				return nil, false, mergeErr
			}
			finalRaw = merged
		}
		return finalRaw, false, nil
	})
	if err != nil {
		return models.SyncState{}, false, err
	}
	if ignored {
		return models.SyncState{}, true, nil
	}

	// finalRaw is freshly produced by us (marshal or merge), so this won't fail in practice.
	json.Unmarshal(finalRaw, &final)
	return final, false, nil
}

// Pull returns the user's stored state, or nil when they have none yet.
func (s *Service) Pull(ctx context.Context, email string) (*models.SyncState, error) {
	raw, found, err := s.store.GetUserState(ctx, email)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, nil
	}
	var state models.SyncState
	if err := json.Unmarshal(raw, &state); err != nil {
		return nil, err
	}
	return &state, nil
}
