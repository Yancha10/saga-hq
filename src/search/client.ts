import type { Session } from '../app/session';
import { logger } from '../diagnostics/logger';
import { SEARCH_TABLES, SearchCore, type SearchDoc, type SearchHit, type SearchType, toDoc } from './core';

/**
 * Per-session search client. Uses a Web Worker when available, otherwise an in-thread index.
 * Index updates follow the session's change events, so it never sees another account's records.
 */
export class SearchClient {
  private worker: Worker | null = null;
  private local: SearchCore | null = null;
  private reqId = 0;
  private pending = new Map<number, (h: SearchHit[]) => void>();
  ready = false;

  constructor(private readonly s: Session) {}

  async start(): Promise<void> {
    const s = this.s;
    if (typeof Worker !== 'undefined' && !import.meta.env?.VITEST) {
      try {
        this.worker = new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (ev) => {
          const m = ev.data as { kind: string; id?: number; hits?: SearchHit[] };
          if (m.kind === 'ready') this.ready = true;
          if (m.kind === 'result' && m.id !== undefined) {
            this.pending.get(m.id)?.(m.hits ?? []);
            this.pending.delete(m.id);
          }
        };
        this.worker.postMessage({ kind: 'init', dbName: s.ref.dbName });
      } catch (e) {
        logger.warn('search', 'worker unavailable, using in-thread index', e);
        this.worker = null;
      }
    }
    if (!this.worker) await this.buildLocal();
    const off = s.onChange(async (events) => {
      for (const e of events) {
        if (!(SEARCH_TABLES as string[]).includes(e.table) || !s.isLive()) continue;
        const type = e.table as SearchType;
        const rows = e.ids.length
          ? ((await s.db.table(type).bulkGet(e.ids)) as (Record<string, unknown> | undefined)[])
          : [];
        const present = rows.filter((r): r is Record<string, unknown> => !!r);
        const missing = e.ids.filter((_id, i) => !rows[i]);
        if (this.worker) {
          if (present.length) this.worker.postMessage({ kind: 'upsert', type, records: present });
          if (missing.length) this.worker.postMessage({ kind: 'remove', type, ids: missing });
        } else if (this.local) {
          for (const r of present) this.local.upsert(toDoc(type, r), `${type}:${r.id as string}`);
          for (const id of missing) this.local.upsert(null, `${type}:${id}`);
        }
        if (e.ids.length === 0 && e.source === 'import') {
          // Bulk replace (restore/import): rebuild
          if (this.worker) this.worker.postMessage({ kind: 'init', dbName: s.ref.dbName });
          else await this.buildLocal();
        }
      }
    });
    s.addDisposer(() => {
      off();
      this.worker?.terminate();
      this.worker = null;
      this.local = null;
      for (const r of this.pending.values()) r([]);
      this.pending.clear();
    });
  }

  private async buildLocal(): Promise<void> {
    const core = new SearchCore();
    for (const t of SEARCH_TABLES) {
      const rows = (await this.s.db.table(t).toArray()) as Record<string, unknown>[];
      core.addAll(rows.map((r) => toDoc(t, r)).filter((d): d is SearchDoc => !!d));
    }
    this.local = core;
    this.ready = true;
  }

  search(q: string, limit = 50): Promise<SearchHit[]> {
    if (this.local) return Promise.resolve(this.local.search(q, limit));
    if (!this.worker) return Promise.resolve([]);
    const id = ++this.reqId;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.worker!.postMessage({ kind: 'query', id, q, limit });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          resolve([]);
        }
      }, 5000);
    });
  }
}
