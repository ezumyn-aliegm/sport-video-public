# AGENTS.md

## Project

Our Team Memories is a Vite/React client with an Express + SQLite server. The durable repository is https://github.com/ezumyn-aliegm/sport-video-public.

## Engineering rules

- Work from a freshly fetched `origin/main` on a named branch; do not treat Kanban scratch workspaces as the product home.
- The UI must read and mutate persisted API state. Do not add seed arrays for athletes, events, moments, clips, counts, or hidden state.
- Preserve the hierarchy Family PIN -> Athlete -> Sport -> Event -> Moment -> Clip. Clips require an event owner and may optionally have a moment owner.
- Keep `children` and `videos` compatibility routes while canonical code uses athletes, timeline, events, moments, and clips.
- Validate request data on the server: dates, enums, sport relationships, URLs, MIME types, file size, tag limits, and sport-pack fields. Use bound SQL values.
- Never serialize private upload paths, PIN hashes, session secrets, or OAuth credentials.
- Upload state must be honest. `mock` and `pending` are valid user-visible states; never pretend YouTube publishing succeeded without credentials.
- Use generated imagery under `public/assets/generated/` for product surfaces. Do not replace it with blank gradients or placeholder SVG hero art.
- Preserve 44px minimum touch targets and dialog keyboard behavior: initial focus, Escape/backdrop close, focus trap/restore, and background inertness.

## Commands

```bash
npm run ci
npm run server
npm run dev
```

Compose exposes host port 3015 -> container port 3000. Port 3013 is stale. Deploy only an approved `main` SHA or release tag after PR review and CI; no deployment is part of the v0.2.0 integration task.

## Review and docs

Every user-visible change bumps semver and adds a concrete CHANGELOG entry. PR descriptions must include exact tests, browser render evidence, head SHA, CI URL/status, and known limitations. Private free GitHub repositories cannot enforce the full required-review branch-protection ruleset; document that limitation rather than claiming the setting exists.

The current candidate has no public HTTPS deployment. Keep SEO metadata noindex and robots disallow-all until a real public host is provisioned and independently verified.
