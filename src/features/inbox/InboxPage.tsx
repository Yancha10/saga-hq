import { useSearch } from '@tanstack/react-router';
import { Archive, BookOpen, Clapperboard, Lightbulb, ListChecks, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useApp, useLive, useSession } from '../../app/context';
import { useShortcuts } from '../../app/keys';
import { toast } from '../../app/status';
import { truncate } from '../../core/util';
import { type TriageTarget, triage } from '../../data/domain';
import type { Capture } from '../../data/schema';
import { trash, undoLast } from '../../data/store';
import { relDays } from '../../rules/time';
import { Button, Empty, Pill } from '../../ui/kit';
import { PageHeader } from '../../ui/PageHeader';
import { ExtLink, MediaThumb, ProjectSelect } from '../common';

const TARGETS: { t: TriageTarget; label: string; key: string }[] = [
  { t: 'idea', label: 'Idea', key: 'i' },
  { t: 'task', label: 'Task', key: 't' },
  { t: 'research', label: 'Research', key: 'r' },
  { t: 'reference', label: 'Reference', key: 'f' },
  { t: 'content', label: 'Content', key: 'c' },
  { t: 'note', label: 'Note', key: 'n' },
];

const suggestionTarget = (c: Capture): TriageTarget => {
  const sug = c.suggestion;
  if (!sug) return 'idea';
  if (sug.type === 'library') return sug.role === 'reference' ? 'reference' : 'research';
  return sug.type as TriageTarget;
};
const TARGET_LABEL: Record<TriageTarget, string> = {
  idea: 'Idea',
  task: 'Task',
  research: 'Research',
  reference: 'Reference',
  asset: 'Asset',
  content: 'Content',
  note: 'Note',
};

export function InboxPage() {
  const s = useSession();
  const { openCapture, toggleSecretary } = useApp();
  const search = useSearch({ strict: false }) as { focus?: string };
  const items = useLive(
    (ss) =>
      ss.db.captures
        .where('status')
        .equals('inbox')
        .toArray()
        .then((xs) => xs.filter((x) => !x.deletedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
    [],
    [],
  );
  const [sel, setSel] = useState(0);
  const [projectFor, setProjectFor] = useState<Record<string, string | null>>({});
  useEffect(() => {
    if (search.focus) {
      const i = items.findIndex((x) => x.id === search.focus);
      if (i >= 0) setSel(i);
    }
  }, [search.focus, items]);
  const cur = items[Math.min(sel, items.length - 1)];

  const doTriage = async (c: Capture, t: TriageTarget) => {
    await triage(s, c, t, { projectId: projectFor[c.id] ?? c.projectId ?? null });
    toast(`Moved to ${TARGET_LABEL[t]}`, { action: { label: 'Undo', run: () => void undoLast(s) } });
  };
  const doArchive = async (c: Capture) => {
    await trash(s, 'captures', c.id, 'Discard capture');
    toast('Capture discarded (in Trash 30 days)', { action: { label: 'Undo', run: () => void undoLast(s) } });
  };

  const shortcuts = useMemo(
    () =>
      cur
        ? [
            { combo: 'j', run: () => setSel((i) => Math.min(i + 1, items.length - 1)) },
            { combo: 'k', run: () => setSel((i) => Math.max(i - 1, 0)) },
            { combo: 'enter', run: () => void doTriage(cur, suggestionTarget(cur)) },
            { combo: 'e', run: () => void doArchive(cur) },
            ...TARGETS.map((x) => ({ combo: x.key, run: () => void doTriage(cur, x.t) })),
          ]
        : [],
    [cur, items.length],
  );
  useShortcuts(shortcuts);

  return (
    <div className="page">
      <PageHeader
        title="Inbox"
        sub={
          items.length
            ? `${items.length} to sort · J/K move · ↵ accept suggestion · I/T/R/F/C/N convert · E discard`
            : 'Everything you capture lands here first.'
        }
        actions={
          <>
            <Button onClick={() => openCapture()}>Capture</Button>
            <Button variant="ghost" onClick={() => toggleSecretary({ intent: 'ask' })}>
              <Sparkles size={15} /> Ask
            </Button>
          </>
        }
      />
      {items.length === 0 ? (
        <Empty
          title="Inbox zero"
          action={
            <Button variant="primary" onClick={() => openCapture()}>
              Capture something
            </Button>
          }
        >
          Capture ideas, links, photos and voice notes in seconds — sort them later.
        </Empty>
      ) : (
        <div className="list" role="list" aria-label="Captures">
          {items.map((c, i) => {
            const target = suggestionTarget(c);
            return (
              <div
                key={c.id}
                role="listitem"
                className="row static"
                style={{
                  alignItems: 'flex-start',
                  background: i === sel ? 'var(--hover)' : undefined,
                  flexWrap: 'wrap',
                }}
                onFocusCapture={() => setSel(i)}
              >
                {c.mediaIds[0] && <MediaThumb mediaId={c.mediaIds[0]} alt="Captured media" />}
                <div className="grow" style={{ minWidth: 200 }}>
                  <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {truncate(c.text ?? (c.mediaIds.length ? `${c.mode} capture` : ''), 500)}
                  </div>
                  <div className="sub hstack" style={{ gap: 6, marginTop: 4 }}>
                    <span>{relDays(c.createdAt)}</span>
                    <span>· {c.mode}</span>
                    {c.url && <ExtLink href={c.url} />}
                    {c.suggestion && (
                      <Pill tone="ai">
                        looks like {TARGET_LABEL[target].toLowerCase()}
                        {c.suggestion.reason ? ` (${c.suggestion.reason})` : ''}
                      </Pill>
                    )}
                  </div>
                  <div className="hstack" style={{ marginTop: 8, gap: 6 }}>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => void doTriage(c, target)}
                      aria-label={`Accept: make ${TARGET_LABEL[target]}`}
                    >
                      → {TARGET_LABEL[target]}
                    </Button>
                    {TARGETS.filter((x) => x.t !== target).map((x) => (
                      <Button key={x.t} size="sm" variant="ghost" onClick={() => void doTriage(c, x.t)}>
                        {x.t === 'idea' ? (
                          <Lightbulb size={13} />
                        ) : x.t === 'task' ? (
                          <ListChecks size={13} />
                        ) : x.t === 'content' ? (
                          <Clapperboard size={13} />
                        ) : (
                          <BookOpen size={13} />
                        )}
                        {x.label}
                      </Button>
                    ))}
                    <div style={{ width: 170 }}>
                      <ProjectSelect
                        value={projectFor[c.id] ?? c.projectId ?? null}
                        onChange={(v) => setProjectFor((p) => ({ ...p, [c.id]: v }))}
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void doArchive(c)}
                      aria-label="Discard capture"
                    >
                      <Archive size={13} /> Discard
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
