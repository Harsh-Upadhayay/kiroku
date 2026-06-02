package config

import (
	"os"
	"strings"
)

type Config struct {
	Port         string
	DataDir      string
	MaxBodyBytes int64
	BCryptCost   int
}

func Load() *Config {
	return &Config{
		Port:         Getenv("PORT", "8080"),
		DataDir:      Getenv("DATA_DIR", "/app/data"),
		MaxBodyBytes: 100 << 20, // 100 MB
		BCryptCost:   10,
	}
}

func Getenv(key, fallbackValue string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallbackValue
	}
	return value
}
