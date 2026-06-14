package anki

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
)

// readZipFile returns the contents of the first archive entry whose name matches one of
// names, or os.ErrNotExist if none match.
func readZipFile(zipReader *zip.Reader, names []string) ([]byte, error) {
	for _, file := range zipReader.File {
		for _, name := range names {
			if file.Name == name {
				rc, err := file.Open()
				if err != nil {
					return nil, err
				}
				defer rc.Close()
				return io.ReadAll(rc)
			}
		}
	}
	return nil, os.ErrNotExist
}

// The helpers below coerce values pulled out of decoded JSON (which are typed as `any`)
// into the concrete types the data model needs. JSON numbers decode as float64, so the
// numeric helpers handle several underlying types defensively.

// fallback returns value, or fallbackValue when value is blank.
func fallback(value, fallbackValue string) string {
	if strings.TrimSpace(value) == "" {
		return fallbackValue
	}
	return value
}

func first(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func secondOrFirst(values []string) string {
	if len(values) > 1 {
		return values[1]
	}
	return first(values)
}

// splitTags splits Anki's space-delimited tag string into a slice.
func splitTags(input string) []string {
	return strings.Fields(input)
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	return fmt.Sprintf("%v", value)
}

func intValue(value any) int64 {
	switch v := value.(type) {
	case int64:
		return v
	case int:
		return int64(v)
	case float64:
		return int64(v)
	case json.Number:
		n, _ := v.Int64()
		return n
	case string:
		n, _ := strconv.ParseInt(v, 10, 64)
		return n
	default:
		return 0
	}
}

// coalesceInt returns fallbackValue when value is nil, otherwise the coerced int.
func coalesceInt(value any, fallbackValue int64) int64 {
	if value == nil {
		return fallbackValue
	}
	return intValue(value)
}

func boolValue(value any) bool {
	switch v := value.(type) {
	case bool:
		return v
	case float64:
		return v != 0
	case int64:
		return v != 0
	case string:
		return v == "true" || v == "1"
	default:
		return false
	}
}

// numberString renders a numeric value as a string, treating zero as empty (Anki uses 0
// to mean "unset" for several optional id fields).
func numberString(value any) string {
	n := intValue(value)
	if n == 0 {
		return ""
	}
	return strconv.FormatInt(n, 10)
}

// zeroEmpty renders an int as a string, or "" when it is zero.
func zeroEmpty(value int64) string {
	if value == 0 {
		return ""
	}
	return strconv.FormatInt(value, 10)
}
