## How to deploy in production
TLDR: look for "(USING THIS ONE)" in this document

This runs alongside your observer on the same machine and reads logs via Docker.

### 1) Requirements
- Node.js 18+ (nvm recommended)
- The service user must be in the `docker` group (or run with sudo) (I chose "run with sudo")

### 2) Install
Clone from GitHub (HTTPS):
```bash
cd ~/flare-systems-deployment
git clone https://github.com/tomerp/observer-logs-web-view.git
cd observer-logs-web-view
nvm use 18
npm ci
npm run build
```

### 3) Configure and run
```bash
export SOURCE=docker
export CONTAINER_NAME=ftso-v2-deployment-fdc-observer-1
export DOCKER_SINCE=1h
export DOCKER_USE_SUDO=1   # if your user isn't in the docker group
export TOKEN=<shared_token>
export PORT=43117
export HOST=0.0.0.0
export VERBOSE=1

npm start
```

Open the browser: `http://<server-ip>:43117` and enter the token.

Health and APIs:
- `GET /health` → `{ ok: true }`
- `GET /recent?limit=5000&since=<iso>` (token required)
- `GET /metrics` (token required)

### 3.1) Run without systemd (keeps running after logout)

Option A — tmux (recommended, you can type sudo password and detach)
```bash
sudo apt-get install -y tmux  # if not installed
tmux new -s observer-logs

# inside tmux
cd ~/flare-systems-deployment/observer-logs-web-view
export SOURCE=docker CONTAINER_NAME=ftso-v2-deployment-fdc-observer-1 \
       DOCKER_SINCE=24h DOCKER_USE_SUDO=1 LOG_TS_IS_UTC=1 \
       TOKEN=<shared_token> PORT=43117 HOST=0.0.0.0 VERBOSE=1
npm run build
npm start   # you will be prompted for sudo password (seed + follow)

# detach tmux without stopping the app:  Ctrl-b then d
# reattach later:  tmux attach -t observer-logs
# stop: reattach and Ctrl-C, or: tmux kill-session -t observer-logs
```

(USING THIS ONE) Option B — nohup with sudo pre-auth (no interactive TTY after start)
```bash
cd ~/flare-systems-deployment/observer-logs-web-view
export SOURCE=docker CONTAINER_NAME=ftso-v2-deployment-fdc-observer-1 \
       DOCKER_SINCE=24h DOCKER_USE_SUDO=1 LOG_TS_IS_UTC=1 \
       TOKEN=<shared_token> PORT=43117 HOST=0.0.0.0 VERBOSE=1

# Authenticate sudo once (you will type your password)
sudo -v

# Optional: (DID NOT DO THIS ONE) keep sudo fresh so restarts won’t prompt (expires ~15 min otherwise)
( while true; do sudo -n true; sleep 60; done ) 2>/dev/null &  echo $! > /tmp/sudo-keepalive.pid

# Run in background and detach from SSH session
nohup bash -lc 'npm run build && npm start' \
  > /home/$USER/observer-logs-web-view.out 2>&1 & disown

# Check logs
tail -f /home/$USER/observer-logs-web-view.out

# Stop app
pkill -f "node dist/index.js" || true
# Stop sudo keepalive (if you started it)
kill $(cat /tmp/sudo-keepalive.pid) 2>/dev/null || true
```

Notes:
- tmux is safest when `DOCKER_USE_SUDO=1` because it gives you a TTY if the app needs the password again (e.g., after reconnects).
- The nohup approach relies on the sudo timestamp; use the keepalive loop if you cannot join the docker group.

### 4) Make it a systemd service
Create `/etc/systemd/system/observer-logs-web-view.service`:
```
[Unit]
Description=Observer Logs Web View
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=<your-user>
WorkingDirectory=/home/<your-user>/flare-systems-deployment/observer-logs-web-view
Environment=NODE_ENV=production
Environment=SOURCE=docker
Environment=CONTAINER_NAME=ftso-v2-deployment-fdc-observer-1
Environment=DOCKER_SINCE=1h
Environment=DOCKER_USE_SUDO=1
Environment=TOKEN=<shared_token>
Environment=PORT=43117
Environment=HOST=0.0.0.0
Environment=VERBOSE=1
ExecStart=/home/<your-user>/.nvm/versions/node/v18.20.2/bin/node dist/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now observer-logs-web-view.service
sudo systemctl status observer-logs-web-view.service
```

### 5) Secure access
- Keep it on 43117 and use SSH tunneling when remote:
```bash
ssh -L 43117:127.0.0.1:43117 tomer@<server>
```
- Or allow LAN access; if exposing to internet, put it behind a reverse proxy with HTTPS and IP allowlists.


