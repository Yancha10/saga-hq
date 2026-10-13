import { Link, useNavigate } from '@tanstack/react-router';
import { Plus, Star } from 'lucide-react';
import { useState } from 'react';
import { useLive, useSession } from '../../app/context';
import type { Content, Project } from '../../data/schema';
import { create } from '../../data/store';
import { Button, Empty, Pill, Sheet, Tabs } from '../../ui/kit';
import { PageHeader } from '../../ui/PageHeader';

export function ProjectsPage() {
  const s = useSession();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<'active' | 'paused' | 'done' | 'archived'>('active');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const data = useLive(
    async (ss) => {
      const [projects, content, tasks] = await Promise.all([
        ss.db.projects.toArray(),
        ss.db.content.toArray(),
        ss.db.tasks.where('status').anyOf('todo', 'doing').toArray(),
      ]);
      return {
        projects,
        content: content.filter((c) => !c.deletedAt),
        tasks: tasks.filter((t) => !t.deletedAt),
      };
    },
    [],
    {
      projects: [] as Project[],
      content: [] as Content[],
      tasks: [] as { projectId?: string | null; isBlocker: boolean; contentId?: string | null }[],
    },
  );
  const list = data.projects.filter(
    (p) => !p.deletedAt && (filter === 'archived' ? !!p.archivedAt : !p.archivedAt && p.status === filter),
  );
  const stats = (p: Project) => {
    const c = data.content.filter((x) => x.projectId === p.id);
    const active = c.filter((x) => !['published', 'reviewed'].includes(x.status)).length;
    const blocked = c.filter((x) => x._blocked).length;
    const next = c
      .map((x) => x._nextPublishAt)
      .filter(Boolean)
      .sort()[0];
    return { active, published: c.length - active, blocked, next };
  };
  return (
    <div className="page">
      <PageHeader
        title="Projects"
        actions={
          <Button variant="primary" onClick={() => setOpen(true)}>
            <Plus size={15} /> New project
          </Button>
        }
      />
      <div style={{ marginBottom: 12 }}>
        <Tabs
          label="Project filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'paused', label: 'Paused' },
            { value: 'done', label: 'Done' },
            { value: 'archived', label: 'Archived' },
          ]}
        />
      </div>
      {list.length === 0 ? (
        <Empty
          title="No projects here"
          action={
            <Button variant="primary" onClick={() => setOpen(true)}>
              Create a project
            </Button>
          }
        >
          Projects are strategic containers — a launch, a season, a series — that pull together content,
          ideas, tasks and results.
        </Empty>
      ) : (
        <div className="list">
          {list.map((p) => {
            const st = stats(p);
            return (
              <Link key={p.id} to="/projects/$id" params={{ id: p.id }} className="row">
                <div className="grow">
                  <div className="title">
                    {p.isFocus && (
                      <Star
                        size={13}
                        fill="currentColor"
                        aria-label="Focus project"
                        style={{ marginRight: 6, color: 'var(--accent)' }}
                      />
                    )}
                    {p.name}
                  </div>
                  <div className="sub">{p.goal || 'No goal set'}</div>
                </div>
                <span className="meta num hide-mobile">
                  {st.active} active · {st.published} published
                </span>
                {st.blocked > 0 && <Pill tone="warn">{st.blocked} blocked</Pill>}
                {st.next && (
                  <span className="tag hide-mobile">
                    next {new Date(st.next).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="New project"
        footer={
          <Button
            variant="primary"
            disabled={!name.trim()}
            onClick={async () => {
              const p = await create(s, 'projects', {
                name: name.trim(),
                goal: goal.trim() || null,
                status: 'active',
                isFocus: false,
                color: 1,
              });
              setOpen(false);
              setName('');
              setGoal('');
              void navigate({ to: '/projects/$id', params: { id: p.id } });
            }}
          >
            Create
          </Button>
        }
      >
        <div className="field">
          <label className="lbl" htmlFor="pname">
            Name
          </label>
          <input
            id="pname"
            className="input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. GTA VI Launch"
          />
        </div>
        <div className="field">
          <label className="lbl" htmlFor="pgoal">
            Goal (optional)
          </label>
          <input
            id="pgoal"
            className="input"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="One line: what success looks like"
          />
        </div>
      </Sheet>
    </div>
  );
}
