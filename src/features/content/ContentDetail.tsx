import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { ArrowRight, CheckCircle2, ImagePlus, Link2, ListPlus, Pin, Sparkles, Type } from 'lucide-react';
import { useState } from 'react';
import { useApp, useIsPhone, useLive, useSession } from '../../app/context';
import { toast } from '../../app/status';
import { MISSING_LABEL, SECTION_LABEL, sectionComplete } from '../../data/derive';
import { editContent, flagBlocked, moveToTomorrow, setContentStatus, togglePin } from '../../data/domain';
import { CONTENT_STATUS_LABEL, CONTENT_STATUSES, type Content, type SheetSection } from '../../data/schema';
import { undoLast, update } from '../../data/store';
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
} from '../common';
import {
  ConceptSection,
  EditSection,
  GenerateSection,
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
        tasks: tasks.filter((t) => !t.deletedAt),
        publications: publications.filter((p) => !p.deletedAt),
        links: links.filter((l) => !l.deletedAt),
        snapshots: snapshots.filter((x) => !x.deletedAt),
        ws,
        template: ws?.formatTemplates.find((t) => t.id === content.formatTemplateId),
      };
    },
    [id],
    undefined,
  );
}
export type Bundle = NonNullable<ReturnType<typeof useContentBundle>> & { content: Content };

export function ContentDetail() {
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
        <Empty title="Content not found">It may have been deleted permanently.</Empty>
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
      toast('Moved to Producing', { action: { label: 'Undo', run: () => void undoLast(s) } });
  };
  const missing = (c._missing ?? []).filter((m) => m !== 'publishDate' || c.status !== 'published');
  const blockers = bundle.tasks.filter((t) => t.isBlocker && t.status !== 'done');

  const quickActions = (
    <div className="hstack" style={{ marginBottom: 12, gap: 6 }}>
      <Button
        size="sm"
        onClick={() =>
          void setContentStatus(s, c, 'ready').then(() =>
            toast(missing.length ? `Ready — ${missing.length} item(s) still missing` : 'Marked Ready'),
          )
        }
      >
        <CheckCircle2 size={14} /> Ready
      </Button>
      <a className="btn sm" href="#sec-package">
        <Type size={14} /> Caption
      </a>
      <a className="btn sm" href="#sec-package">
        <ImagePlus size={14} /> Cover
      </a>
      {c._nextPublishAt && (
        <Button
          size="sm"
          onClick={() =>
            void moveToTomorrow(s, c).then(() =>
              toast('Moved to tomorrow', { action: { label: 'Undo', run: () => void undoLast(s) } }),
            )
          }
        >
          <ArrowRight size={14} /> Tomorrow
        </Button>
      )}
      <a className="btn sm" href="#sec-references">
        <Link2 size={14} /> Reference
      </a>
      <a className="btn sm" href="#tasks">
        <ListPlus size={14} /> Task
      </a>
      <Button
        size="sm"
        onClick={() => toggleSecretary({ intent: 'producer', focus: { entity: 'content', id: c.id } })}
      >
        <Sparkles size={14} /> Ask
      </Button>
    </div>
  );

  const inspector = (
    <aside className="inspector" aria-label="Content details">
      <div className="box">
        <div className="hstack">
          <ContentStatus c={c} />
          <span className="spacer" />
          <span className="meta num">{Math.round((c._readyPct ?? 0) * 100)}% ready</span>
        </div>
        <Progress value={c._readyPct ?? 0} />
        {missing.length > 0 ? (
          <div className="meta">
            Missing: {missing.map((m) => MISSING_LABEL[m as keyof typeof MISSING_LABEL]).join(', ')}
          </div>
        ) : (
          <div className="meta" style={{ color: 'var(--ok)' }}>
            Everything required is in place.
          </div>
        )}
        <div className="field">
          <label className="lbl" htmlFor="cst">
            Status
          </label>
          <select
            id="cst"
            className="select"
            value={c.status}
            onChange={(e) => void setContentStatus(s, c, e.target.value as Content['status'])}
          >
            {CONTENT_STATUSES.map((st) => (
              <option key={st} value={st}>
                {CONTENT_STATUS_LABEL[st]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="lbl" htmlFor="cproj">
            Project
          </label>
          <ProjectSelect
            id="cproj"
            value={c.projectId}
            onChange={(v) => void update(s, 'content', c.id, { projectId: v })}
          />
        </div>
        <div className="field">
          <label className="lbl" htmlFor="cfmt">
            Format
          </label>
          <select
            id="cfmt"
            className="select"
            value={c.formatTemplateId}
            onChange={(e) => void update(s, 'content', c.id, { formatTemplateId: e.target.value })}
          >
            {(bundle.ws?.formatTemplates ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="lbl">Platforms</span>
          <PlatformPicker
            value={c.platforms}
            onChange={(v) => void update(s, 'content', c.id, { platforms: v })}
          />
        </div>
        <div className="field">
          <label className="lbl" htmlFor="cprio">
            Priority
          </label>
          <select
            id="cprio"
            className="select"
            value={c.priority ?? ''}
            onChange={(e) =>
              void update(s, 'content', c.id, { priority: (e.target.value || null) as Content['priority'] })
            }
          >
            <option value="">None</option>
            <option value="low">Low</option>
            <option value="med">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
      </div>
      <div className="box" id="tasks">
        <div className="hstack">
          <h4 style={{ flex: 1 }}>Tasks & blockers</h4>
          <Button size="sm" variant="ghost" onClick={() => setBlockOpen(true)}>
            Flag blocked
          </Button>
        </div>
        {blockers.length > 0 && (
          <div className="meta" style={{ color: 'var(--warn)' }}>
            Blocked by: {blockers.map((t) => t.title).join(' · ')}
          </div>
        )}
        <div className="list">
          {bundle.tasks
            .filter((t) => t.status !== 'done')
            .map((t) => (
              <TaskRow key={t.id} t={t} showParent={false} />
            ))}
          <QuickTask parent={{ contentId: c.id, projectId: c.projectId }} />
        </div>
      </div>
      <div className="box">
        <h4>Attributes for learning (optional)</h4>
        <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="field">
            <label className="lbl" htmlFor="ahook">
              Hook type
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
              <option value="question">Question</option>
              <option value="dialogue">Dialogue</option>
              <option value="cold_open">Cold open</option>
              <option value="reveal">Reveal</option>
              <option value="text">Text hook</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="field">
            <label className="lbl" htmlFor="adur">
              Duration (s)
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
            <span className="lbl">Tone</span>
            <AutoText
              value={c.attributes?.tone}
              onSave={(v) =>
                update(s, 'content', c.id, { attributes: { ...(c.attributes ?? {}), tone: v || null } })
              }
              ariaLabel="Tone"
            />
          </div>
          <div className="field">
            <span className="lbl">Topic</span>
            <AutoText
              value={c.attributes?.topic}
              onSave={(v) =>
                update(s, 'content', c.id, { attributes: { ...(c.attributes ?? {}), topic: v || null } })
              }
              ariaLabel="Topic"
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
          Has dialogue
        </label>
        <div className="field">
          <span className="lbl">Cast</span>
          <TagEditor
            value={c.attributes?.cast}
            onChange={(v) =>
              void update(s, 'content', c.id, { attributes: { ...(c.attributes ?? {}), cast: v } })
            }
            label="Person"
          />
        </div>
        <div className="field">
          <span className="lbl">AI models used</span>
          <TagEditor
            value={c.attributes?.aiModels}
            onChange={(v) =>
              void update(s, 'content', c.id, { attributes: { ...(c.attributes ?? {}), aiModels: v } })
            }
            label="Model"
          />
        </div>
        <div className="field">
          <span className="lbl">Tags</span>
          <TagEditor value={c.tags} onChange={(v) => void update(s, 'content', c.id, { tags: v })} />
        </div>
      </div>
      <details className="box">
        <summary className="lbl">History</summary>
        <HistoryList recordId={c.id} />
      </details>
    </aside>
  );

  return (
    <div className="page" style={{ maxWidth: 1440 }}>
      <PageHeader
        back
        title="Production sheet"
        sub={
          c.ideaId ? (
            <>
              From{' '}
              <Link to="/ideas/$id" params={{ id: c.ideaId }}>
                idea
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
                    r === 'full' ? 'Focus holds 3 items' : r === 'pinned' ? 'Pinned to Focus' : 'Unpinned',
                  ),
                )
              }
            >
              <Pin size={15} /> Focus
            </Button>
            <Button
              variant="ghost"
              className="hide-mobile"
              onClick={() => toggleSecretary({ intent: 'producer', focus: { entity: 'content', id: c.id } })}
            >
              <Sparkles size={15} /> What’s missing?
            </Button>
            <RecordMenu
              label="Content actions"
              items={archiveTrashItems(s, 'content', c, () => void navigate({ to: '/content' }))}
            />
          </>
        }
      />
      <ArchivedNotice rec={c} table="content" />
      <ConflictNotice recordId={c.id} table="content" />
      {phone && quickActions}
      <div className="sheet">
        <nav className="sheet-rail" aria-label="Production sheet sections">
          {sections.map((sec) => {
            const done = sectionComplete(sec, derivIn);
            return (
              <a key={sec} href={`#sec-${sec}`}>
                <span className={`sec-dot ${done ? 'done' : c._stage === sec ? 'part' : ''}`} aria-hidden />
                {SECTION_LABEL[sec]}
                <span className="sr-only">{done ? '(done)' : ''}</span>
              </a>
            );
          })}
          <a href="#sec-results">
            <span className="sec-dot" aria-hidden />
            Results
          </a>
        </nav>
        <div>
          <AutoText
            value={c.title}
            onSave={(v) =>
              update(
                s,
                'content',
                c.id,
                { title: v || 'Untitled content' },
                { coalesceKey: `c:${c.id}:title` },
              )
            }
            className="title plain"
            ariaLabel="Content title"
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
        title="What is blocking this?"
        footer={
          <Button
            variant="primary"
            disabled={!blockReason.trim()}
            onClick={async () => {
              await flagBlocked(s, c, blockReason.trim());
              setBlockReason('');
              setBlockOpen(false);
              toast('Blocker added — it shows on Today until resolved');
            }}
          >
            Flag blocked
          </Button>
        }
      >
        <input
          className="input"
          autoFocus
          value={blockReason}
          onChange={(e) => setBlockReason(e.target.value)}
          placeholder="e.g. Waiting for voice, need reference image"
          aria-label="Blocker reason"
        />
        <div className="chips">
          {[
            'Need reference image',
            'Waiting for voice',
            'Cover missing',
            'Need script decision',
            'Generation failed',
            'Need publish date',
          ].map((r) => (
            <button key={r} type="button" className="chip" onClick={() => setBlockReason(r)}>
              {r}
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}
