/**
 * Saga Lai editorial helpers: variants, editorial checklist, next action, capacity, campaign from a
 * radar entry, rule-impact suggestions, ratios and ICS export. Pure where possible; commands go
 * through the one write path (store.ts) so they are validated, synced and undoable.
 */
import type { Session } from '../app/session';
import { ulid } from '../core/ulid';
import { isBlank, nowIso } from '../core/util';
import { zonedToUtc } from '../import/sagaLai';
import type {
  CheckItem,
  Content,
  Publication,
  RadarItem,
  SheetSection,
  Task,
  Variant,
  VariantField,
  Workspace,
} from './schema';
import { mutate, update } from './store';

// ---------------------------------------------------------------- preferences

export const DEFAULT_PREFS = { weeklyHours: 6, weeklyGoal: 3 } as const;
/** Built-in editorial checklist (rendered through i18n until the user imports or edits their own). */
export const DEFAULT_CHECKLIST_IDS = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8'] as const;

export function workspaceTz(ws: Workspace | undefined): string {
  if (ws?.timezone)
    try {
      new Intl.DateTimeFormat('en', { timeZone: ws.timezone });
      return ws.timezone;
    } catch {
      /* fall through */
    }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export interface ChecklistView {
  items: { id: string; text: string | null }[]; // text null → built-in, rendered via i18n
  version: number;
  custom: boolean;
}
export function checklistOf(ws: Workspace | undefined): ChecklistView {
  if (ws?.checklist?.length) return { items: ws.checklist, version: ws.checklistVersion ?? 1, custom: true };
  return { items: DEFAULT_CHECKLIST_IDS.map((id) => ({ id, text: null })), version: 0, custom: false };
}
export function checklistProgress(
  c: Content,
  cl: ChecklistView,
): { done: number; total: number; stale: boolean } {
  const done = cl.items.filter((i) => c.checks?.[i.id]).length;
  return {
    done,
    total: cl.items.length,
    stale: !!c.checks && Object.keys(c.checks).length > 0 && (c.checklistVersion ?? 0) !== cl.version,
  };
}
export async function toggleCheck(
  s: Session,
  c: Content,
  id: string,
  on: boolean,
  version: number,
): Promise<void> {
  await update(
    s,
    'content',
    c.id,
    { checks: { ...(c.checks ?? {}), [id]: on }, checklistVersion: version },
    { label: 'h.check', coalesceKey: `chk:${c.id}` },
  );
}
export async function saveChecklist(s: Session, ws: Workspace, items: CheckItem[]): Promise<void> {
  await update(
    s,
    'workspace',
    'workspace',
    { checklist: items, checklistVersion: (ws.checklistVersion ?? 0) + 1 },
    { label: 'h.checklist' },
  );
}

// ---------------------------------------------------------------- variants

const FIELD_OF: Record<VariantField, keyof Content | null> = {
  hook: 'hook',
  script: 'script',
  caption: 'caption',
  prompt: 'prompt',
  cover: 'coverText',
  ending: null, // an ending has no single field: it lives as a variant until applied by hand
};
export const variantTarget = (f: VariantField) => FIELD_OF[f];

/** Keep a proposal next to the piece without touching the approved text. */
export async function addVariant(
  s: Session,
  c: Content,
  v: { field: VariantField; text: string; by: Variant['by']; label?: string | null },
): Promise<Variant> {
  const variant: Variant = {
    id: ulid(),
    field: v.field,
    text: v.text.slice(0, 100000),
    by: v.by,
    ...(v.label ? { label: v.label.slice(0, 120) } : {}),
    at: nowIso(),
  };
  await update(s, 'content', c.id, { variants: [...(c.variants ?? []), variant] }, { label: 'h.variantAdd' });
  return variant;
}

/**
 * Approve a variant: it becomes the working text; the text it replaces is kept as a variant first,
 * so nothing is lost and the change is one undo away.
 */
export async function approveVariant(s: Session, c: Content, id: string): Promise<void> {
  const v = c.variants?.find((x) => x.id === id);
  if (!v) return;
  const field = FIELD_OF[v.field];
  const variants = (c.variants ?? []).map((x) => (x.field === v.field ? { ...x, approved: x.id === id } : x));
  const patch: Partial<Content> = { variants };
  if (field) {
    const prev = c[field] as string | null | undefined;
    if (!isBlank(prev) && prev !== v.text && !variants.some((x) => x.field === v.field && x.text === prev))
      variants.push({
        id: ulid(),
        field: v.field,
        text: String(prev),
        by: 'user',
        label: null,
        at: nowIso(),
      });
    (patch as Record<string, unknown>)[field] = v.text;
  }
  await update(s, 'content', c.id, patch, { label: 'h.variantApprove', labelParams: { field: v.field } });
}
export async function removeVariant(s: Session, c: Content, id: string): Promise<void> {
  await update(
    s,
    'content',
    c.id,
    { variants: (c.variants ?? []).filter((x) => x.id !== id) },
    { label: 'h.variantRemove' },
  );
}

// ---------------------------------------------------------------- shots

export function shotsDuration(c: Content): { total: number; counted: number; shots: number } {
  const shots = (c.shots ?? []).filter((x) => !x.deleted);
  const timed = shots.filter((x) => typeof x.durationSec === 'number');
  return {
    total: timed.reduce((n, x) => n + (x.durationSec ?? 0), 0),
    counted: timed.length,
    shots: shots.length,
  };
}

// ---------------------------------------------------------------- next action

export interface NextAction {
  key: string; // i18n key under `next.`
  section: SheetSection | 'saga' | null;
}
/** The one concrete thing that moves a piece forward, in production order. */
export function nextActionFor(c: Content): NextAction {
  const shots = (c.shots ?? []).filter((x) => !x.deleted);
  if (c.status === 'published' || c.status === 'reviewed')
    return { key: c.status === 'published' ? 'log_results' : 'done', section: 'publish' };
  if (isBlank(c.hook)) return { key: 'write_hook', section: 'concept' };
  if (isBlank(c.script) && isBlank(c.concept)) return { key: 'write_script', section: 'concept' };
  if (shots.length === 0 && c.formatTemplateId !== 'image_post')
    return { key: 'plan_shots', section: 'generate' };
  if (shots.some((x) => x.status === 'todo' || x.status === 'generating'))
    return { key: 'generate_shots', section: 'generate' };
  if (isBlank(c.finalExportUrl) && isBlank(c.finalExportMediaId))
    return { key: 'final_export', section: 'edit' };
  if (isBlank(c.coverUrl) && isBlank(c.coverMediaId)) return { key: 'cover', section: 'package' };
  if (isBlank(c.caption)) return { key: 'caption', section: 'package' };
  if (!c._nextPublishAt) return { key: 'schedule', section: 'publish' };
  return { key: 'publish', section: 'publish' };
}

// ---------------------------------------------------------------- week & capacity

/** Monday 00:00 (local) of the week containing `d`. */
export function weekStart(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
}

export interface Capacity {
  availableMin: number;
  estimatedMin: number;
  unestimated: number;
  pubs: number;
  goal: number;
  overloaded: boolean;
  overGoal: boolean;
}
export function capacityOf(ws: Workspace | undefined, tasks: Task[], pubs: number): Capacity {
  const hours = ws?.weeklyHours ?? DEFAULT_PREFS.weeklyHours;
  const goal = ws?.weeklyGoal ?? DEFAULT_PREFS.weeklyGoal;
  const open = tasks.filter((t) => t.status !== 'done');
  const estimatedMin = open.reduce((n, t) => n + (t.estimateMin ?? 0), 0);
  return {
    availableMin: hours * 60,
    estimatedMin,
    unestimated: open.filter((t) => !t.estimateMin).length,
    pubs,
    goal,
    overloaded: estimatedMin > hours * 60,
    overGoal: pubs > goal,
  };
}

// ---------------------------------------------------------------- radar → campaign

export const CAMPAIGN_PARTS = ['teaser', 'main', 'making_of', 'follow_up'] as const;
export type CampaignPart = (typeof CAMPAIGN_PARTS)[number];
const PART_OFFSET: Record<CampaignPart, number> = { teaser: -5, main: 0, making_of: 2, follow_up: 7 };

export interface CampaignDraft {
  part: CampaignPart;
  title: string;
  date: string | null; // YYYY-MM-DD, only when the radar date is verified and day-precise
  include: boolean;
}
/** Proposed pieces. Unverified or vague dates never produce calendar dates. */
export function campaignDraft(r: RadarItem, titles: Record<CampaignPart, string>): CampaignDraft[] {
  const dated =
    r.verification === 'verified' && !!r.startDate && (r.precision === 'day' || r.precision === 'range');
  return CAMPAIGN_PARTS.map((part) => {
    let date: string | null = null;
    if (dated) {
      const d = new Date(`${r.startDate}T12:00:00`);
      d.setDate(d.getDate() + PART_OFFSET[part]);
      date = d.toISOString().slice(0, 10);
    }
    return { part, title: titles[part], date, include: true };
  });
}

export async function createCampaign(
  s: Session,
  r: RadarItem,
  opts: { name: string; drafts: CampaignDraft[]; hour: number; tz: string },
): Promise<string> {
  return mutate(
    s,
    { label: 'h.campaign', labelParams: { count: opts.drafts.filter((d) => d.include).length } },
    async (m) => {
      const p = await m.create('projects', {
        name: opts.name.slice(0, 200) || r.title.slice(0, 200),
        status: 'active',
        kind: 'campaign',
        isFocus: false,
        color: 5,
        platforms: ['instagram'],
        goal: r.angle?.slice(0, 500) ?? null,
        ...(r.startDate ? { startDate: new Date(`${r.startDate}T12:00:00`).toISOString() } : {}),
        ...(r.endDate ? { endDate: new Date(`${r.endDate}T12:00:00`).toISOString() } : {}),
      });
      let prev: string | null = null;
      for (const d of opts.drafts.filter((x) => x.include)) {
        const c = await m.create('content', {
          title: d.title.slice(0, 300),
          status: 'planned',
          formatTemplateId: 'reel',
          platforms: ['instagram'],
          projectId: p.id,
          concept: r.angle ?? null,
        });
        if (d.date) {
          const [y, mo, day] = d.date.split('-').map(Number) as [number, number, number];
          await m.create('publications', {
            contentId: c.id,
            platform: 'instagram',
            status: 'planned',
            scheduledAt: zonedToUtc(y, mo, day, opts.hour, 0, opts.tz),
          });
        }
        if (prev && d.part === 'making_of')
          await m.create('links', {
            fromType: 'content',
            fromId: c.id,
            toType: 'content',
            toId: prev,
            type: 'reuse',
          });
        if (d.part === 'main') prev = c.id;
      }
      if (r.verification !== 'verified')
        await m.create('tasks', {
          title: r.title.slice(0, 480),
          status: 'todo',
          kind: 'task',
          isBlocker: false,
          projectId: p.id,
          notes: r.periodText ?? null,
          category: 'radar',
        });
      await m.update('radar', r.id, { projectId: p.id, decision: r.decision ?? null });
      return p.id;
    },
  );
}

// ---------------------------------------------------------------- Bible: rule impact

const STOP = new Set(
  'para como pero porque cuando donde desde hasta entre sobre todo toda todos todas este esta estos estas aquel cada solo sólo también tiene tienen puede pueden debe deben hacer hace sería siempre nunca antes después with that this from have will your their there about which would could should other than then them they into more most only'.split(
    ' ',
  ),
);
function terms(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9ñ]+/)
      .filter((w) => w.length >= 5 && !STOP.has(w)),
  );
}
/** Words that appear in changed lines (added or removed) of a chapter edit. */
export function changedTerms(before: string, after: string): string[] {
  const a = new Set(before.split('\n').map((l) => l.trim()));
  const b = new Set(after.split('\n').map((l) => l.trim()));
  const changed = [...[...a].filter((l) => !b.has(l)), ...[...b].filter((l) => !a.has(l))].join('\n');
  const common = terms([...a].filter((l) => b.has(l)).join('\n'));
  const out = [...terms(changed)];
  // prefer words that are new to the chapter; fall back to all changed words
  const fresh = out.filter((w) => !common.has(w));
  return (fresh.length ? fresh : out).slice(0, 40);
}
/** Pieces that mention the changed words — a suggestion to review, never an automatic rewrite. */
export function affectedPieces(
  pieces: Content[],
  words: string[],
  limit = 12,
): { piece: Content; hits: string[] }[] {
  if (!words.length) return [];
  const out: { piece: Content; hits: string[] }[] = [];
  for (const c of pieces) {
    if (c.deletedAt || c.archivedAt || c.status === 'reviewed') continue;
    const hay = terms(
      [
        c.title,
        c.hook,
        c.script,
        c.prompt,
        c.caption,
        c.continuityNotes,
        c.artDirection,
        c.soundDirection,
        c.concept,
      ]
        .filter(Boolean)
        .join('\n'),
    );
    const hits = words.filter((w) => hay.has(w));
    if (hits.length) out.push({ piece: c, hits });
  }
  return out.sort((a, b) => b.hits.length - a.hits.length).slice(0, limit);
}

// ---------------------------------------------------------------- ratios

/** part / reach × 100, or null ("no data") when reach is missing or zero. Never divides by nothing. */
export function perReach(part: number | undefined, reach: number | undefined): number | null {
  if (typeof part !== 'number' || typeof reach !== 'number' || !Number.isFinite(reach) || reach <= 0)
    return null;
  return (part / reach) * 100;
}

// ---------------------------------------------------------------- ICS

const icsEsc = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
/** Fold to 75 octets per RFC 5545 (continuation lines start with a space). */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let len = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (len + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      len = 0;
    }
    cur += ch;
    len += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}
const utcStamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function localStamp(iso: string, tz: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}${p.month}${p.day}T${p.hour}${p.minute}${p.second}`;
}
const EU_RULE_ZONES =
  /^(Europe\/(?!Moscow|Istanbul|Minsk|Kaliningrad|Samara|Volgograd|Astrakhan|Saratov|Ulyanovsk|Kirov)|Atlantic\/(Canary|Faroe|Madeira))/;

/** VTIMEZONE for zones on the EU summer-time rule (last Sunday of March/October, 01:00 UTC). */
function vtimezone(tz: string): string[] | null {
  if (!EU_RULE_ZONES.test(tz)) return null;
  const off = (month: number) => {
    const d = Date.UTC(2026, month, 15, 12);
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
        .formatToParts(new Date(d))
        .map((x) => [x.type, x.value]),
    );
    const m = String(p.timeZoneName ?? 'GMT').match(/GMT([+-]\d{2}):?(\d{2})?/);
    return m ? `${m[1]}${m[2] ?? '00'}` : '+0000';
  };
  const std = off(0);
  const dst = off(6);
  const hourOf = (o: string, base: number) => String(base + Number(o.slice(0, 3))).padStart(2, '0');
  return [
    'BEGIN:VTIMEZONE',
    `TZID:${tz}`,
    'BEGIN:DAYLIGHT',
    `TZOFFSETFROM:${std}`,
    `TZOFFSETTO:${dst}`,
    `DTSTART:19700329T${hourOf(std, 1)}0000`,
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    `TZOFFSETFROM:${dst}`,
    `TZOFFSETTO:${std}`,
    `DTSTART:19701025T${hourOf(dst, 1)}0000`,
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];
}

export interface IcsItem {
  uid: string;
  start: string; // ISO instant
  end?: string;
  allDay?: boolean;
  title: string;
  description?: string;
  url?: string;
  updatedAt?: string;
}
/** RFC 5545 calendar. Times are written in `tz` (with its VTIMEZONE) when known, else in UTC. */
export function buildIcs(items: IcsItem[], tz: string, name: string): string {
  const vt = vtimezone(tz);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Saga HQ//Planner//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEsc(name)}`,
    ...(vt ? [`X-WR-TIMEZONE:${tz}`, ...vt] : []),
  ];
  const stamp = utcStamp(new Date().toISOString());
  for (const it of items) {
    const start = it.allDay
      ? `DTSTART;VALUE=DATE:${localStamp(it.start, tz).slice(0, 8)}`
      : vt
        ? `DTSTART;TZID=${tz}:${localStamp(it.start, tz)}`
        : `DTSTART:${utcStamp(it.start)}`;
    const endIso =
      it.end ?? (it.allDay ? undefined : new Date(Date.parse(it.start) + 30 * 60000).toISOString());
    const end = !endIso
      ? null
      : it.allDay
        ? `DTEND;VALUE=DATE:${localStamp(endIso, tz).slice(0, 8)}`
        : vt
          ? `DTEND;TZID=${tz}:${localStamp(endIso, tz)}`
          : `DTEND:${utcStamp(endIso)}`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${it.uid}`,
      `DTSTAMP:${stamp}`,
      ...(it.updatedAt ? [`LAST-MODIFIED:${utcStamp(it.updatedAt)}`] : []),
      start,
      ...(end ? [end] : []),
      `SUMMARY:${icsEsc(it.title)}`,
      ...(it.description ? [`DESCRIPTION:${icsEsc(it.description)}`] : []),
      ...(it.url ? [`URL:${it.url.replace(/[\r\n]/g, '')}`] : []),
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/** Calendar items for planned/published pieces (one per publication), with stable UIDs. */
export function publicationIcsItems(
  pubs: Publication[],
  content: Map<string, Content>,
  label: (c: Content, p: Publication) => string,
): IcsItem[] {
  const out: IcsItem[] = [];
  for (const p of pubs) {
    const when = p.publishedAt ?? p.scheduledAt;
    const c = content.get(p.contentId);
    if (!when || !c || p.deletedAt || c.deletedAt || p.status === 'cancelled') continue;
    out.push({
      uid: `pub-${p.id}@saga-hq`,
      start: when,
      title: label(c, p),
      description: [c.hook, c.dmKeyword ? `DM: ${c.dmKeyword}` : ''].filter(Boolean).join('\n'),
      ...(p.url ? { url: p.url } : {}),
      updatedAt: p.updatedAt,
    });
  }
  return out;
}
