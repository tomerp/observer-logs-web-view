import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import { parseLine } from './parser';
import { LogEvent } from './types';
import { CONFIG } from './config';

export interface LogFollowerEvents {
  event: (evt: LogEvent) => void;
  notice: (msg: string) => void;
  error: (err: Error) => void;
}

export interface LogFollower {
  on(event: 'event', listener: (evt: LogEvent) => void): this;
  on(event: 'notice', listener: (msg: string) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  emit(event: 'event', evt: LogEvent): boolean;
  emit(event: 'notice', msg: string): boolean;
  emit(event: 'error', err: Error): boolean;
}

export class LogFollower extends (EventEmitter as { new(): EventEmitter }) {
  private child?: ChildProcessWithoutNullStreams;
  private restarting = false;
  private backoffMs = 1000;

  start() {
    // Seed recent history, then follow only new lines
    this.seedOnce()
      .catch((e) => this.emit('error', e))
      .finally(() => this.launch());
  }

  stop() {
    if (this.child) {
      this.child.removeAllListeners();
      this.child.kill('SIGTERM');
      this.child = undefined;
    }
    this.restarting = false;
  }

  private launch() {
    const args = ['logs', '-f', '--tail=0', CONFIG.containerName];
    const cmd = CONFIG.dockerUseSudo ? 'sudo' : 'docker';
    const spawnArgs = CONFIG.dockerUseSudo ? ['docker', ...args] : args;
    this.child = spawn(cmd, spawnArgs); // default stdio gives non-null stdout/stderr
    const cp = this.child;
    this.emit('notice', `spawned: ${cmd} ${spawnArgs.join(' ')}`);

    const processStream = (chunk: Buffer, label: 'stdout' | 'stderr') => {
      let buf = label === 'stdout' ? stdoutBuffer : stderrBuffer;
      buf += chunk.toString('utf8');
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        try {
          const evt = parseLine(trimmed);
          this.emit('event', evt);
        } catch (e: any) {
          this.emit('error', e);
        }
      }
      if (label === 'stdout') stdoutBuffer = buf; else stderrBuffer = buf;
    };

    let stdoutBuffer = '';
    let stderrBuffer = '';
    cp.stdout.on('data', (chunk: Buffer) => processStream(chunk, 'stdout'));
    cp.stderr.on('data', (chunk: Buffer) => processStream(chunk, 'stderr'));

    cp.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      this.emit('notice', `docker logs exited code=${code} signal=${signal}`);
      if (!this.restarting) {
        this.restarting = true;
        setTimeout(() => {
          this.restarting = false;
          this.backoffMs = Math.min(this.backoffMs * 2, 30000);
          this.launch();
        }, this.backoffMs);
      }
    });
  }

  private async seedOnce(): Promise<void> {
    return new Promise((resolve) => {
      const args = ['logs', `--since=${CONFIG.dockerSince}`, CONFIG.containerName];
      const cmd = CONFIG.dockerUseSudo ? 'sudo' : 'docker';
      const spawnArgs = CONFIG.dockerUseSudo ? ['docker', ...args] : args;
      const seedProc = spawn(cmd, spawnArgs);
      let stdoutBuffer = '';
      seedProc.stdout.on('data', (chunk: Buffer) => {
        stdoutBuffer += chunk.toString('utf8');
        let idx: number;
        while ((idx = stdoutBuffer.indexOf('\n')) >= 0) {
          const line = stdoutBuffer.slice(0, idx);
          stdoutBuffer = stdoutBuffer.slice(idx + 1);
          if (line.trim().length === 0) continue;
          try {
            const evt = parseLine(line);
            evt.seed = true;
            this.emit('event', evt);
          } catch (e: any) {
            this.emit('error', e);
          }
        }
      });
      seedProc.on('exit', () => resolve());
      seedProc.on('error', () => resolve());
    });
  }
}


