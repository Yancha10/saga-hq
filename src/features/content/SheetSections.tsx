import { Link } from '@tanstack/react-router';
import { Check, Clipboard, Download, Plus, Send, Trash2, Upload } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { useLive, useSession } from '../../app/context';
import { toast } from '../../app/status';
import { ulid } from '../../core/ulid';
import { safeHttpUrl } from '../../core/url';
import { median } from '../../core/util';
import { SECTION_LABEL } from '../../data/derive';
import { logSnapshot, markPublished, schedulePublication } from '../../data/domain';
import {
  type Content,
  PLATFORM_LABEL,
  PLATFORMS,
  type Platform,
  type Publication,
  type SheetSection,
  type Shot,
} from '../../data/schema';
import { update } from '../../data/store';
import { addMedia, mediaUrl } from '../../media/store';
import { fromLocalInput, toLocalInput } from '../../rules/time';
import { AutoText, Button, IconButton, Pill, Sheet } from '../../ui/kit';
import { ExtLink, MediaThumb, References, TagEditor } from '../common';
import { LearningEditor } from '../insights/LearningEditor';
import { MetricsForm } from '../insights/MetricsForm';
import { StudioHandoffSheet } from '../studio/StudioHandoffSheet';
import type { Bundle } from './ContentDetail';

type Edit = (patch: Partial<Content>, key?: string) => Promise<void>;

function SecHead({
  sec,
  b,
  done,
  children,
  title,
}: {
  sec: SheetSection | 'results';
  b: Bundle;
  done?: boolean;
  children?: ReactNode;
  title?: string;
}) {
  const s = useSession();
  const c = b.content;
  const manual = sec !== 'results' && !!c.sectionDone?.[sec];
  return (
    <header>
      <h3>
        {sec !== 'results' && (
          <span className={`sec-dot ${done ? 'done' : c._stage === sec ? 'part' : ''}`} aria-hidden />
        )}
        {title ?? SECTION_LABEL[sec as SheetSection]}
        {sec !== 'results' && done && <span className="sr-only"> (complete)</span>}
      </h3>
      {children}
      {sec !== 'results' && (
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={manual}
          onClick={() =>
            void update(s, 'content', c.id, { sectionDone: { ...(c.sectionDone ?? {}), [sec]: !manual } })
          }
        >
          {manual ? <Check size={13} /> : null} {manual ? 'Marked done' : 'Mark done'}
        </Button>
      )}
    </header>
  );
}

export function ConceptSection({ b, edit, done }: { b: Bundle; edit: Edit; done: boolean }) {
  const c = b.content;
  const words = (c.script ?? '').trim().split(/\s+/).filter(Boolean).length;
  return (
    <section className="sheet-sec" id="sec-concept" aria-label="Concept">
      <SecHead sec="concept" b={b} done={done} />
      <div className="stack">
        <div className="field">
          <span className="lbl">Hook</span>
          <AutoText
            value={c.hook}
            onSave={(v) => edit({ hook: v || null }, 'hook')}
            ariaLabel="Hook"
            placeholder="The first second"
          />
        </div>
        <div className="field">
          <span className="lbl">Concept</span>
          <AutoText
            multiline
            value={c.concept}
            onSave={(v) => edit({ concept: v || null }, 'concept')}
            ariaLabel="Concept"
            placeholder="What happens"
            rows={3}
          />
        </div>
        <div className="field">
          <span className="lbl">Script</span>
          <AutoText
            multiline
            value={c.script}
            onSave={(v) => edit({ script: v || null }, 'script')}
            ariaLabel="Script"
            placeholder="Lines, beats, dialogue…"
            rows={6}
          />
          <span className="hint num">
            {words} words · ~{Math.round(words / 2.5)}s spoken
          </span>
        </div>
        <div className="form-grid">
          <div className="field">
            <span className="lbl">Objective</span>
            <AutoText
              value={c.objective}
              onSave={(v) => edit({ objective: v || null }, 'obj')}
              ariaLabel="Objective"
            />
          </div>
          <div className="field">
            <span className="lbl">Audience</span>
            <AutoText
              value={c.audience}
              onSave={(v) => edit({ audience: v || null }, 'aud')}
              ariaLabel="Audience"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

export function ReferencesSection({ b, done }: { b: Bundle; done: boolean }) {
  return (
    <section className="sheet-sec" id="sec-references" aria-label="References">
      <SecHead sec="references" b={b} done={done} />
      <References fromType="content" fromId={b.content.id} projectId={b.content.projectId} />
    </section>
  );
}

export function GenerateSection({ b, edit, done }: { b: Bundle; edit: Edit; done: boolean }) {
  const s = useSession();
  const c = b.content;
  const shots = (c.shots ?? []).filter((x) => !x.deleted).sort((a, x) => a.order - x.order);
  const [handoff, setHandoff] = useState<Shot | 'content' | null>(null);
  const setShot = (id: string, patch: Partial<Shot>) =>
    edit(
      { shots: (c.shots ?? []).map((x) => (x.id === id ? { ...x, ...patch, rev: s.hlc.now() } : x)) },
      `shot:${id}:${Object.keys(patch).join()}`,
    );
  const addShot = () =>
    edit({
      shots: [
        ...(c.shots ?? []),
        {
          id: ulid(),
          order: (shots.at(-1)?.order ?? 0) + 1,
          description: '',
          referenceIds: [],
          status: 'todo',
          rev: s.hlc.now(),
        },
      ],
    });
  return (
    <section className="sheet-sec" id="sec-generate" aria-label="Generate">
      <SecHead sec="generate" b={b} done={done}>
        <Button size="sm" onClick={() => setHandoff('content')}>
          <Send size={13} /> Open in Saga Studio
        </Button>
      </SecHead>
      <div className="stack">
        <div className="field">
          <span className="lbl">Production notes</span>
          <AutoText
            multiline
            value={c.productionNotes}
            onSave={(v) => edit({ productionNotes: v || null }, 'pnotes')}
            ariaLabel="Production notes"
            placeholder="Prompts, models, characters, approach…"
            rows={2}
          />
        </div>
        {shots.length === 0 ? (
          <div className="hstack">
            <span className="meta">Simple piece? Skip shots. Multi-shot production?</span>
            <Button size="sm" onClick={() => void addShot()}>
              <Plus size={13} /> Add shot structure
            </Button>
          </div>
        ) : (
          <div className="stack">
            {shots.map((sh, i) => (
              <div key={sh.id} className="box">
                <div className="hstack">
                  <strong>Shot {String(i + 1).padStart(2, '0')}</strong>
                  <select
                    className="select"
                    style={{ width: 130, minHeight: 28 }}
                    aria-label={`Shot ${i + 1} status`}
                    value={sh.status}
                    onChange={(e) => void setShot(sh.id, { status: e.target.value as Shot['status'] })}
                  >
                    <option value="todo">To do</option>
                    <option value="generating">Generating</option>
                    <option value="selected">Selected</option>
                    <option value="final">Final</option>
                  </select>
                  <span className="spacer" />
                  <Button size="sm" variant="ghost" onClick={() => setHandoff(sh)}>
                    <Send size={13} /> Studio
                  </Button>
                  <IconButton
                    label={`Remove shot ${i + 1}`}
                    size="sm"
                    onClick={() =>
                      void edit({
                        shots: (c.shots ?? []).map((x) =>
                          x.id === sh.id ? { ...x, deleted: true, rev: s.hlc.now() } : x,
                        ),
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </IconButton>
                </div>
                <AutoText
                  multiline
                  value={sh.description}
                  onSave={(v) => setShot(sh.id, { description: v })}
                  ariaLabel={`Shot ${i + 1} description`}
                  placeholder="What we see"
                  rows={2}
                />
                <div className="form-grid">
                  <div className="field">
                    <span className="lbl">Dialogue</span>
                    <AutoText
                      value={sh.dialogue}
                      onSave={(v) => setShot(sh.id, { dialogue: v || null })}
                      ariaLabel={`Shot ${i + 1} dialogue`}
                    />
                  </div>
                  <div className="field">
                    <span className="lbl">Duration (s)</span>
                    <input
                      type="number"
                      min={0}
                      className="input"
                      value={sh.durationSec ?? ''}
                      aria-label={`Shot ${i + 1} duration`}
                      onChange={(e) =>
                        void setShot(sh.id, { durationSec: e.target.value ? Number(e.target.value) : null })
                      }
                    />
                  </div>
                </div>
                <div className="field">
                  <span className="lbl">Prompt</span>
                  <AutoText
                    multiline
                    value={sh.prompt}
                    onSave={(v) => setShot(sh.id, { prompt: v || null })}
                    ariaLabel={`Shot ${i + 1} prompt`}
                    rows={2}
                  />
                </div>
                <div className="field">
                  <span className="lbl">Selected output (URL)</span>
                  <AutoText
                    value={sh.selectedOutput}
                    onSave={(v) =>
                      setShot(sh.id, {
                        selectedOutput: v || null,
                        ...(v ? { status: sh.status === 'final' ? 'final' : 'selected' } : {}),
                      })
                    }
                    ariaLabel={`Shot ${i + 1} selected output`}
                    placeholder="https://…"
                  />
                  {sh.selectedOutput && <ExtLink href={sh.selectedOutput} />}
                </div>
              </div>
            ))}
            <div>
              <Button size="sm" onClick={() => void addShot()}>
                <Plus size={13} /> Add shot
              </Button>
            </div>
          </div>
        )}
      </div>
      <StudioHandoffSheet
        open={handoff !== null}
        onClose={() => setHandoff(null)}
        b={b}
        shot={handoff && handoff !== 'content' ? handoff : undefined}
      />
    </section>
  );
}

function UploadButton({
  label,
  accept,
  onFile,
}: {
  label: string;
  accept: string;
  onFile: (f: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button size="sm" onClick={() => ref.current?.click()}>
        <Upload size={13} /> {label}
      </Button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />
    </>
  );
}

export function EditSection({ b, edit, done }: { b: Bundle; edit: Edit; done: boolean }) {
  const s = useSession();
  const c = b.content;
  return (
    <section className="sheet-sec" id="sec-edit" aria-label="Edit">
      <SecHead sec="edit" b={b} done={done} />
      <div className="stack">
        <div className="field">
          <span className="lbl">Final export</span>
          <div className="hstack">
            <div style={{ flex: 1, minWidth: 200 }}>
              <AutoText
                value={c.finalExportUrl}
                onSave={(v) => edit({ finalExportUrl: v || null }, 'export')}
                ariaLabel="Final export URL"
                placeholder="Link to the final file (Drive, Studio output…)"
              />
            </div>
            <UploadButton
              label="Attach file"
              accept="image/*,video/*"
              onFile={async (f) => {
                try {
                  const m = await addMedia(s, f, f.name);
                  await edit({ finalExportMediaId: m.id });
                } catch (e) {
                  toast((e as Error).message, { kind: 'error' });
                }
              }}
            />
          </div>
          {c.finalExportMediaId && (
            <span className="hint">File attached ({c.finalExportMediaId.slice(-6)}).</span>
          )}
          <span className="hint">
            Large videos: link them instead of uploading — Saga HQ is not a video store.
          </span>
        </div>
        <div className="field">
          <span className="lbl">Edit notes</span>
          <AutoText
            multiline
            value={c.editNotes}
            onSave={(v) => edit({ editNotes: v || null }, 'enotes')}
            ariaLabel="Edit notes"
            placeholder="Clips, voice, music, transitions…"
            rows={2}
          />
        </div>
        <div className="field">
          <span className="lbl">Audio / music</span>
          <AutoText
            value={c.audioNote}
            onSave={(v) => edit({ audioNote: v || null }, 'audio')}
            ariaLabel="Audio"
          />
        </div>
      </div>
    </section>
  );
}

const CAPTION_LIMIT: Partial<Record<Platform, number>> = {
  instagram: 2200,
  tiktok: 2200,
  youtube: 5000,
  youtube_shorts: 5000,
  x: 280,
};

export function PackageSection({ b, edit, done }: { b: Bundle; edit: Edit; done: boolean }) {
  const s = useSession();
  const c = b.content;
  const len =
    (c.caption ?? '').length + (c.hashtags?.length ? c.hashtags.map((h) => `#${h}`).join(' ').length + 2 : 0);
  const fullCaption = [c.caption, c.hashtags?.length ? c.hashtags.map((h) => `#${h}`).join(' ') : '']
    .filter(Boolean)
    .join('\n\n');
  return (
    <section className="sheet-sec" id="sec-package" aria-label="Package">
      <SecHead sec="package" b={b} done={done} />
      <div className="grid2" style={{ gap: 16 }}>
        <div className="stack">
          <div className="field">
            <span className="lbl">Caption</span>
            <AutoText
              multiline
              value={c.caption}
              onSave={(v) => edit({ caption: v || null }, 'caption')}
              ariaLabel="Caption"
              rows={4}
            />
            <span className="hint num">
              {len} chars{' '}
              {c.platforms
                .filter((p) => CAPTION_LIMIT[p])
                .map((p) => (
                  <span key={p} style={{ color: len > CAPTION_LIMIT[p]! ? 'var(--danger)' : undefined }}>
                    · {PLATFORM_LABEL[p]} {CAPTION_LIMIT[p]}
                  </span>
                ))}
            </span>
          </div>
          <div className="field">
            <span className="lbl">Hashtags</span>
            <TagEditor value={c.hashtags} onChange={(v) => void edit({ hashtags: v })} label="Hashtag" />
          </div>
          <div>
            <Button
              size="sm"
              onClick={() =>
                void navigator.clipboard?.writeText(fullCaption).then(() => toast('Caption copied'))
              }
            >
              <Clipboard size={13} /> Copy caption
            </Button>
          </div>
        </div>
        <div className="stack">
          <div className="field">
            <span className="lbl">Cover</span>
            <div className="hstack">
              <MediaThumb mediaId={c.coverMediaId} url={c.coverUrl} alt="Cover" className="thumb-sm" />
              <UploadButton
                label="Upload cover"
                accept="image/*"
                onFile={async (f) => {
                  const m = await addMedia(s, f, f.name);
                  await edit({ coverMediaId: m.id });
                }}
              />
            </div>
            <AutoText
              value={c.coverUrl}
              onSave={(v) => edit({ coverUrl: v || null }, 'coverurl')}
              ariaLabel="Cover URL"
              placeholder="…or a link to the cover"
            />
          </div>
          <div className="field">
            <span className="lbl">Cover title</span>
            <AutoText
              value={c.coverText}
              onSave={(v) => edit({ coverText: v || null }, 'covertext')}
              ariaLabel="Cover title"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function PubRow({ b, p }: { b: Bundle; p: Publication }) {
  const s = useSession();
  const c = b.content;
  const [url, setUrl] = useState(p.url ?? '');
  const [askUrl, setAskUrl] = useState(false);
  const downloadCover = async () => {
    if (c.coverMediaId) {
      const u = await mediaUrl(s, c.coverMediaId, 'full');
      if (u) {
        const a = document.createElement('a');
        a.href = u;
        a.download = `${c.title.slice(0, 40) || 'cover'}`;
        a.click();
      }
    } else if (c.coverUrl && safeHttpUrl(c.coverUrl))
      window.open(safeHttpUrl(c.coverUrl)!, '_blank', 'noopener');
  };
  return (
    <div className="row static" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
      <strong style={{ width: 90 }}>{PLATFORM_LABEL[p.platform]}</strong>
      {p.status === 'published' ? (
        <>
          <Pill tone="ok" dot>
            Published{' '}
            {p.publishedAt
              ? new Date(p.publishedAt).toLocaleString(undefined, {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : ''}
          </Pill>
          {p.url && <ExtLink href={p.url} />}
        </>
      ) : (
        <>
          <input
            type="datetime-local"
            className="input"
            style={{ width: 210 }}
            aria-label={`${PLATFORM_LABEL[p.platform]} publish time`}
            value={toLocalInput(p.scheduledAt)}
            onChange={(e) => void schedulePublication(s, c, p.platform, fromLocalInput(e.target.value), p)}
          />
          <Button size="sm" variant="primary" onClick={() => setAskUrl(true)}>
            Mark published
          </Button>
          {(c.coverMediaId || c.coverUrl) && (
            <Button size="sm" variant="ghost" onClick={() => void downloadCover()}>
              <Download size={13} /> Cover
            </Button>
          )}
        </>
      )}
      <Sheet
        open={askUrl}
        onClose={() => setAskUrl(false)}
        title={`Published on ${PLATFORM_LABEL[p.platform]}`}
        footer={
          <Button
            variant="primary"
            onClick={async () => {
              await markPublished(s, c, p, safeHttpUrl(url) ?? null);
              setAskUrl(false);
              toast('Published — Today will remind you to log 24h and 7d results');
            }}
          >
            Save
          </Button>
        }
      >
        <div className="field">
          <label className="lbl" htmlFor="puburl">
            Post URL (optional, recommended)
          </label>
          <input
            id="puburl"
            className="input"
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
          />
        </div>
        <p className="meta">
          Saga HQ does not post for you — this records that you published, so results and learnings can attach
          to it.
        </p>
      </Sheet>
    </div>
  );
}

export function PublishSection({ b, done }: { b: Bundle; done: boolean }) {
  const s = useSession();
  const c = b.content;
  const missingPlatforms = c.platforms.filter((p) => !b.publications.some((x) => x.platform === p));
  return (
    <section className="sheet-sec" id="sec-publish" aria-label="Publish">
      <SecHead sec="publish" b={b} done={done} />
      <div className="stack">
        {b.publications.length > 0 && (
          <div className="list">
            {b.publications.map((p) => (
              <PubRow key={p.id} b={b} p={p} />
            ))}
          </div>
        )}
        <div className="hstack">
          {(missingPlatforms.length
            ? missingPlatforms
            : PLATFORMS.filter((p) => !b.publications.some((x) => x.platform === p))
          )
            .slice(0, 6)
            .map((p) => (
              <Button key={p} size="sm" onClick={() => void schedulePublication(s, c, p, null)}>
                <Plus size={13} /> {PLATFORM_LABEL[p]}
              </Button>
            ))}
        </div>
        {b.publications.length === 0 && (
          <span className="meta">
            Add a platform, then pick a date. Planning a publication never posts anything automatically.
          </span>
        )}
      </div>
    </section>
  );
}

export function ResultsSection({ b }: { b: Bundle }) {
  const s = useSession();
  const c = b.content;
  const published = b.publications.filter((p) => p.status === 'published');
  const [logFor, setLogFor] = useState<Publication | null>(null);
  const [learnOpen, setLearnOpen] = useState(false);
  const baseline = useLive(
    async (ss) => {
      const out: Record<string, { median?: number; n: number }> = {};
      for (const p of published) {
        const snaps = (await ss.db.snapshots.where('publicationId').notEqual(p.id).toArray()).filter(
          (x) =>
            !x.deletedAt &&
            x.platform === p.platform &&
            x.checkpoint === '24h' &&
            typeof x.metrics.views === 'number',
        );
        const vals = snaps.map((x) => x.metrics.views!);
        out[p.id] = { median: median(vals), n: vals.length };
      }
      return out;
    },
    [published.map((p) => p.id).join()],
    {} as Record<string, { median?: number; n: number }>,
  );
  const evidence = useLive(
    (ss) =>
      ss.db.links
        .where('toId')
        .equals(c.id)
        .toArray()
        .then((ls) => ls.filter((l) => !l.deletedAt && l.type === 'evidence')),
    [c.id],
    [],
  );
  return (
    <section className="sheet-sec" id="sec-results" aria-label="Results and learning">
      <SecHead sec="results" b={b} title="Results & learning">
        <Button size="sm" variant="ghost" onClick={() => setLearnOpen(true)}>
          Write learning
        </Button>
      </SecHead>
      {published.length === 0 ? (
        <div className="meta">
          Results appear after publication. Log a few numbers at 24h and 7d — that’s enough to learn.
        </div>
      ) : (
        <div className="stack">
          {published.map((p) => {
            const snaps = b.snapshots
              .filter((x) => x.publicationId === p.id)
              .sort((a, x) => a.observedAt.localeCompare(x.observedAt));
            const v24 = snaps.find((x) => x.checkpoint === '24h')?.metrics.views;
            const bl = baseline[p.id];
            return (
              <div key={p.id} className="box">
                <div className="hstack">
                  <strong>{PLATFORM_LABEL[p.platform]}</strong>
                  {v24 !== undefined && bl?.median && bl.n >= 5 ? (
                    <Pill tone={v24 / bl.median >= 1 ? 'ok' : 'warn'}>
                      24h views {(v24 / bl.median).toFixed(1)}× platform median (n={bl.n})
                    </Pill>
                  ) : (
                    <span className="meta">
                      {bl && bl.n < 5 ? 'Not enough history for a baseline yet (n<5)' : ''}
                    </span>
                  )}
                  <span className="spacer" />
                  <Button size="sm" onClick={() => setLogFor(p)}>
                    Log results
                  </Button>
                </div>
                {snaps.length > 0 && (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>When</th>
                          {[...new Set(snaps.flatMap((x) => Object.keys(x.metrics)))].map((k) => (
                            <th key={k}>{k}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {snaps.map((x) => (
                          <tr key={x.id}>
                            <td>{x.checkpoint ?? `${Math.round(x.ageHours)}h`}</td>
                            {[...new Set(snaps.flatMap((y) => Object.keys(y.metrics)))].map((k) => (
                              <td key={k} className="num">
                                {x.metrics[k]?.toLocaleString() ?? '—'}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
          {c.status === 'published' && (
            <div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void update(s, 'content', c.id, {
                    status: 'reviewed',
                    reviewedAt: new Date().toISOString(),
                  })
                }
              >
                Done reviewing
              </Button>
            </div>
          )}
        </div>
      )}
      {evidence.length > 0 && (
        <div className="meta" style={{ marginTop: 8 }}>
          Evidence for {evidence.length} learning{evidence.length > 1 ? 's' : ''}:{' '}
          {evidence.map((l) => (
            <Link key={l.id} to="/learnings/$id" params={{ id: l.fromId }} className="tag">
              view
            </Link>
          ))}
        </div>
      )}
      <Sheet open={!!logFor} onClose={() => setLogFor(null)} title="Log results">
        {logFor && (
          <>
            <p className="meta">
              Checkpoint is detected from the time since publishing (±20%): 1h, 6h, 24h, 72h, 7d, 28d.
            </p>
            <MetricsForm
              platform={logFor.platform}
              onSubmit={async (m) => {
                await logSnapshot(s, logFor, m);
                toast('Results saved');
                setLogFor(null);
              }}
            />
          </>
        )}
      </Sheet>
      <LearningEditor
        open={learnOpen}
        onClose={() => setLearnOpen(false)}
        evidence={[{ type: 'content', id: c.id, label: c.title }]}
      />
    </section>
  );
}
