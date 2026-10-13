import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { BookMarked, Eye, FileClock, PenLine, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useIsPhone, useLive, useSession } from '../../app/context';
import { toast } from '../../app/status';
import { affectedPieces, changedTerms } from '../../data/saga';
import { CHAPTER_STATUSES, type Chapter, type Content } from '../../data/schema';
import { create, mutate, update } from '../../data/store';
import { t, useT } from '../../i18n';
import { Button, Empty, Pill, Section } from '../../ui/kit';
import { Markdown, outline } from '../../ui/Markdown';
import { PageHeader } from '../../ui/PageHeader';
import { ArchivedNotice, archiveTrashItems, contentTitle, HistoryList, RecordMenu } from '../common';

const statusTone = (st: Chapter['status']) =>
  st === 'current' ? 'ok' : st === 'proposed' ? 'accent' : st === 'to_check' ? 'warn' : undefined;

export function useChapters(): Chapter[] {
  return useLive(
    (s) =>
      s.db.chapters.toArray().then((cs) => cs.filter((c) => !c.deletedAt).sort((a, b) => a.order - b.order)),
    [],
    [],
  );
}

const chapterLabel = (c: Chapter) =>
  c.number ? `${c.number} · ${c.title}` : c.title || t('common.untitled');

/** Bible: the account's canon — identity, rules, strategy — readable, searchable and versioned. */
export function BiblePage() {
  useT();
  const s = useSession();
  const navigate = useNavigate();
  const chapters = useChapters();
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  const shown = ql
    ? chapters.filter((c) => `${c.title}\n${c.body ?? ''}`.toLowerCase().includes(ql))
    : chapters;
  return (
    <div className="page narrow">
      <PageHeader
        title={t('nav.bible')}
        sub={t('bible.sub')}
        actions={
          <Button
            onClick={async () => {
              const c = await create(s, 'chapters', {
                title: '',
                order: (chapters[chapters.length - 1]?.order ?? -1) + 1,
                status: 'proposed',
                body: '',
              });
              void navigate({ to: '/bible/$id', params: { id: c.id }, search: { edit: '1' } });
            }}
          >
            <Plus size={16} aria-hidden /> {t('bible.new')}
          </Button>
        }
      />
      {chapters.length === 0 ? (
        <Empty
          title={t('bible.empty_title')}
          action={
            <Link className="btn primary" to="/settings" search={{ section: 'import' }}>
              {t('import.title')}
            </Link>
          }
        >
          {t('bible.empty_body')}
        </Empty>
      ) : (
        <>
          <div className="search-field">
            <Search size={16} aria-hidden />
            <input
              className="input"
              type="search"
              value={q}
              placeholder={t('bible.search')}
              aria-label={t('bible.search')}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <ol className="chapter-list">
            {shown.map((c) => {
              const hit = ql ? snippet(c.body ?? '', ql) : null;
              return (
                <li key={c.id}>
                  <Link to="/bible/$id" params={{ id: c.id }} className="chapter-card">
                    <span className="chapter-num">{c.number ?? '§'}</span>
                    <span className="grow">
                      <span className="chapter-title">{c.title || t('common.untitled')}</span>
                      <span className="sub">
                        {hit ?? t('bible.sections', { count: outline(c.body ?? '').length })}
                      </span>
                    </span>
                    {c.status !== 'current' && (
                      <Pill tone={statusTone(c.status)}>{t(`chapter.status.${c.status}`)}</Pill>
                    )}
                  </Link>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}

function snippet(body: string, q: string): string {
  const i = body.toLowerCase().indexOf(q);
  if (i < 0) return '';
  return `…${body.slice(Math.max(0, i - 40), i + 80).replace(/\s+/g, ' ')}…`;
}

export function ChapterPage() {
  useT();
  const { id } = useParams({ strict: false }) as { id: string };
  const s = useSession();
  const navigate = useNavigate();
  const phone = useIsPhone();
  const chapters = useChapters();
  const c = useLive((ss) => ss.db.chapters.get(id), [id], undefined);
  const pieces = useLive((ss) => ss.db.content.toArray(), [], [] as Content[]);
  const search = useSearch({ strict: false }) as { edit?: string };
  const [editing, setEditing] = useState(search.edit === '1');
  const [draft, setDraft] = useState<string | null>(null);
  const [view, setView] = useState<'current' | 'original'>('current');
  const [impact, setImpact] = useState<{
    words: string[];
    list: { piece: Content; hits: string[] }[];
  } | null>(null);
  const toc = useMemo(() => outline(c?.body ?? ''), [c?.body]);
  if (c === undefined) return <div className="page" aria-busy="true" />;
  if (!c)
    return (
      <div className="page">
        <Empty title={t('bible.not_found')} />
      </div>
    );
  const idx = chapters.findIndex((x) => x.id === c.id);
  const changedFromOriginal = !!c.originalBody && c.originalBody !== c.body;
  const save = async () => {
    if (draft === null) return setEditing(false);
    const before = c.body ?? '';
    await update(s, 'chapters', c.id, { body: draft }, { label: 'h.chapterEdit' });
    const words = changedTerms(before, draft);
    const list = affectedPieces(pieces, words);
    setImpact(list.length ? { words, list } : null);
    setEditing(false);
    setDraft(null);
    toast(t('bible.saved'));
  };
  return (
    <div className="page narrow chapter-page">
      <PageHeader
        back
        title={chapterLabel(c)}
        actions={
          <RecordMenu
            label={t('common.actions')}
            items={[
              ...(changedFromOriginal
                ? [
                    {
                      id: 'restore-original',
                      label: t('bible.restore_original'),
                      run: () =>
                        void update(
                          s,
                          'chapters',
                          c.id,
                          { body: c.originalBody },
                          { label: 'h.chapterRestore' },
                        ).then(() => toast(t('bible.restored'))),
                    },
                  ]
                : []),
              ...archiveTrashItems(s, 'chapters', c, () => void navigate({ to: '/bible' })),
            ]}
          />
        }
      />
      <ArchivedNotice rec={c} table="chapters" />
      <div className="chapter-toolbar">
        <label className="sr-only" htmlFor="chst">
          {t('bible.status')}
        </label>
        <select
          id="chst"
          className="select"
          value={c.status}
          onChange={(e) => void update(s, 'chapters', c.id, { status: e.target.value as Chapter['status'] })}
        >
          {CHAPTER_STATUSES.map((st) => (
            <option key={st} value={st}>
              {t(`chapter.status.${st}`)}
            </option>
          ))}
        </select>
        {changedFromOriginal && (
          <div className="seg" role="group" aria-label={t('bible.version')}>
            <button type="button" aria-pressed={view === 'current'} onClick={() => setView('current')}>
              <PenLine size={14} aria-hidden /> {t('bible.current')}
            </button>
            <button type="button" aria-pressed={view === 'original'} onClick={() => setView('original')}>
              <FileClock size={14} aria-hidden /> {t('bible.original')}
            </button>
          </div>
        )}
        <span className="spacer" />
        {editing ? (
          <>
            <Button variant="ghost" onClick={() => (setEditing(false), setDraft(null))}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={() => void save()}>
              {t('common.save')}
            </Button>
          </>
        ) : (
          <Button onClick={() => (setEditing(true), setView('current'))}>
            <PenLine size={15} aria-hidden /> {t('common.edit')}
          </Button>
        )}
      </div>
      {editing && (
        <div className="stack">
          <input
            className="input title-input"
            defaultValue={c.title}
            aria-label={t('bible.title_label')}
            placeholder={t('bible.title_label')}
            onBlur={(e) =>
              e.target.value !== c.title && void update(s, 'chapters', c.id, { title: e.target.value })
            }
          />
          <input
            className="input"
            defaultValue={c.context ?? ''}
            aria-label={t('bible.context')}
            placeholder={t('bible.context_ph')}
            onBlur={(e) => void update(s, 'chapters', c.id, { context: e.target.value || null })}
          />
          <textarea
            className="input md-editor"
            aria-label={t('bible.body')}
            value={draft ?? c.body ?? ''}
            onChange={(e) => setDraft(e.target.value)}
            rows={phone ? 16 : 28}
          />
          <p className="meta explain">{t('bible.md_hint')}</p>
        </div>
      )}
      {impact && (
        <Section title={t('bible.impact_title', { count: impact.list.length })}>
          <p className="meta">{t('bible.impact_body', { words: impact.words.slice(0, 6).join(', ') })}</p>
          <div className="list">
            {impact.list.map(({ piece, hits }) => (
              <div key={piece.id} className="row static">
                <Link to="/content/$id" params={{ id: piece.id }} className="grow">
                  <div className="title">{contentTitle(piece)}</div>
                  <div className="sub">{hits.slice(0, 4).join(' · ')}</div>
                </Link>
                <Button
                  size="sm"
                  onClick={() =>
                    void mutate(s, { label: 'h.create', labelParams: { entity: 'tasks' } }, (m) =>
                      m.create('tasks', {
                        title: t('bible.review_task', {
                          chapter: chapterLabel(c),
                          piece: contentTitle(piece),
                        }).slice(0, 500),
                        status: 'todo',
                        kind: 'task',
                        isBlocker: false,
                        contentId: piece.id,
                        projectId: piece.projectId ?? null,
                        category: 'bible',
                      }),
                    ).then(() => toast(t('bible.task_created')))
                  }
                >
                  {t('bible.make_task')}
                </Button>
              </div>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={() => setImpact(null)}>
            {t('common.dismiss')}
          </Button>
        </Section>
      )}
      {!editing && (
        <div className="chapter-layout">
          {toc.length > 2 && !phone && (
            <nav className="chapter-toc" aria-label={t('bible.toc')}>
              {toc.map((h, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static text, position is the identity
                <div key={i} className={`toc-l${h.level}`}>
                  {h.text}
                </div>
              ))}
            </nav>
          )}
          <article className="chapter-body">
            {view === 'original' && (
              <div className="banner info" style={{ borderRadius: 10 }}>
                <Eye size={15} aria-hidden /> {t('bible.original_note')}
              </div>
            )}
            {c.context && <p className="chapter-context">{c.context}</p>}
            {(view === 'original' ? c.originalBody : c.body)?.trim() ? (
              <Markdown text={(view === 'original' ? c.originalBody : c.body) ?? ''} />
            ) : (
              <Empty compact title={t('bible.blank')} />
            )}
          </article>
        </div>
      )}
      <nav className="chapter-pager" aria-label={t('bible.pager')}>
        {idx > 0 ? (
          <Link to="/bible/$id" params={{ id: chapters[idx - 1]!.id }} className="btn ghost">
            ← {chapterLabel(chapters[idx - 1]!)}
          </Link>
        ) : (
          <span />
        )}
        {idx >= 0 && idx < chapters.length - 1 && (
          <Link to="/bible/$id" params={{ id: chapters[idx + 1]!.id }} className="btn ghost">
            {chapterLabel(chapters[idx + 1]!)} →
          </Link>
        )}
      </nav>
      <details>
        <summary className="meta">
          <BookMarked size={13} aria-hidden /> {t('common.history')}
        </summary>
        <HistoryList recordId={c.id} />
      </details>
    </div>
  );
}
