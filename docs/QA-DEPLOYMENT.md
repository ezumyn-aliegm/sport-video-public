# Optional HTTPS proxy configuration

Local Compose runs use `TRUST_PROXY=false`. If you run a controlled TLS
reverse proxy, supply its exact IPv4 peer address as seen by Express:

```bash
export QA_TRUST_PROXY=192.0.2.10/32  # documentation example; replace it
# Configure SESSION_SECRET and FAMILY_PIN_HASH in .env first.
docker compose -f docker-compose.yml -f docker-compose.qa.yml up -d --build
```

The example address is reserved for documentation. Discover your own peer
address; do not assume it matches the proxy container address because network
address translation may change it. The override refuses to run without an
explicit value. The app accepts only an exact IPv4 address or /32, never a
broad network, hop count or unrestricted `true` value.

With `NODE_ENV=production`, session cookies use Secure when the trusted
proxy reports HTTPS. Direct HTTP requests remain usable without Secure.
Verify both paths after any network change. Do not print cookies or PINs:

- HTTPS unlock: cookie has Secure, `/api/me` is authenticated, catalog is 200.
- Direct HTTP unlock: cookie omits Secure; authenticated catalog is 200.
- Lock clears authentication; protected catalog returns 401.

These are verification steps, not a claim that this public repository has
a live deployment. No contributor's actual host or proxy topology is included.
