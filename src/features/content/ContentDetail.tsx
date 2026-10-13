import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { ArrowRight, CheckCircle2, ImagePlus, Link2, ListPlus, Pin, Sparkles, Type } from 'lucide-react';
import { useState } from 'react';
import { useApp, useIsPhone, useLive, useSession } from '../../app/context';
import { toast } from '../../app/status';
import { sectionComplete } from '../../data/derive';
import { editContent, flagBlocked, moveToTomorrow, setContentStatus, togglePin } from '../../data/domain';
import { CONTENT_STATUSES, type Content, type SheetSection } from '../../data/schema';
import { undoLast, update } from '../../data/store';
import { fmt, t, useT } from '../../i18n';
import { missingList } from '../../i18n/render';
import { AutoText, Button, Empty, Progress, Sheet } from '../../ui/kit';
import { PageHeader } from '../../ui/PageHeader';
import {
  ArchivedNotice,
  archiveTrashItems,
  ConflictNotice,
  ContentStatus,
  HistoryList,
  PlatformPicker,
  ProjectSelect,
  QuickTask,
  RecordMenu,
  TagEditor,
  TaskRow,
  templateName,
} from '../common';
import {
  ConceptSection,
  EditSection,
  GenerateSection,
  openSheetSection,
  PackageSection,
  PublishSection,
  ReferencesSection,
  ResultsSection,
} from './SheetSections';

export function useContentBundle(id: string) {
  return useLive(
    async (s) => {
      const content = await s.db.content.get(id);
      if (!content) return { content: null };
      const [tasks, publications, links, ws, snapshots] = await Promise.all([
        s.db.tasks.where('contentId').equals(id).toArray(),
        s.db.publications.where('contentId').equals(id).toArray(),
        s.db.links.where('fromId').equals(id).toArray(),
        s.db.workspace.get('workspace'),
        s.db.snapshots.where('contentId').equals(id).toArray(),
      ]);
      return {
        content,
        tasks: tasks.filter((x) => !x.deletedAt),
        publications: publications.filter((p) => !p.deletedAt),
        links: links.filter((l) => !l.deletedAt),
        snapshots: snapshots.filter((x) => !x.deletedAt),
        ws,
        template: ws?.formatTemplates.find((tp) => tp.id === content.formatTemplateId),
      };
    },
    [id],
    undefined,
  );
}
export type Bundle = NonNullable<ReturnType<typeof useContentBundle>> & { content: Content };

export function ContentDetail() {
  useT();
  const { id } = useParams({ strict: false }) as { id: string };
  const s = useSession();
  const navigate = useNavigate();
  const phone = useIsPhone();
  const { toggleSecretary } = useApp();
  const b = useContentBundle(id);
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockReason, setBlockReason] = useState('');
  if (b === undefined) return <div className="page" aria-busy="true" />;
  if (!b.content)
    return (
      <div className="page">
        <Empty title={t('content.not_found')}>{t('common.maybe_deleted')}</Empty>
      </div>
    );
  const bundle = b as Bundle;
  const c = bundle.content;
  const sections = (bundle.template?.sections ?? [
    'concept',
    'references',
    'generate',
    'edit',
    'package',
    'publish',
  ]) as SheetSection[];
  const derivIn = {
    content: c,
    template: bundle.template,
    tasks: bundle.tasks,
    publications: bundle.publications,
    links: bundle.links,
  };
  const edit = async (patch: Partial<Content>, key?: string) => {
    const r = await editContent(s, c, patch, key ? `c:${c.id}:${key}` : undefined);
    if (r.autoProducing)
      toast(t('content.moved_producing'), {
        action: { label: t('common.undo'), run: () => void undoLast(s) },
      });
  };
  const missing = (c._missing ?? []).filter((m) => m !== 'publishDate' || c.status !== 'published');
  const blockers = bundle.tasks.filter((x) => x.isBlocker && x.status !== 'done');

  const quickActions = (
    <div className="hstack filters" style={{ marginBottom: 12, gap: 6 }}>
      <Button
        size="sm"
        onClick={() =>
          void setContentStatus(s, c, 'ready').then(() =>
            toast(
              missing.length
                ? t('content.ready_missing', { count: missing.length })
                : t('content.marked_ready'),
            ),
          )
        }
      >
        <CheckCircle2 size={14} /> {t('content.quick.ready')}
      </Button>
      <Button size="sm" onClick={() => openSheetSection('package')}>
        <Type size={14} /> {t('field.caption')}
      </Button>
      <Button size="sm" onClick={() => openSheetSection('package')}>
        <ImagePlus size={14} /> {t('content.quick.cover')}
      </Button>
      {c._nextPublishAt && (
        <Button
          size="sm"
          onClick={() =>
            void moveToTomorrow(s, c).then(() =>
              toast(t('content.moved_tomorrow'), {
                action: { label: t('common.undo'), run: () => void undoLast(s) },
              }),
            )
          }
        >
          <ArrowRight size={14} /> {t('content.quick.tomorrow')}
        </Button>
      )}
      <Button size="sm" onClick={() => openSheetSection('references')}>
        <Link2 size={14} /> {t('triage.reference')}
      </Button>
      <Button size="sm" onClick={() => openSheetSection('tasks', 'tasks')}>
        <ListPlus size={14} /> {t('task.kind.task')}
      </Button>
      <Button
        size="sm"
        onClick={() => toggleSecretary({ intent: 'producer', focus: { entity: 'content', id: c.id } })}
      >
        <Sparkles size={14} /> {t('common.ask')}
      </Button>
    </div>
  );

  const inspector = (
    <aside className="inspector" aria-label={t('content.details')}>
      <div className="box">
        <div className="hstack">
          <ContentStatus c={c} />
          <span className="spacer" />
          <span className="meta num">{t('content.pct_ready', { pct: fmt.pct(c._readyPct ?? 0) })}</span>
        </div>
        <Progress value={c._readyPct ?? 0} />
        {missing.length > 0 ? (
          <div className="meta">{t('content.missing', { items: missingList(missing) })}</div>
        ) : (
          <div className="meta" style={{ color: 'var(--ok)' }}>
            {t('content.all_in_place')}
          </div>
        )}
        <div className="field">
          <label className="lbl" htmlFor="cst">
            {t('common.status')}
          </label>
          <select
            id="cst"
            className="select"
            value={c.status}
            onChange={(e) => void setContentStatus(s, c, e.target.value as Content['status'])}
          >
            {CONTENT_STATUSES.map((st) => (
              <option key={st} value={st}>
                {t(`content.status.${st}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="lbl" htmlFor="cproj">
            {t('common.project')}
          </label>
          <ProjectSelect
            id="cproj"
            value={c.projectId}
            onChange={(v) => void update(s, 'content', c.id, { projectId: v })}
          />
        </div>
        <div className="field">
          <label className="lbl" htmlFor="cfmt">
            {t('common.format')}
          </label>
          <select
            id="cfmt"
            className="select"
            value={c.formatTemplateId}
            onChange={(e) => void update(s, 'content', c.id, { formatTemplateId: e.target.value })}
          >
            {(bundle.ws?.formatTemplates ?? []).map((tp) => (
              <option key={tp.id} value={tp.id}>
                {templateName(tp)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="lbl">{t('common.platforms')}</span>
          <PlatformPicker
            value={c.platforms}
            onChange={(v) => void update(s, 'content', c.id, { platforms: v })}
          />
        </div>
        <div className="field">
          <label className="lbl" htmlFor="cprio">
            {t('common.priority')}
          </label>
          <select
            id="cprio"
            className="select"
            value={c.priority ?? ''}
            onChange={(e) =>
              void update(s, 'content', c.id, { priority: (e.target.value || null) as Content['priority'] })
            }
          >
            <option value="">{t('priority.none')}</option>
            <option value="low">{t('priority.low')}</option>
            <option value="med">{t('priority.med')}</option>
            <option value="high">{t('priority.high')}</option>
          </select>
        </div>
      </div>
      <div className="box" id="tasks">
        <div className="hstack">
          <h4 style={{ flex: 1 }}>{t('content.tasks_blockers')}</h4>
          <Button size="sm" variant="ghost" onClick={() => setBlockOpen(true)}>
            {t('h.blocked')}
          </Button>
        </div>
        {blockers.length > 0 && (
          <div className="meta" style={{ color: 'var(--warn)' }}>
            {t('content.blocked_by', { list: blockers.map((x) => x.title).join(' · ') })}
          </div>
        )}
        <div className="list">
          {bundle.tasks
            .filter((x) => x.status !== 'done')
            .map((x) => (
              <TaskRow key={x.id} t={x} showParent={false} />
            ))}
          <QuickTask parent={{ contentId: c.id, projectId: c.projectId }} />
        </div>
      </div>
      <details className="box fold-box" open={!phone}>
        <summary>
          <h4>{t('content.attributes')}</h4>
        </summary>
        <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="field">
            <label className="lbl" htmlFor="ahook">
              {t('content.hook_type')}
            </label>
            <select
              id="ahook"
              className="select"
              value={c.attributes?.hookType ?? ''}
              onChange={(e) =>
                void update(s, 'content', c.id, {
                  attributes: { ...(c.attributes ?? {}), hookType: (e.target.value || null) as never },
                })
              }
            >
              <option value="">—</option>
              {(['question', 'dialogue', 'cold_open', 'reveal', 'text', 'other'] as const).map((h) => (
                <option key={h} value={h}>
                  {t(`hook.${h}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="lbl" htmlFor="adur">
              {t('content.duration_s')}
            </label>
            <input
              id="adur"
              type="number"
              min={0}
              className="input"
              value={c.attributes?.durationSec ?? ''}
              onChange={(e) =>
                void update(s, 'content', c.id, {
                  attributes: {
                    ...(c.attributes ?? {}),
                    durationSec: e.target.value ? Number(e.target.value) : null,
                  },
                })
              }
            />
          </div>
          <div className="field">
            <span className="lbl">{t('ideas.tone')}</span>
            <AutoText
              value={c.attributes?.tone}
              onSave={(v) =>
                update(s, 'content', c.id, { attributes: { ...(c.attributes ?? {}), tone: v || null } })
              }
              ariaLabel={t('ideas.tone')}
            />
          </div>
          <div className="field">
            <span className="lbl">{t('content.topic')}</span>
            <AutoText
              value={c.attributes?.topic}
              onSave={(v) =>
                update(s, 'content', c.id, { attributes: { ...(c.attributes ?? {}), topic: v || null } })
              }
              ariaLabel={t('content.topic')}
            />
          </div>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={!!c.attributes?.hasDialogue}
            onChange={(e) =>
              void update(s, 'content', c.id, {
                attributes: { ...(c.attributes ?? {}), hasDialogue: e.target.checked },
              })
            }
          />{' '}
          {t('content.has_dialogue')}
        </label>
        <div className="field">
          <span className="lbl">{t('ideas.cast')}</span>
          <TagEditor
            value={c.attributes?.cast}
            onChange={(v) =>
              void update(s, 'content', c.id, { attributes: { ...(c.attributes ?? {}), cast: v } })
            }
            labelKey="common.person"
          />
        </div>
        <div className="field">
          <span className="lbl">{t('content.ai_models')}</span>
          <TagEditor
            value={c.attributes?.aiModels}
            onChange={(v) =>
              void update(s, 'content', c.id, { attributes: { ...(c.attributes ?? {}), aiModels: v } })
            }
            labelKey="common.model"
          />
        </div>
        <div className="field">
          <span className="lbl">{t('common.tags')}</span>
          <TagEditor value={c.tags} onChange={(v) => void update(s, 'content', c.id, { tags: v })} />
        </div>
      </details>
      <details className="box">
        <summary className="lbl">{t('common.history')}</summary>
        <HistoryList recordId={c.id} />
      </details>
    </aside>
  );

  return (
    <div className="page" style={{ maxWidth: 1440 }}>
      <PageHeader
        back
        title={t('content.sheet')}
        sub={
          c.ideaId ? (
            <>
              <Link to="/ideas/$id" params={{ id: c.ideaId }}>
                {t('content.from_idea')}
              </Link>
            </>
          ) : undefined
        }
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() =>
                void togglePin(s, { entity: 'content', id: c.id }).then((r) =>
                  toast(
                    r === 'full'
                      ? t('today.focus_full')
                      : r === 'pinned'
                        ? t('content.pinned')
                        : t('content.unpinned'),
                  ),
                )
              }
            >
              <Pin size={15} /> {t('today.focus')}
            </Button>
            <Button
              variant="ghost"
              className="hide-mobile"
              onClick={() => toggleSecretary({ intent: 'producer', focus: { entity: 'content', id: c.id } })}
            >
              <Sparkles size={15} /> {t('content.whats_missing')}
            </Button>
            <RecordMenu
              label={t('content.actions')}
              items={archiveTrashItems(s, 'content', c, () => void navigate({ to: '/content' }))}
            />
          </>
        }
      />
      <ArchivedNotice rec={c} table="content" />
      <ConflictNotice recordId={c.id} table="content" />
      {phone && quickActions}
      <div className="sheet">
        <nav className="sheet-rail" aria-label={t('content.sheet_sections')}>
          {sections.map((sec) => {
            const done = sectionComplete(sec, derivIn);
            return (
              <button key={sec} type="button" onClick={() => openSheetSection(sec)}>
                <span className={`sec-dot ${done ? 'done' : c._stage === sec ? 'part' : ''}`} aria-hidden />
                {t(`section.${sec}`)}
                <span className="sr-only">{done ? `(${t('common.done_lower')})` : ''}</span>
              </button>
            );
          })}
          <button type="button" onClick={() => openSheetSection('results')}>
            <span className="sec-dot" aria-hidden />
            {t('projects.tab.results')}
          </button>
        </nav>
        <div>
          <AutoText
            value={c.title}
            onSave={(v) => update(s, 'content', c.id, { title: v }, { coalesceKey: `c:${c.id}:title` })}
            className="title plain"
            ariaLabel={t('content.title_label')}
            placeholder={t('common.untitled')}
          />
          {!phone && <div style={{ marginTop: 8 }}>{quickActions}</div>}
          {sections.includes('concept') && (
            <ConceptSection b={bundle} edit={edit} done={sectionComplete('concept', derivIn)} />
          )}
          {sections.includes('references') && (
            <ReferencesSection b={bundle} done={sectionComplete('references', derivIn)} />
          )}
          {sections.includes('generate') && (
            <GenerateSection b={bundle} edit={edit} done={sectionComplete('generate', derivIn)} />
          )}
          {sections.includes('edit') && (
            <EditSection b={bundle} edit={edit} done={sectionComplete('edit', derivIn)} />
          )}
          {sections.includes('package') && (
            <PackageSection b={bundle} edit={edit} done={sectionComplete('package', derivIn)} />
          )}
          <PublishSection b={bundle} done={sectionComplete('publish', derivIn)} />
          <ResultsSection b={bundle} />
        </div>
        {inspector}
      </div>
      <Sheet
        open={blockOpen}
        onClose={() => setBlockOpen(false)}
        title={t('content.what_blocking')}
        footer={
          <Button
            variant="primary"
            disabled={!blockReason.trim()}
            onClick={async () => {
              await flagBlocked(s, c, blockReason.trim());
              setBlockReason('');
              setBlockOpen(false);
              toast(t('content.blocker_added'));
            }}
          >
            {t('h.blocked')}
          </Button>
        }
      >
        <input
          className="input"
          autoFocus
          value={blockReason}
          onChange={(e) => setBlockReason(e.target.value)}
          placeholder={t('content.blocker_placeholder')}
          aria-label={t('content.blocker_reason')}
        />
        <div className="chips">
          {(['ref', 'voice', 'cover', 'script', 'gen', 'date'] as const)
            .map((k) => t(`blocker.${k}`))
            .map((r) => (
              <button key={r} type="button" className="chip" onClick={() => setBlockReason(r)}>
                {r}
              </button>
            ))}
        </div>
      </Sheet>
    </div>
  );
}
