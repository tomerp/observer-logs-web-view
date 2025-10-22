## How this works

### Overview
The service exposes a WebSocket and REST API. It seeds recent history once, then streams live log lines to connected clients and maintains rolling stats in memory.

### Components
- `src/logFollower.ts` (Docker mode)
  - Seeds with `docker logs --since=<DOCKER_SINCE>` (marked `seed: true`), then follows live with `docker logs --tail=0 -f`.
  - Parses lines and emits `LogEvent`s.
- `src/fileFollower.ts` (File mode)
  - Seeds by reading the last `TAIL_N` lines from `LOG_FILE` (marked `seed: true`).
  - Watches file changes and reads only appended bytes; handles rotation/truncation via inode/offset.
- `src/parser.ts`
  - Extracts timestamp, level (INFO/WARNING/ERROR/CRITICAL), and fields (`round`, `network`, `protocol`).
  - Keeps `raw` text and computed `isoTs`.
- `src/stats.ts`
  - Keeps minute buckets for the last `STATS_WINDOW_MINUTES` minutes for WARNING/ERROR/CRITICAL.
  - Tracks the last processed round and seconds since last round.
- `src/ringBuffer.ts`
  - In-memory ring buffer of the last `RECENT_LIMIT` events for `/recent` hydration.
- `src/server.ts`
  - Express app with REST endpoints and a `ws` server.
  - Broadcasts `line` and periodic `stats` to all WS clients.
  - Token auth via `Authorization: Bearer <TOKEN>` or `?token=`.
  - Serves the minimal UI at `/`.

### Message formats
- WS `hello`: `{ type: 'hello', data: { version: 1, now } }`
- WS `line`: `{ type: 'line', data: LogEvent }`
- WS `stats`: `{ type: 'stats', data: StatsSnapshot }`
- WS `notice`: `{ type: 'notice', data: { msg, ts } }`

### Behavior notes
- Seed events set `seed: true`; the UI avoids autoscroll during seed to prevent jumpiness.
- Backpressure: clients receive messages best-effort; if a client is slow, messages may be dropped by the browser. Server sends small JSON frames.
- Memory: all data is in-memory; restart clears buffers and stats.

### Extensibility
- Add new analytics by updating `stats.ts` and sending extra fields in `StatsSnapshot`.
- Add filters by extending the UI and optionally adding query params to `/recent`.
- Replace the minimal UI with a React app consuming the same APIs.


