// Package store is the data-access layer: it owns every SQL statement the app runs and
// exposes them as plain Go methods. Keeping SQL in one place means handlers and services
// never build queries themselves, and the schema is easy to find and review.
//
// The database schema itself is created by package db (migrations); store only reads and
// writes rows.
package store

import (
	"context"
	"database/sql"
	"time"
)

// SQL statements live together as named constants so the queries are easy to scan and
// reuse. All use parameter placeholders (?) — never string concatenation — to stay safe
// from SQL injection.
const (
	qGetUser      = `SELECT password_hash, joined FROM users WHERE email = ?`
	qInsertUser   = `INSERT INTO users(email, password_hash, joined) VALUES(?, ?, ?)`
	qUpdatePass   = `UPDATE users SET password_hash = ? WHERE email = ?`
	qDeleteUser   = `DELETE FROM users WHERE email = ?`
	qGetUserState = `SELECT state_json FROM user_states WHERE email = ?`
	qPutUserState = `INSERT INTO user_states(email, state_json, updated_at) VALUES(?, ?, ?)`
	qUpsertState  = `INSERT INTO user_states(email, state_json, updated_at) VALUES(?, ?, ?)
		ON CONFLICT(email) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`

	// Writability probe used by the health check.
	qCreateHealthTable = `CREATE TABLE IF NOT EXISTS health_check (id INTEGER PRIMARY KEY, ts INTEGER)`
	qInsertHealth      = `INSERT INTO health_check (ts) VALUES (?)`
	qDeleteHealth      = `DELETE FROM health_check WHERE ts = ?`
)

// Store wraps a database handle. Construct one per use with New(db); it is cheap and
// stateless, so handlers can build it on demand from their *sql.DB.
type Store struct {
	db *sql.DB
}

// New returns a Store backed by db.
func New(db *sql.DB) *Store {
	return &Store{db: db}
}

// GetUser returns the stored password hash and join timestamp for email. The error is
// sql.ErrNoRows when no such user exists.
func (s *Store) GetUser(ctx context.Context, email string) (hash string, joined int64, err error) {
	err = s.db.QueryRowContext(ctx, qGetUser, email).Scan(&hash, &joined)
	return hash, joined, err
}

// CreateUser inserts a new user together with their initial sync state, atomically. If
// either insert fails the whole operation rolls back (so a user never exists without state).
func (s *Store) CreateUser(ctx context.Context, email, hash string, joined int64, state string) error {
	return s.withTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, qInsertUser, email, hash, joined); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, qPutUserState, email, state, joined)
		return err
	})
}

// UpdatePassword sets a new password hash for email.
func (s *Store) UpdatePassword(ctx context.Context, email, hash string) error {
	_, err := s.db.ExecContext(ctx, qUpdatePass, hash, email)
	return err
}

// DeleteAccount removes the user row. The user_states row is removed via the
// ON DELETE CASCADE foreign key.
func (s *Store) DeleteAccount(ctx context.Context, email string) error {
	_, err := s.db.ExecContext(ctx, qDeleteUser, email)
	return err
}

// GetUserState returns the raw sync-state JSON for email. found is false (with a nil error)
// when the user has no stored state yet.
func (s *Store) GetUserState(ctx context.Context, email string) (raw []byte, found bool, err error) {
	var state string
	err = s.db.QueryRowContext(ctx, qGetUserState, email).Scan(&state)
	if err == sql.ErrNoRows {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return []byte(state), true, nil
}

// CheckWritable verifies the database accepts writes by inserting and immediately deleting
// a probe row. A single timestamp is used for both statements so the DELETE always matches
// the INSERT (otherwise a millisecond boundary between two clock reads could orphan rows).
func (s *Store) CheckWritable(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, qCreateHealthTable); err != nil {
		return err
	}
	ts := time.Now().UnixMilli()
	if _, err := s.db.ExecContext(ctx, qInsertHealth, ts); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, qDeleteHealth, ts)
	return err
}

// UpdateUserState transactionally reads the user's current state, hands it to update, and
// persists whatever update returns — all atomically, so a concurrent push can't interleave
// between the read and the write. If update reports skip=true the stored state is left
// untouched (used to reject a destructive push). found tells update whether the user had any
// state yet; existing is nil when not.
//
// The merge/decision logic lives in the caller's update function (see sync.Service.Push);
// this method only owns the transaction and the SQL.
func (s *Store) UpdateUserState(
	ctx context.Context,
	email string,
	updatedAt int64,
	update func(existing []byte, found bool) (newState []byte, skip bool, err error),
) error {
	return s.withTx(ctx, func(tx *sql.Tx) error {
		var state string
		err := tx.QueryRowContext(ctx, qGetUserState, email).Scan(&state)
		if err != nil && err != sql.ErrNoRows {
			return err
		}
		found := err == nil
		var existing []byte
		if found {
			existing = []byte(state)
		}

		newState, skip, err := update(existing, found)
		if err != nil {
			return err
		}
		if skip {
			return nil
		}
		_, err = tx.ExecContext(ctx, qUpsertState, email, string(newState), updatedAt)
		return err
	})
}

// withTx begins a transaction, runs fn, and commits or rolls back based on fn's error.
func (s *Store) withTx(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}
