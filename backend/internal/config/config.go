// Package config loads runtime configuration from environment variables, applying sane
// defaults and validating the result. Load is the single entry point.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Defaults applied when the corresponding environment variable is unset or blank.
const (
	defaultPort         = "8080"
	defaultDataDir      = "/app/data"
	defaultMaxBodyBytes = 100 << 20 // 100 MB, the largest request body we accept (Anki imports are big).
	defaultBCryptCost   = 10

	// bcrypt only accepts costs within this inclusive range (see golang.org/x/crypto/bcrypt).
	minBCryptCost = 4
	maxBCryptCost = 31
)

// Config holds the resolved application configuration. It is read-only after Load.
type Config struct {
	Port         string
	DataDir      string
	MaxBodyBytes int64
	BCryptCost   int
}

// Load reads configuration from the environment, fills in defaults, and validates it.
// It returns an error (rather than panicking) so the caller decides how to fail.
func Load() (*Config, error) {
	cfg := &Config{
		Port:         Getenv("PORT", defaultPort),
		DataDir:      Getenv("DATA_DIR", defaultDataDir),
		MaxBodyBytes: GetenvInt64("MAX_BODY_BYTES", defaultMaxBodyBytes),
		BCryptCost:   GetenvInt("BCRYPT_COST", defaultBCryptCost),
	}
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

func (c *Config) validate() error {
	if c.MaxBodyBytes <= 0 {
		return fmt.Errorf("MAX_BODY_BYTES must be positive, got %d", c.MaxBodyBytes)
	}
	if c.BCryptCost < minBCryptCost || c.BCryptCost > maxBCryptCost {
		return fmt.Errorf("BCRYPT_COST must be between %d and %d, got %d", minBCryptCost, maxBCryptCost, c.BCryptCost)
	}
	return nil
}

// Getenv returns the trimmed value of the named environment variable, or fallbackValue
// when it is unset or blank.
func Getenv(key, fallbackValue string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallbackValue
	}
	return value
}

// GetenvInt behaves like Getenv but parses the value as an int, falling back when unset or
// unparseable.
func GetenvInt(key string, fallbackValue int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallbackValue
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallbackValue
	}
	return parsed
}

// GetenvInt64 behaves like GetenvInt for int64 values.
func GetenvInt64(key string, fallbackValue int64) int64 {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallbackValue
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return fallbackValue
	}
	return parsed
}
