import { useState } from 'react';
import { useLive } from '../../app/context';
import type { Task } from '../../data/schema';
import { Empty, Tabs } from '../../ui/kit';
import { PageHeader } from '../../ui/PageHeader';
import { QuickTask, TaskRow } from '../common';

type F = 'open' | 'today' | 'blockers' | 'decisions' | 'done';

/** All tasks: a saved view, not a project-management system. */
export function TasksPage() {
  const [f, setF] = useState<F>('open');
  const tasks = useLive((s) => s.db.tasks.toArray(), [], [] as Task[]);
  const eod = new Date().setHours(23, 59, 59, 999);
  const list = tasks
    .filter((t) => !t.deletedAt && !t.archivedAt)
    .filter((t) => {
      if (f === 'done') return t.status === 'done';
      if (t.status === 'done') return false;
      if (f === 'today') return !!t.dueAt && Date.parse(t.dueAt) <= eod;
      if (f === 'blockers') return t.isBlocker;
      if (f === 'decisions') return t.kind === 'decision';
      return true;
    })
    .sort((a, b) =>
      f === 'done'
        ? (b.doneAt ?? '').localeCompare(a.doneAt ?? '')
        : (a.dueAt ?? '9').localeCompare(b.dueAt ?? '9'),
    );
  return (
    <div className="page narrow">
      <PageHeader title="All tasks" sub="Tasks live with their content and projects; this is the overview." />
      <div style={{ marginBottom: 12 }}>
        <Tabs
          label="Task filter"
          value={f}
          onChange={setF}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'today', label: 'Due today' },
            { value: 'blockers', label: 'Blockers' },
            { value: 'decisions', label: 'Decisions' },
            { value: 'done', label: 'Done' },
          ]}
        />
      </div>
      <div className="list">
        {list.slice(0, 300).map((t) => (
          <TaskRow key={t.id} t={t} />
        ))}
        {list.length === 0 && (
          <div className="row static">
            <Empty compact>Nothing here.</Empty>
          </div>
        )}
        {f !== 'done' && <QuickTask />}
      </div>
    </div>
  );
}
