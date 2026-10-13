/**
 * Saga Lai package reader. Turns the integration document (Markdown annexes), the HTML v2 file
 * (its embedded `script#seed` JSON — never executed) or a v2 JSON backup into one neutral package.
 * Pure functions: no database, no DOM, no network. Everything here is user content; nothing is
 * translated, invented or "verified" on the way in.
 */
import type { ContentStatus } from '../data/schema';

export interface PkgShot {
  title: string;
  timeLabel?: string;
  durationSec?: number;
  description: string;
  dialogue?: string;
  status: 'todo' | 'generating' | 'selected' | 'final';
}
export interface PkgPiece {
  externalId: string;
  title: string;
  /** Planned publication instant (UTC ISO), converted from the package's wall-clock time + zone. */
  plannedAt?: string;
  publishedAt?: string;
  publishedUrl?: string;
  status: ContentStatus;
  archived?: boolean;
  pillar?: string;
  dmKeyword?: string;
  format: 'reel' | 'carousel' | 'youtube_long' | 'image_post' | 'story';
  durationTargetSec?: number;
  provenance?: string;
  original?: string;
  hook?: string;
  objective?: string;
  coverText?: string;
  artDirection?: string;
  soundDirection?: string;
  continuityNotes?: string;
  cta?: string;
  shots: PkgShot[];
  script?: string;
  prompt?: string;
  caption?: string;
  stories?: string;
  pinnedComment?: string;
  productionNotes?: string;
  notes?: string;
  checks?: Record<string, boolean>;
  metrics?: Record<string, number>;
  coverUrl?: string;
}
export interface PkgChapter {
  externalId: string;
  number?: string;
  title: string;
  order: number;
  body: string;
  originalBody?: string;
}
export type RadarPrecision =
  | 'day'
  | 'range'
  | 'multiple'
  | 'month'
  | 'season'
  | 'year'
  | 'recurring'
  | 'unknown';
export interface PkgRadar {
  externalId: string;
  title: string;
  category?: string;
  periodText?: string;
  startDate?: string;
  endDate?: string;
  precision: RadarPrecision;
  sources: { label: string; url: string }[];
  angle?: string;
  notes?: string;
  verification: 'unverified' | 'verified' | 'discarded';
}
export interface PkgTask {
  externalId: string;
  title: string;
  kind: 'task' | 'decision';
  due?: string; // YYYY-MM-DD
  category?: string;
  status: 'todo' | 'doing' | 'done';
  notes?: string;
}
export interface PkgIdea {
  externalId: string;
  title: string;
  pillar?: string;
  notes?: string;
  emergency: boolean;
}
export interface PkgSession {
  externalId: string;
  task: string;
  provider?: string;
  pieceId?: string;
  prompt?: string;
  response: string;
  at?: string;
}
export interface PkgPrefs {
  timezone?: string;
  weeklyGoal?: number;
  weeklyHours?: number;
  ownerName?: string;
}
export interface SagaPackage {
  kind: 'markdown' | 'seed' | 'backup';
  brand?: string;
  chapters: PkgChapter[];
  pieces: PkgPiece[];
  radar: PkgRadar[];
  tasks: PkgTask[];
  ideas: PkgIdea[];
  checklist: { id: string; text: string }[];
  sessions: PkgSession[];
  prefs: PkgPrefs;
  warnings: string[];
}

export class PackageError extends Error {
  constructor(readonly code: 'PKG_EMPTY' | 'PKG_UNKNOWN' | 'PKG_BAD_JSON') {
    super(code);
    this.name = 'PackageError';
  }
}

// ---------------------------------------------------------------- dates

/** Offset (ms) of `tz` at a UTC instant. */
function tzOffset(utcMs: number, tz: string): number {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return asUtc - utcMs;
}

/** Wall-clock time in an IANA zone → UTC ISO. DST-correct (two-pass offset resolution). */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): string {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let ms = guess - tzOffset(guess, tz);
  ms = guess - tzOffset(ms, tz);
  return new Date(ms).toISOString();
}

/** "2026-10-13 13:45 Europe/Oslo" (zone optional, defaults to `tz`). */
export function parseZoned(text: string, tz = 'Europe/Oslo'): string | undefined {
  const m = text.match(/(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?\s*([A-Za-z_]+\/[A-Za-z_]+)?/);
  if (!m) return undefined;
  const zone = m[6] ?? tz;
  try {
    return zonedToUtc(+m[1]!, +m[2]!, +m[3]!, m[4] ? +m[4] : 12, m[5] ? +m[5] : 0, zone);
  } catch {
    return zonedToUtc(+m[1]!, +m[2]!, +m[3]!, m[4] ? +m[4] : 12, m[5] ? +m[5] : 0, 'UTC');
  }
}

const MONTHS: Record<string, number> = {
  ene: 1,
  enero: 1,
  jan: 1,
  feb: 2,
  febrero: 2,
  mar: 3,
  marzo: 3,
  abr: 4,
  abril: 4,
  apr: 4,
  may: 5,
  mayo: 5,
  jun: 6,
  junio: 6,
  jul: 7,
  julio: 7,
  ago: 8,
  agosto: 8,
  aug: 8,
  sep: 9,
  sept: 9,
  septiembre: 9,
  setiembre: 9,
  oct: 10,
  octubre: 10,
  nov: 11,
  noviembre: 11,
  dic: 12,
  diciembre: 12,
  dec: 12,
};
const SEASONS: Record<string, [string, string]> = {
  primavera: ['03-20', '06-20'],
  verano: ['06-21', '09-22'],
  otoño: ['09-23', '12-20'],
  otono: ['09-23', '12-20'],
  invierno: ['12-21', '03-19'],
};
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export interface ParsedPeriod {
  startDate?: string;
  endDate?: string;
  precision: RadarPrecision;
}

/**
 * Spanish period text → dates + honest precision. A month stays a month (never a made-up day);
 * a date without year is `recurring` and placed at its next occurrence after `ref`.
 */
export function parsePeriod(text: string, ref = '2026-10-10'): ParsedPeriod {
  const s = text.toLowerCase().replace(/[-—]/g, '–').replace(/\s+/g, ' ').trim();
  const refY = +ref.slice(0, 4);
  const yearM = s.match(/\b(\d{4})(?:–(\d{2,4}))?\b/);
  const y1 = yearM ? +yearM[1]! : undefined;
  const y2 = yearM?.[2] ? +(yearM[2].length === 2 ? `${String(y1).slice(0, 2)}${yearM[2]}` : yearM[2]) : y1;

  if (/cada año|every year|anual/.test(s)) {
    const mo = Object.entries(MONTHS).find(([k]) => new RegExp(`\\b${k}\\b`).test(s))?.[1];
    if (mo) {
      const y = ymd(refY, mo, 1) < `${ref.slice(0, 8)}01` ? refY + 1 : refY;
      return { startDate: ymd(y, mo, 1), endDate: ymd(y, mo, lastDay(y, mo)), precision: 'recurring' };
    }
    return { precision: 'recurring' };
  }
  const seasons = Object.keys(SEASONS).filter((k) => s.includes(k));
  if (seasons.length && y1) {
    const first = SEASONS[seasons[0]!]!;
    const last = SEASONS[seasons[seasons.length - 1]!]!;
    const endYear = last[1] < last[0] ? (y2 && y2 !== y1 ? y2 : y1 + 1) : (y2 ?? y1);
    return { startDate: `${y1}-${first[0]}`, endDate: `${endYear}-${last[1]}`, precision: 'season' };
  }
  if (y1 && /(segunda|second) (mitad|half)/.test(s))
    return { startDate: ymd(y1, 7, 1), endDate: ymd(y1, 12, 31), precision: 'year' };
  if (y1 && /(primera|first) (mitad|half)/.test(s))
    return { startDate: ymd(y1, 1, 1), endDate: ymd(y1, 6, 30), precision: 'year' };
  if (/^\d{4}$/.test(s) && y1)
    return { startDate: ymd(y1, 1, 1), endDate: ymd(y1, 12, 31), precision: 'year' };

  const noYear = s.replace(/\b(de )?\d{4}(–\d{2,4})?\b/g, '').trim();
  // Month-only forms: "febrero 2027", "abril–mayo 2027", "principios de jun 2027"
  const monthOnly = noYear
    .replace(/^(principios|finales|mediados|inicio|final) de /, '')
    .match(/^([a-zñ]+)(?:\s*–\s*([a-zñ]+))?$/);
  if (monthOnly && MONTHS[monthOnly[1]!] && (!monthOnly[2] || MONTHS[monthOnly[2]])) {
    const m1 = MONTHS[monthOnly[1]!]!;
    const m2 = monthOnly[2] ? MONTHS[monthOnly[2]]! : m1;
    const y = y1 ?? refY;
    const ye = m2 < m1 ? y + 1 : y;
    return {
      startDate: ymd(y, m1, 1),
      endDate: ymd(ye, m2, lastDay(ye, m2)),
      precision: y1 ? 'month' : 'recurring',
    };
  }

  // Day forms, possibly several: "18 abr y 2 may", "19 y 25–26 mar", "27 ago–12 sep", "17–31 ene"
  const segs = noYear.split(/\s+y\s+|,\s*/).filter(Boolean);
  type D = { d: number; m?: number };
  const parsed: { from: D; to?: D }[] = [];
  for (const seg of segs) {
    const m = seg.match(/^(\d{1,2})(?:\s+([a-zñ]+))?(?:\s*–\s*(\d{1,2})(?:\s+([a-zñ]+))?)?$/);
    if (!m) return { precision: 'unknown' };
    const mo1 = m[2] ? MONTHS[m[2]] : undefined;
    const mo2 = m[4] ? MONTHS[m[4]] : undefined;
    if ((m[2] && !mo1) || (m[4] && !mo2)) return { precision: 'unknown' };
    // "17–31 ene": a month written only after the range applies to both ends (carried below).
    parsed.push({ from: { d: +m[1]!, m: mo1 }, ...(m[3] ? { to: { d: +m[3], m: mo2 } } : {}) });
  }
  if (!parsed.length) return { precision: 'unknown' };
  // Carry months backwards: a day without month takes the next month mentioned.
  let carry: number | undefined;
  for (let i = parsed.length - 1; i >= 0; i--) {
    const p = parsed[i]!;
    if (p.to) {
      p.to.m = p.to.m ?? carry;
      carry = p.to.m ?? carry;
    }
    p.from.m = p.from.m ?? carry;
    carry = p.from.m ?? carry;
  }
  if (parsed.some((p) => !p.from.m || (p.to && !p.to.m))) return { precision: 'unknown' };
  const first = parsed[0]!.from;
  const lastP = parsed[parsed.length - 1]!;
  const end = lastP.to ?? lastP.from;
  let ys = y1 ?? refY;
  if (!y1 && ymd(ys, first.m!, first.d) < ref) ys += 1;
  const ye = end.m! < first.m! ? ys + 1 : ys;
  const startDate = ymd(ys, first.m!, first.d);
  const endDate = ymd(ye, end.m!, end.d);
  const precision: RadarPrecision = !y1
    ? 'recurring'
    : parsed.length > 1
      ? 'multiple'
      : lastP.to
        ? 'range'
        : 'day';
  return { startDate, ...(endDate !== startDate ? { endDate } : {}), precision };
}

// ---------------------------------------------------------------- markdown helpers

const EMPTY_RE = /^(sin completar|sin notas|sin definir|no aplica.*|por desarrollar.*|—|-|n\/a)\.?$/i;
const clean = (v: string | undefined): string | undefined => {
  const t = (v ?? '').trim();
  return t && !EMPTY_RE.test(t) ? t : undefined;
};
/** Strip one pair of wrapping quotes from a single-quoted paragraph ("…" → …). Keeps inner quotes. */
const unquote = (v: string | undefined): string | undefined => {
  if (!v) return v;
  const m = v.match(/^"([^"]*)"$/);
  return m ? m[1] : v;
};
const stripFences = (v: string) =>
  v
    .replace(/^```[a-z]*\n?/gim, '')
    .replace(/^```\s*$/gm, '')
    .trim();

/** Split `text` into blocks starting at lines matching `re` (the match is kept as the block head). */
function splitBy(text: string, re: RegExp): { head: RegExpMatchArray; body: string }[] {
  const lines = text.split('\n');
  const out: { head: RegExpMatchArray; lines: string[] }[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line)) inFence = !inFence;
    const m = !inFence ? line.match(re) : null;
    if (m) out.push({ head: m, lines: [] });
    else if (out.length) out[out.length - 1]!.lines.push(line);
  }
  return out.map((b) => ({ head: b.head, body: b.lines.join('\n') }));
}

/** Section of `text` between a level-2 heading matching `start` and the next level-2 heading outside it. */
function annex(text: string, start: RegExp, end: RegExp): string {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => start.test(l));
  if (i < 0) return '';
  let j = lines.findIndex((l, k) => k > i && end.test(l));
  if (j < 0) j = lines.length;
  return lines.slice(i + 1, j).join('\n');
}

const bullet = (body: string, label: string): string | undefined => {
  const re = new RegExp(`^\\s*-\\s+(?:\\*\\*)?${label}:?(?:\\*\\*)?:?\\s*(.*)$`, 'im');
  return body.match(re)?.[1]?.trim();
};
const bold = (body: string, label: string): string | undefined => {
  const re = new RegExp(`^\\*\\*${label}:\\*\\*\\s*([\\s\\S]*?)(?=\\n\\s*\\n|$)`, 'im');
  return body.match(re)?.[1]?.trim();
};

const STATUS_MAP: Record<string, ContentStatus> = {
  idea: 'planned',
  planificada: 'planned',
  planned: 'planned',
  guion: 'script',
  guión: 'script',
  script: 'script',
  producción: 'producing',
  produccion: 'producing',
  producing: 'producing',
  lista: 'ready',
  listo: 'ready',
  ready: 'ready',
  programada: 'scheduled',
  scheduled: 'scheduled',
  publicada: 'published',
  publicado: 'published',
  published: 'published',
  revisada: 'reviewed',
  reviewed: 'reviewed',
};
export function mapStatus(v: string | undefined): { status: ContentStatus; archived: boolean } {
  const k = (v ?? '').trim().toLowerCase();
  if (/archiv/.test(k)) return { status: 'planned', archived: true };
  return { status: STATUS_MAP[k] ?? 'planned', archived: false };
}
const TASK_STATUS = (v: string | undefined): PkgTask['status'] => {
  const k = (v ?? '').toLowerCase();
  if (/hech|complet|done|resuelt|cerrad/.test(k)) return 'done';
  if (/curso|doing|progreso/.test(k)) return 'doing';
  return 'todo';
};
const formatOf = (v: string | undefined): PkgPiece['format'] => {
  const k = (v ?? '').toLowerCase();
  if (/carrusel|carousel/.test(k)) return 'carousel';
  if (/story|historia/.test(k)) return 'story';
  if (/imagen|image|foto/.test(k)) return 'image_post';
  if (/16:9|youtube/.test(k)) return 'youtube_long';
  return 'reel';
};
const secondsOf = (v: string | undefined): number | undefined => {
  const m = (v ?? '').match(/(\d+(?:[.,]\d+)?)\s*(s|seg|min)/i);
  if (!m) return undefined;
  const n = Number(m[1]!.replace(',', '.'));
  return /min/i.test(m[2]!) ? n * 60 : n;
};

// ---------------------------------------------------------------- markdown package

function parseChapters(a: string): PkgChapter[] {
  return splitBy(a, /^###\s+Cap[ií]tulo\s+(\d+)\s+(.+)$/).map((b, i) => {
    const idM = b.body.match(/^Identificador original:\s*`?([^`\n]+)`?\s*$/m);
    const body = b.body
      .replace(/^Identificador original:.*$/m, '')
      .replace(/^\n+/, '')
      .replace(/\n+$/, '');
    const rawTitle = b.head[2]!.trim();
    const numM = rawTitle.match(/^([0-9]+[a-z]?)\s*·\s*(.+)$/i);
    return {
      externalId: (idM?.[1] ?? b.head[1]!).trim(),
      ...(numM ? { number: numM[1]! } : {}),
      title: numM ? numM[2]!.trim() : rawTitle,
      order: i,
      body,
      originalBody: body,
    };
  });
}

/** Month headers ("## Fichas de noviembre…") and their intro line can land inside a piece: drop them. */
function stripInterludes(body: string): string {
  const lines = body.split('\n');
  const out: string[] = [];
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^```/.test(l)) fence = !fence;
    if (!fence && /^##\s/.test(l)) {
      // skip the header, blank lines and one intro paragraph line that is not a heading/bold/list
      i++;
      while (i < lines.length && !lines[i]!.trim()) i++;
      if (i < lines.length && !/^(#|\*\*|-\s|```)/.test(lines[i]!)) i++;
      i--;
      continue;
    }
    out.push(l);
  }
  return out.join('\n');
}

function subSections(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const b of splitBy(body, /^####\s+(.+)$/)) out[b.head[1]!.trim().toLowerCase()] = b.body.trim();
  return out;
}

function parseShots(proposal: string): PkgShot[] {
  return splitBy(proposal, /^\*\*Bloque\s+(\d+)\s*·\s*([^*]+)\*\*\s*$/).map((b) => {
    const label = b.head[2]!.trim();
    const dialogue = b.body.match(/^Di[aá]logo por plano:\s*(.*)$/m)?.[1];
    const state = b.body.match(/^Estado del plano:\s*(.*)$/m)?.[1]?.toLowerCase() ?? '';
    const description = b.body
      .replace(/^Di[aá]logo por plano:.*$/m, '')
      .replace(/^Estado del plano:.*$/m, '')
      .trim();
    const range = label.match(/(\d+(?:[.,]\d+)?)\s*–\s*(\d+(?:[.,]\d+)?)\s*s/);
    const dur = range ? Number(range[2]!.replace(',', '.')) - Number(range[1]!.replace(',', '.')) : undefined;
    return {
      title: `${b.head[1]} · ${label}`,
      timeLabel: label,
      ...(dur !== undefined && dur >= 0 ? { durationSec: dur } : {}),
      description,
      ...(clean(dialogue) ? { dialogue: clean(dialogue)! } : {}),
      status: /final/.test(state)
        ? 'final'
        : /selec|listo|lista/.test(state)
          ? 'selected'
          : /gener/.test(state)
            ? 'generating'
            : 'todo',
    };
  });
}

function parsePieces(b: string, tz: string): PkgPiece[] {
  return splitBy(b, /^###\s+Pieza\s+(\d+)\s+(.+)$/).map((blk) => {
    const body = stripInterludes(blk.body);
    const meta = body.split(/^####\s/m)[0]!;
    const sec = subSections(body);
    const proposal = sec['propuesta ampliada de trabajo'] ?? '';
    const originalRaw = sec['ficha original'];
    const fenced = originalRaw?.match(/```[a-z]*\n([\s\S]*?)```/)?.[1]?.trim();
    const st = mapStatus(bullet(meta, 'Estado inicial') ?? bullet(meta, 'Estado'));
    const when = bullet(meta, 'Fecha prevista');
    const notesBlock = sec['notas de la pieza'] ?? '';
    const piece: PkgPiece = {
      externalId: bullet(meta, 'Identificador') ?? `post-${blk.head[1]}`,
      title: blk.head[2]!.trim(),
      status: st.status,
      ...(st.archived ? { archived: true } : {}),
      format: formatOf(bullet(meta, 'Formato')),
      shots: parseShots(proposal),
    };
    const set = <K extends keyof PkgPiece>(k: K, v: PkgPiece[K] | undefined) => {
      if (v !== undefined && v !== '') piece[k] = v;
    };
    set('plannedAt', when ? parseZoned(when, tz) : undefined);
    set('pillar', clean(bullet(meta, 'Pilar')));
    set('dmKeyword', clean(bullet(meta, 'Palabra clave de DM')));
    set('durationTargetSec', secondsOf(bullet(meta, 'Duración objetivo')));
    set('provenance', clean(bullet(meta, 'Procedencia del desarrollo')));
    set('original', originalRaw?.trim() || undefined);
    set('hook', clean(bold(proposal, 'Apertura')));
    set('objective', clean(bold(proposal, 'Objetivo')));
    set('coverText', clean(bold(proposal, 'Título de portada')));
    set('artDirection', clean(bold(proposal, 'Arte')));
    set('soundDirection', clean(bold(proposal, 'Sonido')));
    set('continuityNotes', clean(bold(proposal, 'Continuidad')));
    set('cta', unquote(clean(bold(proposal, 'Llamada a la acción'))));
    set('script', unquote(clean(stripFences(sec['guion de trabajo inicial'] ?? ''))));
    set('prompt', clean(stripFences(sec['prompt de trabajo inicial'] ?? '')) ?? fenced);
    set('caption', unquote(clean(sec['caption inicial'])));
    set('stories', clean(sec['stories propuestas']));
    set('pinnedComment', clean(sec['comentario fijado propuesto']));
    set('productionNotes', clean(sec['notas de producción']));
    set('notes', clean(notesBlock.replace(/^M[eé]tricas iniciales:.*$/m, '').trim()));
    return piece;
  });
}

function parseRadar(c: string): PkgRadar[] {
  return splitBy(c, /^###\s+(event-\d+|[a-z]+-\d+)\s+(.+)$/i).map((b) => {
    let title = b.head[2]!.trim();
    const sources: { label: string; url: string }[] = [];
    // trailing "([Label](url))" groups, possibly several
    for (;;) {
      const m = title.match(/\s*\(\[([^\]]+)\]\(([^)\s]+)\)\)\s*$/);
      if (!m) break;
      sources.unshift({ label: m[1]!, url: m[2]! });
      title = title.slice(0, m.index).trim();
    }
    for (const m of b.body.matchAll(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g))
      if (!sources.some((x) => x.url === m[2])) sources.push({ label: m[1]!, url: m[2]! });
    const periodText =
      bullet(b.body, 'Periodo original') ?? bullet(b.body, 'Periodo') ?? bullet(b.body, 'Fecha');
    const review = (bullet(b.body, 'Revisión') ?? '').toLowerCase();
    return {
      externalId: b.head[1]!,
      title,
      ...(clean(bullet(b.body, 'Categoría')) ? { category: clean(bullet(b.body, 'Categoría'))! } : {}),
      ...(periodText ? { periodText } : {}),
      ...(periodText ? parsePeriod(periodText) : { precision: 'unknown' as const }),
      sources,
      ...(clean(bullet(b.body, 'Ángulo')) ? { angle: clean(bullet(b.body, 'Ángulo'))! } : {}),
      ...(clean(bullet(b.body, 'Notas')) ? { notes: clean(bullet(b.body, 'Notas'))! } : {}),
      verification: /^verificad|^comprobad/.test(review)
        ? 'verified'
        : /descart/.test(review)
          ? 'discarded'
          : 'unverified',
    };
  });
}

function parseAnnexD(d: string, pkg: SagaPackage): void {
  const parts = Object.fromEntries(
    splitBy(d, /^###\s+(.+)$/).map((b) => [b.head[1]!.trim().toLowerCase(), b.body]),
  ) as Record<string, string>;
  const find = (re: RegExp) => Object.entries(parts).find(([k]) => re.test(k))?.[1] ?? '';

  for (const b of splitBy(find(/^tareas/), /^-\s+\*\*([\w-]+)\s*·\s*(.+?)\*\*\s*$/)) {
    pkg.tasks.push({
      externalId: b.head[1]!,
      title: b.head[2]!.trim(),
      kind: 'task',
      ...(bullet(b.body, 'Fecha')?.match(/\d{4}-\d{2}-\d{2}/)
        ? { due: bullet(b.body, 'Fecha')!.slice(0, 10) }
        : {}),
      ...(clean(bullet(b.body, 'Categoría')) ? { category: clean(bullet(b.body, 'Categoría'))! } : {}),
      status: TASK_STATUS(bullet(b.body, 'Estado')),
      ...(clean(bullet(b.body, 'Notas')) ? { notes: clean(bullet(b.body, 'Notas'))! } : {}),
    });
  }
  for (const m of find(/^checklist/).matchAll(/^-\s+(c\d+):\s*(.+)$/gm))
    pkg.checklist.push({ id: m[1]!, text: m[2]!.trim() });
  for (const b of splitBy(find(/^ideas/), /^####\s+(idea-\d+)\s+(.+)$/)) {
    const pillar = b.body.match(/^Pilar:\s*(.+)$/m)?.[1]?.trim();
    const notes = b.body.replace(/^Pilar:.*$/m, '').trim();
    pkg.ideas.push({
      externalId: b.head[1]!,
      title: b.head[2]!.trim(),
      ...(pillar ? { pillar } : {}),
      ...(notes ? { notes } : {}),
      emergency: true,
    });
  }
  for (const b of splitBy(find(/^decisiones/), /^####\s+(.+)$/)) {
    const id = b.body.match(/^Identificador:\s*(\S+)/m)?.[1] ?? b.head[1]!.trim();
    const state = b.body.match(/^Estado:\s*(.+)$/m)?.[1];
    const notes = b.body
      .replace(/^Identificador:.*$/m, '')
      .replace(/^Estado:.*$/m, '')
      .trim();
    pkg.tasks.push({
      externalId: `decision-${id}`,
      title: b.head[1]!.trim(),
      kind: 'decision',
      status: TASK_STATUS(state),
      ...(notes ? { notes } : {}),
    });
  }
  const json = find(/^preferencias/).match(/```json\s*([\s\S]*?)```/)?.[1];
  if (json) {
    try {
      Object.assign(pkg.prefs, prefsFrom(JSON.parse(json)));
    } catch {
      pkg.warnings.push('prefs_unreadable');
    }
  }
}

function prefsFrom(o: Record<string, unknown>): PkgPrefs {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : undefined);
  const tz = str(o.timezone);
  let validTz: string | undefined;
  if (tz)
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      validTz = tz;
    } catch {
      validTz = undefined;
    }
  const p: PkgPrefs = {};
  if (validTz) p.timezone = validTz;
  if (num(o.weeklyGoal) !== undefined) p.weeklyGoal = num(o.weeklyGoal)!;
  const hours = num(o.workingHours) ?? num(o.weeklyHours) ?? num(o.hours);
  if (hours !== undefined) p.weeklyHours = hours;
  const name = str(o.name) ?? str(o.ownerName);
  if (name) p.ownerName = name;
  return p;
}

const empty = (kind: SagaPackage['kind']): SagaPackage => ({
  kind,
  chapters: [],
  pieces: [],
  radar: [],
  tasks: [],
  ideas: [],
  checklist: [],
  sessions: [],
  prefs: {},
  warnings: [],
});

export function parseMarkdown(md: string): SagaPackage {
  const text = md.replace(/\r\n?/g, '\n');
  const pkg = empty('markdown');
  const A = annex(text, /^##\s+Anexo A\b/i, /^##\s+Anexo [B-Z]\b/i);
  const B = annex(text, /^##\s+Anexo B\b/i, /^##\s+Anexo [C-Z]\b/i);
  const C = annex(text, /^##\s+Anexo C\b/i, /^##\s+Anexo [D-Z]\b/i);
  const D = annex(text, /^##\s+Anexo D\b/i, /^##\s+Anexo [E-Z]\b/i);
  // Without annex headings, accept a bare file of chapters/pieces/events.
  pkg.chapters = parseChapters(A || text);
  pkg.prefs = {};
  parseAnnexD(D || text, pkg);
  const tz = pkg.prefs.timezone ?? 'Europe/Oslo';
  pkg.pieces = parsePieces(B || text, tz);
  pkg.radar = parseRadar(C || text);
  const brand = text.match(/^####\s+(.+?)\s+[—–-]\s+/m)?.[1] ?? text.match(/secretaria de ([^\n]+)$/im)?.[1];
  if (brand) pkg.brand = brand.trim().slice(0, 60);
  return pkg;
}

// ---------------------------------------------------------------- v2 JSON (seed or backup)

type O = Record<string, unknown>;
const isO = (v: unknown): v is O => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = (v: unknown): O[] =>
  Array.isArray(v) ? v.filter(isO) : isO(v) ? Object.values(v).filter(isO) : [];
const str = (v: unknown): string | undefined =>
  typeof v === 'string' ? clean(v) : typeof v === 'number' ? String(v) : undefined;
const pick = (o: O, ...keys: string[]): string | undefined => {
  for (const k of keys) {
    const v = str(o[k]);
    if (v) return v;
  }
  return undefined;
};
const textOf = (v: unknown): string | undefined => {
  if (typeof v === 'string') return clean(v);
  if (isO(v))
    return Object.entries(v)
      .filter(([, x]) => typeof x === 'string' && x.trim())
      .map(([k, x]) => `- **${k}:** ${x as string}`)
      .join('\n');
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').join('\n') || undefined;
  return undefined;
};

/** Map the v2 state (`schema: 1`, `edition: 2`) tolerantly; invalid records are skipped with a warning. */
export function parseV2(json: unknown, kind: 'seed' | 'backup'): SagaPackage {
  const root = isO(json) && isO(json.state) ? json.state : json;
  if (!isO(root)) throw new PackageError('PKG_UNKNOWN');
  const known = ['sections', 'posts', 'tasks', 'events', 'ideas', 'issues', 'checklist'];
  if (!known.some((k) => k in root)) throw new PackageError('PKG_UNKNOWN');
  const pkg = empty(kind);
  const settings = isO(root.settings) ? root.settings : {};
  pkg.prefs = prefsFrom(settings);
  const tz = pkg.prefs.timezone ?? 'Europe/Oslo';

  arr(root.sections).forEach((s, i) => {
    const title = pick(s, 'title', 'name');
    const body =
      typeof s.body === 'string'
        ? s.body
        : typeof s.text === 'string'
          ? s.text
          : typeof s.content === 'string'
            ? s.content
            : '';
    if (!title && !body) {
      pkg.warnings.push('section_skipped');
      return;
    }
    const original =
      typeof s.original === 'string'
        ? s.original
        : typeof s.originalText === 'string'
          ? s.originalText
          : undefined;
    pkg.chapters.push({
      externalId: String(s.id ?? i),
      title: title ?? '',
      order: typeof s.order === 'number' ? s.order : i,
      body,
      originalBody: original ?? body,
    });
  });

  arr(root.posts).forEach((p, i) => {
    const title = pick(p, 'title', 'name');
    if (!title) {
      pkg.warnings.push('post_skipped');
      return;
    }
    const dev = isO(p.development) ? p.development : {};
    const st = mapStatus(pick(p, 'status', 'state'));
    const date = pick(p, 'date', 'datetime', 'plannedAt', 'scheduled');
    const time = pick(p, 'time');
    const scenes = arr(dev.scenes ?? p.scenes);
    const metrics: Record<string, number> = {};
    if (isO(p.metrics))
      for (const [k, v] of Object.entries(p.metrics))
        if (typeof v === 'number' && Number.isFinite(v)) metrics[k] = v;
    const checks: Record<string, boolean> = {};
    if (isO(p.checks)) for (const [k, v] of Object.entries(p.checks)) checks[k] = !!v;
    else if (Array.isArray(p.checks)) for (const k of p.checks) if (typeof k === 'string') checks[k] = true;
    const piece: PkgPiece = {
      externalId: String(p.id ?? `post-${i + 1}`),
      title,
      status: st.status,
      ...(st.archived || p.archived === true ? { archived: true } : {}),
      format: formatOf(pick(p, 'format', 'type')),
      shots: scenes.map((sc, k) => {
        const label = pick(sc, 'time', 't', 'timing', 'label') ?? '';
        const range = label.match(/(\d+(?:[.,]\d+)?)\s*[–-]\s*(\d+(?:[.,]\d+)?)/);
        const state = (pick(sc, 'status', 'state') ?? '').toLowerCase();
        return {
          title: `${k + 1}${label ? ` · ${label}` : ''}`,
          ...(label ? { timeLabel: label } : {}),
          ...(range
            ? { durationSec: Number(range[2]!.replace(',', '.')) - Number(range[1]!.replace(',', '.')) }
            : {}),
          description: pick(sc, 'action', 'desc', 'description', 'text') ?? '',
          ...(pick(sc, 'dialogue', 'dialog', 'line')
            ? { dialogue: pick(sc, 'dialogue', 'dialog', 'line')! }
            : {}),
          status: /final/.test(state) ? 'final' : /listo|ready|selec|done/.test(state) ? 'selected' : 'todo',
        } satisfies PkgShot;
      }),
    };
    const set = <K extends keyof PkgPiece>(k: K, v: PkgPiece[K] | undefined) => {
      if (v !== undefined && v !== '') piece[k] = v;
    };
    if (date) {
      const full = /\d{1,2}:\d{2}/.test(date) ? date : `${date.slice(0, 10)} ${time ?? '12:00'}`;
      set(
        'plannedAt',
        /Z$|[+-]\d{2}:\d{2}$/.test(date) ? new Date(date).toISOString() : parseZoned(full, tz),
      );
    }
    const pub = pick(p, 'publishedAt', 'published');
    if (pub && !Number.isNaN(Date.parse(pub))) set('publishedAt', new Date(pub).toISOString());
    set('publishedUrl', pick(p, 'url', 'postUrl'));
    set('pillar', pick(p, 'pillar', 'pilar'));
    set('dmKeyword', pick(p, 'keyword', 'dmKeyword', 'dm'));
    set('durationTargetSec', typeof p.duration === 'number' ? p.duration : secondsOf(pick(p, 'duration')));
    set('original', textOf(p.detail));
    set('hook', pick(dev, 'hook', 'opening') ?? pick(p, 'hook'));
    set('objective', pick(dev, 'objective', 'goal'));
    set('coverText', pick(dev, 'coverTitle', 'cover') ?? pick(p, 'coverTitle'));
    set('artDirection', pick(dev, 'art', 'artDirection'));
    set('soundDirection', pick(dev, 'sound', 'audio'));
    set('continuityNotes', pick(dev, 'continuity'));
    set('cta', pick(dev, 'cta', 'callToAction') ?? pick(p, 'cta'));
    set('script', pick(p, 'script') ?? pick(dev, 'script'));
    set('prompt', pick(p, 'prompt') ?? pick(dev, 'prompt'));
    set('caption', pick(p, 'caption') ?? pick(dev, 'caption'));
    set('stories', textOf(dev.stories ?? p.stories));
    set('pinnedComment', pick(dev, 'pinnedComment', 'pinned') ?? pick(p, 'pinnedComment'));
    set('productionNotes', pick(dev, 'productionNotes') ?? pick(p, 'productionNotes'));
    set('notes', pick(p, 'notes'));
    set('coverUrl', pick(p, 'coverUrl'));
    if (Object.keys(checks).length) piece.checks = checks;
    if (Object.keys(metrics).length) piece.metrics = metrics;
    pkg.pieces.push(piece);
    for (const [k, n] of arr(dev.aiNotes).entries()) {
      const response = pick(n, 'text', 'response', 'content');
      if (response)
        pkg.sessions.push({
          externalId: `${piece.externalId}:ai-${k}`,
          task: pick(n, 'task', 'kind') ?? 'other',
          ...(pick(n, 'provider', 'source') ? { provider: pick(n, 'provider', 'source')! } : {}),
          pieceId: piece.externalId,
          response,
          ...(pick(n, 'at', 'date') ? { at: pick(n, 'at', 'date')! } : {}),
        });
    }
  });

  for (const e of arr(root.events)) {
    const title = pick(e, 'title', 'name');
    if (!title) continue;
    const periodText = pick(e, 'period', 'date', 'when');
    const url = pick(e, 'url', 'source');
    pkg.radar.push({
      externalId: String(e.id ?? `event-${pkg.radar.length}`),
      title,
      ...(pick(e, 'category', 'cat') ? { category: pick(e, 'category', 'cat')! } : {}),
      ...(periodText ? { periodText, ...parsePeriod(periodText) } : { precision: 'unknown' as const }),
      sources:
        url && /^https?:/.test(url) ? [{ label: pick(e, 'sourceName', 'sourceLabel') ?? url, url }] : [],
      ...(pick(e, 'angle') ? { angle: pick(e, 'angle')! } : {}),
      ...(pick(e, 'notes') ? { notes: pick(e, 'notes')! } : {}),
      verification: 'unverified',
    });
  }
  for (const t of arr(root.tasks)) {
    const title = pick(t, 'title', 'text', 'name');
    if (!title) continue;
    const due = pick(t, 'date', 'due', 'dueAt');
    pkg.tasks.push({
      externalId: String(t.id ?? `task-${pkg.tasks.length}`),
      title,
      kind: 'task',
      ...(due?.match(/^\d{4}-\d{2}-\d{2}/) ? { due: due.slice(0, 10) } : {}),
      ...(pick(t, 'category', 'cat') ? { category: pick(t, 'category', 'cat')! } : {}),
      status: t.done === true ? 'done' : TASK_STATUS(pick(t, 'status', 'state')),
      ...(pick(t, 'notes') ? { notes: pick(t, 'notes')! } : {}),
    });
  }
  for (const i of arr(root.issues)) {
    const title = pick(i, 'title', 'name');
    if (!title) continue;
    pkg.tasks.push({
      externalId: `decision-${String(i.id ?? pkg.tasks.length)}`,
      title,
      kind: 'decision',
      status: i.resolved === true ? 'done' : TASK_STATUS(pick(i, 'status', 'state')),
      ...(pick(i, 'text', 'description', 'notes') ? { notes: pick(i, 'text', 'description', 'notes')! } : {}),
    });
  }
  for (const i of arr(root.ideas)) {
    const title = pick(i, 'title', 'text', 'name');
    if (!title) continue;
    pkg.ideas.push({
      externalId: String(i.id ?? `idea-${pkg.ideas.length}`),
      title,
      ...(pick(i, 'pillar', 'pilar') ? { pillar: pick(i, 'pillar', 'pilar')! } : {}),
      ...(pick(i, 'notes', 'description') ? { notes: pick(i, 'notes', 'description')! } : {}),
      emergency: true,
    });
  }
  const cl = Array.isArray(root.checklist) ? root.checklist : [];
  cl.forEach((c, i) => {
    if (typeof c === 'string') pkg.checklist.push({ id: `c${i}`, text: c });
    else if (isO(c) && pick(c, 'text', 'label'))
      pkg.checklist.push({ id: String(c.id ?? `c${i}`), text: pick(c, 'text', 'label')! });
  });
  for (const [k, n] of arr(root.aiSessions).entries()) {
    const response = pick(n, 'response', 'text', 'answer');
    if (!response) continue;
    pkg.sessions.push({
      externalId: String(n.id ?? `ai-${k}`),
      task: pick(n, 'task', 'kind') ?? 'other',
      ...(pick(n, 'provider') ? { provider: pick(n, 'provider')! } : {}),
      ...(pick(n, 'postId', 'pieceId') ? { pieceId: pick(n, 'postId', 'pieceId')! } : {}),
      ...(pick(n, 'prompt', 'brief') ? { prompt: pick(n, 'prompt', 'brief')! } : {}),
      response,
      ...(pick(n, 'at', 'date') ? { at: pick(n, 'at', 'date')! } : {}),
    });
  }
  return pkg;
}

/** Find the embedded seed of the HTML v2 file by text only (the file's scripts are never run). */
export function extractSeed(html: string): unknown {
  const m = html.match(/<script\b[^>]*\bid=["']seed["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) throw new PackageError('PKG_UNKNOWN');
  try {
    return JSON.parse(m[1]!.trim());
  } catch {
    throw new PackageError('PKG_BAD_JSON');
  }
}

/** Detect the file type and parse it. */
export function parsePackage(text: string, fileName = ''): SagaPackage {
  const t = text.trim();
  if (!t) throw new PackageError('PKG_EMPTY');
  let pkg: SagaPackage;
  if (/\.html?$/i.test(fileName) || /^<!doctype html|^<html/i.test(t)) pkg = parseV2(extractSeed(t), 'seed');
  else if (/\.json$/i.test(fileName) || t.startsWith('{')) {
    let json: unknown;
    try {
      json = JSON.parse(t);
    } catch {
      throw new PackageError('PKG_BAD_JSON');
    }
    pkg = parseV2(json, 'backup');
  } else pkg = parseMarkdown(t);
  const total =
    pkg.chapters.length +
    pkg.pieces.length +
    pkg.radar.length +
    pkg.tasks.length +
    pkg.ideas.length +
    pkg.checklist.length;
  if (!total) throw new PackageError('PKG_UNKNOWN');
  return pkg;
}
