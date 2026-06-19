<div align="center">

# 記録 · Kiroku

### Learn Japanese your way — kana, kanji, vocab, and your own Anki decks, all in one place.

**Kiroku** is a fast, offline-first Japanese study app. Drill the kana, follow a guided JLPT N5 course, build vocab straight from photos, and review your imported Anki decks with modern spaced repetition — on any device, even with no signal.

<br />

### 👉 **[Open Kiroku → kiroku.neovara.uk](https://kiroku.neovara.uk)**

<br />

[![Live App](https://img.shields.io/badge/Live-kiroku.neovara.uk-4f46e5?style=for-the-badge&logo=pwa&logoColor=white)](https://kiroku.neovara.uk)
[![Offline First](https://img.shields.io/badge/Offline-First-22c55e?style=for-the-badge)](https://kiroku.neovara.uk)
[![Install as App](https://img.shields.io/badge/Installable-PWA-f59e0b?style=for-the-badge)](https://kiroku.neovara.uk)

</div>

---

> [!TIP]
> Nothing to download from a store and no account required to start. Just open **[kiroku.neovara.uk](https://kiroku.neovara.uk)** and begin — or tap **“Add to Home Screen”** to install it like a native app.

## ✨ What you can do

| | Feature | What it gives you |
|---|---|---|
| 🎓 | **Guided N5 Course** | A structured, day-by-day path through JLPT N5 — kanji, vocabulary, and grammar — with progress that picks up right where you left off. |
| あ | **Kana Mastery** | Timed **Speed Sheets** to build recall, an **SRS quiz** for long-term retention, and a tappable character chart with **audio pronunciation**. |
| 📸 | **Vocab from Anywhere** | Snap a photo of a textbook page or word list and Kiroku pulls the vocabulary out for you, or search and add words by hand. |
| 🃏 | **Your Anki Decks** | Import any `.apkg` / `.colpkg` package — cards, media, and study order are preserved — and review with the modern **FSRS** scheduler. |
| 📖 | **Instant Dictionary** | Look up any word or kanji offline, see readings and meanings, and tap any character for a **breakdown of its parts and a mnemonic**. |
| ☁️ | **Sync Across Devices** | Sign in to carry your progress, reviews, and decks from your phone to your laptop and back. |

## 🎯 Why Kiroku

- **🛜 Works offline, everywhere.** Your lessons, decks, and reviews live on your device, so studying on the train or on a plane just works.
- **📱 Install like an app.** Add it to your home screen for a full-screen, native feel — no app store needed.
- **🧠 Smarter reviews.** The FSRS algorithm schedules each card for the moment you’re about to forget it, so you study less and remember more.
- **🇯🇵 Built for real learners.** From your very first あ to importing a 2,000-card kanji deck, Kiroku grows with you.
- **🌗 Easy on the eyes.** Light, dark, and system themes.

## 🚀 Get started in seconds

1. **Open [kiroku.neovara.uk](https://kiroku.neovara.uk)** in any modern browser.
2. *(Optional)* Tap **Add to Home Screen** to install Kiroku as an app.
3. Pick where you want to begin:
   - New to Japanese? Start the **N5 Course** or drill **Kana**.
   - Already have material? **Import an Anki deck** or **snap a photo** of your vocab list.
4. *(Optional)* Create an account in **Settings** to sync across your devices.

> [!NOTE]
> Prefer to keep everything local? You can. An account only adds cross-device sync — every feature works without one.

## 🔒 Your data, your control

- **You own it.** Study data is stored locally in your browser; signing in syncs an encrypted-at-rest copy to keep your devices in step.
- **No tracking.** Kiroku ships with **zero third-party analytics**.
- **Secure by default.** Account passwords are hashed with BCrypt and never stored in plain text.

---

<details>
<summary><strong>🛠️ For developers & self-hosting</strong></summary>

<br />

Kiroku is a React + TypeScript frontend backed by a Go API, packaged for Docker.

### Run locally

**Prerequisites:** Node.js 22+ and Go 1.22+

```bash
npm install      # install dependencies
npm run dev      # start frontend + backend proxy
```

Backend only:

```bash
cd backend
go test ./...                      # run tests
go run cmd/kiroku-api/main.go      # run the API
```

### Deploy with Docker

Kiroku is containerized and runs with Docker Compose. Point your DNS / reverse proxy (e.g. Traefik) at the host, then:

```bash
docker compose up -d
```

Roll back to a specific build with an image tag:

```bash
KIROKU_TAG=sha-xxxxxxx docker compose up -d
```

### Backup & restore

The SQLite database lives in `./data` (see `docker-compose.yml`).

```bash
cp data/kiroku.db data/kiroku.db.bak     # backup
# restore: stop services, then
mv data/kiroku.db.bak data/kiroku.db     # and start again
```

</details>

<div align="center">
<br />

**[Start studying → kiroku.neovara.uk](https://kiroku.neovara.uk)**

<sub>記録 — <em>kiroku</em>, “a record.” Keep one of your Japanese journey.</sub>

</div>
