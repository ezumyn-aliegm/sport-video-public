# Our Team Memories

> Multi-sport family highlights organized as Family PIN -> Athlete -> Sport -> Event -> Moment -> Clip. Version 0.2.3.

Repository: https://github.com/ezumyn-aliegm/sport-video-public

Our Team Memories is a private family archive for games, fights, practices, tournaments, and the small wins parents want to find again. The home screen is an API-backed newest-first timeline: an event is the visual parent, moments stay ordered beneath it, and clips attach either to the event or to one moment.

## Quick start

```bash
npm install
cp .env.example .env
node ./scripts/hash-pin.js 1234
# Paste the generated FAMILY_PIN_HASH assignment into .env.
npm run server   # API on http://localhost:3000
npm run dev      # Vite UI on http://localhost:5173
```

The Vite UI proxies `/api` and `/uploads` to the local Express server. For the production-shaped path:

```bash
docker compose up -d --build
```

The Compose service listens on host port 3015 and maps to the app's port 3000: http://localhost:3015. Host port 3013 is not used by this project. For an optional controlled TLS reverse proxy, see
[`docs/QA-DEPLOYMENT.md`](docs/QA-DEPLOYMENT.md). Supply your own exact
proxy address; no personal deployment settings are included.

## Demo content and public history

The default empty-database fixture is fictional: Emma, Noah, Maya, their
teams, opponents, dates, results and sport categories demonstrate the data
model. They are not a family archive. Demo clip links use `example.invalid`
and are intentionally not playable videos. New uploads stay local in mock
mode; no YouTube upload occurs.

Product imagery in `public/assets/generated/` is generated illustration;
repository screenshots show the demo fixture. No runtime family database,
private upload folder, live PIN or OAuth credential is included. To explore,
follow Quick start, set your own local PIN and unlock the demo timeline.
Do not put real family data in a publicly shared demo instance.

See [PUBLICATION.md](PUBLICATION.md) for the preserved, sanitized history.
The project is MIT-licensed; see [LICENSE](LICENSE).


## v0.2 domain and API

The migration keeps the original `children` IDs and flat `videos` rows for compatibility, then adds canonical `athletes`, `events`, `moments`, `clips`, notes, tags, typed joins, and `legacy_video_map`. Legacy rows are backfilled deterministically and the migration is idempotent. Docker's `./data` volume is preserved; migration never deletes the existing SQLite file.

Canonical authenticated routes include:

- `GET /api/timeline` with athlete, sport, event type, date range, result, tag, and hidden filters.
- `GET|POST|PATCH /api/events` plus event detail, ordered moments, and event-level clips.
- `GET|POST|PATCH /api/moments` plus moment-level clips.
- `GET|PATCH /api/clips` for honest ready, mock, pending, or failed status.
- `POST /api/capture` for an atomic video-first Event -> Moment -> Clip path.

The old `/api/children` and `/api/videos` routes remain compatibility aliases. The browser must call the API for children, sports, timeline, counts, hidden state, filters, create, edit, and hide. Do not add static catalog arrays that can contradict SQLite.

Taekwondo is a progressive `tkd.v1` sport pack. Soccer and basketball use game language (opponent/team, score, period or half) and do not receive TKD fields. Fresh demo data keeps Emma soccer and Noah basketball and adds Maya's three-fight Mountain West Open tournament. Demo insertion is idempotent and is only automatic for a new empty database or explicit `SEED_DEMO=1`; a non-empty production database is backfilled only.

## Family PIN and uploads

The shared PIN is compared against `FAMILY_PIN_HASH`; it is never stored in SQLite. Successful unlock regenerates the session. Lock clears the session server-side and the client clears all privileged data before waiting for the response. Production requires a non-placeholder `SESSION_SECRET`; session cookies are `Secure` on HTTPS and adapt to direct HTTP/LAN access. Set `TRUST_PROXY` to the exact reverse-proxy IPv4 address (or `/32` CIDR) only when a controlled proxy terminates TLS.

Uploads use a real file input and remain private behind the authenticated `/uploads` route. With `YOUTUBE_MODE=mock`, the response says `publish_status=mock` and explains that YouTube is not connected. With live credentials absent, the response is `pending`; the UI never claims a successful public upload. Rejected files are removed, MIME is checked server-side, and `MAX_UPLOAD_STORAGE_MB` bounds retained private files.

Compose expands `$` in environment values. Always generate the hash with `node ./scripts/hash-pin.js <PIN>` so bcrypt dollar signs remain Compose-safe; the server normalizes the escaped value for local dotenv runs.

## Environment

See `.env.example` for the complete list. Important values:

- `PORT=3000` inside the container.
- `SESSION_SECRET` (required and unique in production).
- `FAMILY_PIN_HASH` (generated, never committed).
- `YOUTUBE_MODE=mock|live`.
- `MAX_UPLOAD_MB=500` and `MAX_UPLOAD_STORAGE_MB=2048`.
- `DB_PATH=./data/sport-video.db`.
- `SEED_DEMO=1` only when an operator explicitly wants the reserved demo fixture.

## Tests and release gates

```bash
npm run ci
```

`npm run ci` runs Oxlint, Node API/migration tests, Vitest React interaction tests, and the Vite production build. The suite covers auth, migration/backfill, hierarchy ownership, event and moment fields, sport-pack disclosure, timeline filters, create/edit/hide persistence, upload honesty and cleanup, and API-driven UI fetch paths.

The durable release path is:

1. Start from freshly fetched `origin/main`.
2. Work on a named branch and commit the change.
3. Run `npm run ci`, `git diff --check`, and desktop/mobile browser QA.
4. Open one non-draft PR to `main` with the exact head SHA and evidence.
5. Wait for GitHub CI and critic review. Do not merge or deploy from a component branch.
6. Deploy only an approved `main` commit or release tag SHA, never a dirty checkout or arbitrary feature branch.

Private repositories on the free GitHub plan do not provide the full branch-protection ruleset gate needed for a hard server-side required-review policy. The process gate is therefore documented and enforced by PR/critic/CI workflow rather than claimed as a GitHub setting.

## Operator runbook

- **Local QA:** `npm install`, `.env`, `npm run server`, `npm run dev`; use the UI at port 5173 or Compose at port 3015.
- **Compose:** set a real production `SESSION_SECRET` and generated PIN hash, then `docker compose up -d --build`; inspect `docker compose logs -f sport-video`.
- **SQLite backup:** stop the service before copying `data/sport-video.db`; retain the backup and verify `PRAGMA integrity_check` before any migration.
- **Deploy:** build and publish only the exact approved `main` SHA. QA the running URL and record the URL, SHA, and CI run. This release candidate must not be deployed from this task.
- **Rollback:** restore the pre-migration SQLite backup for a schema rollback. A code rollback may keep the canonical schema only while compatibility routes remain.

## Public HTTPS status

There is no claimed public HTTPS deployment for this private QA release. The production-shaped URL is local/private at port 3015 until an operator provisions a real host, TLS termination, DNS, secrets, and an independent QA run. `robots.txt` is intentionally disallow-all and the document metadata is noindex so the release does not pretend to be publicly hosted.

## Known limitations

- Shared PIN access has no per-parent audit trail.
- Live YouTube OAuth publishing is not implemented in this release.
- The UI exposes reversible hide rather than hard delete.
- Uploaded files remain on the private mounted volume until an operator removes them after a confirmed database deletion.
