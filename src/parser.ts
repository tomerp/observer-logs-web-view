import { LogEvent, LogLevel, ParsedFields } from './types';

const LEVELS: LogLevel[] = ['INFO', 'WARNING', 'ERROR', 'CRITICAL', 'UNKNOWN'];

function detectLevel(parts: string[]): LogLevel {
  // Expected format: "<ts>\t<LEVEL>\t<module>\t<message>"
  if (parts.length >= 2) {
    const lvl = parts[1].trim().toUpperCase();
    if (lvl === 'INFO' || lvl === 'WARNING' || lvl === 'ERROR' || lvl === 'CRITICAL') {
      return lvl as LogLevel;
    }
  }
  // Fallback: scan entire line
  const full = parts.join('\t').toUpperCase();
  if (full.includes('\tCRITICAL\t') || full.includes(' CRITICAL ')) return 'CRITICAL';
  if (full.includes('\tERROR\t') || full.includes(' ERROR ')) return 'ERROR';
  if (full.includes('\tWARNING\t') || full.includes(' WARNING ')) return 'WARNING';
  if (full.includes('\tINFO\t') || full.includes(' INFO ')) return 'INFO';
  return 'UNKNOWN';
}

function parseFields(message: string): ParsedFields {
  const fields: ParsedFields = {};
  // network:songbird round:1140989 protocol:fdc ...
  const netMatch = message.match(/network:([A-Za-z0-9_-]+)/);
  if (netMatch) fields.network = netMatch[1];
  const roundMatch = message.match(/round:(\d{3,})/);
  if (roundMatch) fields.round = Number(roundMatch[1]);
  const protoMatch = message.match(/protocol:([A-Za-z0-9_-]+)/);
  if (protoMatch) fields.protocol = protoMatch[1];
  // processed round 1140981
  const processedMatch = message.match(/processed round (\d{3,})/i);
  if (processedMatch) fields.round = Number(processedMatch[1]);
  return fields;
}

export function parseLine(rawLine: string): LogEvent {
  const trimmed = rawLine.replace(/[\r\n]+$/, '');
  // Normalize any color codes / ANSI sequences that might appear from docker TTY
  const cleaned = trimmed.replace(/\x1b\[[0-9;]*m/g, '');
  const parts = cleaned.split('\t');
  // Timestamp in first field like "2025-10-22 07:33:49,598"
  const tsIso = parts[0]?.replace(',', '.').replace(' ', 'T') + 'Z';
  const date = new Date(tsIso);
  const ts = isNaN(date.getTime()) ? Date.now() : date.getTime();
  const level = detectLevel(parts);
  const message = parts.slice(3).join('\t') || parts.slice(2).join('\t') || cleaned;
  const parsed = parseFields(message);
  return {
    ts,
    isoTs: new Date(ts).toISOString(),
    level,
    raw: cleaned,
    parsed,
  };
}


