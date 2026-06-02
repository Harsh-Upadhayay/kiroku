# Kiroku

Kiroku is an offline-first Japanese study app for Hiragana, Katakana, and imported Anki decks.

It includes kana drills, spaced repetition review, custom deck import, and browser-to-browser sync through a structured Go backend.

## 🚀 Local Development

### Prerequisites
- Node.js 22+
- Go 1.22+

### Running the App
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the development server (Frontend + Backend proxy):
   ```bash
   npm run dev
   ```

### Backend Development
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Run tests:
   ```bash
   go test ./...
   ```
3. Run the API directly:
   ```bash
   go run cmd/kiroku-api/main.go
   ```

## 🏗️ Production Deployment

Kiroku is containerized using Docker and can be deployed with Docker Compose.

### Docker Compose
1. Ensure `kiroku.neovara.uk` is configured in your DNS/Reverse Proxy (e.g., Traefik).
2. Start the services:
   ```bash
   docker compose up -d
   ```

### Rollback Workflow
To roll back to a previous version, use the specific image tag:
```bash
# Example: Rolling back to a specific version tag or SHA
KIROKU_TAG=sha-xxxxxxx docker compose up -d
```

## 💾 Backup & Restore

### Backup
The database is stored in the `./data` directory (as configured in `docker-compose.yml`).
```bash
cp data/kiroku.db data/kiroku.db.bak
```

### Restore
1. Stop the services.
2. Replace the database file:
   ```bash
   mv data/kiroku.db.bak data/kiroku.db
   ```
3. Start the services.

## 🔒 Privacy & Security

- **Data Ownership**: All your study data is stored locally in your browser (IndexedDB) and synced to the Kiroku API if you are logged in.
- **Security**: Passwords are hashed using BCrypt.
- **Analytics**: No third-party analytics are used.
- **Backups**: The server maintains your latest synced state in a SQLite database. Regular backups of the server's `data/` directory are recommended.
