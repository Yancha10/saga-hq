import { Link } from '@tanstack/react-router';
import {
  Check,
  ChevronDown,
  ClipboardCopy,
  FileText,
  GitCompare,
  Lock,
  Plus,
  Trash2,
  Wand2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useIsPhone, useLive, useSession } from '../../app/context';
import { toast } from '../../app/status';
import { linkRecords, unlink } from '../../data/domain';
import {
  addVariant,
  approveVariant,
  checklistOf,
  checklistProgress,
  removeVariant,
  toggleCheck,
  variantTarget,
} from '../../data/saga';
import { type Content, VARIANT_FIELDS, type VariantField } from '../../data/schema';
import { fmt, t, useT } from '../../i18n';
import { AutoText, Button, IconButton, Pill, Sheet } from '../../ui/kit';
import { Markdown } from '../../ui/Markdown';
import { contentTitle } from '../common';
import type { Bundle } from './ContentDetail';

type Edit = (patch: Partial<Content>, key?: string) => Promise<void>;
const REL_TYPES = ['continuity', 'dependency', 'reuse'] as const;

/** Editorial card of a piece: original, proposal, variants, checklist, DM and relations. */
export function SagaSection({ b, edit }: { b: Bundle; edit: Edit }) {
  useT();
  const phone = useIsPhone();
  const c = b.content;
  const [open, setOpen] = useState(!phone);
  useEffect(() => {
    const on = (e: Event) => (e as CustomEvent).detail === 'saga' && setOpen(true);
    window.addEventListener('hq:open-section', on);
    return () => window.removeEventListener('hq:open-section', on);
  }, []);
  const cl = checklistOf(b.ws);
  const prog = checklistProgress(c, cl);
  const pillars = useLive(
    (ss) =>
      ss.db.content
        .toArray()
        .then((cs) => [...new Set(cs.map((x) => x.pillar).filter((x): x is string => !!x))].sort()),
    [],
    [] as string[],
  );
  const dmState = !c.dmKeyword ? null : c.dmDelivery?.trim() ? 'prepared' : 'missing';
  return (
    <section
      className={`sheet-sec saga-sec ${open ? '' : 'closed'}`}
      id="sec-saga"
      aria-label={t('saga.section')}
    >
      <header>
        <h3>
          <button type="button" className="fold-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
            <span className="sec-dot saga" aria-hidden />
            {t('saga.section')}
            <ChevronDown size={17} className="chev" aria-hidden />
          </button>
        </h3>
        {open && (
          <Link to="/workshop" search={{ content: c.id }} className="btn sm">
            <Wand2 size={13} aria-hidden /> {t('saga.open_workshop')}
          </Link>
        )}
      </header>
      {!open ? (
        <div className="saga-peek">
          {c.pillar && <span className="tag">{c.pillar}</span>}
          {c.dmKeyword && <span className="tag">DM · {c.dmKeyword}</span>}
          <span className="meta">{t('saga.check_progress', { done: prog.done, total: prog.total })}</span>
        </div>
      ) : (
        <div className="stack">
          <div className="form-grid saga-summary">
            <div className="field">
              <label className="lbl" htmlFor="spillar">
                {t('saga.pillar')}
              </label>
              <input
                id="spillar"
                className="input"
                list="pillars-list"
                defaultValue={c.pillar ?? ''}
                key={c.pillar ?? ''}
                onBlur={(e) =>
                  e.target.value !== (c.pillar ?? '') && void edit({ pillar: e.target.value || null })
                }
              />
              <datalist id="pillars-list">
                {pillars.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>
            <div className="field">
              <label className="lbl" htmlFor="sdur">
                {t('saga.duration_target')}
              </label>
              <input
                id="sdur"
                type="number"
                min={0}
                className="input"
                value={c.durationTargetSec ?? ''}
                onChange={(e) =>
                  void edit({ durationTargetSec: e.target.value ? Number(e.target.value) : null })
                }
              />
            </div>
            <div className="field span-2">
              <span className="lbl">{t('saga.objective')}</span>
              <AutoText
                value={c.objective}
                onSave={(v) => edit({ objective: v || null }, 'obj')}
                ariaLabel={t('saga.objective')}
              />
            </div>
            <div className="field span-2">
              <span className="lbl">{t('saga.cta')}</span>
              <AutoText
                value={c.cta}
                onSave={(v) => edit({ cta: v || null }, 'cta')}
                ariaLabel={t('saga.cta')}
              />
            </div>
          </div>

          <div className="dm-box">
            <div className="hstack">
              <div className="field" style={{ flex: '0 1 220px' }}>
                <span className="lbl">{t('saga.dm_keyword')}</span>
                <AutoText
                  value={c.dmKeyword}
                  onSave={(v) => edit({ dmKeyword: v.trim().toUpperCase() || null }, 'dm')}
                  ariaLabel={t('saga.dm_keyword')}
                  placeholder={t('saga.dm_ph')}
                />
              </div>
              {dmState && (
                <Pill tone={dmState === 'prepared' ? 'ok' : 'warn'} dot>
                  {t(`saga.dm_state.${dmState}`)}
                </Pill>
              )}
            </div>
            {c.dmKeyword && (
              <div className="field">
                <span className="lbl">{t('saga.dm_delivery')}</span>
                <AutoText
                  multiline
                  value={c.dmDelivery}
                  onSave={(v) => edit({ dmDelivery: v || null }, 'dmd')}
                  ariaLabel={t('saga.dm_delivery')}
                  placeholder={t('saga.dm_delivery_ph')}
                  rows={2}
                />
                <p className="meta explain">{t('saga.dm_note')}</p>
              </div>
            )}
          </div>

          {c.original?.text && (
            <details className="original-card">
              <summary>
                <FileText size={15} aria-hidden />
                <span className="grow">{t('saga.original')}</span>
                <span className="meta">
                  <Lock size={12} aria-hidden /> {t('saga.read_only')} · {fmt.date(c.original.importedAt)}
                </span>
              </summary>
              <Markdown text={c.original.text} />
              {c.original.sourceLabel && (
                <div className="meta">{t('saga.source', { source: c.original.sourceLabel })}</div>
              )}
            </details>
          )}

          <div className="saga-grid">
            {(
              [
                ['artDirection', 'saga.art'],
                ['soundDirection', 'saga.sound'],
                ['continuityNotes', 'saga.continuity'],
              ] as const
            ).map(([k, label]) => (
              <div key={k} className="field">
                <span className="lbl">{t(label)}</span>
                <AutoText
                  multiline
                  value={c[k]}
                  onSave={(v) => edit({ [k]: v || null } as Partial<Content>, k)}
                  ariaLabel={t(label)}
                  rows={3}
                />
              </div>
            ))}
          </div>

          <div className="field">
            <div className="hstack">
              <span className="lbl grow">{t('saga.prompt')}</span>
              {c.prompt && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void navigator.clipboard
                      ?.writeText(c.prompt ?? '')
                      .then(() => toast(t('saga.prompt_copied')))
                      .catch(() => toast(t('workshop.copy_fallback')))
                  }
                >
                  <ClipboardCopy size={13} aria-hidden /> {t('saga.copy_prompt')}
                </Button>
              )}
            </div>
            <AutoText
              multiline
              value={c.prompt}
              onSave={(v) => edit({ prompt: v || null }, 'prompt')}
              ariaLabel={t('saga.prompt')}
              placeholder={t('saga.prompt_ph')}
              rows={4}
              className="mono"
            />
          </div>

          <div className="saga-grid">
            <div className="field">
              <span className="lbl">{t('saga.stories')}</span>
              <AutoText
                multiline
                value={c.stories}
                onSave={(v) => edit({ stories: v || null }, 'stories')}
                ariaLabel={t('saga.stories')}
                rows={3}
              />
            </div>
            <div className="field">
              <span className="lbl">{t('saga.pinned')}</span>
              <AutoText
                multiline
                value={c.pinnedComment}
                onSave={(v) => edit({ pinnedComment: v || null }, 'pin')}
                ariaLabel={t('saga.pinned')}
                rows={3}
              />
            </div>
          </div>

          <Variants b={b} />
          <Checklist b={b} />
          <Relations b={b} />

          <div className="field">
            <span className="lbl">{t('saga.notes')}</span>
            <AutoText
              multiline
              value={c.notes}
              onSave={(v) => edit({ notes: v || null }, 'notes')}
              ariaLabel={t('saga.notes')}
              rows={2}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function Variants({ b }: { b: Bundle }) {
  useT();
  const s = useSession();
  const c = b.content;
  const [field, setField] = useState<VariantField>('hook');
  const [text, setText] = useState('');
  const [compare, setCompare] = useState<string | null>(null);
  const list = (c.variants ?? []).slice().sort((a, z) => z.at.localeCompare(a.at));
  const byField = VARIANT_FIELDS.map((f) => [f, list.filter((v) => v.field === f)] as const).filter(
    ([, v]) => v.length,
  );
  const cmp = list.find((v) => v.id === compare);
  const cmpField = cmp ? variantTarget(cmp.field) : null;
  return (
    <div className="variants">
      <h4>{t('saga.variants', { count: list.length })}</h4>
      <p className="meta explain">{t('saga.variants_hint')}</p>
      {byField.map(([f, vs]) => (
        <div key={f} className="variant-group">
          <div className="lbl">{t(`variant.field.${f}`)}</div>
          {vs.map((v) => (
            <div key={v.id} className={`variant ${v.approved ? 'approved' : ''}`}>
              <div className="variant-head">
                <Pill tone={v.by === 'ai' ? 'ai' : v.by === 'import' ? undefined : 'accent'}>
                  {t(`variant.by.${v.by}`)}
                </Pill>
                {v.label && <span className="meta">{v.label}</span>}
                <span className="meta">{fmt.dateTime(v.at)}</span>
                {v.approved && (
                  <Pill tone="ok" dot>
                    {t('saga.approved')}
                  </Pill>
                )}
                <span className="spacer" />
                {variantTarget(v.field) && (
                  <IconButton label={t('saga.compare')} size="sm" onClick={() => setCompare(v.id)}>
                    <GitCompare size={14} />
                  </IconButton>
                )}
                <IconButton
                  label={t('saga.remove_variant')}
                  size="sm"
                  onClick={() => void removeVariant(s, c, v.id)}
                >
                  <Trash2 size={14} />
                </IconButton>
              </div>
              <div className="variant-text">{v.text}</div>
              {!v.approved && (
                <Button
                  size="sm"
                  onClick={() =>
                    void approveVariant(s, c, v.id).then(() =>
                      toast(
                        variantTarget(v.field) ? t('saga.approved_toast') : t('saga.approved_ending_toast'),
                      ),
                    )
                  }
                >
                  <Check size={13} aria-hidden />{' '}
                  {variantTarget(v.field) ? t('saga.approve_use') : t('saga.approve')}
                </Button>
              )}
            </div>
          ))}
        </div>
      ))}
      <div className="variant-add">
        <select
          className="select"
          aria-label={t('saga.variant_field')}
          value={field}
          onChange={(e) => setField(e.target.value as VariantField)}
        >
          {VARIANT_FIELDS.map((f) => (
            <option key={f} value={f}>
              {t(`variant.field.${f}`)}
            </option>
          ))}
        </select>
        <textarea
          className="input"
          rows={2}
          value={text}
          placeholder={t('saga.variant_ph')}
          aria-label={t('saga.variant_text')}
          onChange={(e) => setText(e.target.value)}
        />
        <Button
          size="sm"
          disabled={!text.trim()}
          onClick={() =>
            void addVariant(s, c, { field, text: text.trim(), by: 'user' }).then(() => {
              setText('');
              toast(t('saga.variant_added'));
            })
          }
        >
          <Plus size={13} aria-hidden /> {t('saga.add_variant')}
        </Button>
      </div>
      {cmp && cmpField && (
        <Sheet
          open
          onClose={() => setCompare(null)}
          title={t('saga.compare_title', { field: t(`variant.field.${cmp.field}`) })}
          wide
        >
          <div className="compare">
            <div>
              <div className="lbl">{t('saga.current_text')}</div>
              <div className="variant-text">{String(c[cmpField] ?? '') || '—'}</div>
            </div>
            <div>
              <div className="lbl">{t('saga.this_variant')}</div>
              <div className="variant-text">{cmp.text}</div>
            </div>
          </div>
          <Button
            variant="primary"
            onClick={() =>
              void approveVariant(s, c, cmp.id).then(() => {
                setCompare(null);
                toast(t('saga.approved_toast'));
              })
            }
          >
            {t('saga.approve_use')}
          </Button>
        </Sheet>
      )}
    </div>
  );
}

function Checklist({ b }: { b: Bundle }) {
  useT();
  const s = useSession();
  const c = b.content;
  const cl = checklistOf(b.ws);
  const prog = checklistProgress(c, cl);
  return (
    <div className="checklist">
      <div className="hstack">
        <h4 className="grow">{t('saga.checklist')}</h4>
        <span className="meta num">{t('saga.check_progress', { done: prog.done, total: prog.total })}</span>
      </div>
      <p className="meta explain">{t('saga.checklist_hint')}</p>
      {prog.stale && <div className="banner info">{t('saga.checklist_stale')}</div>}
      <ul className="check-list">
        {cl.items.map((i) => (
          <li key={i.id}>
            <label className="check">
              <input
                type="checkbox"
                checked={!!c.checks?.[i.id]}
                onChange={(e) => void toggleCheck(s, c, i.id, e.target.checked, cl.version)}
              />{' '}
              {i.text ?? t(`checklist.default.${i.id}`)}
            </label>
          </li>
        ))}
      </ul>
      <Link to="/settings" search={{ section: 'workspace' }} className="meta link-quiet">
        {t('saga.edit_checklist')}
      </Link>
    </div>
  );
}

function Relations({ b }: { b: Bundle }) {
  useT();
  const s = useSession();
  const c = b.content;
  const data = useLive(
    async (ss) => {
      const [out, inc, all] = await Promise.all([
        ss.db.links.where('fromId').equals(c.id).toArray(),
        ss.db.links.where('toId').equals(c.id).toArray(),
        ss.db.content.toArray(),
      ]);
      const rel = (l: { type: string; deletedAt?: string | null }) =>
        !l.deletedAt && (REL_TYPES as readonly string[]).includes(l.type);
      return {
        out: out.filter(rel),
        inc: inc.filter(rel),
        all: all.filter((x) => !x.deletedAt && x.id !== c.id),
      };
    },
    [c.id],
    { out: [], inc: [], all: [] as Content[] },
  );
  const [target, setTarget] = useState('');
  const [type, setType] = useState<(typeof REL_TYPES)[number]>('continuity');
  const [note, setNote] = useState('');
  const title = (id: string) => {
    const x = data.all.find((y) => y.id === id);
    return x ? contentTitle(x) : t('common.untitled');
  };
  const rows = [
    ...data.out.map((l) => ({ l, other: l.toId, dir: 'out' as const })),
    ...data.inc.map((l) => ({ l, other: l.fromId, dir: 'in' as const })),
  ];
  return (
    <div className="relations">
      <h4>{t('saga.relations', { count: rows.length })}</h4>
      <p className="meta explain">{t('saga.relations_hint')}</p>
      {rows.length > 0 && (
        <div className="list">
          {rows.map(({ l, other, dir }) => (
            <div key={l.id} className="row static">
              <Pill tone="accent">{t(`link.${l.type}.${dir}`)}</Pill>
              <Link to="/content/$id" params={{ id: other }} className="grow">
                <div className="title">{title(other)}</div>
                {l.note && <div className="sub">{l.note}</div>}
              </Link>
              <IconButton label={t('saga.remove_relation')} size="sm" onClick={() => void unlink(s, l.id)}>
                <Trash2 size={14} />
              </IconButton>
            </div>
          ))}
        </div>
      )}
      <div className="relation-add">
        <select
          className="select"
          aria-label={t('saga.relation_type')}
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
        >
          {REL_TYPES.map((x) => (
            <option key={x} value={x}>
              {t(`link.${x}.out`)}
            </option>
          ))}
        </select>
        <select
          className="select"
          aria-label={t('saga.relation_piece')}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          <option value="">{t('saga.pick_piece')}</option>
          {data.all.map((x) => (
            <option key={x.id} value={x.id}>
              {contentTitle(x)}
            </option>
          ))}
        </select>
        <input
          className="input"
          value={note}
          placeholder={t('saga.relation_note_ph')}
          aria-label={t('saga.relation_note')}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button
          size="sm"
          disabled={!target}
          onClick={() =>
            void linkRecords(s, 'content', c.id, 'content', target, type, note.trim() || undefined).then(
              () => {
                setTarget('');
                setNote('');
                toast(t('saga.relation_added'));
              },
            )
          }
        >
          <Plus size={13} aria-hidden /> {t('saga.add_relation')}
        </Button>
      </div>
    </div>
  );
}
