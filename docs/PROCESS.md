# Development and release process

Repository: https://github.com/ezumyn-aliegm/sport-video-public
Durable checkout: `/Users/demo/work/sport-video`

## Non-negotiable ship path

1. Write the product spec and acceptance evidence on the Kanban card.
2. Fetch `origin/main` and create a feature or release branch from that SHA.
3. Implement in the durable git repository, not only in a Kanban scratch workspace.
4. Add product-meaningful tests before declaring the behavior complete.
5. Run `npm run ci`, `git diff --check`, and browser QA at desktop 1280/1440 and mobile 360/390/414 widths.
6. Push the branch and open one non-draft PR to `main`.
7. Link parent/component PRs and component dispositions in the release PR. Do not ship a static design branch over an API-backed implementation.
8. Wait for CI and critic review. No merge or deploy is part of this v0.2.0 integration task.
9. Deploy only an approved `main` commit or release tag SHA. Never deploy a dirty checkout, a scratch workspace, or an arbitrary feature branch.
10. Complete the Kanban card with PR URL, branch, head SHA, CI URL/status, exact tests, version, changed files, render evidence, known limitations, and public HTTPS status.

## Product invariants

- The UI must call the authenticated API for family session state, athletes, sports, timeline, counts, filters, creation, edit, hide, and upload status. Static arrays may describe copy or fallback imagery only; they must never represent catalog state.
- The persisted hierarchy is Family PIN -> Athlete -> Sport -> Event -> ordered Moment -> Clip. Every clip has `event_id`; `moment_id = NULL` means event-level ownership.
- Legacy `children` IDs and flat `videos` rows remain compatible after the idempotent migration/backfill. A migration failure rolls back and leaves the source database intact.
- Multi-sport is required. Taekwondo is a progressive `tkd.v1` pack; soccer and basketball never receive irrelevant TKD fields.
- Upload success is honest: mock or pending is visible when YouTube credentials are absent. No UI may claim a public upload that did not happen.

## Verification recipes

```bash
npm run ci
git diff --check
```

For a fresh API probe, use an isolated SQLite path and upload directory. Unlock with a test-only bcrypt hash, then verify unauthenticated 401, valid/invalid PIN, newest-first timeline filters, event/moment/clip ownership, refresh persistence, hide/unhide, upload cleanup, and local-path redaction.

For UI QA, serve the built app through the Express server and inspect at 1280/1440 and 360/390/414 CSS-pixel widths. Confirm real generated imagery loads, event cards contain nested moments, no horizontal overflow is concealed, touch targets are at least 44px, and dialogs have initial focus, Escape/backdrop close, focus trapping/restoration, and background inertness.

## Operations

Compose maps host port 3015 to container port 3000. Host port 3013 is stale and must not appear in runbooks. Private free GitHub repositories do not expose the full branch-protection required-review ruleset; do not claim that gate exists. Record the limitation and enforce review through PR/critic/CI process.

There is no public HTTPS deployment for the 0.2.0 release candidate. Keep SEO metadata noindex and robots disallow-all until an operator provisions and independently verifies a real public URL.

## Date validation note

The strict date rule is the single-backslash regex `/^\d{4}-\d{2}-\d{2}$/` plus Gregorian-date validation. A documentation string with double-escaped `\\d` is not an implementation rule and must not be copied into code.
