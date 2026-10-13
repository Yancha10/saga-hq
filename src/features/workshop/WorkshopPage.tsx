import { Link, useSearch } from '@tanstack/react-router';
import { Bot, Check, ClipboardCopy, ExternalLink, Save, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { complete, ProviderError } from '../../ai/providers';
import { providerConfig } from '../../ai/secretary';
import {
  buildBrief,
  DEFAULT_TARGET,
  PIECELESS,
  PROVIDER_URLS,
  suggestChapters,
  WORKSHOP_TASKS,
  type WorkshopTask,
  weekPubCount,
} from '../../ai/workshop';
import { useLive, useSession } from '../../app/context';
import { toast } from '../../app/status';
import { nowIso } from '../../core/util';
import { addVariant } from '../../data/saga';
import { type Content, VARIANT_FIELDS, type VariantField, type WorkSession } from '../../data/schema';
import { create, update } from '../../data/store';
import { logger } from '../../diagnostics/logger';
import { fmt, t, useT } from '../../i18n';
import { errorText } from '../../i18n/render';
import { Button, Chip, Empty, Pill, Section } from '../../ui/kit';
import { PageHeader } from '../../ui/PageHeader';
import { useChapters } from '../bible/BiblePage';
import { contentTitle } from '../common';

const SOURCES = ['chatgpt', 'claude', 'other', 'unknown'] as const;

/** AI Workshop: prepare a contextual brief, use it in ChatGPT/Claude (or your own API), keep the answer as a proposal. */
export function WorkshopPage() {
  useT();
  const s = useSession();
  const search = useSearch({ strict: false }) as { content?: string; task?: string };
  const chapters = useChapters();
  const pieces = useLive(
    (ss) =>
      ss.db.content
        .toArray()
        .then((cs) =>
          cs
            .filter((c) => !c.deletedAt && !c.archivedAt)
            .sort((a, b) => (a._nextPublishAt ?? '9999').localeCompare(b._nextPublishAt ?? '9999')),
        ),
    [],
    [] as Content[],
  );
  const [pieceId, setPieceId] = useState<string>(search.content ?? '');
  const [task, setTask] = useState<WorkshopTask>(
    (WORKSHOP_TASKS as readonly string[]).includes(search.task ?? '')
      ? (search.task as WorkshopTask)
      : 'write_script',
  );
  const [chapterIds, setChapterIds] = useState<string[] | null>(null);
  const [incDecisions, setIncDecisions] = useState(true);
  const [incTasks, setIncTasks] = useState(true);
  const [incCapacity, setIncCapacity] = useState(true);
  const [extra, setExtra] = useState('');
  const [edited, setEdited] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [source, setSource] = useState<(typeof SOURCES)[number]>('chatgpt');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const briefRef = useRef<HTMLTextAreaElement>(null);
  const piece = pieces.find((p) => p.id === pieceId) ?? null;
  const suggested = useMemo(() => suggestChapters(chapters, piece), [chapters, piece]);
  const chosen = chapterIds ?? suggested;
  const ctx = useLive(
    async (ss) => {
      const [ws, decisions, tasks, weekPubs, api] = await Promise.all([
        ss.db.workspace.get('workspace'),
        ss.db.tasks.filter((x) => !x.deletedAt && x.kind === 'decision' && x.status !== 'done').toArray(),
        pieceId
          ? ss.db.tasks
              .where('contentId')
              .equals(pieceId)
              .filter((x) => !x.deletedAt && x.status !== 'done')
              .toArray()
          : ss.db.tasks
              .filter((x) => !x.deletedAt && x.status !== 'done' && x.kind === 'task')
              .limit(15)
              .toArray(),
        weekPubCount(ss),
        providerConfig(ss).then((c): string | null => (c ? c.provider : null)),
      ]);
      return { ws, decisions, tasks, weekPubs, api };
    },
    [pieceId],
    { ws: undefined, decisions: [], tasks: [], weekPubs: 0, api: null as string | null },
  );
  const sessions = useLive(
    (ss) =>
      ss.db.sessions
        .orderBy('at')
        .reverse()
        .toArray()
        .then((xs) => xs.filter((x) => !x.deletedAt)),
    [],
    [] as WorkSession[],
  );
  const generated = buildBrief({
    task,
    piece,
    chapters: chapters.filter((c) => chosen.includes(c.id)),
    ...(incDecisions ? { decisions: ctx.decisions } : {}),
    ...(incTasks ? { tasks: ctx.tasks } : {}),
    ...(incCapacity && ctx.ws ? { ws: ctx.ws, weekPubs: ctx.weekPubs } : {}),
    extra,
  });
  const brief = edited ?? generated;
  // a new selection regenerates the brief (manual edits apply to the current selection only)
  useEffect(() => setEdited(null), [task, pieceId]);
  const needsPiece = !piece && !PIECELESS.includes(task);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(brief);
      setCopied(true);
      toast(t('workshop.copied'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: select the text so the user can copy it by hand.
      briefRef.current?.focus();
      briefRef.current?.select();
      toast(t('workshop.copy_fallback'));
    }
  };
  const save = async (response: string, mode: 'manual' | 'api', provider: string) => {
    await create(s, 'sessions', {
      task,
      provider,
      mode,
      declaredSource: mode === 'manual' ? t(`workshop.source.${source}`) : provider,
      contentId: piece?.id ?? null,
      projectId: piece?.projectId ?? null,
      contextSummary: [
        piece ? contentTitle(piece) : '',
        ...chapters.filter((c) => chosen.includes(c.id)).map((c) => c.title),
        incDecisions ? t('workshop.ctx.decisions') : '',
        incTasks ? t('workshop.ctx.tasks') : '',
        incCapacity ? t('workshop.ctx.capacity') : '',
      ]
        .filter(Boolean)
        .join(' · ')
        .slice(0, 20000),
      prompt: brief.slice(0, 200000),
      response: response.slice(0, 200000),
      status: 'draft',
      at: nowIso(),
    });
    setAnswer('');
    toast(t('workshop.saved'));
  };

  return (
    <div className="page workshop">
      <PageHeader title={t('nav.workshop')} sub={t('workshop.sub')} />
      <div className="workshop-layout">
        <div className="stack">
          <Section title={t('workshop.step1')}>
            <div className="field">
              <label className="lbl" htmlFor="wpiece">
                {t('workshop.piece')}
              </label>
              <select
                id="wpiece"
                className="select"
                value={pieceId}
                onChange={(e) => {
                  setPieceId(e.target.value);
                  setChapterIds(null);
                }}
              >
                <option value="">{t('workshop.no_piece')}</option>
                {pieces.map((p) => (
                  <option key={p.id} value={p.id}>
                    {contentTitle(p)}
                    {p._nextPublishAt
                      ? ` · ${fmt.date(p._nextPublishAt, { day: 'numeric', month: 'short' })}`
                      : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <span className="lbl" id="wtask">
                {t('workshop.task_label')}
              </span>
              <div className="task-grid" role="group" aria-labelledby="wtask">
                {WORKSHOP_TASKS.map((k) => (
                  <Chip key={k} on={task === k} onClick={() => setTask(k)}>
                    {t(`workshop.task.${k}`)}
                  </Chip>
                ))}
              </div>
            </div>
          </Section>
          <Section title={t('workshop.step2')} fold="closed">
            {chapters.length > 0 && (
              <div className="field">
                <span className="lbl">{t('workshop.chapters')}</span>
                <div className="chips">
                  {chapters.map((c) => (
                    <Chip
                      key={c.id}
                      on={chosen.includes(c.id)}
                      onClick={() =>
                        setChapterIds(
                          chosen.includes(c.id) ? chosen.filter((x) => x !== c.id) : [...chosen, c.id],
                        )
                      }
                    >
                      {c.number ? `${c.number} · ` : ''}
                      {c.title}
                      {suggested.includes(c.id) ? ' ✦' : ''}
                    </Chip>
                  ))}
                </div>
                {suggested.length > 0 && <p className="meta">{t('workshop.suggested_hint')}</p>}
              </div>
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={incDecisions}
                onChange={(e) => setIncDecisions(e.target.checked)}
              />{' '}
              {t('workshop.ctx.decisions')} ({fmt.num(ctx.decisions.length)})
            </label>
            <label className="check">
              <input type="checkbox" checked={incTasks} onChange={(e) => setIncTasks(e.target.checked)} />{' '}
              {t('workshop.ctx.tasks')} ({fmt.num(ctx.tasks.length)})
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={incCapacity}
                onChange={(e) => setIncCapacity(e.target.checked)}
              />{' '}
              {t('workshop.ctx.capacity')}
            </label>
            <div className="field">
              <label className="lbl" htmlFor="wextra">
                {t('workshop.extra')}
              </label>
              <input
                id="wextra"
                className="input"
                value={extra}
                placeholder={t('workshop.extra_ph')}
                onChange={(e) => setExtra(e.target.value)}
              />
            </div>
          </Section>
        </div>
        <div className="stack">
          <Section title={t('workshop.step3')}>
            {needsPiece && <div className="banner info">{t('workshop.pick_piece')}</div>}
            <p className="meta">{t('workshop.what_copied')}</p>
            <textarea
              ref={briefRef}
              className="input brief"
              aria-label={t('workshop.brief_label')}
              value={brief}
              onChange={(e) => setEdited(e.target.value)}
              rows={12}
            />
            <div className="meta num">{t('workshop.chars', { count: brief.length })}</div>
            <div className="hstack wrap">
              <Button variant="primary" onClick={() => void copy()} disabled={needsPiece}>
                {copied ? <Check size={16} aria-hidden /> : <ClipboardCopy size={16} aria-hidden />}{' '}
                {copied ? t('workshop.copied_short') : t('workshop.copy')}
              </Button>
              <a
                className="btn"
                href={PROVIDER_URLS.chatgpt}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setSource('chatgpt')}
              >
                {t('workshop.open_chatgpt')} <ExternalLink size={14} aria-hidden />
              </a>
              <a
                className="btn"
                href={PROVIDER_URLS.claude}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setSource('claude')}
              >
                {t('workshop.open_claude')} <ExternalLink size={14} aria-hidden />
              </a>
              {ctx.api ? (
                <Button
                  disabled={busy || needsPiece}
                  onClick={async () => {
                    const cfg = await providerConfig(s);
                    if (!cfg) return;
                    setBusy(true);
                    try {
                      const res = await complete(cfg, {
                        system: t('workshop.api_system'),
                        user: brief,
                        maxTokens: 4000,
                      });
                      s.assertLive();
                      await save(res.text, 'api', `${cfg.provider} · ${res.model}`);
                    } catch (e) {
                      logger.warn('workshop', 'api call failed', e);
                      toast(e instanceof ProviderError ? t(`ai.error.${e.kind}`) : errorText(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Wand2 size={16} aria-hidden />{' '}
                  {busy ? t('workshop.generating') : t('workshop.generate_api')}
                </Button>
              ) : (
                <span className="meta api-off">
                  <Bot size={14} aria-hidden /> {t('workshop.api_off')}{' '}
                  <Link to="/settings" search={{ section: 'ai' }}>
                    {t('workshop.api_setup')}
                  </Link>
                </span>
              )}
            </div>
          </Section>
          <Section title={t('workshop.step4')}>
            <textarea
              className="input"
              aria-label={t('workshop.answer_label')}
              placeholder={t('workshop.answer_ph')}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={7}
            />
            <div className="hstack wrap">
              <label className="lbl" htmlFor="wsrc">
                {t('workshop.declared_source')}
              </label>
              <select
                id="wsrc"
                className="select"
                style={{ maxWidth: 200 }}
                value={source}
                onChange={(e) => setSource(e.target.value as (typeof SOURCES)[number])}
              >
                {SOURCES.map((x) => (
                  <option key={x} value={x}>
                    {t(`workshop.source.${x}`)}
                  </option>
                ))}
              </select>
              <Button
                variant="primary"
                disabled={!answer.trim()}
                onClick={() => void save(answer.trim(), 'manual', source)}
              >
                <Save size={16} aria-hidden /> {t('workshop.save_answer')}
              </Button>
            </div>
            <p className="meta explain">{t('workshop.source_note')}</p>
          </Section>
        </div>
      </div>
      <Section title={t('workshop.sessions')} count={sessions.length}>
        {sessions.length === 0 ? (
          <Empty compact title={t('workshop.no_sessions')} />
        ) : (
          <div className="session-list">
            {sessions.slice(0, 40).map((x) => (
              <SessionCard key={x.id} x={x} pieces={pieces} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function SessionCard({ x, pieces }: { x: WorkSession; pieces: Content[] }) {
  useT();
  const s = useSession();
  const piece = pieces.find((p) => p.id === x.contentId);
  const defaultField: VariantField = DEFAULT_TARGET[x.task as WorkshopTask] ?? 'script';
  const [target, setTarget] = useState<VariantField>(defaultField);
  return (
    <details className={`session-card s-${x.status}`}>
      <summary>
        <Sparkles size={15} aria-hidden />
        <span className="grow">
          <span className="title">
            {(WORKSHOP_TASKS as readonly string[]).includes(x.task) ? t(`workshop.task.${x.task}`) : x.task}
            {piece ? ` · ${contentTitle(piece)}` : ''}
          </span>
          <span className="sub">
            {fmt.dateTime(x.at)} ·{' '}
            {x.mode === 'api' ? x.provider : t('workshop.declared', { source: x.declaredSource ?? '—' })}
          </span>
        </span>
        <Pill tone={x.status === 'applied' ? 'ok' : x.status === 'discarded' ? undefined : 'ai'}>
          {t(`workshop.status.${x.status}`)}
        </Pill>
      </summary>
      <div className="session-body">
        <pre className="answer">{x.response}</pre>
        {x.contextSummary && (
          <div className="meta">{t('workshop.context_used', { ctx: x.contextSummary })}</div>
        )}
        {x.appliedTo && <div className="meta">{t('workshop.applied_to', { field: x.appliedTo })}</div>}
        {piece && x.status !== 'discarded' && (
          <div className="hstack wrap">
            <label className="lbl" htmlFor={`tg-${x.id}`}>
              {t('workshop.apply_as')}
            </label>
            <select
              id={`tg-${x.id}`}
              className="select"
              style={{ maxWidth: 180 }}
              value={target}
              onChange={(e) => setTarget(e.target.value as VariantField)}
            >
              {VARIANT_FIELDS.map((f) => (
                <option key={f} value={f}>
                  {t(`variant.field.${f}`)}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="primary"
              onClick={async () => {
                await addVariant(s, piece, {
                  field: target,
                  text: x.response ?? '',
                  by: 'ai',
                  label: t(`workshop.task.${x.task}`),
                });
                await update(s, 'sessions', x.id, { status: 'applied', appliedTo: target });
                toast(t('workshop.applied_toast'));
              }}
            >
              {t('workshop.apply')}
            </Button>
            <Link
              to="/content/$id"
              params={{ id: piece.id }}
              search={{ tab: 'saga' }}
              className="btn sm ghost"
            >
              {t('workshop.open_piece')}
            </Link>
          </div>
        )}
        <div className="hstack">
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void navigator.clipboard?.writeText(x.response ?? '').then(() => toast(t('workshop.copied')))
            }
          >
            <ClipboardCopy size={14} aria-hidden /> {t('workshop.copy_answer')}
          </Button>
          {x.status === 'draft' && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void update(s, 'sessions', x.id, { status: 'discarded' })}
            >
              <Trash2 size={14} aria-hidden /> {t('workshop.discard')}
            </Button>
          )}
        </div>
      </div>
    </details>
  );
}
