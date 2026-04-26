import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { CONFIG } from './config';
import { LogFollower } from './logFollower';
import { FileFollower } from './fileFollower';
import { RingBuffer } from './ringBuffer';
import { LogEvent } from './types';
import { RollingStats } from './stats';

export function createServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: CONFIG.corsOrigin === '*' ? true : CONFIG.corsOrigin }));
  if (CONFIG.verbose) {
    app.use((req, _res, next) => {
      // eslint-disable-next-line no-console
      console.log(`[REQ] ${req.method} ${req.originalUrl}`);
      next();
    });
  }

  function authMiddleware(req: Request, res: Response, next: NextFunction) {
    if (!CONFIG.token) return next();
    const header = req.headers['authorization'];
    const urlToken = (req.query.token as string) || '';
    const bearer = header && header.startsWith('Bearer ') ? header.slice(7) : '';
    if (bearer === CONFIG.token || urlToken === CONFIG.token) return next();
    return res.status(401).json({ error: 'unauthorized' });
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  const follower = CONFIG.source === 'file' ? new FileFollower() : new LogFollower();
  const buffer = new RingBuffer<LogEvent>(CONFIG.recentLimit);
  const stats = new RollingStats(CONFIG.statsWindowMinutes);

  follower.on('event', (evt: LogEvent) => {
    buffer.push(evt);
    stats.add(evt);
    const payload = JSON.stringify({ type: 'line', data: evt });
    for (const client of wss.clients) {
      if (client.readyState === 1 /* OPEN */) {
        try { client.send(payload); } catch {}
      }
    }
    if (CONFIG.verbose && !evt.seed) {
      // eslint-disable-next-line no-console
      console.log(`[LINE] ${evt.raw}`);
    }
  });
  follower.on('notice', (msg: string) => {
    const payload = JSON.stringify({ type: 'notice', data: { msg, ts: Date.now() } });
    for (const client of wss.clients) {
      if (client.readyState === 1) { try { client.send(payload); } catch {} }
    }
    if (CONFIG.verbose) {
      // eslint-disable-next-line no-console
      console.log(`[NOTICE] ${msg}`);
    }
  });

  // Periodic stats push
  const statsTimer = setInterval(() => {
    const snapshot = stats.snapshot(Date.now());
    const payload = JSON.stringify({ type: 'stats', data: snapshot });
    for (const client of wss.clients) {
      if (client.readyState === 1) { try { client.send(payload); } catch {} }
    }
  }, CONFIG.statsPushIntervalMs);
  if (typeof (statsTimer as any).unref === 'function') (statsTimer as any).unref();

  // REST endpoints
  app.get('/api/v1/health', (_req: Request, res: Response) => res.json({ ok: true }));
  // Aliases for convenience
  app.get('/health', (_req: Request, res: Response) => res.json({ ok: true }));

  app.get('/api/v1/recent', authMiddleware, (req: Request, res: Response) => {
    const { limit, since } = req.query as { limit?: string; since?: string };
    let events = buffer.toArray();
    const preCount = events.length;
    if (since) {
      const ts = Date.parse(since);
      if (!isNaN(ts)) events = events.filter((e) => e.ts >= ts);
    }
    const lim = Math.min(Number(limit || CONFIG.recentLimit), CONFIG.recentLimit);
    if (events.length > lim) events = events.slice(events.length - lim);
    if (CONFIG.verbose) {
      const first = events[0]?.isoTs;
      const last = events[events.length - 1]?.isoTs;
      // eslint-disable-next-line no-console
      console.log(`[RECENT] pre=${preCount} filtered=${events.length} limit=${lim} since=${since || 'none'} first=${first || '-'} last=${last || '-'}`);
    }
    res.json({ events });
  });
  app.get('/recent', authMiddleware, (req: Request, res: Response) => {
    const { limit, since } = req.query as { limit?: string; since?: string };
    let events = buffer.toArray();
    const preCount = events.length;
    if (since) {
      const ts = Date.parse(since);
      if (!isNaN(ts)) events = events.filter((e) => e.ts >= ts);
    }
    const lim = Math.min(Number(limit || CONFIG.recentLimit), CONFIG.recentLimit);
    if (events.length > lim) events = events.slice(events.length - lim);
    if (CONFIG.verbose) {
      const first = events[0]?.isoTs;
      const last = events[events.length - 1]?.isoTs;
      // eslint-disable-next-line no-console
      console.log(`[RECENT] pre=${preCount} filtered=${events.length} limit=${lim} since=${since || 'none'} first=${first || '-'} last=${last || '-'}`);
    }
    res.json({ events });
  });

  app.get('/api/v1/metrics', authMiddleware, (_req: Request, res: Response) => {
    const snap = stats.snapshot(Date.now());
    res.json(snap);
  });
  app.get('/metrics', authMiddleware, (_req: Request, res: Response) => {
    const snap = stats.snapshot(Date.now());
    res.json(snap);
  });

  // Minimal view: no WebSocket. Refreshes every 5s; a small script applies browser-local
  // timestamps (same logic as the main UI) and #log-end (meta refresh to a fixed #url stops
  // after once when it matches the current page in many browsers).
  // Same auth as /recent; optional ?limit= (default 500, capped at RECENT_LIMIT).
  app.get('/view-lite', authMiddleware, (req: Request, res: Response) => {
    const { limit: limitQ } = req.query as { limit?: string };
    let events = buffer.toArray();
    const defaultLite = 500;
    const lim = Math.min(
      Math.max(1, Number(limitQ) || defaultLite),
      CONFIG.recentLimit
    );
    if (events.length > lim) events = events.slice(events.length - lim);

    const viewLiteData = {
      lines: events.map((e) => ({ ts: e.ts, raw: e.raw, level: e.level })),
    };
    const viewLiteJson = JSON.stringify(viewLiteData).replace(/</g, '\\u003c');

    res.type('html').send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="5" />
  <title>Observer Logs (lite)</title>
  <style>
    body { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; margin: 0; background: #000; color: #ddd; }
    header { padding: 8px 12px; background: #111; color: #eee; font-size: 14px; }
    #log { padding: 8px 12px; }
    #log > div { margin: 0; padding: 0; line-height: 1.35; white-space: pre-wrap; word-break: break-word; }
    .INFO { color: #9aa7ff; }
    .WARNING { color: #ffd666; }
    .ERROR { color: #ff6b6b; }
    .CRITICAL { color: #ff66a1; font-weight: bold; }
    .UNKNOWN { color: #aaa; }
  </style>
</head>
<body>
  <header>Observer Logs (lite) · auto-refresh 5s · ${events.length} lines (limit ${lim})</header>
  <div id="log"></div>
  <div id="log-end"></div>
  <script>window.__VIEW_LITE__=${viewLiteJson};</script>
  <script>
(function(){
  function formatLocalLine(evt) {
    try {
      var ts = typeof evt.ts === 'number' ? evt.ts : Date.now();
      var localTs = new Date(ts).toLocaleString();
      var raw = String(evt.raw || '');
      var idx = raw.indexOf('\\t');
      if (idx >= 0) return (localTs + raw.slice(idx)).replace(/\\r?\\n+$/g, '');
      return (localTs + ' ' + raw).replace(/\\r?\\n+$/g, '');
    } catch (e) { return String(evt && evt.raw != null ? evt.raw : ''); }
  }
  var d = window.__VIEW_LITE__;
  var list = d && d.lines;
  if (!list || !list.length) return;
  var log = document.getElementById('log');
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    var div = document.createElement('div');
    var lv = e.level;
    div.className = ['INFO','WARNING','ERROR','CRITICAL','UNKNOWN'].indexOf(lv) >= 0 ? lv : 'UNKNOWN';
    div.textContent = formatLocalLine(e);
    log.appendChild(div);
  }
  location.replace(location.pathname + location.search + '#log-end');
})();
  </script>
</body>
</html>`);
  });

  // Debug endpoint
  app.get('/debug', authMiddleware, (_req: Request, res: Response) => {
    const events = buffer.toArray();
    const info = {
      bufferSize: events.length,
      first: events[0]?.isoTs,
      last: events[events.length - 1]?.isoTs,
    };
    res.json(info);
  });

  // Static minimal UI
  app.use('/', express.static(path.join(__dirname, 'static')));

  // WS auth on connection
  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    if (CONFIG.token) {
      const url = new URL(req.url || '', 'http://localhost');
      const tokenParam = url.searchParams.get('token') || '';
      const auth = req.headers['authorization'];
      const bearer = auth && auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (tokenParam !== CONFIG.token && bearer !== CONFIG.token) {
        ws.close(1008, 'unauthorized');
        return;
      }
    }
    ws.send(JSON.stringify({ type: 'hello', data: { version: 1, now: Date.now() } }));
    // Keep-alive ping to prevent intermediaries from closing idle connections
    const pingInterval = setInterval(() => {
      if (ws.readyState === 1) { try { ws.ping(); } catch {} }
    }, 20000);
    ws.on('close', () => clearInterval(pingInterval));
  });

  if (CONFIG.verbose) {
    // eslint-disable-next-line no-console
    console.log(`[BOOT] source=${CONFIG.source} container=${CONFIG.containerName} since=${CONFIG.dockerSince} sudo=${CONFIG.dockerUseSudo}`);
  }
  follower.start();

  return { app, server };
}


