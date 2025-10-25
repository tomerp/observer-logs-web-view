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
    if (CONFIG.verbose) {
      // eslint-disable-next-line no-console
      console.log(`[SPAWN] ${cmd} ${spawnArgs.join(' ')}`);
    }

    const processStream = (chunk: Buffer, label: 'stdout' | 'stderr') => {
      let buf = label === 'stdout' ? stdoutBuffer : stderrBuffer;
      buf += chunk.toString('utf8');
      let idx: number;
      let processed = 0;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        try {
          const evt = parseLine(trimmed);
          this.emit('event', evt);
          processed++;
        } catch (e: any) {
          this.emit('error', e);
        }
      }
      if (label === 'stdout') stdoutBuffer = buf; else stderrBuffer = buf;
      if (CONFIG.verbose && processed > 0) {
        // eslint-disable-next-line no-console
        console.log(`[STREAM ${label}] processed=${processed} remainingBytes=${Buffer.byteLength(buf, 'utf8')}`);
      }
    };

    let stdoutBuffer = '';
    let stderrBuffer = '';
    cp.stdout.on('data', (chunk: Buffer) => processStream(chunk, 'stdout'));
    cp.stderr.on('data', (chunk: Buffer) => processStream(chunk, 'stderr'));

    cp.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      this.emit('notice', `docker logs exited code=${code} signal=${signal}`);
      if (CONFIG.verbose) {
        // eslint-disable-next-line no-console
        console.log(`[EXIT] code=${code} signal=${signal}`);
      }
      if (!this.restarting) {
        this.restarting = true;
        setTimeout(() => {
          this.restarting = false;
          this.backoffMs = Math.min(this.backoffMs * 2, 30000);
          this.launch();
        }, this.backoffMs);
      }
    });

    cp.on('error', (err: Error) => {
      const msg = `docker logs spawn error: ${err.message}`;
      this.emit('notice', msg);
      if (CONFIG.verbose) {
        // eslint-disable-next-line no-console
        console.log(`[ERROR] ${msg}`);
      }
    });
  }

  private async seedOnce(): Promise<void> {
    return new Promise((resolve) => {
      const args = ['logs', `--since=${CONFIG.dockerSince}`, CONFIG.containerName];
      const cmd = CONFIG.dockerUseSudo ? 'sudo' : 'docker';
      const spawnArgs = CONFIG.dockerUseSudo ? ['docker', ...args] : args;
      const seedProc = spawn(cmd, spawnArgs);
      if (CONFIG.verbose) {
        // eslint-disable-next-line no-console
        console.log(`[SEED] ${cmd} ${spawnArgs.join(' ')}`);
      }
      let stdoutBuffer = '';
      let stderrBuffer = '';
      let count = 0;
      const flush = (which: 'stdout' | 'stderr', final: boolean) => {
        let buf = which === 'stdout' ? stdoutBuffer : stderrBuffer;
        let idx: number;
        let processed = 0;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (line.trim().length === 0) continue;
          try {
            const evt = parseLine(line);
            evt.seed = true;
            this.emit('event', evt);
            count++;
            processed++;
          } catch (e: any) {
            this.emit('error', e);
          }
        }
        if (which === 'stdout') stdoutBuffer = buf; else stderrBuffer = buf;
        if (CONFIG.verbose && (final || processed > 0)) {
          // eslint-disable-next-line no-console
          console.log(`[SEED-FLUSH ${which}] processed=${processed} total=${count} remainingBytes=${Buffer.byteLength(buf, 'utf8')} final=${final}`);
        }
      };
      seedProc.stdout.on('data', (chunk: Buffer) => {
        stdoutBuffer += chunk.toString('utf8');
        flush('stdout', false);
      });
      seedProc.stderr.on('data', (chunk: Buffer) => {
        stderrBuffer += chunk.toString('utf8');
        flush('stderr', false);
      });
      seedProc.on('exit', (code) => {
        flush('stdout', true);
        flush('stderr', true);
        if (CONFIG.verbose) {
          // eslint-disable-next-line no-console
          console.log(`[SEED] exit code=${code} total=${count}`);
        }
        resolve();
      });
      seedProc.on('error', (err) => {
        if (CONFIG.verbose) {
          // eslint-disable-next-line no-console
          console.log(`[SEED] error ${err.message}`);
        }
        resolve();
      });
    });
  }
}


