# Architecture

## Stack
- React + Vite frontend (static build served by Express)
- Express API + session cookie auth (family PIN)
- SQLite for catalog
- Docker compose project `sport-video`

## Deploy
- Target host: app-host (192.0.2.30) under `/opt/docker/sport-video`
- Host port: prefer free port (e.g. 3015) mapped to container 3000
- Public host: `sport-video.example.invalid` via Nginx Proxy Manager

## Auth model (v1)
Shared family PIN (bcrypt hash in env). Tradeoffs documented in README.
