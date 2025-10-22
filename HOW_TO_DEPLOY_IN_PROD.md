## How to deploy in production

This runs alongside your observer on the same machine and reads logs via Docker.

### 1) Requirements
- Node.js 18+ (nvm recommended)
- The service user must be in the `docker` group (or run with sudo)

### 2) Install
```bash
cd ~/flare-systems-deployment
git clone (or copy) observer-logs-web-view
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
export TOKEN=<shared_token>
export PORT=43117
export HOST=0.0.0.0

npm start
```

Open the browser: `http://<server-ip>:43117` and enter the token.

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
Environment=TOKEN=<shared_token>
Environment=PORT=43117
Environment=HOST=0.0.0.0
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


