# Changelog

All notable changes to Kids Sport Video Tracker are documented here.

## [0.1.3] - 2026-08-08

### Added
- Bounded aggregate upload storage with `MAX_UPLOAD_STORAGE_MB` and orphan cleanup on rejected uploads.
- Browser-level React regression coverage for auth, filters, refresh races, create, upload, edit, and hide flows.

### Fixed
- Lock now clears privileged client state before the server logout completes and reports logout failures separately.
- Selected video details stay inside the active child and sport filter.
- Overlapping catalog refreshes cannot let stale responses overwrite newer state.
- Production startup rejects the documented placeholder session secrets, and child creation rejects unknown sports.
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
- Empty state only when the filtered catalog is empty (no "No clips yet" while clips show).
- Add video and video detail are intentional panels opened by CTA, not always mounted.
- Duration badges no longer double-stack (removed baked-in SVG durations).
- Touch targets for Lock, sport filters, and secondary actions meet 44px minimum.
- Form controls have explicit labels; heading order and muted text contrast improved.
- SEO: meta description, robots.txt and sitemap.xml with correct content-types, brand favicon.

### Changed
- Catalog-first parent hierarchy (Apple Photos progressive disclosure + TeamSnap sports context).
- Panel sheet pattern for add/detail flows (shadcn Sheet/Dialog interaction model in CSS).

## [0.1.0] - 2026-08-07

### Added
- Initial product import from Hermes Kanban E2E (scratch → durable git).
- Parent catalog with link + upload (mock YouTube mode).
- Family PIN auth, Docker compose packaging, README.
- CI workflow (lint, unit smoke, build).
- Process contract: git branch, PR, critic review, versioning required for ship.
