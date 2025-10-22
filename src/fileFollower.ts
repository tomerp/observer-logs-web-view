import fs from 'fs';
import { EventEmitter } from 'events';
import { parseLine } from './parser';
import { LogEvent } from './types';
import { CONFIG } from './config';

export interface FileFollower {
  on(event: 'event', listener: (evt: LogEvent) => void): this;
  on(event: 'notice', listener: (msg: string) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  emit(event: 'event', evt: LogEvent): boolean;
  emit(event: 'notice', msg: string): boolean;
  emit(event: 'error', err: Error): boolean;
}

export class FileFollower extends (EventEmitter as { new(): EventEmitter }) {
  private watcher?: fs.FSWatcher;
  private lastOffset = 0;
  private lastInode?: number;
  private partial = '';

  start() {
    if (!CONFIG.logFile) {
      this.emit('notice', 'No LOG_FILE specified');
      return;
    }
    this.seedOnce()
      .catch((e) => this.emit('error', e))
      .finally(() => this.watch());
  }

  stop() {
    this.watcher?.close();
    this.watcher = undefined;
  }

  private async seedOnce(): Promise<void> {
    try {
      const [stat, content] = await Promise.all([
        fs.promises.stat(CONFIG.logFile),
        fs.promises.readFile(CONFIG.logFile, 'utf8'),
      ]);
      this.lastInode = (stat as any).ino;
      const lines = content.split('\n');
      const start = Math.max(0, lines.length - CONFIG.tailInitialLines);
      for (let i = start; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        try {
          const evt = parseLine(line);
          evt.seed = true;
          this.emit('event', evt);
        } catch (e: any) {
          this.emit('error', e);
        }
      }
      this.lastOffset = Buffer.byteLength(content, 'utf8');
    } catch (e: any) {
      this.emit('error', e);
    }
  }

  private watch() {
    this.emit('notice', `watching ${CONFIG.logFile}`);
    this.watcher = fs.watch(CONFIG.logFile, { persistent: true }, (eventType) => {
      if (eventType === 'change' || eventType === 'rename') {
        this.processUpdates().catch((e) => this.emit('error', e));
      }
    });
  }

  private async processUpdates(): Promise<void> {
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(CONFIG.logFile);
    } catch (e: any) {
      // File might be temporarily missing; skip
      return;
    }
    const inode = (stat as any).ino;
    const size = stat.size;
    if (this.lastInode && inode !== this.lastInode) {
      // File replaced; skip existing contents and start from end
      this.lastInode = inode;
      this.lastOffset = size;
      this.partial = '';
      this.emit('notice', 'file rotation detected; skipping existing content');
      return;
    }
    this.lastInode = inode;
    if (size < this.lastOffset) {
      // Truncated; jump to end
      this.emit('notice', `file truncated from ${this.lastOffset} to ${size}`);
      this.lastOffset = size;
      this.partial = '';
      return;
    }
    if (size === this.lastOffset) return; // nothing new

    const fd = await fs.promises.open(CONFIG.logFile, 'r');
    try {
      const toRead = size - this.lastOffset;
      const buffer = Buffer.allocUnsafe(Math.max(8192, Math.min(1 << 20, toRead)));
      let position = this.lastOffset;
      while (position < size) {
        const len = Math.min(buffer.length, size - position);
        const { bytesRead } = await fd.read({ buffer, offset: 0, length: len, position });
        if (bytesRead <= 0) break;
        position += bytesRead;
        this.partial += buffer.toString('utf8', 0, bytesRead);
        let idx: number;
        while ((idx = this.partial.indexOf('\n')) >= 0) {
          const line = this.partial.slice(0, idx);
          this.partial = this.partial.slice(idx + 1);
          if (line.trim().length === 0) continue;
          try {
            const evt = parseLine(line);
            this.emit('event', evt);
          } catch (e: any) {
            this.emit('error', e);
          }
        }
      }
      this.lastOffset = size;
    } finally {
      await fd.close();
    }
  }
}


