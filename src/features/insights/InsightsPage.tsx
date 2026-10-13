import { Link } from '@tanstack/react-router';
import { Plus, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useApp, useLive, useSession } from '../../app/context';
import { toast } from '../../app/status';
import { median } from '../../core/util';
import { exportCsv } from '../../data/backup';
import { logSnapshot } from '../../data/domain';
import {
  type Content,
  type Learning,
  PLATFORM_LABEL,
  type Publication,
  type Snapshot,
  type Workspace,
} from '../../data/schema';
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
import { downloadText } from '../common';
import { LearningEditor } from './LearningEditor';
import { MetricsForm } from './MetricsForm';

type Tab = 'results' | 'patterns' | 'learnings' | 'week';

export function InsightsPage() {
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
        title="Insights"
        sub="Results and learnings — built for learning, not vanity."
        actions={
          <>
            <Button variant="ghost" onClick={() => toggleSecretary({ intent: 'analyst' })}>
              <Sparkles size={15} /> Analyst
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
              Export CSV
            </Button>
          </>
        }
      />
      <div style={{ marginBottom: 16 }}>
        <Tabs
          label="Insights"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'results', label: 'Results' },
            { value: 'patterns', label: 'Patterns' },
            {
              value: 'learnings',
              label: `Learnings ${d.learnings.filter((l) => l.status === 'active').length || ''}`,
            },
            { value: 'week', label: 'Week' },
          ]}
        />
      </div>
      {tab === 'results' && <Results pubs={d.pubs} snaps={d.snaps} cmap={cmap} />}
      {tab === 'patterns' && <Patterns pubs={d.pubs} snaps={d.snaps} cmap={cmap} />}
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
    return (
      <Empty title="No published content yet">
        Mark content as published from its Production Sheet, then log results here or from Today.
      </Empty>
    );
  return (
    <>
      <div className="hstack" style={{ marginBottom: 8 }}>
        <span className="meta">Compare at</span>
        <Tabs
          label="Checkpoint"
          value={cp}
          onChange={setCp}
          options={CHECKPOINTS.map((c) => ({ value: c.key, label: c.key }))}
        />
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Content</th>
              <th>Platform</th>
              <th>Published</th>
              <th>Views {cp}</th>
              <th>vs median</th>
              <th>Likes</th>
              <th>Shares</th>
              <th>Saves</th>
              <th />
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
                      {cmap.get(p.contentId)?.title}
                    </Link>
                  </td>
                  <td>{PLATFORM_LABEL[p.platform]}</td>
                  <td>
                    {p.publishedAt
                      ? new Date(p.publishedAt).toLocaleDateString(undefined, {
                          day: 'numeric',
                          month: 'short',
                        })
                      : ''}
                  </td>
                  <td className="num">{v?.toLocaleString() ?? '—'}</td>
                  <td className="num">
                    {v !== undefined && m ? (
                      <Pill tone={v / m >= 2 ? 'ok' : v / m <= 0.5 ? 'warn' : undefined}>
                        {(v / m).toFixed(1)}×
                      </Pill>
                    ) : (
                      <span className="meta">n&lt;5</span>
                    )}
                  </td>
                  <td className="num">{val(p, cp, 'likes')?.toLocaleString() ?? '—'}</td>
                  <td className="num">{val(p, cp, 'shares')?.toLocaleString() ?? '—'}</td>
                  <td className="num">{val(p, cp, 'saves')?.toLocaleString() ?? '—'}</td>
                  <td>
                    <Button size="sm" variant="ghost" onClick={() => setLogFor(p)}>
                      Log
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="meta" style={{ marginTop: 8 }}>
        Baselines compare against the median of the same platform and format; shown only with at least{' '}
        {MIN_BASELINE} comparable posts. Platform metrics are not summed across platforms.
      </p>
      <Sheet open={!!logFor} onClose={() => setLogFor(null)} title="Log results">
        {logFor && (
          <MetricsForm
            platform={logFor.platform}
            onSubmit={async (m) => {
              await logSnapshot(s, logFor, m);
              toast('Results saved');
              setLogFor(null);
            }}
          />
        )}
      </Sheet>
    </>
  );
}

const ATTRS: { key: string; label: string; fn: (c: Content, p: Publication) => string | null | undefined }[] =
  [
    { key: 'hookType', label: 'Hook type', fn: (c) => c.attributes?.hookType },
    { key: 'format', label: 'Format', fn: (c) => c.formatTemplateId },
    { key: 'platform', label: 'Platform', fn: (_c, p) => PLATFORM_LABEL[p.platform] },
    {
      key: 'duration',
      label: 'Duration',
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
      label: 'Posting hour',
      fn: (_c, p) =>
        p.publishedAt ? `${String(new Date(p.publishedAt).getHours()).padStart(2, '0')}:00` : null,
    },
    {
      key: 'weekday',
      label: 'Weekday',
      fn: (_c, p) =>
        p.publishedAt ? new Date(p.publishedAt).toLocaleDateString(undefined, { weekday: 'short' }) : null,
    },
    { key: 'tone', label: 'Tone', fn: (c) => c.attributes?.tone },
    {
      key: 'dialogue',
      label: 'Dialogue',
      fn: (c) =>
        c.attributes?.hasDialogue === undefined || c.attributes?.hasDialogue === null
          ? null
          : c.attributes.hasDialogue
            ? 'with dialogue'
            : 'no dialogue',
    },
    { key: 'model', label: 'AI model', fn: (c) => c.attributes?.aiModels?.[0] },
  ];

function Patterns({
  pubs,
  snaps,
  cmap,
}: {
  pubs: Publication[];
  snaps: Snapshot[];
  cmap: Map<string, Content>;
}) {
  const [attr, setAttr] = useState('hookType');
  const [metric, setMetric] = useState('views');
  const [cp, setCp] = useState<CheckpointKey>('24h');
  const [platform, setPlatform] = useState<string>('');
  const a = ATTRS.find((x) => x.key === attr)!;
  const scoped = platform ? pubs.filter((p) => p.platform === platform) : pubs;
  const rows = patternBy(scoped, snaps, cmap, a.fn, metric, cp);
  const max = Math.max(1, ...rows.map((r) => r.median));
  return (
    <div className="stack">
      <div className="hstack">
        <select
          className="select"
          style={{ width: 160 }}
          value={attr}
          onChange={(e) => setAttr(e.target.value)}
          aria-label="Group by"
        >
          {ATTRS.map((x) => (
            <option key={x.key} value={x.key}>
              By {x.label.toLowerCase()}
            </option>
          ))}
        </select>
        <select
          className="select"
          style={{ width: 170 }}
          value={metric}
          onChange={(e) => setMetric(e.target.value)}
          aria-label="Metric"
        >
          {COMMON_METRICS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
        <select
          className="select"
          style={{ width: 110 }}
          value={cp}
          onChange={(e) => setCp(e.target.value as CheckpointKey)}
          aria-label="Checkpoint"
        >
          {CHECKPOINTS.map((c) => (
            <option key={c.key} value={c.key}>
              {c.key}
            </option>
          ))}
        </select>
        <select
          className="select"
          style={{ width: 150 }}
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          aria-label="Platform"
        >
          <option value="">All platforms</option>
          {[...new Set(pubs.map((p) => p.platform))].map((p) => (
            <option key={p} value={p}>
              {PLATFORM_LABEL[p]}
            </option>
          ))}
        </select>
      </div>
      {rows.length === 0 ? (
        <Empty compact>
          No data for this combination yet. Fill content attributes and log results to see patterns.
        </Empty>
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
                median {Math.round(r.median).toLocaleString()} · n={r.n}
                {r.n < MIN_BASELINE ? ' · too few' : ''}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="meta">
        Groups with fewer than {MIN_BASELINE} posts are dimmed. Differences are correlations — use them to
        form hypotheses, not conclusions.
      </p>
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
        <div className="hstack" style={{ marginBottom: 12 }}>
          <Tabs
            label="Learning status"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'retired', label: 'Retired' },
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
            <Plus size={15} /> New learning
          </Button>
        </div>
        {list.length === 0 ? (
          <Empty compact>No learnings yet. Write one when a result surprises you.</Empty>
        ) : (
          <div className="list">
            {list.map((l) => (
              <Link key={l.id} to="/learnings/$id" params={{ id: l.id }} className="row">
                <div className="grow">
                  <div className="title" style={{ whiteSpace: 'normal' }}>
                    {l.statement}
                  </div>
                  <div className="sub">
                    {l.confidence} confidence
                    {l.scope?.platforms?.length
                      ? ` · ${l.scope.platforms.map((p) => PLATFORM_LABEL[p]).join(', ')}`
                      : ''}
                    {l.lastValidatedAt
                      ? ` · validated ${new Date(l.lastValidatedAt).toLocaleDateString()}`
                      : ''}
                  </div>
                </div>
                <Pill tone={l.kind === 'conclusion' ? 'ok' : l.kind === 'hypothesis' ? 'accent' : undefined}>
                  {l.kind}
                </Pill>
              </Link>
            ))}
          </div>
        )}
      </div>
      <div>
        <Section title="Suggested by rules">
          {outliers.length ? (
            <div className="list">
              {outliers.map((o) => {
                const c = cmap.get(o.contentId);
                const statement = `${c?.title ?? 'A post'} ${o.ratio >= 1 ? 'outperformed' : 'underperformed'} its platform median (${o.ratio.toFixed(1)}× at ${o.checkpoint}, n=${o.n}).`;
                return (
                  <div key={o.publicationId} className="row static" style={{ flexWrap: 'wrap' }}>
                    <div className="grow" style={{ whiteSpace: 'normal' }}>
                      <span className="reason">observation</span> {statement}
                    </div>
                    <Button
                      size="sm"
                      onClick={() => {
                        setPreset({
                          statement,
                          evidence: c ? [{ type: 'content', id: c.id, label: c.title }] : [],
                        });
                        setOpen(true);
                      }}
                    >
                      Save as learning
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="meta">
              Outliers appear once a platform has at least {MIN_BASELINE} posts with 24h results.
            </div>
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
  const st = startOfWeek(Date.now()).getTime();
  const thisWeek = pubs.filter((p) => p.publishedAt && Date.parse(p.publishedAt) >= st);
  const lastWeek = pubs.filter(
    (p) => p.publishedAt && Date.parse(p.publishedAt) >= st - 7 * DAY && Date.parse(p.publishedAt) < st,
  );
  const newL = learnings.filter((l) => Date.parse(l.createdAt) >= st);
  return (
    <div className="grid2">
      <div>
        <Section title="Published this week" count={thisWeek.length}>
          <div className="list">
            {(ws?.cadence ?? []).map((c) => (
              <div key={c.platform} className="row static">
                <span style={{ width: 120 }}>{PLATFORM_LABEL[c.platform]}</span>
                <span className="num">
                  {thisWeek.filter((p) => p.platform === c.platform).length} / {c.perWeek}
                </span>
              </div>
            ))}
            {thisWeek.map((p) => (
              <Link key={p.id} to="/content/$id" params={{ id: p.contentId }} className="row">
                <div className="grow title">{cmap.get(p.contentId)?.title}</div>
                <span className="meta">{PLATFORM_LABEL[p.platform]}</span>
              </Link>
            ))}
            {!thisWeek.length && (
              <div className="row static meta">
                Nothing published yet this week (last week: {lastWeek.length}).
              </div>
            )}
          </div>
        </Section>
      </div>
      <div>
        <Section title="New learnings" count={newL.length}>
          {newL.map((l) => (
            <div key={l.id} className="meta">
              <span className="tag">{l.kind}</span> {l.statement}
            </div>
          ))}
          {!newL.length && <div className="meta">None this week.</div>}
        </Section>
      </div>
    </div>
  );
}
