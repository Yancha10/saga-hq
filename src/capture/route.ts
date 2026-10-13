/**
 * Voice/share capture router. Turns a dictated or shared text into a destination:
 *   "Tarea: llamar al estudio el viernes"   → task due Friday
 *   "Idea: Saga en un videoclub de 1995"    → idea
 *   "Guion para Faro: …" / "Gancho para …"  → variant on that piece (never replaces the approved text)
 *   "Radar: festival … 17–31 ene 2027"      → unverified radar entry with honest date precision
 *   "Pieza: …"                              → planned piece
 *   [SAGA] … [/SAGA] block from ChatGPT/Claude → structured idea/task/piece/radar
 * Anything else stays in the Inbox with a suggestion: nothing is filed wrongly in silence.
 * Pure functions (no database); language-independent prefixes (ES/EN).
 */
import { parsePeriod } from '../import/sagaLai';

export type RouteKind = 'idea' | 'task' | 'variant' | 'radar' | 'piece' | 'inbox';
export type VariantTarget = 'hook' | 'script' | 'caption' | 'prompt' | 'ending' | 'cover';

export interface Route {
  kind: RouteKind;
  title: string;
  body: string;
  /** YYYY-MM-DD for tasks */
  due?: string;
  /** piece the variant is for (free text, resolved against titles later) */
  pieceQuery?: string;
  field?: VariantTarget;
  pillar?: string;
  hook?: string;
  situation?: string;
  tension?: string;
  twist?: string;
  payoff?: string;
  period?: { text: string; startDate?: string; endDate?: string; precision: string };
}

export const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

const firstSentence = (s: string, n = 120): string => {
  const line = s.split('\n').find((l) => l.trim()) ?? '';
  const m = line.match(/^(.{8,}?[.!?])(\s|$)/);
  return (m ? m[1]! : line).trim().slice(0, n);
};

const PREFIX: [RegExp, RouteKind][] = [
  [/^(idea|ideas)\b[:,.\s-]*/i, 'idea'],
  [/^(tarea|task|to ?do|pendiente|recordatorio|recuerdame|recuérdame|remind me( to)?)\b[:,.\s-]*/i, 'task'],
  [/^(radar|evento|event|oportunidad|opportunity)\b[:,.\s-]*/i, 'radar'],
  [/^(pieza|contenido|reel|carrusel|carousel|piece|post)\b[:,.\s-]*/i, 'piece'],
];
const VARIANT_RE =
  /^(guion|guión|script|gancho|apertura|hook|opening|caption|descripcion|descripción|prompt|remate|final|ending|portada|cover)\s+(para|de|del|for|of)\s+(?:el\s+|la\s+|the\s+)?(.+?)\s*[:\-–—]\s*([\s\S]+)$/i;
const FIELD: Record<string, VariantTarget> = {
  guion: 'script',
  script: 'script',
  gancho: 'hook',
  apertura: 'hook',
  hook: 'hook',
  opening: 'hook',
  caption: 'caption',
  descripcion: 'caption',
  prompt: 'prompt',
  remate: 'ending',
  final: 'ending',
  ending: 'ending',
  portada: 'cover',
  cover: 'cover',
};

const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};
const MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** "hoy", "mañana", "pasado mañana", "el viernes", "el 12 de noviembre", "12/11", "tomorrow", "friday". */
export function parseWhen(text: string, now = new Date()): { date?: string; rest: string } {
  const n = norm(text);
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const cut = (re: RegExp) =>
    text
      .replace(re, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([.,;:])/g, '$1')
      .trim();
  const add = (days: number) => {
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    return ymd(d);
  };
  let m: RegExpMatchArray | null;
  if (/\bpasado manana\b|\bday after tomorrow\b/.test(n))
    return {
      date: add(2),
      rest: cut(/\b(para\s+)?pasado mañana\b|\bpasado manana\b|\bthe day after tomorrow\b/i),
    };
  if (/\b(manana|tomorrow)\b/.test(n) && !/\bpor la manana\b|\bde la manana\b/.test(n))
    return { date: add(1), rest: cut(/\b(para\s+)?(mañana|manana|tomorrow)\b/i) };
  if (/\b(hoy|today|esta tarde|esta noche|tonight)\b/.test(n))
    return { date: add(0), rest: cut(/\b(para\s+)?(hoy|today|esta tarde|esta noche|tonight)\b/i) };
  m = n.match(
    /\b(?:el|este|proximo|next|on|this)?\s*(domingo|lunes|martes|miercoles|jueves|viernes|sabado|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/,
  );
  if (m) {
    const target = WEEKDAYS[m[1]!]!;
    let diff = (target - base.getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    return {
      date: add(diff),
      rest: cut(
        /\b(para\s+)?(el|este|próximo|proximo|next|on|this)?\s*(domingo|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
      ),
    };
  }
  m =
    n.match(/\b(\d{1,2})\s+de\s+([a-z]+)(?:\s+de\s+(\d{4}))?\b/) ??
    n.match(/\b([a-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/);
  if (m) {
    const [d, mo, y] = /^\d/.test(m[1]!) ? [+m[1]!, MONTHS[m[2]!], m[3]] : [+m[2]!, MONTHS[m[1]!], m[3]];
    if (mo && d >= 1 && d <= 31) {
      let year = y ? +y : base.getFullYear();
      const cand = new Date(year, mo - 1, d, 12);
      if (!y && cand < base) year++;
      return {
        date: ymd(new Date(year, mo - 1, d, 12)),
        rest: cut(
          /\b(para\s+)?(el\s+)?(\d{1,2}\s+de\s+[a-záéíóúñ]+(\s+de\s+\d{4})?|[a-z]+\s+\d{1,2}(,?\s+\d{4})?)\b/i,
        ),
      };
    }
  }
  m = n.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (m) {
    const d = +m[1]!;
    const mo = +m[2]!;
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      let year = m[3] ? +(m[3].length === 2 ? `20${m[3]}` : m[3]) : base.getFullYear();
      if (!m[3] && new Date(year, mo - 1, d, 12) < base) year++;
      return {
        date: ymd(new Date(year, mo - 1, d, 12)),
        rest: cut(/\b(para\s+)?(el\s+)?\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/i),
      };
    }
  }
  return { rest: text.trim() };
}

/** Extract a date phrase for radar entries without inventing precision. */
function radarPeriod(text: string): Route['period'] | undefined {
  const re =
    /(\d{1,2}(?:\s*[–-]\s*\d{1,2})?\s+(?:de\s+)?(?:ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic)[a-z]*\.?(?:\s+(?:de\s+)?\d{4})?|(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?:\s+(?:de\s+)?\d{4})?|(?:primavera|verano|otoño|otono|invierno)(?:\s+de)?\s+\d{4})/i;
  const m = text.match(re);
  if (!m) return undefined;
  const raw = m[1]!.replace(/\s+de\s+/gi, ' ').replace(/\./g, '');
  const p = parsePeriod(
    raw.replace(/\b(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*/i, (x) =>
      x.slice(0, 3).toLowerCase(),
    ),
  );
  return { text: m[1]!, ...p };
}

/** Structured block that ChatGPT/Claude are asked to end ideas with. */
function parseBlock(text: string): Route | null {
  const m = text.match(/\[SAGA\]([\s\S]*?)(\[\/SAGA\]|$)/i);
  if (!m) return null;
  const kv: Record<string, string> = {};
  for (const line of m[1]!.split('\n')) {
    const x = line.match(/^\s*[-*]?\s*([\p{L} ]+?)\s*:\s*(.+)$/u);
    if (x) kv[norm(x[1]!)] = x[2]!.trim();
  }
  const tipo = norm(kv.tipo ?? kv.type ?? 'idea');
  const kind: RouteKind = /tarea|task/.test(tipo)
    ? 'task'
    : /radar|evento|event/.test(tipo)
      ? 'radar'
      : /pieza|piece|contenido|reel/.test(tipo)
        ? 'piece'
        : 'idea';
  const title = (kv.titulo ?? kv.title ?? firstSentence(text.replace(m[0], ''))).slice(0, 300);
  if (!title) return null;
  const body = (kv.notas ?? kv.notes ?? kv.descripcion ?? text.replace(m[0], '').trim()).trim();
  const when = kv.fecha ?? kv.date;
  const r: Route = { kind, title, body };
  if (kv.pilar ?? kv.pillar) r.pillar = (kv.pilar ?? kv.pillar)!;
  if (kv.gancho ?? kv.apertura ?? kv.hook) r.hook = (kv.gancho ?? kv.apertura ?? kv.hook)!;
  if (kv.situacion ?? kv.situation) r.situation = (kv.situacion ?? kv.situation)!;
  if (kv.tension) r.tension = kv.tension;
  if (kv.giro ?? kv.twist) r.twist = (kv.giro ?? kv.twist)!;
  if (kv.remate ?? kv.payoff) r.payoff = (kv.remate ?? kv.payoff)!;
  if (when && kind === 'task') {
    const w = /^\d{4}-\d{2}-\d{2}/.test(when) ? { date: when.slice(0, 10) } : parseWhen(when);
    if (w.date) r.due = w.date;
  }
  if (when && kind === 'radar') r.period = { text: when, ...parsePeriod(when) };
  return r;
}

export function routeText(input: string, now = new Date()): Route {
  const text = input.replace(/\r\n?/g, '\n').trim();
  const block = parseBlock(text);
  if (block) return block;

  const v = text.match(VARIANT_RE);
  if (v) {
    const field = FIELD[norm(v[1]!)];
    if (field)
      return {
        kind: 'variant',
        field,
        pieceQuery: v[3]!.trim(),
        title: firstSentence(v[4]!),
        body: v[4]!.trim(),
      };
  }

  for (const [re, kind] of PREFIX) {
    if (!re.test(text)) continue;
    const rest = text.replace(re, '').trim();
    if (!rest) break;
    if (kind === 'task') {
      const w = parseWhen(rest, now);
      const clean = w.rest.replace(/^(de|que|to)\s+/i, '');
      return {
        kind,
        title: firstSentence(clean, 200) || firstSentence(rest, 200),
        body: rest,
        ...(w.date ? { due: w.date } : {}),
      };
    }
    if (kind === 'radar') {
      const period = radarPeriod(rest);
      return { kind, title: firstSentence(rest, 200), body: rest, ...(period ? { period } : {}) };
    }
    return { kind, title: firstSentence(rest), body: rest };
  }

  // Implicit task with a date: "llamar al estudio el viernes"
  if (
    /^(llamar|enviar|mandar|comprar|pagar|reservar|revisar|terminar|grabar|subir|exportar|call|send|buy|pay|book|finish|record|upload)\b/i.test(
      text,
    )
  ) {
    const w = parseWhen(text, now);
    return {
      kind: 'task',
      title: firstSentence(w.rest, 200),
      body: text,
      ...(w.date ? { due: w.date } : {}),
    };
  }
  return { kind: 'inbox', title: firstSentence(text), body: text };
}

/** Best matching piece title for a spoken reference ("Faro", "la pieza 27", "videoclub"). */
export function matchPiece<T extends { id: string; title: string; externalId?: string | null }>(
  query: string,
  pieces: T[],
): T | undefined {
  const q = norm(query);
  const num = q.match(/(?:pieza|post|piece)\s*-?\s*(\d+)/)?.[1];
  if (num) {
    const byId = pieces.find((p) => norm(p.externalId ?? '') === `post-${num}`);
    if (byId) return byId;
  }
  const words = q.split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 3);
  let best: { p: T; score: number } | undefined;
  for (const p of pieces) {
    const t = norm(p.title);
    let score = t === q ? 100 : t.includes(q) ? 50 : 0;
    score += words.filter((w) => t.includes(w)).length * 10;
    if (score > 0 && (!best || score > best.score)) best = { p, score };
  }
  return best && best.score >= 10 ? best.p : undefined;
}
