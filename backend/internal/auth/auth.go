// Package auth provides password hashing and credential helpers, plus a Service (see
// service.go) that holds the account-management business logic.
package auth

import (
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// NormalizeEmail lower-cases and trims an email so it can serve as a stable identity key.
func NormalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// HashPassword returns a bcrypt hash of password at the given work factor (cost).
func HashPassword(password string, cost int) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), cost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

// CheckPassword reports whether password matches the bcrypt hash. Any error (mismatch or a
// malformed hash) yields false.
func CheckPassword(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

// NowMillis returns the current Unix time in milliseconds.
func NowMillis() int64 {
	return time.Now().UnixMilli()
}

// MinPasswordLen is the minimum number of characters a password must have.
const MinPasswordLen = 8

// ValidatePassword reports whether a password meets the minimum length requirement.
func ValidatePassword(password string) bool {
	return len(password) >= MinPasswordLen
}
