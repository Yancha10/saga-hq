/**
 * Local-only diagnostics. Nothing is ever sent anywhere. Entries are kept in memory (ring buffer)
 * and redacted on write: API keys, OAuth tokens, emails and any runtime-registered sensitive value.
 */
export type Level = 'debug' | 'info' | 'warn' | 'error';
export interface LogEntry {
  at: string;
  level: Level;
  area: string;
  message: string;
}

const MAX = 400;
const buffer: LogEntry[] = [];
const sensitive = new Set<string>();

const PATTERNS: [RegExp, string][] = [
  [/sk-ant-[A-Za-z0-9_-]{8,}/g, '[redacted-key]'],
  [/sk-[A-Za-z0-9_-]{8,}/g, '[redacted-key]'],
  [/ya29\.[A-Za-z0-9._-]+/g, '[redacted-token]'],
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted-email]'],
  [/access_token=[^&\s]+/g, 'access_token=[redacted]'],
];

/** Register a value that must never appear in logs (e.g. a decrypted key while in use). */
export function registerSensitive(value: string | undefined | null): void {
  if (value && value.length >= 6) sensitive.add(value);
}
export function unregisterSensitive(value: string | undefined | null): void {
  if (value) sensitive.delete(value);
}

export function redact(input: string): string {
  let out = input;
  for (const v of sensitive) out = out.split(v).join('[redacted]');
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

function stringify(parts: unknown[]): string {
  return parts
    .map((p) => {
      if (p instanceof Error) return `${p.name}: ${p.message}`;
      if (typeof p === 'string') return p;
      try {
        return JSON.stringify(p);
      } catch {
        return String(p);
      }
    })
    .join(' ');
}

export function log(level: Level, area: string, ...parts: unknown[]): void {
  const entry: LogEntry = { at: new Date().toISOString(), level, area, message: redact(stringify(parts)).slice(0, 2000) };
  buffer.push(entry);
  if (buffer.length > MAX) buffer.shift();
  if (import.meta.env?.DEV && import.meta.env.MODE !== 'test' && level !== 'debug') {
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
    fn(`[${area}]`, entry.message);
  }
}

export const logger = {
  debug: (area: string, ...p: unknown[]) => log('debug', area, ...p),
  info: (area: string, ...p: unknown[]) => log('info', area, ...p),
  warn: (area: string, ...p: unknown[]) => log('warn', area, ...p),
  error: (area: string, ...p: unknown[]) => log('error', area, ...p),
};

export function getLogs(): LogEntry[] {
  return buffer.slice();
}
export function clearLogs(): void {
  buffer.length = 0;
}
