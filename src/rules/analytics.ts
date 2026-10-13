import { median } from '../core/util';
import type { Content, Publication, Snapshot } from '../data/schema';

/** Platform-scoped metric keys. Cross-platform totals are deliberately not computed. */
export const COMMON_METRICS = [
  { key: 'views', label: 'Views / plays' },
  { key: 'likes', label: 'Likes' },
  { key: 'comments', label: 'Comments' },
  { key: 'shares', label: 'Shares' },
  { key: 'saves', label: 'Saves' },
  { key: 'avgWatchSec', label: 'Avg watch (s)' },
  { key: 'retentionPct', label: 'Retention / completion %' },
  { key: 'followers', label: 'Followers gained' },
  { key: 'profileVisits', label: 'Profile visits' },
  { key: 'reach', label: 'Reach' },
] as const;

export const CHECKPOINTS = [
  { key: '1h', hours: 1 },
  { key: '6h', hours: 6 },
  { key: '24h', hours: 24 },
  { key: '72h', hours: 72 },
  { key: '7d', hours: 168 },
  { key: '28d', hours: 672 },
] as const;
export type CheckpointKey = (typeof CHECKPOINTS)[number]['key'];

/** Snap an observation age to a checkpoint label within ±20%. */
export function snapCheckpoint(ageHours: number): CheckpointKey | null {
  for (const c of CHECKPOINTS) if (Math.abs(ageHours - c.hours) <= c.hours * 0.2) return c.key;
  return null;
}

export const MIN_BASELINE = 5;

export interface Outlier {
  publicationId: string;
  contentId: string;
  ratio: number;
  n: number;
  metric: string;
  checkpoint: string;
}

/** Compare each publication's checkpoint value against the median of the same platform+format. */
export function findOutliers(
  pubs: Publication[],
  snaps: Snapshot[],
  content: Map<string, Content>,
  metric = 'views',
  checkpoint: CheckpointKey = '24h',
): Outlier[] {
  const byPub = new Map<string, number>();
  for (const s of snaps) {
    if (s.deletedAt || s.checkpoint !== checkpoint) continue;
    const v = s.metrics[metric];
    if (typeof v === 'number') byPub.set(s.publicationId, v);
  }
  const groups = new Map<string, { pub: Publication; v: number }[]>();
  for (const p of pubs) {
    const v = byPub.get(p.id);
    if (v === undefined || p.deletedAt) continue;
    const fmt = content.get(p.contentId)?.formatTemplateId ?? '?';
    const k = `${p.platform}|${fmt}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push({ pub: p, v });
  }
  const out: Outlier[] = [];
  for (const items of groups.values()) {
    for (const it of items) {
      const others = items.filter((x) => x !== it).map((x) => x.v);
      if (others.length < MIN_BASELINE) continue;
      const m = median(others)!;
      if (m <= 0) continue;
      const ratio = it.v / m;
      if (ratio >= 2 || ratio <= 0.5)
        out.push({
          publicationId: it.pub.id,
          contentId: it.pub.contentId,
          ratio,
          n: others.length,
          metric,
          checkpoint,
        });
    }
  }
  return out.sort((a, b) => Math.abs(Math.log(b.ratio)) - Math.abs(Math.log(a.ratio)));
}

export interface PatternRow {
  value: string;
  n: number;
  median: number;
}
/** Group checkpoint values by a content attribute. Returns null groups when n is too small. */
export function patternBy(
  pubs: Publication[],
  snaps: Snapshot[],
  content: Map<string, Content>,
  attr: (c: Content, p: Publication) => string | null | undefined,
  metric = 'views',
  checkpoint: CheckpointKey = '24h',
): PatternRow[] {
  const val = new Map<string, number>();
  for (const s of snaps)
    if (!s.deletedAt && s.checkpoint === checkpoint && typeof s.metrics[metric] === 'number')
      val.set(s.publicationId, s.metrics[metric]!);
  const groups = new Map<string, number[]>();
  for (const p of pubs) {
    const v = val.get(p.id);
    const c = content.get(p.contentId);
    if (v === undefined || !c) continue;
    const a = attr(c, p);
    if (!a) continue;
    if (!groups.has(a)) groups.set(a, []);
    groups.get(a)!.push(v);
  }
  return [...groups.entries()]
    .map(([value, vs]) => ({ value, n: vs.length, median: median(vs)! }))
    .sort((a, b) => b.median - a.median);
}
