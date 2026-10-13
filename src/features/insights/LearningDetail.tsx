import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useLive, useSession } from '../../app/context';
import { toast } from '../../app/status';
import { nowIso } from '../../core/util';
import type { Learning } from '../../data/schema';
import { update } from '../../data/store';
import { AutoText, Button, Empty, Section } from '../../ui/kit';
import { PageHeader } from '../../ui/PageHeader';
import { ArchivedNotice, archiveTrashItems, HistoryList, PlatformPicker, RecordMenu } from '../common';

export function LearningDetail() {
  const { id } = useParams({ strict: false }) as { id: string };
  const s = useSession();
  const navigate = useNavigate();
  const l = useLive((ss) => ss.db.learnings.get(id), [id], undefined);
  const evidence = useLive(
    async (ss) => {
      const links = (await ss.db.links.where('fromId').equals(id).toArray()).filter((x) => !x.deletedAt);
      const out: { linkId: string; contentId: string; title: string; type: string }[] = [];
      for (const k of links) {
        const cid =
          k.toType === 'content'
            ? k.toId
            : k.toType === 'publication'
              ? (await ss.db.publications.get(k.toId))?.contentId
              : undefined;
        const c = cid ? await ss.db.content.get(cid) : undefined;
        if (c) out.push({ linkId: k.id, contentId: c.id, title: c.title, type: k.type });
      }
      return out;
    },
    [id],
    [],
  );
  const newData = useLive(
    async (ss) => {
      if (!l?.lastValidatedAt) return 0;
      const pubs = await ss.db.publications.where('publishedAt').above(l.lastValidatedAt).toArray();
      return pubs.filter(
        (p) => !p.deletedAt && (!l.scope?.platforms?.length || l.scope.platforms.includes(p.platform)),
      ).length;
    },
    [l?.lastValidatedAt, l?.scope?.platforms?.join()],
    0,
  );
  if (l === undefined) return <div className="page" aria-busy="true" />;
  if (!l)
    return (
      <div className="page">
        <Empty title="Learning not found" />
      </div>
    );
  const up = (patch: Partial<Learning>, key?: string) =>
    update(s, 'learnings', l.id, patch, key ? { coalesceKey: `l:${l.id}:${key}` } : undefined);
  return (
    <div className="page narrow">
      <PageHeader
        back
        title="Learning"
        sub={l.origin?.source === 'ai' ? '✧ Suggested by the Secretary, saved by you' : undefined}
        actions={
          <RecordMenu
            label="Actions"
            items={[
              {
                id: 'retire',
                label: l.status === 'active' ? 'Retire (no longer true)' : 'Reactivate',
                run: () => void up({ status: l.status === 'active' ? 'retired' : 'active' }),
              },
              ...archiveTrashItems(s, 'learnings', l, () => void navigate({ to: '/insights' })),
            ]}
          />
        }
      />
      <ArchivedNotice rec={l} table="learnings" />
      <div className="stack">
        <AutoText
          multiline
          value={l.statement}
          onSave={(v) => v.trim() && up({ statement: v.trim() }, 'stmt')}
          ariaLabel="Statement"
          className="title"
          rows={2}
        />
        <div className="form-grid">
          <div className="field">
            <label className="lbl" htmlFor="lk">
              Type
            </label>
            <select
              id="lk"
              className="select"
              value={l.kind}
              onChange={(e) => void up({ kind: e.target.value as Learning['kind'] })}
            >
              <option value="observation">Observation</option>
              <option value="hypothesis">Hypothesis</option>
              <option value="conclusion">Conclusion</option>
            </select>
          </div>
          <div className="field">
            <label className="lbl" htmlFor="lc">
              Confidence
            </label>
            <select
              id="lc"
              className="select"
              value={l.confidence}
              onChange={(e) => void up({ confidence: e.target.value as Learning['confidence'] })}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>
        {l.kind === 'conclusion' && evidence.length < 5 && (
          <div className="banner warning" style={{ borderRadius: 8 }}>
            Only {evidence.length} linked piece(s) of evidence. Results show correlation, not causation.
          </div>
        )}
        <div className="field">
          <span className="lbl">Scope: platforms</span>
          <PlatformPicker
            value={l.scope?.platforms ?? []}
            onChange={(v) => void up({ scope: { ...(l.scope ?? {}), platforms: v } })}
          />
        </div>
        <div className="field">
          <span className="lbl">Evidence notes</span>
          <AutoText
            multiline
            value={l.evidenceNote}
            onSave={(v) => up({ evidenceNote: v || null }, 'ev')}
            ariaLabel="Evidence notes"
            rows={3}
          />
        </div>
        <Section title="Linked evidence" count={evidence.length}>
          {evidence.length ? (
            <div className="list">
              {evidence.map((e) => (
                <Link key={e.linkId} to="/content/$id" params={{ id: e.contentId }} className="row">
                  <div className="grow title">{e.title}</div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="meta">
              Link evidence by writing learnings from a content item’s Results section.
            </div>
          )}
        </Section>
        <div className="box">
          <div>
            Last validated: {l.lastValidatedAt ? new Date(l.lastValidatedAt).toLocaleDateString() : 'never'}
            {newData ? ` · ${newData} new publication(s) in scope since then` : ''}
          </div>
          <div>
            <Button
              size="sm"
              onClick={() =>
                void up({ lastValidatedAt: nowIso() }).then(() => toast('Marked as revalidated'))
              }
            >
              Still holds — revalidate
            </Button>
          </div>
        </div>
        <details>
          <summary className="meta">History</summary>
          <HistoryList recordId={l.id} />
        </details>
      </div>
    </div>
  );
}
