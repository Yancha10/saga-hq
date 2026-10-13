import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { Clapperboard, GitBranch, Heart, Sparkles, Star } from 'lucide-react';
import { useState } from 'react';
import { useApp, useLive, useSession } from '../../app/context';
import { toast } from '../../app/status';
import { createVariant, ideaToContent } from '../../data/domain';
import type { Idea, Platform } from '../../data/schema';
import { update } from '../../data/store';
import { t, useT } from '../../i18n';
import { AutoText, Button, Empty, IconButton, Pill, Section, Sheet } from '../../ui/kit';
import { PageHeader } from '../../ui/PageHeader';
import {
  ArchivedNotice,
  archiveTrashItems,
  ConflictNotice,
  HistoryList,
  PlatformPicker,
  ProjectSelect,
  RecordMenu,
  References,
  TagEditor,
  templateName,
} from '../common';
import { IdeaLab } from './IdeaLab';

const SCORE_DIMS = ['hook', 'originality', 'effort', 'timeliness', 'fit'] as const;

export function IdeaDetail() {
  useT();
  const { id } = useParams({ strict: false }) as { id: string };
  const s = useSession();
  const navigate = useNavigate();
  const { toggleSecretary } = useApp();
  const idea = useLive((ss) => ss.db.ideas.get(id), [id], undefined);
  const ws = useLive((ss) => ss.db.workspace.get('workspace'), [], undefined);
  const parent = useLive(
    async (ss) => (idea?.parentIdeaId ? ss.db.ideas.get(idea.parentIdeaId) : undefined),
    [idea?.parentIdeaId],
    undefined,
  );
  const variants = useLive(
    (ss) =>
      ss.db.ideas
        .where('parentIdeaId')
        .equals(id)
        .toArray()
        .then((v) => v.filter((x) => !x.deletedAt)),
    [id],
    [],
  );
  const contents = useLive(
    (ss) =>
      ss.db.content
        .where('ideaId')
        .equals(id)
        .toArray()
        .then((v) => v.filter((x) => !x.deletedAt)),
    [id],
    [],
  );
  const [makeOpen, setMakeOpen] = useState(false);
  const [variantOpen, setVariantOpen] = useState(false);
  const [variantLabel, setVariantLabel] = useState('');
  if (idea === undefined) return <div className="page" aria-busy="true" />;
  if (!idea)
    return (
      <div className="page">
        <Empty title={t('ideas.not_found')}>{t('common.maybe_deleted')}</Empty>
      </div>
    );
  const up = (patch: Partial<Idea>, key?: string) =>
    update(s, 'ideas', idea.id, patch, key ? { coalesceKey: `idea:${idea.id}:${key}` } : undefined);

  return (
    <div className="page narrow" style={{ maxWidth: 1180 }}>
      <PageHeader
        back
        title={t('ideas.idea')}
        sub={
          parent ? (
            <>
              {t('ideas.variant_of_prefix')}{' '}
              <Link to="/ideas/$id" params={{ id: parent.id }}>
                {parent.title}
              </Link>
            </>
          ) : idea.origin?.source === 'capture' ? (
            t('ideas.from_capture')
          ) : undefined
        }
        actions={
          <>
            <IconButton
              label={idea.favorite ? t('idea.unfavorite') : t('idea.favorite')}
              aria-pressed={!!idea.favorite}
              onClick={() => void up({ favorite: !idea.favorite })}
            >
              <Heart size={16} fill={idea.favorite ? 'currentColor' : 'none'} />
            </IconButton>
            <Button
              onClick={() => void up({ status: idea.status === 'shortlisted' ? 'new' : 'shortlisted' })}
            >
              <Star size={15} fill={idea.status === 'shortlisted' ? 'currentColor' : 'none'} />{' '}
              {idea.status === 'shortlisted' ? t('idea.status.shortlisted') : t('ideas.shortlist')}
            </Button>
            <Button variant="primary" onClick={() => setMakeOpen(true)}>
              <Clapperboard size={15} /> {t('ideas.make_content')}
            </Button>
            <RecordMenu
              label={t('ideas.actions')}
              items={[
                {
                  id: 'park',
                  label: idea.status === 'parked' ? t('ideas.unpark') : t('ideas.park'),
                  run: () => void up({ status: idea.status === 'parked' ? 'new' : 'parked' }),
                },
                ...archiveTrashItems(s, 'ideas', idea, () => void navigate({ to: '/ideas' })),
              ]}
            />
          </>
        }
      />
      <ArchivedNotice rec={idea} table="ideas" />
      <ConflictNotice recordId={idea.id} table="ideas" />
      <div className="grid2">
        <div className="stack">
          <AutoText
            value={idea.title}
            onSave={(v) => up({ title: v }, 'title')}
            className="title plain"
            ariaLabel={t('ideas.title_label')}
            placeholder={t('ideas.title_label')}
          />
          <div className="field">
            <span className="lbl">{t('ideas.raw')}</span>
            <AutoText
              multiline
              value={idea.raw}
              onSave={(v) => up({ raw: v || null }, 'raw')}
              ariaLabel={t('ideas.raw')}
              placeholder={t('ideas.raw_placeholder')}
            />
          </div>
          <div className="field">
            <span className="lbl">{t('field.hook')}</span>
            <AutoText
              value={idea.hook}
              onSave={(v) => up({ hook: v || null }, 'hook')}
              ariaLabel={t('field.hook')}
              placeholder={t('ideas.hook_placeholder')}
            />
          </div>
          <div className="field">
            <span className="lbl">{t('field.concept')}</span>
            <AutoText
              multiline
              value={idea.concept}
              onSave={(v) => up({ concept: v || null }, 'concept')}
              ariaLabel={t('field.concept')}
              placeholder={t('ideas.concept_placeholder')}
              rows={4}
            />
          </div>
          <div className="field">
            <span className="lbl">{t('ideas.why')}</span>
            <AutoText
              multiline
              value={idea.whyItWorks}
              onSave={(v) => up({ whyItWorks: v || null }, 'why')}
              ariaLabel={t('ideas.why')}
              rows={2}
            />
          </div>
          <Section fold="closed" title={t('idea.dev.title')}>
            <p className="meta explain">{t('idea.dev.hint')}</p>
            <div className="saga-grid">
              {(['situation', 'tension', 'twist', 'payoff'] as const).map((k) => (
                <div key={k} className="field">
                  <span className="lbl">{t(`idea.dev.${k}`)}</span>
                  <AutoText
                    multiline
                    value={idea[k]}
                    onSave={(v) => up({ [k]: v || null } as Partial<Idea>, k)}
                    ariaLabel={t(`idea.dev.${k}`)}
                    placeholder={t(`idea.dev.${k}_ph`)}
                    rows={2}
                  />
                </div>
              ))}
            </div>
            <div className="form-grid">
              <div className="field">
                <span className="lbl">{t('saga.pillar')}</span>
                <AutoText
                  value={idea.pillar}
                  onSave={(v) => up({ pillar: v || null }, 'pillar')}
                  ariaLabel={t('saga.pillar')}
                />
              </div>
              <div className="field">
                <label className="lbl" htmlFor="idur">
                  {t('saga.duration_target')}
                </label>
                <input
                  id="idur"
                  type="number"
                  min={0}
                  className="input"
                  value={idea.durationSec ?? ''}
                  onChange={(e) => void up({ durationSec: e.target.value ? Number(e.target.value) : null })}
                />
              </div>
              <div className="field">
                <label className="lbl" htmlFor="idiff">
                  {t('idea.difficulty')}
                </label>
                <select
                  id="idiff"
                  className="select"
                  value={idea.difficulty ?? ''}
                  onChange={(e) => void up({ difficulty: (e.target.value || null) as Idea['difficulty'] })}
                >
                  <option value="">—</option>
                  <option value="low">{t('idea.diff.low')}</option>
                  <option value="med">{t('idea.diff.med')}</option>
                  <option value="high">{t('idea.diff.high')}</option>
                </select>
              </div>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={!!idea.emergency}
                onChange={(e) => void up({ emergency: e.target.checked })}
              />{' '}
              {t('idea.emergency_label')}
            </label>
          </Section>
          <Section fold="closed" title={t('section.references')}>
            <References fromType="idea" fromId={idea.id} projectId={idea.projectId} />
          </Section>
          <Section
            title={t('ideas.variants')}
            fold="closed"
            count={variants.length}
            action={
              <Button size="sm" onClick={() => setVariantOpen(true)}>
                <GitBranch size={14} /> {t('ideas.new_variant')}
              </Button>
            }
          >
            {variants.length ? (
              <div className="list">
                {variants.map((v) => (
                  <Link key={v.id} to="/ideas/$id" params={{ id: v.id }} className="row">
                    <div className="grow">
                      <div className="title">{v.title || t('ideas.untitled')}</div>
                      <div className="sub">
                        {v.variantLabel}
                        {v.origin?.source === 'ai' ? ` · ✧ ${t('ideas.ai_kept')}` : ''}
                      </div>
                    </div>
                    <Pill>{t(`idea.status.${v.status}`)}</Pill>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="meta">{t('ideas.variants_hint')}</div>
            )}
          </Section>
          <Section fold="closed" title={t('common.notes')}>
            <AutoText
              multiline
              value={idea.notes}
              onSave={(v) => up({ notes: v || null }, 'notes')}
              ariaLabel={t('common.notes')}
            />
          </Section>
        </div>
        <div className="stack">
          <div className="box">
            <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="field">
                <label className="lbl" htmlFor="istatus">
                  {t('common.status')}
                </label>
                <select
                  id="istatus"
                  className="select"
                  value={idea.status}
                  onChange={(e) => void up({ status: e.target.value as Idea['status'] })}
                >
                  {(['new', 'shortlisted', 'committed', 'parked'] as const).map((st) => (
                    <option key={st} value={st}>
                      {t(`idea.status.${st}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="lbl" htmlFor="iprio">
                  {t('common.priority')}
                </label>
                <select
                  id="iprio"
                  className="select"
                  value={idea.priority ?? ''}
                  onChange={(e) => void up({ priority: (e.target.value || null) as Idea['priority'] })}
                >
                  <option value="">{t('priority.none')}</option>
                  <option value="low">{t('priority.low')}</option>
                  <option value="med">{t('priority.med')}</option>
                  <option value="high">{t('priority.high')}</option>
                </select>
              </div>
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label className="lbl" htmlFor="iproj">
                  {t('common.project')}
                </label>
                <ProjectSelect
                  id="iproj"
                  value={idea.projectId}
                  onChange={(v) => void up({ projectId: v })}
                />
              </div>
              <div className="field">
                <span className="lbl">{t('common.format')}</span>
                <AutoText
                  value={idea.format}
                  onSave={(v) => up({ format: v || null })}
                  ariaLabel={t('common.format')}
                  placeholder={t('ideas.format_placeholder')}
                />
              </div>
              <div className="field">
                <span className="lbl">{t('ideas.tone')}</span>
                <AutoText
                  value={idea.tone}
                  onSave={(v) => up({ tone: v || null })}
                  ariaLabel={t('ideas.tone')}
                  placeholder={t('ideas.tone_placeholder')}
                />
              </div>
            </div>
            <div className="field">
              <span className="lbl">{t('common.platforms')}</span>
              <PlatformPicker value={idea.platforms ?? []} onChange={(v) => void up({ platforms: v })} />
            </div>
            <div className="field">
              <span className="lbl">{t('ideas.cast')}</span>
              <TagEditor value={idea.cast} onChange={(v) => void up({ cast: v })} labelKey="common.person" />
            </div>
            <div className="field">
              <span className="lbl">{t('common.tags')}</span>
              <TagEditor value={idea.tags} onChange={(v) => void up({ tags: v })} />
            </div>
            {ws?.scoringEnabled && (
              <div className="field">
                <span className="lbl">{t('ideas.scores')}</span>
                {SCORE_DIMS.map((d) => {
                  const sc = idea.scores?.[d];
                  return (
                    <div key={d} className="hstack" style={{ justifyContent: 'space-between' }}>
                      <span className="meta">
                        {t(`ideas.score.${d}`)}
                        {sc?.by === 'ai' ? ` (${t('ideas.ai_unconfirmed')})` : ''}
                      </span>
                      <span className="chips" role="group" aria-label={t(`ideas.score.${d}`)}>
                        {([1, 2, 3] as const).map((n) => (
                          <button
                            key={n}
                            type="button"
                            className="chip"
                            aria-pressed={sc?.value === n}
                            onClick={() =>
                              void up({ scores: { ...(idea.scores ?? {}), [d]: { value: n, by: 'user' } } })
                            }
                          >
                            {t(`priority.${(['low', 'med', 'high'] as const)[n - 1]}`)}
                          </button>
                        ))}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {contents.length > 0 && (
            <div className="box">
              <h4>{t('ideas.became_content')}</h4>
              {contents.map((c) => (
                <Link key={c.id} to="/content/$id" params={{ id: c.id }} className="hstack">
                  {c.title || t('common.untitled')} <Pill>{t(`content.status.${c.status}`)}</Pill>
                </Link>
              ))}
            </div>
          )}
          <IdeaLab idea={idea} />
          <Button
            variant="ghost"
            onClick={() => toggleSecretary({ intent: 'creative', focus: { entity: 'idea', id: idea.id } })}
          >
            <Sparkles size={15} /> {t('ideas.discuss')}
          </Button>
          <details>
            <summary className="meta">{t('common.history')}</summary>
            <HistoryList recordId={idea.id} />
          </details>
        </div>
      </div>

      <MakeContentSheet
        open={makeOpen}
        onClose={() => setMakeOpen(false)}
        idea={idea}
        onDone={(cid) => void navigate({ to: '/content/$id', params: { id: cid } })}
      />
      <Sheet
        open={variantOpen}
        onClose={() => setVariantOpen(false)}
        title={t('ideas.new_variant')}
        footer={
          <Button
            variant="primary"
            onClick={async () => {
              const v = await createVariant(
                s,
                idea,
                variantLabel.trim() || t('ideas.version_n', { n: variants.length + 2 }),
              );
              setVariantOpen(false);
              setVariantLabel('');
              void navigate({ to: '/ideas/$id', params: { id: v.id } });
            }}
          >
            {t('h.variant')}
          </Button>
        }
      >
        <div className="field">
          <label className="lbl" htmlFor="vlabel">
            {t('common.label')}
          </label>
          <input
            id="vlabel"
            className="input"
            autoFocus
            placeholder={t('ideas.variant_placeholder')}
            value={variantLabel}
            onChange={(e) => setVariantLabel(e.target.value)}
          />
        </div>
        <p className="meta">{t('ideas.variant_note')}</p>
      </Sheet>
    </div>
  );
}

export function MakeContentSheet({
  open,
  onClose,
  idea,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  idea: Idea;
  onDone: (contentId: string) => void;
}) {
  useT();
  const s = useSession();
  const ws = useLive((ss) => ss.db.workspace.get('workspace'), [], undefined);
  const [tpl, setTpl] = useState('reel');
  const [platforms, setPlatforms] = useState<Platform[] | null>(null);
  const [projectId, setProjectId] = useState<string | null | undefined>(undefined);
  const template = ws?.formatTemplates.find((tp) => tp.id === tpl);
  const plats = platforms ?? (idea.platforms?.length ? idea.platforms : (template?.platforms ?? []));
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('h.ideaToContent')}
      footer={
        <Button
          variant="primary"
          onClick={async () => {
            const c = await ideaToContent(s, idea, {
              formatTemplateId: tpl,
              platforms: plats,
              projectId: projectId === undefined ? idea.projectId : projectId,
            });
            toast(t('ideas.content_created'));
            onClose();
            onDone(c.id);
          }}
        >
          {t('ai.action.createContent')}
        </Button>
      }
    >
      <div className="field">
        <label className="lbl" htmlFor="mformat">
          {t('common.format')}
        </label>
        <select id="mformat" className="select" value={tpl} onChange={(e) => setTpl(e.target.value)}>
          {(ws?.formatTemplates ?? []).map((tp) => (
            <option key={tp.id} value={tp.id}>
              {templateName(tp)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <span className="lbl">{t('common.platforms')}</span>
        <PlatformPicker value={plats} onChange={setPlatforms} />
      </div>
      <div className="field">
        <span className="lbl">{t('common.project')}</span>
        <ProjectSelect value={projectId === undefined ? idea.projectId : projectId} onChange={setProjectId} />
      </div>
      <p className="meta">{t('ideas.make_note')}</p>
    </Sheet>
  );
}
