import { useState } from 'react';
import { useLive } from '../../app/context';
import type { Task } from '../../data/schema';
import { t, useT } from '../../i18n';
import { Empty, Tabs } from '../../ui/kit';
import { PageHeader } from '../../ui/PageHeader';
import { QuickTask, TaskRow } from '../common';

type F = 'open' | 'today' | 'blockers' | 'decisions' | 'done';

/** All tasks: a saved view, not a project-management system. */
export function TasksPage() {
  useT();
  const [f, setF] = useState<F>('open');
  const tasks = useLive((s) => s.db.tasks.toArray(), [], [] as Task[]);
  const eod = new Date().setHours(23, 59, 59, 999);
  const list = tasks
    .filter((x) => !x.deletedAt && !x.archivedAt)
    .filter((x) => {
      if (f === 'done') return x.status === 'done';
      if (x.status === 'done') return false;
      if (f === 'today') return !!x.dueAt && Date.parse(x.dueAt) <= eod;
      if (f === 'blockers') return x.isBlocker;
      if (f === 'decisions') return x.kind === 'decision';
      return true;
    })
    .sort((a, b) =>
      f === 'done'
        ? (b.doneAt ?? '').localeCompare(a.doneAt ?? '')
        : (a.dueAt ?? '9').localeCompare(b.dueAt ?? '9'),
    );
  return (
    <div className="page narrow">
      <PageHeader title={t('nav.tasks_all')} sub={t('tasks.sub')} />
      <div style={{ marginBottom: 12 }}>
        <Tabs
          label={t('tasks.filter_label')}
          value={f}
          onChange={setF}
          options={[
            { value: 'open', label: t('tasks.filter.open') },
            { value: 'today', label: t('tasks.filter.today') },
            { value: 'blockers', label: t('tasks.filter.blockers') },
            { value: 'decisions', label: t('tasks.filter.decisions') },
            { value: 'done', label: t('tasks.filter.done') },
          ]}
        />
      </div>
      <div className="list">
        {list.slice(0, 300).map((x) => (
          <TaskRow key={x.id} t={x} />
        ))}
        {list.length === 0 && (
          <div className="row static">
            <Empty compact>{t('common.nothing_here')}</Empty>
          </div>
        )}
        {f !== 'done' && <QuickTask />}
      </div>
    </div>
  );
}
