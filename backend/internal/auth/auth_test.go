package auth

import "testing"

func TestValidatePassword(t *testing.T) {
	tests := []struct {
		password string
		want     bool
	}{
		{"1234567", false},
		{"12345678", true},
		{"password", true},
		{"", false},
	}

	for _, tt := range tests {
		if got := ValidatePassword(tt.password); got != tt.want {
			t.Errorf("ValidatePassword(%q) = %v, want %v", tt.password, got, tt.want)
		}
	}
}

func TestCheckPassword(t *testing.T) {
	password := "securepassword"
	hash, err := HashPassword(password, 10)
	if err != nil {
		t.Fatalf("HashPassword failed: %v", err)
	}

	if !CheckPassword(password, hash) {
		t.Error("CheckPassword failed with correct password")
	}

	if CheckPassword("wrongpassword", hash) {
		t.Error("CheckPassword succeeded with wrong password")
	}
}
