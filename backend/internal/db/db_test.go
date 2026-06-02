package db

import (
	"os"
	"testing"
)

func TestInitAndMigrations(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "kiroku-db-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	database, err := Init(tempDir)
	if err != nil {
		t.Fatalf("Init failed: %v", err)
	}
	defer database.Close()

	// Verify tables exist
	var name string
	err = database.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").Scan(&name)
	if err != nil {
		t.Errorf("users table missing: %v", err)
	}

	err = database.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name='user_states'").Scan(&name)
	if err != nil {
		t.Errorf("user_states table missing: %v", err)
	}
}
