# Architecture

- React + Vite frontend; the built assets are served by Express.
- Express API with a shared family PIN and session-cookie authentication.
- SQLite catalog with a backward-compatible event/moment/clip migration.
- Private uploads are served only through authenticated routes.
- Docker Compose maps host port 3015 to container port 3000.

## Deployment configuration

Choose your own host, storage volume and HTTPS hostname. No contributor's
server, domain or network topology is required. The optional QA override
requires the exact reverse-proxy peer address seen by Express; see
[QA-DEPLOYMENT.md](QA-DEPLOYMENT.md).

## Scope

This is a single-family application, not a multi-account public video service.
The shared PIN has no per-user audit trail. Live YouTube publishing is not
implemented. Demo records and imagery are described in the README.
