import { deepEqual } from '../core/util';
import { isDerivedField, LONG_TEXT_FIELDS, META_FIELDS, type Shot, type Tombstone } from '../data/schema';

type Rec = Record<string, unknown> & {
  id: string;
  rev: string;
  fieldRevs: Record<string, string>;
  fieldPrev?: Record<string, string>;
};

export interface FieldConflict {
  field: string;
  loserValue: unknown;
  loserRev: string;
  winnerRev: string;
}

export interface MergeResult {
  record: Rec | null; // null → stays deleted (tombstoned)
  conflicts: FieldConflict[];
  resurrected: boolean;
  changed: boolean;
}

export function stripDerived<T extends Record<string, unknown>>(r: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) if (!isDerivedField(k)) out[k] = v;
  return out as T;
}

function mergeShots(local: Shot[] | undefined, remote: Shot[] | undefined): Shot[] {
  const byId = new Map<string, Shot>();
  for (const s of local ?? []) byId.set(s.id, s);
  for (const s of remote ?? []) {
    const l = byId.get(s.id);
    if (!l || s.rev > l.rev) byId.set(s.id, s);
  }
  return [...byId.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/**
 * Per-field last-writer-wins on HLC field revisions. Concurrent edits (neither side had seen the
 * other's revision) of long-form text keep the losing value as a conflict copy — never silently lost.
 * Pure and idempotent: merge(merge(a,b),b) === merge(a,b), and the winner is identical on every device.
 */
export function mergeRecord(local: Rec | undefined, remoteIn: Rec, tombstone?: Tombstone): MergeResult {
  const remote = stripDerived(remoteIn);
  if (!local) {
    if (tombstone) {
      if (remote.rev > tombstone.rev) {
        // An edit newer than the deletion: resurrect into Trash so nothing is lost silently.
        return {
          record: { ...remote, deletedAt: remote.deletedAt ?? tombstone.deletedAt },
          conflicts: [],
          resurrected: true,
          changed: true,
        };
      }
      return { record: null, conflicts: [], resurrected: false, changed: false };
    }
    return { record: remote, conflicts: [], resurrected: false, changed: true };
  }

  const out: Rec = { ...local };
  const fieldRevs = { ...local.fieldRevs };
  const fieldPrev = { ...(local.fieldPrev ?? {}) };
  const conflicts: FieldConflict[] = [];
  let changed = false;
  const keys = new Set([...Object.keys(remote.fieldRevs ?? {}), ...Object.keys(local.fieldRevs ?? {})]);
  for (const k of keys) {
    if (META_FIELDS.has(k) || isDerivedField(k)) continue;
    const lr = local.fieldRevs?.[k];
    const rr = remote.fieldRevs?.[k];
    if (!rr || rr === lr) continue;
    const remoteWins = !lr || rr > lr;
    if (k === 'shots') {
      const merged = mergeShots(local.shots as Shot[] | undefined, remote.shots as Shot[] | undefined);
      if (!deepEqual(merged, local.shots)) changed = true;
      out.shots = merged;
      if (remoteWins) {
        changed = true;
        fieldRevs[k] = rr;
        if (remote.fieldPrev?.[k]) fieldPrev[k] = remote.fieldPrev[k];
      }
      continue;
    }
    const concurrent =
      !!lr && remote.fieldPrev?.[k] !== lr && local.fieldPrev?.[k] !== rr && !deepEqual(local[k], remote[k]);
    if (concurrent && LONG_TEXT_FIELDS.has(k)) {
      conflicts.push(
        remoteWins
          ? { field: k, loserValue: local[k], loserRev: lr, winnerRev: rr }
          : { field: k, loserValue: remote[k], loserRev: rr, winnerRev: lr },
      );
    }
    if (remoteWins) {
      changed = true; // value and/or field revision changes — must be persisted for convergence
      out[k] = remote[k] ?? null;
      fieldRevs[k] = rr;
      if (remote.fieldPrev?.[k]) fieldPrev[k] = remote.fieldPrev[k];
      else delete fieldPrev[k];
    }
  }
  out.fieldRevs = fieldRevs;
  out.fieldPrev = fieldPrev;
  const maxRev = Object.values(fieldRevs).reduce(
    (a, b) => (b > a ? b : a),
    local.rev > remote.rev ? local.rev : remote.rev,
  );
  if (maxRev !== local.rev) changed = true;
  out.rev = maxRev;
  if (remote.rev > local.rev) {
    out.updatedAt = remote.updatedAt;
    out.updatedByDevice = remote.updatedByDevice;
  }
  if (
    typeof remote.createdAt === 'string' &&
    typeof local.createdAt === 'string' &&
    remote.createdAt < local.createdAt
  )
    out.createdAt = remote.createdAt;
  if (typeof remote.schemaVersion === 'number' && remote.schemaVersion > (local.schemaVersion as number))
    out.schemaVersion = remote.schemaVersion;
  return { record: out, conflicts, resurrected: false, changed };
}

/** Remote tombstone against a local record. */
export function applyTombstone(local: Rec | undefined, tomb: Tombstone): { delete: boolean; trash: boolean } {
  if (!local) return { delete: false, trash: false };
  // Local had edits newer than the deletion: keep it, but in Trash, so the user decides.
  if (local.rev > tomb.rev) return { delete: false, trash: !local.deletedAt };
  return { delete: true, trash: false };
}
