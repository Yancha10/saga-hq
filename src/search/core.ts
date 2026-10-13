import MiniSearch from 'minisearch';

export type SearchType =
  | 'projects'
  | 'ideas'
  | 'captures'
  | 'content'
  | 'tasks'
  | 'library'
  | 'learnings'
  | 'events';
export const SEARCH_TABLES: SearchType[] = [
  'projects',
  'ideas',
  'captures',
  'content',
  'tasks',
  'library',
  'learnings',
  'events',
];

export interface SearchDoc {
  key: string; // `${type}:${id}`
  id: string;
  type: SearchType;
  title: string;
  body: string;
  tags: string;
  projectId: string;
  status: string;
  archived: boolean;
  updatedAt: string;
}

export interface SearchHit {
  id: string;
  type: SearchType;
  title: string;
  snippet: string;
  status: string;
  projectId: string;
  score: number;
}

const s = (v: unknown) => (typeof v === 'string' ? v : Array.isArray(v) ? v.join(' ') : '');

export function toDoc(type: SearchType, r: Record<string, unknown>): SearchDoc | null {
  if (r.deletedAt) return null;
  let title = '';
  let body = '';
  switch (type) {
    case 'projects':
      title = s(r.name);
      body = [r.goal, r.brief].map(s).join('\n');
      break;
    case 'ideas':
      title = s(r.title);
      body = [r.raw, r.hook, r.concept, r.notes, r.whyItWorks, r.cast, r.topic, r.variantLabel]
        .map(s)
        .join('\n');
      break;
    case 'captures':
      title = s(r.text).slice(0, 120) || s(r.url);
      body = [r.text, r.url].map(s).join('\n');
      break;
    case 'content':
      title = s(r.title);
      body = [r.hook, r.concept, r.script, r.caption, r.coverText, r.hashtags, r.productionNotes]
        .map(s)
        .join('\n');
      break;
    case 'tasks':
      title = s(r.title);
      body = [r.notes, r.resolution].map(s).join('\n');
      break;
    case 'library':
      title = s(r.title) || s(r.originalUrl);
      body = [r.notes, r.whyRelevant, r.originalUrl, r.site, r.author, r.kind].map(s).join('\n');
      break;
    case 'learnings':
      title = s(r.statement);
      body = [r.evidenceNote, r.kind].map(s).join('\n');
      break;
    case 'events':
      title = s(r.title);
      body = s(r.notes);
      break;
  }
  return {
    key: `${type}:${r.id as string}`,
    id: r.id as string,
    type,
    title,
    body: body.slice(0, 20000),
    tags: s(r.tags),
    projectId: s(r.projectId),
    status: s(r.status),
    archived: !!r.archivedAt,
    updatedAt: s(r.updatedAt),
  };
}

export interface ParsedQuery {
  text: string;
  type?: SearchType;
  status?: string;
  projectId?: string;
  includeArchived: boolean;
}

const TYPE_ALIASES: Record<string, SearchType> = {
  idea: 'ideas',
  ideas: 'ideas',
  project: 'projects',
  projects: 'projects',
  content: 'content',
  task: 'tasks',
  tasks: 'tasks',
  research: 'library',
  ref: 'library',
  reference: 'library',
  library: 'library',
  asset: 'library',
  learning: 'learnings',
  learnings: 'learnings',
  inbox: 'captures',
  capture: 'captures',
  event: 'events',
};

export function parseQuery(q: string): ParsedQuery {
  const out: ParsedQuery = { text: '', includeArchived: false };
  const rest: string[] = [];
  for (const tok of q.trim().split(/\s+/)) {
    const m = tok.match(/^(type|status|is|project):(.+)$/i);
    if (!m) {
      rest.push(tok);
      continue;
    }
    const [, k, v] = m;
    if (k!.toLowerCase() === 'type' && TYPE_ALIASES[v!.toLowerCase()])
      out.type = TYPE_ALIASES[v!.toLowerCase()];
    else if (k!.toLowerCase() === 'status') out.status = v!.toLowerCase();
    else if (k!.toLowerCase() === 'is' && v!.toLowerCase() === 'archived') out.includeArchived = true;
    else if (k!.toLowerCase() === 'project') out.projectId = v;
  }
  out.text = rest.join(' ');
  return out;
}

export class SearchCore {
  private ms = new MiniSearch<SearchDoc>({
    idField: 'key',
    fields: ['title', 'body', 'tags'],
    storeFields: ['id', 'type', 'title', 'body', 'status', 'projectId', 'archived', 'updatedAt'],
    searchOptions: { boost: { title: 3, tags: 2 }, prefix: true, fuzzy: 0.15, combineWith: 'AND' },
  });

  get size(): number {
    return this.ms.documentCount;
  }

  upsert(doc: SearchDoc | null, key?: string): void {
    const k = doc?.key ?? key;
    if (k && this.ms.has(k)) this.ms.discard(k);
    if (doc && (doc.title || doc.body)) this.ms.add(doc);
  }

  addAll(docs: SearchDoc[]): void {
    this.ms.addAll(docs.filter((d) => !this.ms.has(d.key) && (d.title || d.body)));
  }

  clear(): void {
    this.ms.removeAll();
  }

  search(q: string, limit = 50): SearchHit[] {
    const pq = parseQuery(q);
    if (!pq.text) return [];
    const res = this.ms.search(pq.text, {
      filter: (r) =>
        (!pq.type || r.type === pq.type) &&
        (!pq.status || r.status === pq.status) &&
        (!pq.projectId || r.projectId === pq.projectId) &&
        (pq.includeArchived || !r.archived),
    });
    return res.slice(0, limit).map((r) => {
      const body = String(r.body ?? '');
      const term = (r.terms?.[0] as string | undefined) ?? '';
      const idx = term ? body.toLowerCase().indexOf(term.toLowerCase()) : -1;
      const snippet =
        idx >= 0
          ? body.slice(Math.max(0, idx - 40), idx + 80).replace(/\s+/g, ' ')
          : body.slice(0, 100).replace(/\s+/g, ' ');
      return {
        id: r.id as string,
        type: r.type as SearchType,
        title: String(r.title),
        snippet,
        status: String(r.status),
        projectId: String(r.projectId),
        score: r.score,
      };
    });
  }
}
