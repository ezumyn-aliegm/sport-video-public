# Kids Sport Video Tracker

> **Process:** See [docs/PROCESS.md](docs/PROCESS.md). Code ships only via **git + PR + CI**. Version **0.1.3**.


A family-friendly video catalog for kids sports highlights. Parents can paste links or upload clips, tag them by child/sport/date, and hide clips when needed. v1 uses a shared family PIN for quick access.

## Quick start (local)

1. Install dependencies:
   npm install
2. Copy env:
   cp .env.example .env
3. Set a family PIN hash:
   node ./scripts/hash-pin.js 1234
   (paste the complete `FAMILY_PIN_HASH=...` output into `.env`; the script escapes dollar signs for Compose and the server normalizes it for local runs)
4. Run in dev:
   npm run dev
5. API server (separate terminal):
   npm run server

Default dev UI: http://localhost:5173
API server: http://localhost:3000

## Production (Docker)

1. Build + run:
   docker compose up -d --build
2. App runs on host port 3015 (http://localhost:3015 or via proxy).
3. Restart:
   docker compose restart sport-video

## Family PIN model (v1)

- One PIN for the entire family. Fast, low-friction access.
- Tradeoffs: anyone with the PIN can view/edit; no per-parent audit trail.
- Rate limit: 5 attempts per 15 minutes per IP.

## YouTube upload mode

This v1 defaults to **mock** upload because YouTube OAuth credentials are not available on the host. The server uses sqlite3 (async) to avoid native build issues on Node 26 in local dev; production container builds fine.

### Mock mode (default)

- Set YOUTUBE_MODE=mock
- Upload stores the file in /uploads and generates a **demo link**:
  https://youtube.com/watch?v=mock_<uuid>
- UI surfaces “Mock upload” and explains that YouTube is not connected

### Live mode (requires Operator setup)

Required env vars:
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- YOUTUBE_REFRESH_TOKEN

Notes:
- Service accounts do not work with YouTube uploads.
- Operator must do a one-time OAuth consent by the YouTube channel owner.
- Default privacy is unlisted; change YOUTUBE_DEFAULT_PRIVACY if needed.

## Environment variables

- PORT=3000
- NODE_ENV=development|production (Docker Compose forces production)
- SESSION_SECRET=string
- TRUST_PROXY=false (set true only behind a controlled reverse proxy that terminates TLS)
- FAMILY_PIN_HASH=bcrypt hash
- YOUTUBE_MODE=mock|live
- GOOGLE_CLIENT_ID=
- GOOGLE_CLIENT_SECRET=
- YOUTUBE_REFRESH_TOKEN=
- YOUTUBE_DEFAULT_PRIVACY=unlisted
- YOUTUBE_SELF_DECLARED_MADE_FOR_KIDS=true
- MAX_UPLOAD_MB=500
- MAX_UPLOAD_STORAGE_MB=2048 (aggregate private-QA upload cap; new uploads are rejected when full)
- DB_PATH=./data/sport-video.db

### Compose bcrypt hashes

Docker Compose treats dollar signs in `.env` values as interpolation markers. Always use the output of `node ./scripts/hash-pin.js <PIN>` rather than pasting a raw bcrypt hash. The generated assignment uses Compose-safe escaping, and `server/config.js` accepts the same escaped value for local development.

## Operator deploy notes (app-host)

- Project directory: /opt/docker/sport-video
- Compose project name: sport-video
- Host port: 3015 (proxy to 192.0.2.30:3015)
- Do not edit /opt/docker/docker-compose.yml
- Allow UFW: sudo ufw allow 3015/tcp comment 'sport-video'

## Seed demo data

On first run, the app auto-seeds:
- 2 children (Emma, Noah)
- 4 sports
- 3 videos (1 hidden, 1 mock upload)

## Known limitations

- Live YouTube uploads not implemented without OAuth creds.
- No per-parent accounts or audit trail.
- No delete UI (hide only).
- Upload files remain on the mounted storage until an operator removes orphaned files; the aggregate `MAX_UPLOAD_STORAGE_MB` cap prevents unbounded disk growth and rejects new uploads when full.
- Docker startup rejects the example `SESSION_SECRET` placeholder when `NODE_ENV=production`; set a unique secret before running Compose.
