# Changelog

All notable changes to Our Team Memories are documented here.

## [0.2.1] - 2026-08-08

### Fixed
- Primary action orange (`--orange`) darkened from `#e85d04` to `#c2410c` so white button labels meet WCAG AA contrast (5.18:1, was 3.50:1). Hover uses `--orange-dark` `#9a3412` (7.31:1). Bright brand spark retained as `--orange-bright` for non-text marks (logo heart, decorative SVGs).

## [0.2.0] - 2026-08-08

### Added
- API-backed multi-sport Family -> Athlete -> Sport -> Event -> Moment -> Clip timeline.
- Idempotent SQLite migration/backfill with `families`, `athletes`, `athlete_sports`, events, ordered moments, clips, notes, tags, typed joins, and `legacy_video_map` while preserving legacy IDs and flat rows.
- Emma soccer and Noah basketball compatibility data plus Maya's three-fight Taekwondo tournament fixture with event-level and moment-level clips.
- Canonical timeline filters for athlete, sport, event type, date range, result, and tag, including explicit hidden-memory inspection.
- Event, moment, clip, athlete, and composite capture API routes with structured errors, ownership validation, and sport-pack validation.
- Event-first, moment-first, and clip-first UI flows with real file input and honest mock/pending YouTube status.
- Generated multi-sport imagery, event-parent cards, nested moment rows, event and moment detail dialogs, keyboard focus management, and responsive family timeline layouts.
- Reusable Tailwind v4 and shadcn/Radix primitives now back the buttons, cards, forms, tabs, filters, and dialogs without changing the warm family-sports visual language.
- Product and operator documentation for API-first UI state, Compose-safe bcrypt values, port 3015, main-SHA-only deployment, the private free-plan branch-protection limitation, and no public HTTPS claim.

### Fixed
- Legacy `/api/children` and `/api/videos` actions now reconcile through canonical persisted records instead of contradictory browser seed arrays.
- Event and moment hide/show state, edit state, clip ownership, upload cleanup, and local path redaction persist across refresh.
- TKD fields are rejected for soccer and basketball moments; strict date validation uses the corrected one-backslash regex and Gregorian validation.
- SEO metadata, favicon, robots, and sitemap no longer use Vite or unrelated placeholder branding; private QA release is explicitly noindex/disallow-all.
- Production unlock now establishes a session on direct HTTP/LAN access while preserving secure cookies for HTTPS deployments.

## [0.1.3] - 2026-08-08

### Added
- Bounded aggregate upload storage with `MAX_UPLOAD_STORAGE_MB` and orphan cleanup on rejected uploads.
- Browser-level React regression coverage for auth, filters, refresh races, create, upload, edit, and hide flows.

### Fixed
- Lock now clears privileged client state before the server logout completes and reports logout failures separately.
- Selected video details stay inside the active child and sport filter.
- Overlapping catalog refreshes cannot let stale responses overwrite newer state.
- Production startup rejects documented placeholder session secrets, and child creation rejects unknown sports.
- Upload rows cannot retain unsafe external URLs, and a delayed logout cannot clear a newer unlock session.
- Creation refreshes honor the form's target athlete, and lock resets the sport filter before the next unlock.
- Multer is upgraded to the maintained 2.x line.

## [0.1.2] - 2026-08-08

### Added
- API-backed browser catalog loading for children, sports, videos, and upload settings.
- Family PIN unlock and Lock actions that create and destroy the authenticated session.
- Link and phone-upload forms with persisted metadata, mock upload status, and refresh behavior.
- Video detail editing, hide/unhide persistence, child selection, and sport filters.
- Regression coverage for auth, catalog fetches, create/filter, upload, edit/hide, and Compose-safe PIN hashing.

### Fixed
- Seeded UI data no longer masks the SQLite catalog state.
- Vite development requests proxy `/api` and `/uploads` to the local Express server.
- `hash-pin.js` emits a Compose-safe `FAMILY_PIN_HASH` assignment so bcrypt dollar signs are not expanded during deployment.

## [0.1.1] - 2026-08-08

### Fixed
- Empty state only when the filtered catalog is empty.
- Add video and video detail use intentional Sheet/Dialog-style panels.
- Touch targets for Lock, sport filters, and secondary actions meet 44px minimum.
- Form labels, heading order, muted text contrast, robots.txt, sitemap.xml, and brand favicon were corrected.

## [0.1.0] - 2026-08-07

### Added
- Initial durable product import with family PIN auth, Docker Compose packaging, README, and CI process gates.
