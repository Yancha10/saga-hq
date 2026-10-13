import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useLive, useSession } from '../../app/context';
import { toast } from '../../app/status';
import { nowIso } from '../../core/util';
import type { Learning } from '../../data/schema';
import { update } from '../../data/store';
import { fmt, t, useT } from '../../i18n';
import { AutoText, Button, Empty, Section } from '../../ui/kit';
import { PageHeader } from '../../ui/PageHeader';
import {
  ArchivedNotice,
  archiveTrashItems,
  contentTitle,
  HistoryList,
  PlatformPicker,
  RecordMenu,
} from '../common';

export function LearningDetail() {
  useT();
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
        if (c) out.push({ linkId: k.id, contentId: c.id, title: contentTitle(c), type: k.type });
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
        <Empty title={t('learning.not_found')} />
      </div>
    );
  const up = (patch: Partial<Learning>, key?: string) =>
    update(s, 'learnings', l.id, patch, key ? { coalesceKey: `l:${l.id}:${key}` } : undefined);
  return (
    <div className="page narrow">
      <PageHeader
        back
        title={t('learning.title')}
        sub={l.origin?.source === 'ai' ? `✧ ${t('learning.ai_saved')}` : undefined}
        actions={
          <RecordMenu
            label={t('common.actions')}
            items={[
              {
                id: 'retire',
                label: l.status === 'active' ? t('learning.retire') : t('learning.reactivate'),
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
          ariaLabel={t('field.statement')}
          className="title"
          rows={2}
        />
        <div className="form-grid">
          <div className="field">
            <label className="lbl" htmlFor="lk">
              {t('task.kind_label')}
            </label>
            <select
              id="lk"
              className="select"
              value={l.kind}
              onChange={(e) => void up({ kind: e.target.value as Learning['kind'] })}
            >
              <option value="observation">{t('learning.kind.observation')}</option>
              <option value="hypothesis">{t('learning.kind.hypothesis')}</option>
              <option value="conclusion">{t('learning.kind.conclusion')}</option>
            </select>
          </div>
          <div className="field">
            <label className="lbl" htmlFor="lc">
              {t('learning.confidence')}
            </label>
            <select
              id="lc"
              className="select"
              value={l.confidence}
              onChange={(e) => void up({ confidence: e.target.value as Learning['confidence'] })}
            >
              <option value="low">{t('priority.low')}</option>
              <option value="medium">{t('priority.med')}</option>
              <option value="high">{t('priority.high')}</option>
            </select>
          </div>
        </div>
        {l.kind === 'conclusion' && evidence.length < 5 && (
          <div className="banner warning" style={{ borderRadius: 8 }}>
            {t('learning.few_evidence', { count: evidence.length })}
          </div>
        )}
        <div className="field">
          <span className="lbl">{t('learning.scope_platforms')}</span>
          <PlatformPicker
            value={l.scope?.platforms ?? []}
            onChange={(v) => void up({ scope: { ...(l.scope ?? {}), platforms: v } })}
          />
        </div>
        <div className="field">
          <span className="lbl">{t('learning.evidence_notes')}</span>
          <AutoText
            multiline
            value={l.evidenceNote}
            onSave={(v) => up({ evidenceNote: v || null }, 'ev')}
            ariaLabel={t('learning.evidence_notes')}
            rows={3}
          />
        </div>
        <Section title={t('learning.linked_evidence')} count={evidence.length}>
          {evidence.length ? (
            <div className="list">
              {evidence.map((e) => (
                <Link key={e.linkId} to="/content/$id" params={{ id: e.contentId }} className="row">
                  <div className="grow title">{e.title}</div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="meta">{t('learning.link_hint')}</div>
          )}
        </Section>
        <div className="box">
          <div>
            {t('learning.last_validated', {
              date: l.lastValidatedAt ? fmt.date(l.lastValidatedAt) : t('common.never'),
            })}
            {newData ? ` · ${t('learning.new_data', { count: newData })}` : ''}
          </div>
          <div>
            <Button
              size="sm"
              onClick={() =>
                void up({ lastValidatedAt: nowIso() }).then(() => toast(t('learning.revalidated')))
              }
            >
              {t('learning.revalidate')}
            </Button>
          </div>
        </div>
        <details>
          <summary className="meta">{t('common.history')}</summary>
          <HistoryList recordId={l.id} />
        </details>
      </div>
    </div>
  );
}
