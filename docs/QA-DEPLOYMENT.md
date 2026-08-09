# Sport Video QA deployment

This repository includes `docker-compose.qa.yml` for the non-production QA host at `app-host`. Use the override only when the service is reached through the controlled Nginx Proxy Manager TLS reverse proxy; never use it as a generic production default.

```bash
docker compose -f docker-compose.yml -f docker-compose.qa.yml up -d --build
```

The override sets `TRUST_PROXY=192.0.2.1/32`. Although Nginx Proxy Manager currently has `198.51.100.3` on its Docker network, its request to the host-published port `3015` is NATed into the app's `sport-video_default` network and arrives at Express from the bridge gateway `192.0.2.1` (verified on the QA host with a sanitized long-lived root request). Nginx Proxy Manager forwards the public request scheme in `X-Forwarded-Proto`, so `express-session`'s production `secure: 'auto'` cookie is `Secure` on the public HTTPS face. Direct LAN requests to host port `3015` originate outside this exact trusted address, so forwarded headers are ignored and the request receives a non-Secure cookie that remains usable over HTTP.

Do not replace the exact address with an unrestricted `true` value, a hop count, or a broad network: Express rate limiting warns that permissive proxy trust allows client-controlled forwarding headers to bypass IP-based limits. If Docker recreates the bridge with a different gateway or the proxy topology changes, update the allowlist and regression coverage before deploying; invalid values fail startup rather than silently disabling proxy trust.

## Sanitized verification

After an authorized QA unlock, inspect only these attributes and statuses; never print cookie values, PINs, or response bodies containing private data:

- Public HTTPS: `Set-Cookie` includes `Secure`; `/api/me` is authenticated; a protected catalog route returns `200`.
- Direct LAN HTTP: `Set-Cookie` omits `Secure`; `/api/me` is authenticated; a protected catalog route returns `200`.
- After lock/logout on each face: `/api/me` is unauthenticated and the protected catalog route returns `401`.

The QA override is intentionally separate from `docker-compose.yml` so local/direct-LAN Compose runs keep the safe default `TRUST_PROXY=false`.
