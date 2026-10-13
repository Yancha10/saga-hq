import { Link } from '@tanstack/react-router';
import { Plus, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useApp, useLive, useSession } from '../../app/context';
import { toast } from '../../app/status';
import { median } from '../../core/util';
import { exportCsv } from '../../data/backup';
import { logSnapshot } from '../../data/domain';
import type { Content, Learning, Publication, Snapshot, Workspace } from '../../data/schema';
import { fmt, t, useT } from '../../i18n';
import { platformName } from '../../i18n/render';
import {
  CHECKPOINTS,
  type CheckpointKey,
  COMMON_METRICS,
  findOutliers,
  MIN_BASELINE,
  patternBy,
} from '../../rules/analytics';
import { DAY, startOfWeek } from '../../rules/time';
import { Button, Empty, Pill, Section, Sheet, Tabs } from '../../ui/kit';
import { PageHeader } from '../../ui/PageHeader';
import { contentTitle, downloadText, templateName } from '../common';
import { LearningEditor } from './LearningEditor';
import { MetricsForm } from './MetricsForm';

type Tab = 'results' | 'patterns' | 'learnings' | 'week';

export function InsightsPage() {
  useT();
  const s = useSession();
  const { toggleSecretary } = useApp();
  const [tab, setTab] = useState<Tab>('results');
  const d = useLive(
    async (ss) => {
      const [pubs, snaps, learnings, ws] = await Promise.all([
        ss.db.publications.where('status').equals('published').toArray(),
        ss.db.snapshots.toArray(),
        ss.db.learnings.toArray(),
        ss.db.workspace.get('workspace'),
      ]);
      const live = pubs.filter((p) => !p.deletedAt);
      const contents = (await ss.db.content.bulkGet([...new Set(live.map((p) => p.contentId))])).filter(
        (c): c is Content => !!c && !c.deletedAt,
      );
      return {
        pubs: live.filter((p) => contents.some((c) => c.id === p.contentId)),
        snaps: snaps.filter((x) => !x.deletedAt),
        learnings: learnings.filter((l) => !l.deletedAt),
        contents,
        ws,
      };
    },
    [],
    {
      pubs: [] as Publication[],
      snaps: [] as Snapshot[],
      learnings: [] as Learning[],
      contents: [] as Content[],
      ws: undefined as Workspace | undefined,
    },
  );
  const cmap = useMemo(() => new Map(d.contents.map((c) => [c.id, c])), [d.contents]);
  return (
    <div className="page">
      <PageHeader
        title={t('nav.insights')}
        sub={t('insights.sub')}
        actions={
          <>
            <Button variant="ghost" onClick={() => toggleSecretary({ intent: 'analyst' })}>
              <Sparkles size={15} /> {t('secretary.intent.analyst')}
            </Button>
            <Button
              variant="ghost"
              onClick={async () =>
                downloadText(
                  `saga-hq-analytics-${new Date().toISOString().slice(0, 10)}.csv`,
                  await exportCsv(s, 'analytics'),
                  'text/csv',
                )
              }
            >
              {t('insights.export_csv')}
            </Button>
          </>
        }
      />
      <div style={{ marginBottom: 16 }}>
        <Tabs
          label={t('nav.insights')}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'results', label: t('projects.tab.results') },
            { value: 'patterns', label: t('insights.patterns') },
            {
              value: 'learnings',
              label: `${t('insights.learnings')} ${d.learnings.filter((l) => l.status === 'active').length || ''}`,
            },
            { value: 'week', label: t('calendar.week') },
          ]}
        />
      </div>
      {tab === 'results' && <Results pubs={d.pubs} snaps={d.snaps} cmap={cmap} />}
      {tab === 'patterns' && <Patterns pubs={d.pubs} snaps={d.snaps} cmap={cmap} ws={d.ws} />}
      {tab === 'learnings' && <Learnings learnings={d.learnings} pubs={d.pubs} snaps={d.snaps} cmap={cmap} />}
      {tab === 'week' && <Week pubs={d.pubs} learnings={d.learnings} ws={d.ws} cmap={cmap} />}
    </div>
  );
}

function Results({
  pubs,
  snaps,
  cmap,
}: {
  pubs: Publication[];
  snaps: Snapshot[];
  cmap: Map<string, Content>;
}) {
  useT();
  const s = useSession();
  const [cp, setCp] = useState<CheckpointKey>('24h');
  const [logFor, setLogFor] = useState<Publication | null>(null);
  const rows = [...pubs]
    .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    .slice(0, 200);
  const val = (p: Publication, k: CheckpointKey, m = 'views') =>
    snaps.find((x) => x.publicationId === p.id && x.checkpoint === k)?.metrics[m];
  const baseline = (p: Publication) => {
    const vals = pubs
      .filter(
        (x) =>
          x.id !== p.id &&
          x.platform === p.platform &&
          cmap.get(x.contentId)?.formatTemplateId === cmap.get(p.contentId)?.formatTemplateId,
      )
      .map((x) => val(x, cp))
      .filter((v): v is number => v !== undefined);
    return vals.length >= MIN_BASELINE ? median(vals) : undefined;
  };
  if (!pubs.length)
    return <Empty title={t('projects.no_published')}>{t('insights.no_published_body')}</Empty>;
  return (
    <>
      <div className="hstack" style={{ marginBottom: 8 }}>
        <span className="meta">{t('insights.compare_at')}</span>
        <Tabs
          label={t('insights.checkpoint')}
          value={cp}
          onChange={setCp}
          options={CHECKPOINTS.map((c) => ({ value: c.key, label: c.key }))}
        />
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t('nav.content')}</th>
              <th>{t('common.platform')}</th>
              <th>{t('content.status.published')}</th>
              <th>{t('insights.views_cp', { cp })}</th>
              <th>{t('insights.vs_median')}</th>
              <th>{t('metric.likes')}</th>
              <th>{t('metric.shares')}</th>
              <th>{t('metric.saves')}</th>
              <th>
                <span className="sr-only">{t('common.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const v = val(p, cp);
              const m = baseline(p);
              return (
                <tr key={p.id}>
                  <td className="wrap">
                    <Link to="/content/$id" params={{ id: p.contentId }}>
                      {contentTitle(cmap.get(p.contentId) ?? {})}
                    </Link>
                  </td>
                  <td>{platformName(p.platform)}</td>
                  <td>{p.publishedAt ? fmt.date(p.publishedAt, { day: 'numeric', month: 'short' }) : ''}</td>
                  <td className="num">{v !== undefined ? fmt.num(v) : '—'}</td>
                  <td className="num">
                    {v !== undefined && m ? (
                      <Pill tone={v / m >= 2 ? 'ok' : v / m <= 0.5 ? 'warn' : undefined}>
                        {fmt.ratio(v / m)}
                      </Pill>
                    ) : (
                      <span className="meta">n&lt;5</span>
                    )}
                  </td>
                  {(['likes', 'shares', 'saves'] as const).map((k) => {
                    const x = val(p, cp, k);
                    return (
                      <td key={k} className="num">
                        {x !== undefined ? fmt.num(x) : '—'}
                      </td>
                    );
                  })}
                  <td>
                    <Button size="sm" variant="ghost" onClick={() => setLogFor(p)}>
                      {t('insights.log')}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="meta" style={{ marginTop: 8 }}>
        {t('insights.baseline_note', { n: MIN_BASELINE })}
      </p>
      <Sheet open={!!logFor} onClose={() => setLogFor(null)} title={t('h.logResults')}>
        {logFor && (
          <MetricsForm
            platform={logFor.platform}
            onSubmit={async (m) => {
              await logSnapshot(s, logFor, m);
              toast(t('today.results_saved'));
              setLogFor(null);
            }}
          />
        )}
      </Sheet>
    </>
  );
}

/** Grouping labels are computed at render time in the UI language; nothing here is persisted. */
const ATTRS: {
  key: string;
  fn: (c: Content, p: Publication, ws?: Workspace) => string | null | undefined;
}[] = [
  { key: 'hookType', fn: (c) => (c.attributes?.hookType ? t(`hook.${c.attributes.hookType}`) : null) },
  {
    key: 'format',
    fn: (c, _p, ws) => {
      const tpl = ws?.formatTemplates.find((x) => x.id === c.formatTemplateId);
      return tpl ? templateName(tpl) : c.formatTemplateId;
    },
  },
  { key: 'platform', fn: (_c, p) => platformName(p.platform) },
  {
    key: 'duration',
    fn: (c) =>
      c.attributes?.durationSec
        ? c.attributes.durationSec <= 15
          ? '≤15s'
          : c.attributes.durationSec <= 30
            ? '16–30s'
            : c.attributes.durationSec <= 60
              ? '31–60s'
              : '>60s'
        : null,
  },
  {
    key: 'hour',
    fn: (_c, p) =>
      p.publishedAt ? `${String(new Date(p.publishedAt).getHours()).padStart(2, '0')}:00` : null,
  },
  {
    key: 'weekday',
    fn: (_c, p) => (p.publishedAt ? fmt.date(p.publishedAt, { weekday: 'short' }) : null),
  },
  { key: 'tone', fn: (c) => c.attributes?.tone },
  {
    key: 'dialogue',
    fn: (c) =>
      c.attributes?.hasDialogue === undefined || c.attributes?.hasDialogue === null
        ? null
        : c.attributes.hasDialogue
          ? t('insights.with_dialogue')
          : t('insights.no_dialogue'),
  },
  { key: 'model', fn: (c) => c.attributes?.aiModels?.[0] },
];

function Patterns({
  pubs,
  snaps,
  cmap,
  ws,
}: {
  pubs: Publication[];
  snaps: Snapshot[];
  cmap: Map<string, Content>;
  ws?: Workspace;
}) {
  useT();
  const [attr, setAttr] = useState('hookType');
  const [metric, setMetric] = useState('views');
  const [cp, setCp] = useState<CheckpointKey>('24h');
  const [platform, setPlatform] = useState<string>('');
  const a = ATTRS.find((x) => x.key === attr)!;
  const scoped = platform ? pubs.filter((p) => p.platform === platform) : pubs;
  const rows = patternBy(scoped, snaps, cmap, (c, p) => a.fn(c, p, ws), metric, cp);
  const max = Math.max(1, ...rows.map((r) => r.median));
  return (
    <div className="stack">
      <div className="hstack">
        <select
          className="select"
          style={{ width: 160 }}
          value={attr}
          onChange={(e) => setAttr(e.target.value)}
          aria-label={t('insights.group_by')}
        >
          {ATTRS.map((x) => (
            <option key={x.key} value={x.key}>
              {t(`insights.by.${x.key}`)}
            </option>
          ))}
        </select>
        <select
          className="select"
          style={{ width: 170 }}
          value={metric}
          onChange={(e) => setMetric(e.target.value)}
          aria-label={t('insights.metric')}
        >
          {COMMON_METRICS.map((m) => (
            <option key={m.key} value={m.key}>
              {t(`metric.${m.key}`)}
            </option>
          ))}
        </select>
        <select
          className="select"
          style={{ width: 110 }}
          value={cp}
          onChange={(e) => setCp(e.target.value as CheckpointKey)}
          aria-label={t('insights.checkpoint')}
        >
          {CHECKPOINTS.map((c) => (
            <option key={c.key} value={c.key}>
              {c.key}
            </option>
          ))}
        </select>
        <select
          className="select"
          style={{ width: 'auto', maxWidth: '100%' }}
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          aria-label={t('common.platform')}
        >
          <option value="">{t('common.all_platforms')}</option>
          {[...new Set(pubs.map((p) => p.platform))].map((p) => (
            <option key={p} value={p}>
              {platformName(p)}
            </option>
          ))}
        </select>
      </div>
      {rows.length === 0 ? (
        <Empty compact>{t('insights.no_pattern_data')}</Empty>
      ) : (
        <div className="list">
          {rows.map((r) => (
            <div key={r.value} className="row static" style={{ opacity: r.n < MIN_BASELINE ? 0.55 : 1 }}>
              <span style={{ width: 140 }}>{r.value}</span>
              <div style={{ flex: 1 }}>
                <div className="progress" style={{ height: 8 }} aria-hidden>
                  <span style={{ width: `${(r.median / max) * 100}%` }} />
                </div>
              </div>
              <span className="num meta" style={{ width: 170, textAlign: 'right' }}>
                {t('insights.median_n', { median: Math.round(r.median), n: r.n })}
                {r.n < MIN_BASELINE ? ` · ${t('insights.too_few')}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="meta">{t('insights.patterns_note', { n: MIN_BASELINE })}</p>
    </div>
  );
}

function Learnings({
  learnings,
  pubs,
  snaps,
  cmap,
}: {
  learnings: Learning[];
  pubs: Publication[];
  snaps: Snapshot[];
  cmap: Map<string, Content>;
}) {
  useT();
  const [filter, setFilter] = useState<'active' | 'retired'>('active');
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<{
    statement: string;
    evidence: { type: 'content'; id: string; label: string }[];
  } | null>(null);
  const outliers = findOutliers(pubs, snaps, cmap).slice(0, 5);
  const list = learnings
    .filter((l) => l.status === filter && !l.archivedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <div className="grid2">
      <div>
        <div className="hstack filters" style={{ marginBottom: 12 }}>
          <Tabs
            label={t('insights.learning_status')}
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'active', label: t('learning.status.active') },
              { value: 'retired', label: t('learning.status.retired') },
            ]}
          />
          <span className="spacer" />
          <Button
            variant="primary"
            onClick={() => {
              setPreset(null);
              setOpen(true);
            }}
          >
            <Plus size={15} /> {t('insights.new_learning')}
          </Button>
        </div>
        {list.length === 0 ? (
          <Empty compact>{t('insights.no_learnings')}</Empty>
        ) : (
          <div className="list">
            {list.map((l) => (
              <Link key={l.id} to="/learnings/$id" params={{ id: l.id }} className="row">
                <div className="grow">
                  <div className="title" style={{ whiteSpace: 'normal' }}>
                    {l.statement}
                  </div>
                  <div className="sub">
                    {t(`learning.confidence.${l.confidence}`)}
                    {l.scope?.platforms?.length ? ` · ${l.scope.platforms.map(platformName).join(', ')}` : ''}
                    {l.lastValidatedAt
                      ? ` · ${t('insights.validated', { date: fmt.date(l.lastValidatedAt) })}`
                      : ''}
                  </div>
                </div>
                <Pill tone={l.kind === 'conclusion' ? 'ok' : l.kind === 'hypothesis' ? 'accent' : undefined}>
                  {t(`learning.kind.${l.kind}`)}
                </Pill>
              </Link>
            ))}
          </div>
        )}
      </div>
      <div>
        <Section title={t('insights.suggested_rules')}>
          {outliers.length ? (
            <div className="list">
              {outliers.map((o) => {
                const c = cmap.get(o.contentId);
                const statement = t(o.ratio >= 1 ? 'suggest.outlier_up' : 'suggest.outlier_down', {
                  title: c ? contentTitle(c) : t('insights.a_post'),
                  ratio: fmt.ratio(o.ratio),
                  checkpoint: o.checkpoint,
                  n: o.n,
                });
                return (
                  <div key={o.publicationId} className="row static" style={{ flexWrap: 'wrap' }}>
                    <div className="grow" style={{ whiteSpace: 'normal' }}>
                      <span className="reason">{t('learning.kind.observation')}</span> {statement}
                    </div>
                    <Button
                      size="sm"
                      onClick={() => {
                        setPreset({
                          statement,
                          evidence: c ? [{ type: 'content', id: c.id, label: contentTitle(c) }] : [],
                        });
                        setOpen(true);
                      }}
                    >
                      {t('insights.save_learning')}
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="meta">{t('insights.outliers_hint', { n: MIN_BASELINE })}</div>
          )}
        </Section>
      </div>
      <LearningEditor
        key={preset?.statement ?? 'new'}
        open={open}
        onClose={() => setOpen(false)}
        evidence={preset?.evidence ?? []}
        initial={preset ? { statement: preset.statement, kind: 'observation' } : undefined}
      />
    </div>
  );
}

function Week({
  pubs,
  learnings,
  ws,
  cmap,
}: {
  pubs: Publication[];
  learnings: Learning[];
  ws: Workspace | undefined;
  cmap: Map<string, Content>;
}) {
  useT();
  const st = startOfWeek(Date.now()).getTime();
  const thisWeek = pubs.filter((p) => p.publishedAt && Date.parse(p.publishedAt) >= st);
  const lastWeek = pubs.filter(
    (p) => p.publishedAt && Date.parse(p.publishedAt) >= st - 7 * DAY && Date.parse(p.publishedAt) < st,
  );
  const newL = learnings.filter((l) => Date.parse(l.createdAt) >= st);
  return (
    <div className="grid2">
      <div>
        <Section title={t('insights.published_week')} count={thisWeek.length}>
          <div className="list">
            {(ws?.cadence ?? []).map((c) => (
              <div key={c.platform} className="row static">
                <span style={{ width: 120 }}>{platformName(c.platform)}</span>
                <span className="num">
                  {thisWeek.filter((p) => p.platform === c.platform).length} / {c.perWeek}
                </span>
              </div>
            ))}
            {thisWeek.map((p) => (
              <Link key={p.id} to="/content/$id" params={{ id: p.contentId }} className="row">
                <div className="grow title">{contentTitle(cmap.get(p.contentId) ?? {})}</div>
                <span className="meta">{platformName(p.platform)}</span>
              </Link>
            ))}
            {!thisWeek.length && (
              <div className="row static meta">{t('insights.none_week', { n: lastWeek.length })}</div>
            )}
          </div>
        </Section>
      </div>
      <div>
        <Section title={t('insights.new_learnings')} count={newL.length}>
          {newL.map((l) => (
            <div key={l.id} className="meta">
              <span className="tag">{t(`learning.kind.${l.kind}`)}</span> {l.statement}
            </div>
          ))}
          {!newL.length && <div className="meta">{t('insights.none_this_week')}</div>}
        </Section>
      </div>
    </div>
  );
}
