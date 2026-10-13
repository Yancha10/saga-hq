import { Link, useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useLive, useSession } from '../../app/context';
import type { Idea } from '../../data/schema';
import { create } from '../../data/store';
import { relDays } from '../../rules/time';
import { Button, Empty, Pill, Tabs } from '../../ui/kit';
import { PageHeader } from '../../ui/PageHeader';
import { ProjectSelect, useProjects } from '../common';

type Filter = 'active' | 'shortlisted' | 'new' | 'parked' | 'committed' | 'archived';
const PAGE = 100;

export function IdeasPage() {
  const s = useSession();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('active');
  const [q, setQ] = useState('');
  const [project, setProject] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [draft, setDraft] = useState('');
  const projects = useProjects();
  const pName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const ideas = useLive((ss) => ss.db.ideas.orderBy('updatedAt').reverse().toArray(), [], [] as Idea[]);
  const variantCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of ideas)
      if (i.parentIdeaId && !i.deletedAt) m.set(i.parentIdeaId, (m.get(i.parentIdeaId) ?? 0) + 1);
    return m;
  }, [ideas]);
  const filtered = ideas.filter((i) => {
    if (i.deletedAt) return false;
    if (filter === 'archived') return !!i.archivedAt;
    if (i.archivedAt) return false;
    if (i.parentIdeaId && filter === 'active') return false;
    if (filter === 'active' && (i.status === 'parked' || i.status === 'committed')) return false;
    if (filter !== 'active' && i.status !== filter) return false;
    if (project && i.projectId !== project) return false;
    if (q && !`${i.title} ${i.hook ?? ''} ${i.raw ?? ''}`.toLowerCase().includes(q.toLowerCase()))
      return false;
    return true;
  });
  const add = async () => {
    if (!draft.trim()) return;
    const i = await create(s, 'ideas', { title: draft.trim(), status: 'new', projectId: project });
    setDraft('');
    void navigate({ to: '/ideas/$id', params: { id: i.id } });
  };
  return (
    <div className="page">
      <PageHeader title="Ideas" sub={`${filtered.length} shown`} />
      <div className="hstack" style={{ marginBottom: 12 }}>
        <Tabs
          label="Idea filter"
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setLimit(PAGE);
          }}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'shortlisted', label: 'Shortlist' },
            { value: 'new', label: 'New' },
            { value: 'committed', label: 'In content' },
            { value: 'parked', label: 'Parked' },
            { value: 'archived', label: 'Archived' },
          ]}
        />
        <input
          className="input"
          style={{ maxWidth: 240 }}
          placeholder="Filter…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Filter ideas"
        />
        <div style={{ width: 200 }}>
          <ProjectSelect value={project} onChange={setProject} />
        </div>
      </div>
      <form
        className="hstack list"
        style={{ padding: '4px 10px', marginBottom: 12, flexWrap: 'nowrap' }}
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <Plus size={16} aria-hidden style={{ color: 'var(--text-3)' }} />
        <input
          className="input plain"
          style={{ flex: 1 }}
          placeholder="New idea title — Enter to create"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="New idea title"
        />
        {draft && (
          <Button size="sm" type="submit">
            Create
          </Button>
        )}
      </form>
      {filtered.length === 0 ? (
        <Empty title={ideas.length ? 'No ideas match' : 'No ideas yet'}>
          {ideas.length
            ? 'Try another filter.'
            : 'Capture thoughts from anywhere with the + button, then turn the good ones into content.'}
        </Empty>
      ) : (
        <div className="list">
          {filtered.slice(0, limit).map((i) => (
            <Link key={i.id} to="/ideas/$id" params={{ id: i.id }} className="row">
              <div className="grow">
                <div className="title">
                  {i.status === 'shortlisted' ? '★ ' : ''}
                  {i.title || 'Untitled idea'}
                </div>
                <div className="sub">
                  {[
                    i.hook,
                    i.projectId && pName.get(i.projectId),
                    i.format,
                    i.variantLabel && `variant: ${i.variantLabel}`,
                  ]
                    .filter(Boolean)
                    .join(' · ') || relDays(i.updatedAt)}
                </div>
              </div>
              {variantCount.get(i.id) ? <span className="tag">{variantCount.get(i.id)} variants</span> : null}
              <Pill
                tone={i.status === 'shortlisted' ? 'accent' : i.status === 'committed' ? 'ok' : undefined}
              >
                {i.status}
              </Pill>
            </Link>
          ))}
          {filtered.length > limit && (
            <button
              type="button"
              className="more-link"
              style={{ border: 0, background: 'none', textAlign: 'left', cursor: 'pointer' }}
              onClick={() => setLimit((l) => l + PAGE)}
            >
              Show {Math.min(PAGE, filtered.length - limit)} more of {filtered.length - limit}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
