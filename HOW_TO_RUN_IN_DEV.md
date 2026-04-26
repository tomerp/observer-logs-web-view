## How to run in development (local file mode)

This guide explains how to run `observer-logs-web-view` **locally on your machine**, without Docker, and have it follow a **growing local log file** using `SOURCE=file`.

### 1) Requirements

- **Node.js 18+** (nvm recommended)
- **npm** (comes with Node)
- A log file on your machine that will **keep growing** (e.g. another process writing logs to `app.log`)

### 2) Install dependencies

From the project root:

```bash
cd observer-logs-web-view
nvm use 18          # or ensure Node 18+ is active
npm install         # or: npm ci  (if you prefer)
```

### 3) Configure for file mode

The server chooses between Docker logs and a plain file based on the `SOURCE` env var:

- **Docker mode**: `SOURCE=docker` (default)
- **File mode**: `SOURCE=file`

For local development following a file, set at least:

```bash
# LOG_FILE must exist. PORT defaults to 43117. Use HOST=0.0.0.0 for LAN. TOKEN can be empty.
export SOURCE=file
export LOG_FILE=test-observer.log
export PORT=43117
export HOST=127.0.0.1
export VERBOSE=1
export TOKEN=dev-token
export LOG_TS_IS_UTC=1
# If the first field in each line is **UTC** (e.g. docker-style logs, or forTestingAppendToLog.sh), add:
# export LOG_TS_IS_UTC=1
```

Avoid trailing `# ...` comments on the same line as `export` when copy-pasting: some clients drop the `#`, which turns the rest of the line into extra words and zsh will error with `export: not valid in this context: optional,`.

Notes:
- **`LOG_FILE` must exist** at startup; the app will:
  - Seed from the last `TAIL_N` lines (env: `TAIL_N`, default 2000),
  - Then watch for new lines as they are appended.

#### Timestamps: `LOG_TS_IS_UTC` (read this if times look “wrong” in the UI)

The parser turns the first tab-separated field on each line into an epoch. That field is either **local** or **UTC** depending on this env var:

| Setting | Parser behavior | Typical use |
|--------|------------------|-------------|
| (unset) | First field = **local** wall time | Logs written in your machine’s local timezone **without** a `Z` / UTC designator |
| `LOG_TS_IS_UTC=1` | First field = **UTC** | **Production** uses this with Docker/observer-style UTC timestamps. **`forTestingAppendToLog.sh` uses `date -u`**, so its lines are UTC: set this or the main UI will show misleading “local” times. |

`HOW_TO_DEPLOY_IN_PROD.md` sets `LOG_TS_IS_UTC=1` for production. For a dev environment that matches that behavior, add `export LOG_TS_IS_UTC=1` to your shell (or the one-liner in §5) whenever you use the test script or any UTC-sourced file.

### 4) (Optional) Use the test log generator script

For quick local testing, there is a helper script that creates (if needed) and continuously appends to a log file:

- Script: `forTestingAppendToLog.sh`
- Default log path: `./test-observer.log` in this repo
- Timestamps are written with `date -u` (**UTC**). The server’s default is to treat the first field as **local** time unless you set `LOG_TS_IS_UTC=1` (see **Timestamps** above), so you almost always want that when using this script next to the dev server.

Run it in one terminal:

```bash
cd observer-logs-web-view

# Option A: use default ./test-observer.log
bash ./forTestingAppendToLog.sh

# Option B: specify a custom log file path
bash ./forTestingAppendToLog.sh /absolute/path/to/your.log
```

You can also control the target file via `LOG_FILE`:

```bash
cd observer-logs-web-view
LOG_FILE=$PWD/test-observer.log bash ./forTestingAppendToLog.sh
```

Leave this running (it appends a line every second) while you start the dev server in another terminal.

### 5) Start the server in dev mode

There are two common ways to run it locally:

#### Option A — `npm run dev` (TypeScript, auto-reload)

This uses `nodemon` + `ts-node` to watch the `src` directory and restart on changes.

```bash
cd observer-logs-web-view

export SOURCE=file LOG_FILE=$PWD/test-observer.log \
       PORT=43117 HOST=127.0.0.1 VERBOSE=1 TOKEN=dev-token \
       LOG_TS_IS_UTC=1

npm run dev
```

(`LOG_TS_IS_UTC=1` matches production and the UTC timestamps from `forTestingAppendToLog.sh`. Omit it if your log file’s first column is already in **local** time.)

#### Option B — build once, then `npm start`

This is closer to production (runs compiled JS from `dist/`), but without Docker.

```bash
cd observer-logs-web-view

export SOURCE=file LOG_FILE=$PWD/test-observer.log \
       PORT=43117 HOST=127.0.0.1 VERBOSE=1 TOKEN=dev-token \
       LOG_TS_IS_UTC=1

npm run build
npm start
```

### 6) Open the UI

With the server running:

- **Main UI:** `http://127.0.0.1:43117` — live tail via WebSocket, stats in the header, token field. If you set `TOKEN`, enter it when prompted (or append `?token=dev-token` to the URL).
- **Lite UI:** `http://127.0.0.1:43117/view-lite?token=dev-token` (if using a token) — server-rendered page, no WebSocket; refreshes every 5s and shows the last 500 lines by default. Add `&limit=200` to show fewer lines on slow devices.

You should see on the main UI:
- The recent seed of log lines from the end of `LOG_FILE`,
- New lines appearing in real time as your other process writes to the log.

### 7) Troubleshooting tips

- **Timestamps in the main UI look like raw file time / not your local zone**
  - The browser shows `toLocaleString()` for `evt.ts`. If `evt.ts` was parsed wrong, time will be wrong. For UTC first-column logs (incl. `forTestingAppendToLog.sh`), set **`LOG_TS_IS_UTC=1`**. See **Timestamps: `LOG_TS_IS_UTC`** in §3.
- **No lines appearing**
  - Confirm `SOURCE=file` (e.g. `echo $SOURCE`) and that `LOG_FILE` exists and is being written to.
  - Check the terminal output for `[NOTICE]` or `[ERROR]` messages (use `VERBOSE=1`).
- **File rotation / truncation**
  - The file follower detects inode changes and truncation and will emit notices like
    *"file rotation detected; skipping existing content"* or *"file truncated from X to Y"*.
  - This is expected when your log is rotated; it will resume from the new end.

