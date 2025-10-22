## What is this?

Observer Logs Web View is a small Node.js/TypeScript service that streams the FTSO observer logs to a web browser with lightweight real‑time analytics.

### Key features
- Live tail in the browser via WebSocket
- Rolling last‑60‑minutes counts for WARNING/ERROR/CRITICAL
- Displays last processed round and seconds since last round
- Token-protected APIs (shared bearer token or `?token=` param)
- Minimal UI included; React frontend can be added later using the same APIs

### Data sources (two modes)
- Docker mode (production): seeds from `docker logs --since=<window>` and then follows live logs with `docker logs --tail=0 -f`.
- File mode (local dev): seeds the last N lines from a file, then follows new appended bytes using fs watchers.

### Endpoints
- WebSocket: `/ws` (messages: `hello`, `line`, `stats`, `notice`)
- REST: `/api/v1/recent`, `/api/v1/metrics`, `/api/v1/health`
- Short aliases: `/recent`, `/metrics`, `/health`
- Static UI: `/`

### Configuration (env vars)
- `PORT` (default: 43117)
- `HOST` (default: 0.0.0.0)
- `TOKEN` (optional, shared secret)
- `SOURCE` (`docker` or `file`, default: `docker`)
- `CONTAINER_NAME` (default: `ftso-v2-deployment-fdc-observer-1`)
- `DOCKER_SINCE` (default: `1h`)
- `DOCKER_USE_SUDO` (`1`/`true` to run `sudo docker logs`)
- `LOG_FILE` (file mode only)
- `TAIL_N` (file mode initial lines, default: 2000)
- `RECENT_LIMIT` (ring buffer size, default: 5000)
- `STATS_WINDOW_MINUTES` (default: 60)

### Other behavior
- Timestamps in logs are interpreted as server-local time to avoid timezone skew.
- WebSocket keep-alive pings prevent idle disconnects through NAT/load balancers.


