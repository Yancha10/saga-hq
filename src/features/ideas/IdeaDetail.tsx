import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { Clapperboard, GitBranch, Sparkles, Star } from 'lucide-react';
import { useState } from 'react';
import { useApp, useLive, useSession } from '../../app/context';
import { toast } from '../../app/status';
import { createVariant, ideaToContent } from '../../data/domain';
import type { Idea, Platform } from '../../data/schema';
import { update } from '../../data/store';
import { AutoText, Button, Empty, Pill, Section, Sheet } from '../../ui/kit';
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
} from '../common';
import { IdeaLab } from './IdeaLab';

const SCORE_DIMS = [
  { k: 'hook', label: 'Hook' },
  { k: 'originality', label: 'Originality' },
  { k: 'effort', label: 'Ease (low effort)' },
  { k: 'timeliness', label: 'Timeliness' },
  { k: 'fit', label: 'Strategic fit' },
] as const;

export function IdeaDetail() {
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
        <Empty title="Idea not found">It may have been deleted permanently.</Empty>
      </div>
    );
  const up = (patch: Partial<Idea>, key?: string) =>
    update(s, 'ideas', idea.id, patch, key ? { coalesceKey: `idea:${idea.id}:${key}` } : undefined);

  return (
    <div className="page narrow" style={{ maxWidth: 1180 }}>
      <PageHeader
        back
        title="Idea"
        sub={
          parent ? (
            <>
              Variant of{' '}
              <Link to="/ideas/$id" params={{ id: parent.id }}>
                {parent.title}
              </Link>
            </>
          ) : idea.origin?.source === 'capture' ? (
            'From a capture'
          ) : undefined
        }
        actions={
          <>
            <Button
              onClick={() => void up({ status: idea.status === 'shortlisted' ? 'new' : 'shortlisted' })}
            >
              <Star size={15} fill={idea.status === 'shortlisted' ? 'currentColor' : 'none'} />{' '}
              {idea.status === 'shortlisted' ? 'Shortlisted' : 'Shortlist'}
            </Button>
            <Button variant="primary" onClick={() => setMakeOpen(true)}>
              <Clapperboard size={15} /> Make content
            </Button>
            <RecordMenu
              label="Idea actions"
              items={[
                {
                  id: 'park',
                  label: idea.status === 'parked' ? 'Unpark' : 'Park',
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
            ariaLabel="Idea title"
            placeholder="Idea title"
          />
          <div className="field">
            <span className="lbl">Raw idea</span>
            <AutoText
              multiline
              value={idea.raw}
              onSave={(v) => up({ raw: v || null }, 'raw')}
              ariaLabel="Raw idea"
              placeholder="The thought as it came…"
            />
          </div>
          <div className="field">
            <span className="lbl">Hook</span>
            <AutoText
              value={idea.hook}
              onSave={(v) => up({ hook: v || null }, 'hook')}
              ariaLabel="Hook"
              placeholder="The first second / first line"
            />
          </div>
          <div className="field">
            <span className="lbl">Concept</span>
            <AutoText
              multiline
              value={idea.concept}
              onSave={(v) => up({ concept: v || null }, 'concept')}
              ariaLabel="Concept"
              placeholder="What happens, the story, the twist…"
              rows={4}
            />
          </div>
          <div className="field">
            <span className="lbl">Why it may work</span>
            <AutoText
              multiline
              value={idea.whyItWorks}
              onSave={(v) => up({ whyItWorks: v || null }, 'why')}
              ariaLabel="Why it may work"
              rows={2}
            />
          </div>
          <Section title="References">
            <References fromType="idea" fromId={idea.id} projectId={idea.projectId} />
          </Section>
          <Section
            title="Variants"
            count={variants.length}
            action={
              <Button size="sm" onClick={() => setVariantOpen(true)}>
                <GitBranch size={14} /> New variant
              </Button>
            }
          >
            {variants.length ? (
              <div className="list">
                {variants.map((v) => (
                  <Link key={v.id} to="/ideas/$id" params={{ id: v.id }} className="row">
                    <div className="grow">
                      <div className="title">{v.title}</div>
                      <div className="sub">
                        {v.variantLabel}
                        {v.origin?.source === 'ai' ? ' · ✧ AI-suggested, user-kept' : ''}
                      </div>
                    </div>
                    <Pill>{v.status}</Pill>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="meta">Branch the idea without touching the original.</div>
            )}
          </Section>
          <Section title="Notes">
            <AutoText
              multiline
              value={idea.notes}
              onSave={(v) => up({ notes: v || null }, 'notes')}
              ariaLabel="Notes"
            />
          </Section>
        </div>
        <div className="stack">
          <div className="box">
            <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="field">
                <label className="lbl" htmlFor="istatus">
                  Status
                </label>
                <select
                  id="istatus"
                  className="select"
                  value={idea.status}
                  onChange={(e) => void up({ status: e.target.value as Idea['status'] })}
                >
                  <option value="new">New</option>
                  <option value="shortlisted">Shortlisted</option>
                  <option value="committed">In content</option>
                  <option value="parked">Parked</option>
                </select>
              </div>
              <div className="field">
                <label className="lbl" htmlFor="iprio">
                  Priority
                </label>
                <select
                  id="iprio"
                  className="select"
                  value={idea.priority ?? ''}
                  onChange={(e) => void up({ priority: (e.target.value || null) as Idea['priority'] })}
                >
                  <option value="">None</option>
                  <option value="low">Low</option>
                  <option value="med">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label className="lbl" htmlFor="iproj">
                  Project
                </label>
                <ProjectSelect
                  id="iproj"
                  value={idea.projectId}
                  onChange={(v) => void up({ projectId: v })}
                />
              </div>
              <div className="field">
                <span className="lbl">Format</span>
                <AutoText
                  value={idea.format}
                  onSave={(v) => up({ format: v || null })}
                  ariaLabel="Format"
                  placeholder="15s reel, carousel…"
                />
              </div>
              <div className="field">
                <span className="lbl">Tone</span>
                <AutoText
                  value={idea.tone}
                  onSave={(v) => up({ tone: v || null })}
                  ariaLabel="Tone"
                  placeholder="funny, dark…"
                />
              </div>
            </div>
            <div className="field">
              <span className="lbl">Platforms</span>
              <PlatformPicker value={idea.platforms ?? []} onChange={(v) => void up({ platforms: v })} />
            </div>
            <div className="field">
              <span className="lbl">Characters / people</span>
              <TagEditor value={idea.cast} onChange={(v) => void up({ cast: v })} label="Person" />
            </div>
            <div className="field">
              <span className="lbl">Tags</span>
              <TagEditor value={idea.tags} onChange={(v) => void up({ tags: v })} />
            </div>
            {ws?.scoringEnabled && (
              <div className="field">
                <span className="lbl">Scores (optional, your judgement)</span>
                {SCORE_DIMS.map((d) => {
                  const sc = idea.scores?.[d.k];
                  return (
                    <div key={d.k} className="hstack" style={{ justifyContent: 'space-between' }}>
                      <span className="meta">
                        {d.label}
                        {sc?.by === 'ai' ? ' (AI, unconfirmed)' : ''}
                      </span>
                      <span className="chips" role="group" aria-label={d.label}>
                        {([1, 2, 3] as const).map((n) => (
                          <button
                            key={n}
                            type="button"
                            className="chip"
                            aria-pressed={sc?.value === n}
                            onClick={() =>
                              void up({ scores: { ...(idea.scores ?? {}), [d.k]: { value: n, by: 'user' } } })
                            }
                          >
                            {['low', 'med', 'high'][n - 1]}
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
              <h4>Became content</h4>
              {contents.map((c) => (
                <Link key={c.id} to="/content/$id" params={{ id: c.id }} className="hstack">
                  {c.title} <Pill>{c.status}</Pill>
                </Link>
              ))}
            </div>
          )}
          <IdeaLab idea={idea} />
          <Button
            variant="ghost"
            onClick={() => toggleSecretary({ intent: 'creative', focus: { entity: 'idea', id: idea.id } })}
          >
            <Sparkles size={15} /> Discuss with Secretary
          </Button>
          <details>
            <summary className="meta">History</summary>
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
        title="New variant"
        footer={
          <Button
            variant="primary"
            onClick={async () => {
              const v = await createVariant(s, idea, variantLabel.trim() || `Version ${variants.length + 2}`);
              setVariantOpen(false);
              setVariantLabel('');
              void navigate({ to: '/ideas/$id', params: { id: v.id } });
            }}
          >
            Create variant
          </Button>
        }
      >
        <div className="field">
          <label className="lbl" htmlFor="vlabel">
            Label
          </label>
          <input
            id="vlabel"
            className="input"
            autoFocus
            placeholder="e.g. Darker, 15s cut, different ending"
            value={variantLabel}
            onChange={(e) => setVariantLabel(e.target.value)}
          />
        </div>
        <p className="meta">The variant copies the hook and concept. The original idea is never changed.</p>
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
  const s = useSession();
  const ws = useLive((ss) => ss.db.workspace.get('workspace'), [], undefined);
  const [tpl, setTpl] = useState('reel');
  const [platforms, setPlatforms] = useState<Platform[] | null>(null);
  const [projectId, setProjectId] = useState<string | null | undefined>(undefined);
  const template = ws?.formatTemplates.find((t) => t.id === tpl);
  const plats = platforms ?? (idea.platforms?.length ? idea.platforms : (template?.platforms ?? []));
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Turn idea into content"
      footer={
        <Button
          variant="primary"
          onClick={async () => {
            const c = await ideaToContent(s, idea, {
              formatTemplateId: tpl,
              platforms: plats,
              projectId: projectId === undefined ? idea.projectId : projectId,
            });
            toast('Content created — the idea is kept and linked');
            onClose();
            onDone(c.id);
          }}
        >
          Create content
        </Button>
      }
    >
      <div className="field">
        <label className="lbl" htmlFor="mformat">
          Format
        </label>
        <select id="mformat" className="select" value={tpl} onChange={(e) => setTpl(e.target.value)}>
          {(ws?.formatTemplates ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <span className="lbl">Platforms</span>
        <PlatformPicker value={plats} onChange={setPlatforms} />
      </div>
      <div className="field">
        <span className="lbl">Project</span>
        <ProjectSelect value={projectId === undefined ? idea.projectId : projectId} onChange={setProjectId} />
      </div>
      <p className="meta">
        Hook, concept, cast and references are carried over. You can create several pieces from one idea.
      </p>
    </Sheet>
  );
}
