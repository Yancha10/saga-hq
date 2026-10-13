/// <reference lib="webworker" />
import Dexie from 'dexie';
import { SEARCH_TABLES, SearchCore, type SearchDoc, type SearchType, toDoc } from './core';

/**
 * Search runs off the main thread. The worker opens ONLY the workspace database it is told to
 * (one worker per session; terminated on account switch), builds the index in batches, and
 * answers queries.
 */
const core = new SearchCore();
let ready = false;

type Msg =
  | { kind: 'init'; dbName: string }
  | { kind: 'upsert'; type: SearchType; records: Record<string, unknown>[] }
  | { kind: 'remove'; type: SearchType; ids: string[] }
  | { kind: 'query'; id: number; q: string; limit?: number };

self.onmessage = async (ev: MessageEvent<Msg>) => {
  const m = ev.data;
  if (m.kind === 'init') {
    const db = new Dexie(m.dbName);
    await db.open();
    for (const t of SEARCH_TABLES) {
      if (!db.tables.some((x) => x.name === t)) continue;
      let offset = 0;
      for (;;) {
        const rows = (await db.table(t).offset(offset).limit(2000).toArray()) as Record<string, unknown>[];
        if (!rows.length) break;
        core.addAll(rows.map((r) => toDoc(t, r)).filter((d): d is SearchDoc => !!d));
        offset += rows.length;
      }
    }
    db.close();
    ready = true;
    (self as unknown as Worker).postMessage({ kind: 'ready', size: core.size });
  } else if (m.kind === 'upsert') {
    for (const r of m.records) core.upsert(toDoc(m.type, r), `${m.type}:${r.id as string}`);
  } else if (m.kind === 'remove') {
    for (const id of m.ids) core.upsert(null, `${m.type}:${id}`);
  } else if (m.kind === 'query') {
    (self as unknown as Worker).postMessage({
      kind: 'result',
      id: m.id,
      ready,
      hits: core.search(m.q, m.limit),
    });
  }
};
