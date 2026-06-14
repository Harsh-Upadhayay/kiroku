package auth

import (
	"context"
	"errors"
	"fmt"

	"kiroku-api/internal/models"
)

// Sentinel errors returned by Service so the HTTP layer can map a failure to the right
// status code without knowing how the service works internally. Callers compare with
// errors.Is; the underlying cause (when any) is wrapped for logging.
var (
	// ErrInvalidCredentials means the email/password pair did not authenticate.
	ErrInvalidCredentials = errors.New("invalid credentials")
	// ErrWeakPassword means a password failed validation (see ValidatePassword).
	ErrWeakPassword = errors.New("password does not meet requirements")
	// ErrHashFailed means bcrypt could not hash the password (e.g. bad cost).
	ErrHashFailed = errors.New("password hashing failed")
	// ErrUserExists means registration could not create the account (typically a duplicate).
	ErrUserExists = errors.New("user already exists")
)

// userStore is the slice of persistence the auth Service needs. It is declared here, in
// the consumer, rather than in the store package — the idiomatic Go convention. Anything
// that provides these four methods (the real *store.Store, or a fake in a test) can back
// the service.
type userStore interface {
	GetUser(ctx context.Context, email string) (hash string, joined int64, err error)
	CreateUser(ctx context.Context, email, hash string, joined int64, state string) error
	UpdatePassword(ctx context.Context, email, hash string) error
	DeleteAccount(ctx context.Context, email string) error
}

// Service holds the account-management business logic (validation, password hashing, and
// orchestration of the store). HTTP handlers stay thin by delegating to it.
type Service struct {
	store        userStore
	cost         int
	defaultState string
}

// NewService builds a Service. cost is the bcrypt work factor; defaultState is the initial
// sync state stored for a newly registered user.
func NewService(store userStore, cost int, defaultState string) *Service {
	return &Service{store: store, cost: cost, defaultState: defaultState}
}

// Register validates the credentials, hashes the password, and creates the user with their
// initial state. It returns ErrWeakPassword, ErrHashFailed or ErrUserExists on the
// corresponding failure.
func (s *Service) Register(ctx context.Context, email, password string) (models.UserResponse, error) {
	email = NormalizeEmail(email)
	if email == "" || !ValidatePassword(password) {
		return models.UserResponse{}, ErrWeakPassword
	}
	hash, err := HashPassword(password, s.cost)
	if err != nil {
		return models.UserResponse{}, fmt.Errorf("%w: %v", ErrHashFailed, err)
	}
	joined := NowMillis()
	if err := s.store.CreateUser(ctx, email, hash, joined, s.defaultState); err != nil {
		return models.UserResponse{}, fmt.Errorf("%w: %v", ErrUserExists, err)
	}
	return models.UserResponse{Email: email, Joined: joined}, nil
}

// Login verifies the password against the stored hash. It returns ErrInvalidCredentials for
// any failure (unknown user or wrong password) so callers cannot distinguish the two.
func (s *Service) Login(ctx context.Context, email, password string) (models.UserResponse, error) {
	email = NormalizeEmail(email)
	hash, joined, err := s.store.GetUser(ctx, email)
	if err != nil || !CheckPassword(password, hash) {
		return models.UserResponse{}, ErrInvalidCredentials
	}
	return models.UserResponse{Email: email, Joined: joined}, nil
}

// ChangePassword verifies the old password before setting the new one. The old password is
// checked first (ErrInvalidCredentials), then the new password is validated (ErrWeakPassword).
func (s *Service) ChangePassword(ctx context.Context, email, oldPassword, newPassword string) error {
	email = NormalizeEmail(email)
	hash, _, err := s.store.GetUser(ctx, email)
	if err != nil || !CheckPassword(oldPassword, hash) {
		return ErrInvalidCredentials
	}
	if !ValidatePassword(newPassword) {
		return ErrWeakPassword
	}
	newHash, err := HashPassword(newPassword, s.cost)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrHashFailed, err)
	}
	return s.store.UpdatePassword(ctx, email, newHash)
}

// DeleteAccount verifies the password and then removes the account.
func (s *Service) DeleteAccount(ctx context.Context, email, password string) error {
	email = NormalizeEmail(email)
	hash, _, err := s.store.GetUser(ctx, email)
	if err != nil || !CheckPassword(password, hash) {
		return ErrInvalidCredentials
	}
	return s.store.DeleteAccount(ctx, email)
}
