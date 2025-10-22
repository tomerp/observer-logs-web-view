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
  });
  follower.on('notice', (msg: string) => {
    const payload = JSON.stringify({ type: 'notice', data: { msg, ts: Date.now() } });
    for (const client of wss.clients) {
      if (client.readyState === 1) { try { client.send(payload); } catch {} }
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

  app.get('/api/v1/recent', authMiddleware, (req: Request, res: Response) => {
    const { limit, since } = req.query as { limit?: string; since?: string };
    let events = buffer.toArray();
    if (since) {
      const ts = Date.parse(since);
      if (!isNaN(ts)) events = events.filter((e) => e.ts >= ts);
    }
    const lim = Math.min(Number(limit || CONFIG.recentLimit), CONFIG.recentLimit);
    if (events.length > lim) events = events.slice(events.length - lim);
    res.json({ events });
  });

  app.get('/api/v1/metrics', authMiddleware, (_req: Request, res: Response) => {
    const snap = stats.snapshot(Date.now());
    res.json(snap);
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
    }, 25000);
    ws.on('close', () => clearInterval(pingInterval));
  });

  follower.start();

  return { app, server };
}


