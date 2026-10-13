import { Link } from '@tanstack/react-router';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Clipboard,
  Copy,
  Download,
  Plus,
  Send,
  Trash2,
  Upload,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useIsPhone, useLive, useSession } from '../../app/context';
import { toast } from '../../app/status';
import { ulid } from '../../core/ulid';
import { safeHttpUrl } from '../../core/url';
import { median } from '../../core/util';
import { logSnapshot, markPublished, schedulePublication } from '../../data/domain';
import { perReach, shotsDuration } from '../../data/saga';
import {
  type Content,
  PLATFORMS,
  type Platform,
  type Publication,
  type SheetSection,
  type Shot,
} from '../../data/schema';
import { update } from '../../data/store';
import { fmt, t, useT } from '../../i18n';
import { errorText, platformName } from '../../i18n/render';
import { addMedia, mediaUrl } from '../../media/store';
import { fromLocalInput, toLocalInput } from '../../rules/time';
import { AutoText, Button, IconButton, Pill, Sheet } from '../../ui/kit';
import { ExtLink, MediaThumb, References, TagEditor } from '../common';
import { LearningEditor } from '../insights/LearningEditor';
import { MetricsForm } from '../insights/MetricsForm';
import { StudioHandoffSheet } from '../studio/StudioHandoffSheet';
import type { Bundle } from './ContentDetail';

const SHOT_DIRECTION = [
  'timeLabel',
  'character',
  'camera',
  'framing',
  'movement',
  'light',
  'sound',
  'continuityObject',
] as const;

type Edit = (patch: Partial<Content>, key?: string) => Promise<void>;
type SecKey = SheetSection | 'results';

/** Phone accordion: only the current stage starts open; choices are remembered for the session. */
const foldMemory = new Map<string, boolean>();
const OPEN_EVENT = 'hq:open-section';
export function openSheetSection(sec: string, anchor = `sec-${sec}`): void {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: sec }));
  setTimeout(
    () => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    60,
  );
}
type Fold = { closed: boolean; open: boolean; phone: boolean; toggle: () => void };
function useFold(b: Bundle, sec: SecKey): Fold {
  const phone = useIsPhone();
  const key = `${b.content.id}:${sec}`;
  const c = b.content;
  const byDefault =
    sec === 'results' ? c.status === 'published' || c.status === 'reviewed' : (c._stage ?? 'concept') === sec;
  const [open, setOpen] = useState(() => foldMemory.get(key) ?? byDefault);
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent).detail === sec) {
        foldMemory.set(key, true);
        setOpen(true);
      }
    };
    window.addEventListener(OPEN_EVENT, on);
    return () => window.removeEventListener(OPEN_EVENT, on);
  }, [key, sec]);
  return {
    open,
    phone,
    closed: phone && !open,
    toggle: () =>
      setOpen((o) => {
        foldMemory.set(key, !o);
        return !o;
      }),
  };
}

function SecHead({
  sec,
  b,
  done,
  children,
  title,
  fold,
}: {
  sec: SheetSection | 'results';
  b: Bundle;
  done?: boolean;
  children?: ReactNode;
  title?: string;
  fold: Fold;
}) {
  useT();
  const s = useSession();
  const c = b.content;
  const manual = sec !== 'results' && !!c.sectionDone?.[sec];
  const heading = (
    <>
      {sec !== 'results' && (
        <span className={`sec-dot ${done ? 'done' : c._stage === sec ? 'part' : ''}`} aria-hidden />
      )}
      {title ?? t(`section.${sec}`)}
      {sec !== 'results' && done && <span className="sr-only"> ({t('common.complete')})</span>}
    </>
  );
  return (
    <header>
      {fold.phone ? (
        <h3>
          <button type="button" className="fold-toggle" aria-expanded={fold.open} onClick={fold.toggle}>
            {heading}
            <ChevronDown size={17} className="chev" aria-hidden />
          </button>
        </h3>
      ) : (
        <h3>{heading}</h3>
      )}
      {!fold.closed && children}
      {!fold.closed && sec !== 'results' && (
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={manual}
          onClick={() =>
            void update(s, 'content', c.id, { sectionDone: { ...(c.sectionDone ?? {}), [sec]: !manual } })
          }
        >
          {manual ? <Check size={13} /> : null} {manual ? t('sheet.marked_done') : t('sheet.mark_done')}
        </Button>
      )}
    </header>
  );
}

export function ConceptSection({ b, edit, done }: { b: Bundle; edit: Edit; done: boolean }) {
  useT();
  const fold = useFold(b, 'concept');
  const c = b.content;
  const words = (c.script ?? '').trim().split(/\s+/).filter(Boolean).length;
  return (
    <section
      className={`sheet-sec ${fold.closed ? 'closed' : ''}`}
      id="sec-concept"
      aria-label={t('section.concept')}
    >
      <SecHead fold={fold} sec="concept" b={b} done={done} />
      <div className="stack">
        <div className="field">
          <span className="lbl">{t('field.hook')}</span>
          <AutoText
            value={c.hook}
            onSave={(v) => edit({ hook: v || null }, 'hook')}
            ariaLabel={t('field.hook')}
            placeholder={t('sheet.hook_placeholder')}
          />
        </div>
        <div className="field">
          <span className="lbl">{t('field.concept')}</span>
          <AutoText
            multiline
            value={c.concept}
            onSave={(v) => edit({ concept: v || null }, 'concept')}
            ariaLabel={t('field.concept')}
            placeholder={t('sheet.concept_placeholder')}
            rows={3}
          />
        </div>
        <div className="field">
          <span className="lbl">{t('field.script')}</span>
          <AutoText
            multiline
            value={c.script}
            onSave={(v) => edit({ script: v || null }, 'script')}
            ariaLabel={t('field.script')}
            placeholder={t('sheet.script_placeholder')}
            rows={6}
          />
          <span className="hint num">{t('sheet.words', { count: words, sec: Math.round(words / 2.5) })}</span>
        </div>
        <div className="form-grid">
          <div className="field">
            <span className="lbl">{t('sheet.objective')}</span>
            <AutoText
              value={c.objective}
              onSave={(v) => edit({ objective: v || null }, 'obj')}
              ariaLabel={t('sheet.objective')}
            />
          </div>
          <div className="field">
            <span className="lbl">{t('sheet.audience')}</span>
            <AutoText
              value={c.audience}
              onSave={(v) => edit({ audience: v || null }, 'aud')}
              ariaLabel={t('sheet.audience')}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

export function ReferencesSection({ b, done }: { b: Bundle; done: boolean }) {
  useT();
  const fold = useFold(b, 'references');
  return (
    <section
      className={`sheet-sec ${fold.closed ? 'closed' : ''}`}
      id="sec-references"
      aria-label={t('section.references')}
    >
      <SecHead fold={fold} sec="references" b={b} done={done} />
      <References fromType="content" fromId={b.content.id} projectId={b.content.projectId} />
    </section>
  );
}

export function GenerateSection({ b, edit, done }: { b: Bundle; edit: Edit; done: boolean }) {
  useT();
  const fold = useFold(b, 'generate');
  const s = useSession();
  const c = b.content;
  const shots = (c.shots ?? []).filter((x) => !x.deleted).sort((a, x) => a.order - x.order);
  const [handoff, setHandoff] = useState<Shot | 'content' | null>(null);
  const setShot = (id: string, patch: Partial<Shot>) =>
    edit(
      { shots: (c.shots ?? []).map((x) => (x.id === id ? { ...x, ...patch, rev: s.hlc.now() } : x)) },
      `shot:${id}:${Object.keys(patch).join()}`,
    );
  const carousel = c.formatTemplateId === 'carousel';
  const dur = shotsDuration(c);
  const move = (id: string, dir: -1 | 1) => {
    const i = shots.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= shots.length) return;
    const a = shots[i]!;
    const z = shots[j]!;
    void edit({
      shots: (c.shots ?? []).map((x) =>
        x.id === a.id
          ? { ...x, order: z.order, rev: s.hlc.now() }
          : x.id === z.id
            ? { ...x, order: a.order, rev: s.hlc.now() }
            : x,
      ),
    });
  };
  const duplicate = (sh: Shot) => {
    const later = shots.filter((x) => x.order > sh.order);
    void edit({
      shots: [
        ...(c.shots ?? []).map((x) =>
          later.some((l) => l.id === x.id) ? { ...x, order: x.order + 1, rev: s.hlc.now() } : x,
        ),
        { ...sh, id: ulid(), order: sh.order + 1, status: 'todo', selectedOutput: null, rev: s.hlc.now() },
      ],
    });
  };
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
    <section
      className={`sheet-sec ${fold.closed ? 'closed' : ''}`}
      id="sec-generate"
      aria-label={t('section.generate')}
    >
      <SecHead fold={fold} sec="generate" b={b} done={done}>
        <Button size="sm" onClick={() => setHandoff('content')}>
          <Send size={13} /> {t('studio.open_in')}
        </Button>
      </SecHead>
      <div className="stack">
        <div className="field">
          <span className="lbl">{t('field.productionNotes')}</span>
          <AutoText
            multiline
            value={c.productionNotes}
            onSave={(v) => edit({ productionNotes: v || null }, 'pnotes')}
            ariaLabel={t('field.productionNotes')}
            placeholder={t('sheet.pnotes_placeholder')}
            rows={2}
          />
        </div>
        {shots.length > 0 && !carousel && (
          <div
            className={`duration-check ${c.durationTargetSec && dur.total > c.durationTargetSec ? 'over' : ''}`}
          >
            {t('saga.duration_sum', { total: fmt.num(dur.total), count: dur.shots })}
            {c.durationTargetSec
              ? ` · ${t('saga.duration_vs', { target: fmt.num(c.durationTargetSec) })}`
              : ''}
            <span className="meta"> · {t('saga.duration_note')}</span>
          </div>
        )}
        {shots.length === 0 ? (
          <div className="hstack">
            <span className="meta">{t('sheet.shots_hint')}</span>
            <Button size="sm" onClick={() => void addShot()}>
              <Plus size={13} /> {t('sheet.add_shot_structure')}
            </Button>
          </div>
        ) : (
          <div className="stack">
            {shots.map((sh, i) => (
              <div key={sh.id} className="box">
                <div className="hstack">
                  <strong>
                    {carousel
                      ? t('saga.slide_n', { n: i + 1 })
                      : t('sheet.shot_n', { n: String(i + 1).padStart(2, '0') })}
                  </strong>
                  {sh.timeLabel && !carousel && <span className="tag">{sh.timeLabel}</span>}
                  <select
                    className="select"
                    style={{ width: 130, minHeight: 28 }}
                    aria-label={t('sheet.shot_status', { n: i + 1 })}
                    value={sh.status}
                    onChange={(e) => void setShot(sh.id, { status: e.target.value as Shot['status'] })}
                  >
                    {(['todo', 'generating', 'selected', 'final'] as const).map((st) => (
                      <option key={st} value={st}>
                        {t(`shot.status.${st}`)}
                      </option>
                    ))}
                  </select>
                  <span className="spacer" />
                  <IconButton
                    label={t('saga.shot_up', { n: i + 1 })}
                    size="sm"
                    disabled={i === 0}
                    onClick={() => move(sh.id, -1)}
                  >
                    <ArrowUp size={14} />
                  </IconButton>
                  <IconButton
                    label={t('saga.shot_down', { n: i + 1 })}
                    size="sm"
                    disabled={i === shots.length - 1}
                    onClick={() => move(sh.id, 1)}
                  >
                    <ArrowDown size={14} />
                  </IconButton>
                  <IconButton
                    label={t('saga.shot_duplicate', { n: i + 1 })}
                    size="sm"
                    onClick={() => duplicate(sh)}
                  >
                    <Copy size={14} />
                  </IconButton>
                  <Button size="sm" variant="ghost" onClick={() => setHandoff(sh)}>
                    <Send size={13} /> {t('studio.short')}
                  </Button>
                  <IconButton
                    label={t('sheet.remove_shot', { n: i + 1 })}
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
                  ariaLabel={t('sheet.shot_desc', { n: i + 1 })}
                  placeholder={t('sheet.what_we_see')}
                  rows={2}
                />
                <div className="form-grid">
                  <div className="field">
                    <span className="lbl">{t('hook.dialogue')}</span>
                    <AutoText
                      value={sh.dialogue}
                      onSave={(v) => setShot(sh.id, { dialogue: v || null })}
                      ariaLabel={t('sheet.shot_dialogue', { n: i + 1 })}
                    />
                  </div>
                  {!carousel && (
                    <div className="field">
                      <span className="lbl">{t('content.duration_s')}</span>
                      <input
                        type="number"
                        min={0}
                        className="input"
                        value={sh.durationSec ?? ''}
                        aria-label={t('sheet.shot_duration', { n: i + 1 })}
                        onChange={(e) =>
                          void setShot(sh.id, { durationSec: e.target.value ? Number(e.target.value) : null })
                        }
                      />
                    </div>
                  )}
                </div>
                <details className="shot-direction">
                  <summary className="meta">{t('saga.shot_direction')}</summary>
                  <div className="form-grid">
                    {SHOT_DIRECTION.map((k) => (
                      <div key={k} className="field">
                        <span className="lbl">{t(`shot.f.${k}`)}</span>
                        <AutoText
                          value={(sh as Record<string, unknown>)[k] as string | null | undefined}
                          onSave={(v) => setShot(sh.id, { [k]: v || null } as Partial<Shot>)}
                          ariaLabel={`${t(`shot.f.${k}`)} · ${i + 1}`}
                        />
                      </div>
                    ))}
                  </div>
                </details>
                <div className="field">
                  <span className="lbl">{t('sheet.prompt')}</span>
                  <AutoText
                    multiline
                    value={sh.prompt}
                    onSave={(v) => setShot(sh.id, { prompt: v || null })}
                    ariaLabel={t('sheet.shot_prompt', { n: i + 1 })}
                    rows={2}
                  />
                </div>
                <div className="field">
                  <span className="lbl">{t('sheet.selected_output')}</span>
                  <AutoText
                    value={sh.selectedOutput}
                    onSave={(v) =>
                      setShot(sh.id, {
                        selectedOutput: v || null,
                        ...(v ? { status: sh.status === 'final' ? 'final' : 'selected' } : {}),
                      })
                    }
                    ariaLabel={t('sheet.shot_output', { n: i + 1 })}
                    placeholder="https://…"
                  />
                  {sh.selectedOutput && <ExtLink href={sh.selectedOutput} />}
                </div>
              </div>
            ))}
            <div>
              <Button size="sm" onClick={() => void addShot()}>
                <Plus size={13} /> {t('sheet.add_shot')}
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
  useT();
  const fold = useFold(b, 'edit');
  const s = useSession();
  const c = b.content;
  return (
    <section
      className={`sheet-sec ${fold.closed ? 'closed' : ''}`}
      id="sec-edit"
      aria-label={t('section.edit')}
    >
      <SecHead fold={fold} sec="edit" b={b} done={done} />
      <div className="stack">
        <div className="field">
          <span className="lbl">{t('sheet.final_export')}</span>
          <div className="hstack">
            <div style={{ flex: 1, minWidth: 200 }}>
              <AutoText
                value={c.finalExportUrl}
                onSave={(v) => edit({ finalExportUrl: v || null }, 'export')}
                ariaLabel={t('sheet.final_export_url')}
                placeholder={t('sheet.final_export_placeholder')}
              />
            </div>
            <UploadButton
              label={t('sheet.attach_file')}
              accept="image/*,video/*"
              onFile={async (f) => {
                try {
                  const m = await addMedia(s, f, f.name);
                  await edit({ finalExportMediaId: m.id });
                } catch (e) {
                  toast(errorText(e), { kind: 'error' });
                }
              }}
            />
          </div>
          {c.finalExportMediaId && (
            <span className="hint">{t('sheet.file_attached', { id: c.finalExportMediaId.slice(-6) })}</span>
          )}
          <span className="hint">{t('sheet.large_videos')}</span>
        </div>
        <div className="field">
          <span className="lbl">{t('field.editNotes')}</span>
          <AutoText
            multiline
            value={c.editNotes}
            onSave={(v) => edit({ editNotes: v || null }, 'enotes')}
            ariaLabel={t('field.editNotes')}
            placeholder={t('sheet.enotes_placeholder')}
            rows={2}
          />
        </div>
        <div className="field">
          <span className="lbl">{t('sheet.audio')}</span>
          <AutoText
            value={c.audioNote}
            onSave={(v) => edit({ audioNote: v || null }, 'audio')}
            ariaLabel={t('sheet.audio')}
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
  useT();
  const fold = useFold(b, 'package');
  const s = useSession();
  const c = b.content;
  const len =
    (c.caption ?? '').length + (c.hashtags?.length ? c.hashtags.map((h) => `#${h}`).join(' ').length + 2 : 0);
  const fullCaption = [c.caption, c.hashtags?.length ? c.hashtags.map((h) => `#${h}`).join(' ') : '']
    .filter(Boolean)
    .join('\n\n');
  return (
    <section
      className={`sheet-sec ${fold.closed ? 'closed' : ''}`}
      id="sec-package"
      aria-label={t('section.package')}
    >
      <SecHead fold={fold} sec="package" b={b} done={done} />
      <div className="grid2" style={{ gap: 16 }}>
        <div className="stack">
          <div className="field">
            <span className="lbl">{t('field.caption')}</span>
            <AutoText
              multiline
              value={c.caption}
              onSave={(v) => edit({ caption: v || null }, 'caption')}
              ariaLabel={t('field.caption')}
              rows={4}
            />
            <span className="hint num">
              {t('sheet.chars', { count: len })}{' '}
              {c.platforms
                .filter((p) => CAPTION_LIMIT[p])
                .map((p) => (
                  <span key={p} style={{ color: len > CAPTION_LIMIT[p]! ? 'var(--danger)' : undefined }}>
                    · {platformName(p)} {fmt.num(CAPTION_LIMIT[p]!)}
                  </span>
                ))}
            </span>
          </div>
          <div className="field">
            <span className="lbl">{t('sheet.hashtags')}</span>
            <TagEditor
              value={c.hashtags}
              onChange={(v) => void edit({ hashtags: v })}
              labelKey="sheet.hashtag"
            />
          </div>
          <div>
            <Button
              size="sm"
              onClick={() =>
                void navigator.clipboard?.writeText(fullCaption).then(() => toast(t('sheet.caption_copied')))
              }
            >
              <Clipboard size={13} /> {t('sheet.copy_caption')}
            </Button>
          </div>
        </div>
        <div className="stack">
          <div className="field">
            <span className="lbl">{t('content.quick.cover')}</span>
            <div className="hstack">
              <MediaThumb
                mediaId={c.coverMediaId}
                url={c.coverUrl}
                alt={t('content.quick.cover')}
                className="thumb-sm"
              />
              <UploadButton
                label={t('sheet.upload_cover')}
                accept="image/*"
                onFile={async (f) => {
                  try {
                    const m = await addMedia(s, f, f.name);
                    await edit({ coverMediaId: m.id });
                  } catch (e) {
                    toast(errorText(e), { kind: 'error' });
                  }
                }}
              />
            </div>
            <AutoText
              value={c.coverUrl}
              onSave={(v) => edit({ coverUrl: v || null }, 'coverurl')}
              ariaLabel={t('sheet.cover_url')}
              placeholder={t('sheet.cover_url_placeholder')}
            />
          </div>
          <div className="field">
            <span className="lbl">{t('sheet.cover_title')}</span>
            <AutoText
              value={c.coverText}
              onSave={(v) => edit({ coverText: v || null }, 'covertext')}
              ariaLabel={t('sheet.cover_title')}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function PubRow({ b, p }: { b: Bundle; p: Publication }) {
  useT();
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
        a.download = `${c.title.slice(0, 40) || 'cover'}`; // file name, not UI text
        a.click();
      }
    } else if (c.coverUrl && safeHttpUrl(c.coverUrl))
      window.open(safeHttpUrl(c.coverUrl)!, '_blank', 'noopener');
  };
  return (
    <div className="row static" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
      <strong style={{ width: 90 }}>{platformName(p.platform)}</strong>
      {p.status === 'published' ? (
        <>
          <Pill tone="ok" dot>
            {t('content.status.published')} {p.publishedAt ? fmt.dateTime(p.publishedAt) : ''}
          </Pill>
          {p.url && <ExtLink href={p.url} />}
        </>
      ) : (
        <>
          <input
            type="datetime-local"
            className="input"
            style={{ width: 210 }}
            aria-label={t('sheet.publish_time', { platform: platformName(p.platform) })}
            value={toLocalInput(p.scheduledAt)}
            onChange={(e) => void schedulePublication(s, c, p.platform, fromLocalInput(e.target.value), p)}
          />
          <Button size="sm" variant="primary" onClick={() => setAskUrl(true)}>
            {t('h.published')}
          </Button>
          {(c.coverMediaId || c.coverUrl) && (
            <Button size="sm" variant="ghost" onClick={() => void downloadCover()}>
              <Download size={13} /> {t('content.quick.cover')}
            </Button>
          )}
        </>
      )}
      <Sheet
        open={askUrl}
        onClose={() => setAskUrl(false)}
        title={t('sheet.published_on', { platform: platformName(p.platform) })}
        footer={
          <Button
            variant="primary"
            onClick={async () => {
              await markPublished(s, c, p, safeHttpUrl(url) ?? null);
              setAskUrl(false);
              toast(t('sheet.published_toast'));
            }}
          >
            {t('common.save')}
          </Button>
        }
      >
        <div className="field">
          <label className="lbl" htmlFor="puburl">
            {t('sheet.post_url')}
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
        <p className="meta">{t('sheet.no_autopost')}</p>
      </Sheet>
    </div>
  );
}

export function PublishSection({ b, done }: { b: Bundle; done: boolean }) {
  useT();
  const fold = useFold(b, 'publish');
  const s = useSession();
  const c = b.content;
  const missingPlatforms = c.platforms.filter((p) => !b.publications.some((x) => x.platform === p));
  return (
    <section
      className={`sheet-sec ${fold.closed ? 'closed' : ''}`}
      id="sec-publish"
      aria-label={t('section.publish')}
    >
      <SecHead fold={fold} sec="publish" b={b} done={done} />
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
                <Plus size={13} /> {platformName(p)}
              </Button>
            ))}
        </div>
        {b.publications.length === 0 && <span className="meta">{t('sheet.publish_hint')}</span>}
      </div>
    </section>
  );
}

export function ResultsSection({ b }: { b: Bundle }) {
  useT();
  const fold = useFold(b, 'results');
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
    <section
      className={`sheet-sec ${fold.closed ? 'closed' : ''}`}
      id="sec-results"
      aria-label={t('sheet.results_learning')}
    >
      <SecHead fold={fold} sec="results" b={b} title={t('sheet.results_learning')}>
        <Button size="sm" variant="ghost" onClick={() => setLearnOpen(true)}>
          {t('sheet.write_learning')}
        </Button>
      </SecHead>
      {published.length === 0 ? (
        <div className="meta">{t('sheet.results_hint')}</div>
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
                  <strong>{platformName(p.platform)}</strong>
                  {v24 !== undefined && bl?.median && bl.n >= 5 ? (
                    <Pill tone={v24 / bl.median >= 1 ? 'ok' : 'warn'}>
                      {t('sheet.vs_median', { ratio: fmt.ratio(v24 / bl.median), n: bl.n })}
                    </Pill>
                  ) : (
                    <span className="meta">{bl && bl.n < 5 ? t('sheet.no_baseline') : ''}</span>
                  )}
                  <span className="spacer" />
                  <Button size="sm" onClick={() => setLogFor(p)}>
                    {t('h.logResults')}
                  </Button>
                </div>
                {snaps.length > 0 && (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>{t('sheet.when')}</th>
                          {[...new Set(snaps.flatMap((x) => Object.keys(x.metrics)))].map((k) => (
                            <th key={k}>{t(`metric.${k}`)}</th>
                          ))}
                          <th title={t('ratio.shares_hint')}>{t('ratio.shares')}</th>
                          <th title={t('ratio.saves_hint')}>{t('ratio.saves')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {snaps.map((x) => (
                          <tr key={x.id}>
                            <td>
                              {x.checkpoint ?? t('ratio.no_window')}
                              <div className="meta">
                                {fmt.date(x.observedAt)} · {t(`snapshot.source.${x.source}`)}
                              </div>
                            </td>
                            {[...new Set(snaps.flatMap((y) => Object.keys(y.metrics)))].map((k) => (
                              <td key={k} className="num">
                                {x.metrics[k] !== undefined ? fmt.num(x.metrics[k]!) : '—'}
                              </td>
                            ))}
                            {(['shares', 'saves'] as const).map((k) => {
                              const r = perReach(x.metrics[k], x.metrics.reach);
                              return (
                                <td key={k} className="num">
                                  {r === null ? (
                                    <span className="meta">{t('ratio.no_data')}</span>
                                  ) : (
                                    `${fmt.num(r, { maximumFractionDigits: 1 })} %`
                                  )}
                                </td>
                              );
                            })}
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
                {t('sheet.done_reviewing')}
              </Button>
            </div>
          )}
        </div>
      )}
      {evidence.length > 0 && (
        <div className="meta" style={{ marginTop: 8 }}>
          {t('sheet.evidence_for', { count: evidence.length })}{' '}
          {evidence.map((l) => (
            <Link key={l.id} to="/learnings/$id" params={{ id: l.fromId }} className="tag">
              {t('common.view_lower')}
            </Link>
          ))}
        </div>
      )}
      <Sheet open={!!logFor} onClose={() => setLogFor(null)} title={t('h.logResults')}>
        {logFor && (
          <>
            <p className="meta">{t('sheet.checkpoint_hint')}</p>
            <MetricsForm
              platform={logFor.platform}
              onSubmit={async (m) => {
                await logSnapshot(s, logFor, m);
                toast(t('today.results_saved'));
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
