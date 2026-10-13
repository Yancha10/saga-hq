import { useSyncExternalStore } from 'react';
import { en, type MessageKey } from './en';
import { es } from './es';

/**
 * Lightweight i18n (no dependency). Centralized dictionaries, `{param}` interpolation, plural forms
 * via Intl.PluralRules (`key_one`, `key_other`, optional `key_many`), Intl date/number/relative formats.
 * Locale is a DEVICE preference (localStorage `hq.locale`) — never stored in workspace data.
 * Adding a language = add a dictionary typed as Record<MessageKey, string> and list it in LOCALES.
 */
export const LOCALES = ['es', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_NAME: Record<Locale, string> = { es: 'Español', en: 'English' };
const DICTS: Record<Locale, Record<string, string>> = { en, es };
const STORAGE_KEY = 'hq.locale';

export function detectLocale(
  langs: readonly string[] = typeof navigator !== 'undefined'
    ? (navigator.languages ?? [navigator.language])
    : [],
): Locale {
  for (const l of langs) {
    if (!l) continue;
    if (l.toLowerCase().startsWith('es')) return 'es';
    if (l.toLowerCase().startsWith('en')) return 'en';
  }
  return 'en';
}

function storedLocale(): Locale | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'es' || v === 'en' ? v : null;
  } catch {
    return null;
  }
}

let current: Locale = storedLocale() ?? detectLocale();
const subs = new Set<() => void>();
const missing = new Set<string>();

function applyDocumentLang(): void {
  if (typeof document !== 'undefined') document.documentElement.lang = current;
}
applyDocumentLang();

function notify(): void {
  for (const s of subs) s();
}

// Keep every open tab in the same language: a choice made in one tab hot-switches the others.
if (typeof window !== 'undefined')
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY && (e.newValue === 'es' || e.newValue === 'en') && e.newValue !== current) {
      current = e.newValue;
      applyDocumentLang();
      notify();
    }
  });

export function getLocale(): Locale {
  return current;
}

/** Explicit user choice: persisted, always wins over browser detection. Hot-switches the UI. */
export function setLocale(l: Locale): void {
  current = l;
  try {
    localStorage.setItem(STORAGE_KEY, l);
  } catch {
    /* preference not persisted (private mode) — still applied for this session */
  }
  applyDocumentLang();
  notify();
}

export function hasExplicitLocale(): boolean {
  return storedLocale() !== null;
}

export function subscribeLocale(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export type Params = Record<string, string | number | null | undefined>;

function lookup(locale: Locale, key: string): string | undefined {
  return DICTS[locale][key];
}

function pluralKey(locale: Locale, key: string, count: number): string | undefined {
  const form = new Intl.PluralRules(locale).select(count);
  return lookup(locale, `${key}_${form}`) ?? lookup(locale, `${key}_other`);
}

export function translate(locale: Locale, key: string, params?: Params): string {
  let s: string | undefined;
  if (params && typeof params.count === 'number') s = pluralKey(locale, key, params.count);
  s ??= lookup(locale, key);
  if (s === undefined) {
    // Technical fallback: English, then a humanized key (never a raw dotted key).
    if (!missing.has(`${locale}:${key}`)) {
      missing.add(`${locale}:${key}`);
      if (import.meta.env?.DEV) console.warn(`[i18n] missing ${locale} key: ${key}`);
    }
    if (locale !== 'en') return translate('en', key, params);
    s = key.split('.').pop()!.replace(/_/g, ' ');
  }
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const v = params[name];
    if (v === null || v === undefined) return '';
    return typeof v === 'number' ? new Intl.NumberFormat(locale).format(v) : String(v);
  });
}

export function t(key: MessageKey | (string & {}), params?: Params): string {
  return translate(current, key, params);
}

export function missingKeys(): string[] {
  return [...missing];
}

// ---------- formatting ----------
export const fmt = {
  date: (
    d: string | number | Date,
    opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' },
  ) => new Intl.DateTimeFormat(current, opts).format(new Date(d)),
  dayShort: (d: string | number | Date) =>
    new Intl.DateTimeFormat(current, { weekday: 'short', day: 'numeric', month: 'short' }).format(
      new Date(d),
    ),
  weekdayLong: (d: string | number | Date) =>
    new Intl.DateTimeFormat(current, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(d)),
  time: (d: string | number | Date) =>
    new Intl.DateTimeFormat(current, { hour: '2-digit', minute: '2-digit' }).format(new Date(d)),
  dateTime: (d: string | number | Date) =>
    new Intl.DateTimeFormat(current, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(d)),
  dayTime: (d: string | number | Date) =>
    new Intl.DateTimeFormat(current, { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(
      new Date(d),
    ),
  num: (n: number, opts?: Intl.NumberFormatOptions) => new Intl.NumberFormat(current, opts).format(n),
  pct: (ratio: number) =>
    new Intl.NumberFormat(current, { style: 'percent', maximumFractionDigits: 0 }).format(ratio),
  ratio: (r: number) =>
    `${new Intl.NumberFormat(current, { maximumFractionDigits: r < 1 ? 2 : 1 }).format(r)}×`,
  money: (amount: number, currency: string) => {
    try {
      return new Intl.NumberFormat(current, { style: 'currency', currency }).format(amount);
    } catch {
      return `${new Intl.NumberFormat(current).format(amount)} ${currency}`;
    }
  },
  bytes: (n: number | undefined) => {
    if (n === undefined) return '—';
    const gb = n / 1024 ** 3;
    return gb >= 1
      ? `${new Intl.NumberFormat(current, { maximumFractionDigits: 2 }).format(gb)} GB`
      : `${new Intl.NumberFormat(current, { maximumFractionDigits: 1 }).format(n / 1024 ** 2)} MB`;
  },
  /** Today / Yesterday / in 3 days / 2 days ago — Intl.RelativeTimeFormat, day granularity. */
  relDay: (iso: string | number | Date, now = Date.now()) => {
    const a = new Date(iso);
    a.setHours(0, 0, 0, 0);
    const b = new Date(now);
    b.setHours(0, 0, 0, 0);
    const days = Math.round((a.getTime() - b.getTime()) / 86400000);
    const s = new Intl.RelativeTimeFormat(current, { numeric: 'auto' }).format(days, 'day');
    return s.charAt(0).toUpperCase() + s.slice(1);
  },
};

/** Parse a user-typed number in the current locale ("1.234,5" in es, "1,234.5" in en; "12k" → 12000). */
export function parseNum(input: string, locale: Locale = current): number {
  let v = input.trim().replace(/\s/g, '');
  let mult = 1;
  if (/k$/i.test(v)) {
    mult = 1000;
    v = v.slice(0, -1);
  } else if (/m$/i.test(v)) {
    mult = 1_000_000;
    v = v.slice(0, -1);
  }
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  const group = parts.find((x) => x.type === 'group')?.value ?? ',';
  const decimal = parts.find((x) => x.type === 'decimal')?.value ?? '.';
  v = v.split(group).join('').split('\u00a0').join('');
  if (decimal !== '.') v = v.replace(decimal, '.');
  const n = Number(v);
  return v === '' || !Number.isFinite(n) ? Number.NaN : n * mult;
}

/** React hook: re-renders on language change (hot switch, no reload, no state loss). */
export function useT() {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocale);
  return { t, locale, fmt };
}
