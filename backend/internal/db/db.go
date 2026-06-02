package db

import (
	"database/sql"
	"fmt"
	"log/slog"
	"path/filepath"

	_ "modernc.org/sqlite"
)

func Init(dataDir string) (*sql.DB, error) {
	dbPath := filepath.Join(dataDir, "kiroku.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	db.SetMaxOpenConns(1)

	if err := migrate(db); err != nil {
		return nil, fmt.Errorf("migration failed: %w", err)
	}

	return db, nil
}

func migrate(db *sql.DB) error {
	// Simple versioned migration system
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)`)
	if err != nil {
		return err
	}

	var currentVersion int
	err = db.QueryRow(`SELECT MAX(version) FROM schema_migrations`).Scan(&currentVersion)
	if err != nil {
		currentVersion = 0
	}

	migrations := []struct {
		version int
		stmt    string
	}{
		{
			version: 1,
			stmt: `CREATE TABLE IF NOT EXISTS users (
				email TEXT PRIMARY KEY,
				password_hash TEXT NOT NULL,
				joined INTEGER NOT NULL
			)`,
		},
		{
			version: 2,
			stmt: `CREATE TABLE IF NOT EXISTS user_states (
				email TEXT PRIMARY KEY,
				state_json TEXT NOT NULL,
				updated_at INTEGER NOT NULL,
				FOREIGN KEY(email) REFERENCES users(email) ON DELETE CASCADE
			)`,
		},
	}

	for _, m := range migrations {
		if m.version > currentVersion {
			slog.Info("Running migration", "version", m.version)
			if _, err := db.Exec(m.stmt); err != nil {
				return fmt.Errorf("migration v%d failed: %w", m.version, err)
			}
			if _, err := db.Exec(`INSERT INTO schema_migrations (version) VALUES (?)`, m.version); err != nil {
				return fmt.Errorf("failed to record migration v%d: %w", m.version, err)
			}
		}
	}

	return nil
}

func GetUser(db *sql.DB, email string) (string, int64, error) {
	var hash string
	var joined int64
	err := db.QueryRow(`SELECT password_hash, joined FROM users WHERE email = ?`, email).Scan(&hash, &joined)
	return hash, joined, err
}

func CreateUser(db *sql.DB, email, hash string, joined int64, defaultState string) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`INSERT INTO users(email, password_hash, joined) VALUES(?, ?, ?)`, email, hash, joined); err != nil {
		return err
	}
	if _, err = tx.Exec(`INSERT INTO user_states(email, state_json, updated_at) VALUES(?, ?, ?)`, email, defaultState, joined); err != nil {
		return err
	}
	return tx.Commit()
}
