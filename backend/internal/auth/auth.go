package auth

import (
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

func NormalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func HashPassword(password string, cost int) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), cost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

func CheckPassword(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func NowMillis() int64 {
	return time.Now().UnixMilli()
}

func ValidatePassword(password string) bool {
	return len(password) >= 8 // Basic security hardening
}
