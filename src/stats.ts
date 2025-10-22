import { LogEvent, StatsBucket, StatsSnapshot } from './types';

export class RollingStats {
  private buckets = new Map<number, StatsBucket>(); // key: epochMinute
  private lastRound?: number;
  private lastRoundTs?: number;

  constructor(private windowMinutes: number) {}

  add(event: LogEvent): void {
    const minute = Math.floor(event.ts / 60000);
    let bucket = this.buckets.get(minute);
    if (!bucket) {
      bucket = { minute, WARNING: 0, ERROR: 0, CRITICAL: 0 };
      this.buckets.set(minute, bucket);
    }
    // Count warnings/errors/criticals both from level field and from message hints when level is UNKNOWN
    const increment = (lvl: 'WARNING' | 'ERROR' | 'CRITICAL') => { bucket![lvl]++; };
    if (event.level === 'WARNING' || event.level === 'ERROR' || event.level === 'CRITICAL') {
      increment(event.level);
    } else if (event.level === 'UNKNOWN') {
      const rawUpper = event.raw.toUpperCase();
      if (rawUpper.includes('\tWARNING\t') || rawUpper.includes(' WARNING ')) increment('WARNING');
      if (rawUpper.includes('\tERROR\t') || rawUpper.includes(' ERROR ')) increment('ERROR');
      if (rawUpper.includes('\tCRITICAL\t') || rawUpper.includes(' CRITICAL ')) increment('CRITICAL');
    }
    if (event.parsed.round) {
      this.lastRound = event.parsed.round;
      this.lastRoundTs = event.ts;
    }
    this.evictOld(event.ts);
  }

  private evictOld(nowTs: number) {
    const cutoffMinute = Math.floor((nowTs - this.windowMinutes * 60000) / 60000);
    for (const key of this.buckets.keys()) {
      if (key < cutoffMinute) this.buckets.delete(key);
    }
  }

  snapshot(nowTs: number): StatsSnapshot {
    this.evictOld(nowTs);
    const minutes: number[] = Array.from(this.buckets.keys()).sort((a, b) => a - b);
    const buckets: StatsBucket[] = minutes.map((m) => this.buckets.get(m)!)
      .slice(-this.windowMinutes); // clamp to window size
    const totals = buckets.reduce(
      (acc, b) => ({
        WARNING: acc.WARNING + b.WARNING,
        ERROR: acc.ERROR + b.ERROR,
        CRITICAL: acc.CRITICAL + b.CRITICAL,
      }),
      { WARNING: 0, ERROR: 0, CRITICAL: 0 }
    );
    const secondsSinceLastRound = this.lastRoundTs ? Math.max(0, Math.floor((nowTs - this.lastRoundTs) / 1000)) : undefined;
    return {
      generatedAt: nowTs,
      windowMinutes: this.windowMinutes,
      buckets,
      totals,
      lastRound: this.lastRound,
      secondsSinceLastRound,
    };
  }
}


