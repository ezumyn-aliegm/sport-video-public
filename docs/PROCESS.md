# Development process (Graph AI engineering + SDLC)

This project must not live only in Hermes Kanban scratch workspaces.

## Mandatory ship path

1. **Spec** on Kanban with definition of done.
2. **Git branch** from `main` (`feat/…`, `fix/…`).
3. **Implement** on the branch (Hermes programmer or human).
4. **Tests + lint + build** pass locally (`npm run ci`).
5. **Pull request** to `main` (no direct push of feature work to main).
6. **Review gate** — Hermes critic and/or human: flaws first, PR diff required.
7. **CI green** on the PR.
8. **Version** — bump semver + CHANGELOG for user-visible change.
9. **Deploy** from a tagged release or `main` SHA; QA against running URL.
10. **Kanban complete** only with PR URL + version + deploy URL + QA evidence.

## Forbidden

- Completing a product card with code only in `~/.hermes/kanban/.../workspaces/...` and no git commit.
- Merging without PR review for non-trivial changes.
- Shipping without version/CHANGELOG update.
- Claiming mobile/UX pass without rendered QA evidence.

## Repo

GitHub: set after `gh repo create`. Durable path: `/Users/demo/work/sport-video` (or clone path).
