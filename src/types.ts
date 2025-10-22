export type LogLevel = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL' | 'UNKNOWN';

export interface ParsedFields {
  round?: number;
  network?: string;
  protocol?: string;
}

export interface LogEvent {
  ts: number; // epoch millis
  isoTs: string;
  level: LogLevel;
  raw: string;
  parsed: ParsedFields;
  seed?: boolean; // true if from initial history seeding
}

export interface StatsBucket {
  minute: number; // epoch minute (floor(ts / 60000))
  WARNING: number;
  ERROR: number;
  CRITICAL: number;
}

export interface StatsSnapshot {
  generatedAt: number;
  windowMinutes: number;
  buckets: StatsBucket[];
  totals: {
    WARNING: number;
    ERROR: number;
    CRITICAL: number;
  };
  lastRound?: number;
  secondsSinceLastRound?: number;
}


