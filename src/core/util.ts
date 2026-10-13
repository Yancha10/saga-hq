export function stableStringify(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(',')}}`;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const na = a === null || a === undefined || a === '';
  const nb = b === null || b === undefined || b === '';
  if (na && nb) return true;
  return stableStringify(a) === stableStringify(b);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

export function groupBy<T, K extends string>(items: T[], key: (t: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const it of items) {
    const k = key(it);
    if (!out[k]) out[k] = [];
    out[k].push(it);
  }
  return out;
}

export function median(nums: number[]): number | undefined {
  if (nums.length === 0) return undefined;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1]! + s[m]!) / 2;
}
