import { Link } from '@tanstack/react-router';
import { CheckCircle2, ExternalLink, Megaphone, Plus, Search, ShieldQuestion, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useLive, useSession } from '../../app/context';
import { toast } from '../../app/status';
import { safeHttpUrl } from '../../core/url';
import { nowIso } from '../../core/util';
import { type CampaignDraft, campaignDraft, createCampaign, workspaceTz } from '../../data/saga';
import { RADAR_PRECISIONS, RADAR_VERIFICATION, type RadarItem } from '../../data/schema';
import { create, update } from '../../data/store';
import { fmt, t, useT } from '../../i18n';
import { AutoText, Button, Chip, Empty, Pill, Sheet } from '../../ui/kit';
import { PageHeader } from '../../ui/PageHeader';
import { archiveTrashItems, RecordMenu, useProjects } from '../common';

const vTone = (v: RadarItem['verification']) =>
  v === 'verified' ? 'ok' : v === 'discarded' ? undefined : 'warn';

/** "17–31 ene 2027" stays as written; the badge says how precise it really is. */
export function PeriodBadge({ r }: { r: RadarItem }) {
  useT();
  return (
    <span className="period">
      <span className="period-text">
        {r.periodText || (r.startDate ? fmt.date(r.startDate) : t('radar.no_date'))}
      </span>
      <span className={`prec prec-${r.precision}`}>{t(`radar.precision.${r.precision}`)}</span>
    </span>
  );
}

function monthKey(r: RadarItem): string {
  return r.startDate ? r.startDate.slice(0, 7) : 'zzzz';
}

export function RadarPage() {
  useT();
  const s = useSession();
  const items = useLive(
    (ss) => ss.db.radar.toArray().then((xs) => xs.filter((x) => !x.deletedAt)),
    [],
    [] as RadarItem[],
  );
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const [ver, setVer] = useState<RadarItem['verification'] | 'all'>('all');
  const [past, setPast] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [campaign, setCampaign] = useState<RadarItem | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const cats = useMemo(
    () => [...new Set(items.map((i) => i.category).filter((x): x is string => !!x))].sort(),
    [items],
  );
  const ql = q.trim().toLowerCase();
  const shown = items
    .filter((i) => !i.archivedAt)
    .filter((i) => (ver === 'all' ? i.verification !== 'discarded' : i.verification === ver))
    .filter((i) => !cat || i.category === cat)
    .filter(
      (i) =>
        past ||
        !(i.endDate ?? i.startDate) ||
        (i.endDate ?? i.startDate)! >= today ||
        i.precision === 'recurring',
    )
    .filter((i) => !ql || `${i.title} ${i.angle ?? ''} ${i.notes ?? ''}`.toLowerCase().includes(ql))
    .sort((a, b) => (a.startDate ?? '9999').localeCompare(b.startDate ?? '9999'));
  const groups = new Map<string, RadarItem[]>();
  for (const i of shown) groups.set(monthKey(i), [...(groups.get(monthKey(i)) ?? []), i]);
  const unverified = items.filter((i) => i.verification === 'unverified' && !i.archivedAt).length;
  const current = items.find((i) => i.id === open);
  return (
    <div className="page">
      <PageHeader
        title={t('nav.radar')}
        sub={unverified ? t('radar.sub_unverified', { count: unverified }) : t('radar.sub')}
        actions={
          <Button
            onClick={async () => {
              const r = await create(s, 'radar', {
                title: t('radar.new_title'),
                precision: 'unknown',
                sources: [],
                verification: 'unverified',
              });
              setOpen(r.id);
            }}
          >
            <Plus size={16} aria-hidden /> {t('radar.new')}
          </Button>
        }
      />
      {items.length === 0 ? (
        <Empty
          title={t('radar.empty_title')}
          action={
            <Link className="btn primary" to="/settings" search={{ section: 'import' }}>
              {t('import.title')}
            </Link>
          }
        >
          {t('radar.empty_body')}
        </Empty>
      ) : (
        <>
          <div className="search-field">
            <Search size={16} aria-hidden />
            <input
              className="input"
              type="search"
              value={q}
              placeholder={t('radar.search')}
              aria-label={t('radar.search')}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="hstack filters" role="group" aria-label={t('common.filters')}>
            <Chip on={ver === 'all'} onClick={() => setVer('all')}>
              {t('radar.all')}
            </Chip>
            {RADAR_VERIFICATION.map((v) => (
              <Chip key={v} on={ver === v} onClick={() => setVer(v)}>
                {t(`radar.verification.${v}`)}
              </Chip>
            ))}
            <span className="filters-sep" aria-hidden />
            {cats.map((c) => (
              <Chip key={c} on={cat === c} onClick={() => setCat(cat === c ? null : c)}>
                {c}
              </Chip>
            ))}
            <Chip on={past} onClick={() => setPast(!past)}>
              {t('radar.show_past')}
            </Chip>
          </div>
          {shown.length === 0 && <Empty compact title={t('radar.none_match')} />}
          {[...groups.entries()].map(([k, list]) => (
            <section key={k} className="radar-month">
              <h3 className="month-head">
                {k === 'zzzz' ? t('radar.undated') : fmt.monthYear(`${k}-15T12:00:00Z`)}
                <span className="num"> · {list.length}</span>
              </h3>
              <div className="radar-grid">
                {list.map((r) => (
                  <article key={r.id} className={`radar-card v-${r.verification}`}>
                    <button type="button" className="radar-open" onClick={() => setOpen(r.id)}>
                      <PeriodBadge r={r} />
                      <span className="radar-title">{r.title}</span>
                      {r.angle && <span className="radar-angle">{r.angle}</span>}
                    </button>
                    <div className="radar-foot">
                      <Pill tone={vTone(r.verification)} dot>
                        {t(`radar.verification.${r.verification}`)}
                      </Pill>
                      {r.category && <span className="tag">{r.category}</span>}
                      {r.projectId && <span className="tag accent">{t('radar.in_campaign')}</span>}
                      <span className="spacer" />
                      {r.sources[0] && safeHttpUrl(r.sources[0].url) && (
                        <a
                          className="icon-btn sm"
                          href={safeHttpUrl(r.sources[0].url)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={t('radar.open_source', { source: r.sources[0].label })}
                          title={r.sources[0].label}
                        >
                          <ExternalLink size={15} aria-hidden />
                        </a>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </>
      )}
      {current && (
        <RadarSheet
          r={current}
          onClose={() => setOpen(null)}
          onCampaign={() => {
            setOpen(null);
            setCampaign(current);
          }}
        />
      )}
      {campaign && <CampaignSheet r={campaign} onClose={() => setCampaign(null)} />}
    </div>
  );
}

function RadarSheet({
  r,
  onClose,
  onCampaign,
}: {
  r: RadarItem;
  onClose: () => void;
  onCampaign: () => void;
}) {
  useT();
  const s = useSession();
  const projects = useProjects();
  const up = (patch: Partial<RadarItem>, key?: string) =>
    update(s, 'radar', r.id, patch, key ? { coalesceKey: `r:${r.id}:${key}` } : undefined);
  const project = projects.find((p) => p.id === r.projectId);
  return (
    <Sheet
      open
      onClose={onClose}
      title={t('radar.entry')}
      wide
      footer={
        <>
          <RecordMenu label={t('common.actions')} items={archiveTrashItems(s, 'radar', r, onClose)} />
          <span className="spacer" />
          <Button onClick={onCampaign}>
            <Megaphone size={16} aria-hidden /> {t('radar.to_campaign')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <AutoText
          value={r.title}
          onSave={(v) => v.trim() && up({ title: v.trim() }, 'title')}
          ariaLabel={t('radar.f_title')}
          className="title"
        />
        <div className="verify-row">
          {r.verification !== 'verified' ? (
            <Button
              variant="primary"
              onClick={() =>
                void up({ verification: 'verified', lastCheckedAt: nowIso() }).then(() =>
                  toast(t('radar.verified_toast')),
                )
              }
            >
              <CheckCircle2 size={16} aria-hidden /> {t('radar.mark_verified')}
            </Button>
          ) : (
            <Button onClick={() => void up({ verification: 'unverified' })}>
              <ShieldQuestion size={16} aria-hidden /> {t('radar.mark_unverified')}
            </Button>
          )}
          {r.verification !== 'discarded' && (
            <Button
              variant="ghost"
              onClick={() => void up({ verification: 'discarded', lastCheckedAt: nowIso() })}
            >
              <XCircle size={16} aria-hidden /> {t('radar.discard')}
            </Button>
          )}
          <span className="meta">
            {r.lastCheckedAt
              ? t('radar.checked_on', { date: fmt.date(r.lastCheckedAt) })
              : t('radar.never_checked')}
          </span>
        </div>
        {r.verification !== 'verified' && <div className="banner warning">{t('radar.unverified_note')}</div>}
        <div className="form-grid">
          <div className="field">
            <label className="lbl" htmlFor="rp">
              {t('radar.f_period')}
            </label>
            <input
              id="rp"
              className="input"
              defaultValue={r.periodText ?? ''}
              onBlur={(e) => void up({ periodText: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label className="lbl" htmlFor="rpr">
              {t('radar.f_precision')}
            </label>
            <select
              id="rpr"
              className="select"
              value={r.precision}
              onChange={(e) => void up({ precision: e.target.value as RadarItem['precision'] })}
            >
              {RADAR_PRECISIONS.map((p) => (
                <option key={p} value={p}>
                  {t(`radar.precision.${p}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="lbl" htmlFor="rs">
              {t('radar.f_start')}
            </label>
            <input
              id="rs"
              type="date"
              className="input"
              value={r.startDate ?? ''}
              onChange={(e) => void up({ startDate: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label className="lbl" htmlFor="re">
              {t('radar.f_end')}
            </label>
            <input
              id="re"
              type="date"
              className="input"
              value={r.endDate ?? ''}
              onChange={(e) => void up({ endDate: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label className="lbl" htmlFor="rc">
              {t('radar.f_category')}
            </label>
            <input
              id="rc"
              className="input"
              defaultValue={r.category ?? ''}
              onBlur={(e) => void up({ category: e.target.value || null })}
            />
          </div>
          <div className="field">
            <label className="lbl" htmlFor="rn">
              {t('radar.f_next_review')}
            </label>
            <input
              id="rn"
              type="date"
              className="input"
              value={r.nextReviewAt ?? ''}
              onChange={(e) => void up({ nextReviewAt: e.target.value || null })}
            />
          </div>
        </div>
        <div className="field">
          <span className="lbl">{t('radar.f_angle')}</span>
          <AutoText
            multiline
            value={r.angle}
            onSave={(v) => up({ angle: v || null }, 'angle')}
            ariaLabel={t('radar.f_angle')}
            rows={2}
          />
        </div>
        <div className="field">
          <span className="lbl">{t('radar.f_decision')}</span>
          <AutoText
            value={r.decision}
            onSave={(v) => up({ decision: v || null }, 'dec')}
            ariaLabel={t('radar.f_decision')}
          />
        </div>
        <div className="field">
          <span className="lbl">{t('radar.f_sources')}</span>
          <ul className="source-list">
            {r.sources.map((src, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static text, position is the identity
              <li key={`${src.url}-${i}`}>
                {safeHttpUrl(src.url) ? (
                  <a href={safeHttpUrl(src.url)!} target="_blank" rel="noopener noreferrer">
                    {src.label} <ExternalLink size={12} aria-hidden />
                  </a>
                ) : (
                  src.label
                )}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => void up({ sources: r.sources.filter((_, k) => k !== i) })}
                >
                  {t('common.remove')}
                </button>
              </li>
            ))}
          </ul>
          <input
            className="input"
            placeholder={t('radar.add_source_ph')}
            aria-label={t('radar.add_source')}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              const url = safeHttpUrl(e.currentTarget.value.trim());
              if (!url) return;
              void up({ sources: [...r.sources, { label: new URL(url).hostname, url }] });
              e.currentTarget.value = '';
            }}
          />
        </div>
        <div className="field">
          <span className="lbl">{t('common.notes')}</span>
          <AutoText
            multiline
            value={r.notes}
            onSave={(v) => up({ notes: v || null }, 'notes')}
            ariaLabel={t('common.notes')}
            rows={2}
          />
        </div>
        {project && (
          <Link
            to="/projects/$id"
            params={{ id: project.id }}
            className="btn ghost"
            style={{ alignSelf: 'flex-start' }}
          >
            {t('radar.open_campaign', { name: project.name })}
          </Link>
        )}
      </div>
    </Sheet>
  );
}

function CampaignSheet({ r, onClose }: { r: RadarItem; onClose: () => void }) {
  useT();
  const s = useSession();
  const ws = useLive((ss) => ss.db.workspace.get('workspace'), [], undefined);
  const titles = {
    teaser: t('campaign.part_title.teaser', { title: r.title }),
    main: t('campaign.part_title.main', { title: r.title }),
    making_of: t('campaign.part_title.making_of', { title: r.title }),
    follow_up: t('campaign.part_title.follow_up', { title: r.title }),
  };
  const [name, setName] = useState(r.title.slice(0, 120));
  const [drafts, setDrafts] = useState<CampaignDraft[]>(() => campaignDraft(r, titles));
  const [hour, setHour] = useState(19);
  const load = useLive(
    async (ss) => {
      const dates = drafts.filter((d) => d.include && d.date).map((d) => d.date!);
      if (!dates.length) return 0;
      const from = new Date(`${dates.sort()[0]}T00:00:00`);
      from.setDate(from.getDate() - 3);
      const to = new Date(`${dates[dates.length - 1]}T23:59:59`);
      to.setDate(to.getDate() + 3);
      return ss.db.publications
        .where('scheduledAt')
        .between(from.toISOString(), to.toISOString())
        .filter((p) => !p.deletedAt && p.status !== 'cancelled')
        .count();
    },
    [drafts.map((d) => `${d.include}${d.date}`).join()],
    0,
  );
  const dated = drafts.some((d) => d.date);
  return (
    <Sheet
      open
      onClose={onClose}
      title={t('campaign.title')}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!drafts.some((d) => d.include)}
            onClick={async () => {
              await createCampaign(s, r, { name, drafts, hour, tz: workspaceTz(ws) });
              toast(t('campaign.created', { count: drafts.filter((d) => d.include).length }));
              onClose();
            }}
          >
            {t('campaign.create', { count: drafts.filter((d) => d.include).length })}
          </Button>
        </>
      }
    >
      <div className="stack">
        <p className="muted">{t('campaign.intro')}</p>
        {!dated && <div className="banner warning">{t('campaign.no_dates')}</div>}
        <div className="field">
          <label className="lbl" htmlFor="cname">
            {t('campaign.name')}
          </label>
          <input id="cname" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="list">
          {drafts.map((d, i) => (
            <div key={d.part} className="row static campaign-row">
              <input
                type="checkbox"
                checked={d.include}
                aria-label={t(`campaign.part.${d.part}`)}
                onChange={(e) =>
                  setDrafts(drafts.map((x, k) => (k === i ? { ...x, include: e.target.checked } : x)))
                }
              />
              <div className="grow stack" style={{ gap: 4 }}>
                <span className="lbl">{t(`campaign.part.${d.part}`)}</span>
                <input
                  className="input"
                  value={d.title}
                  aria-label={t('campaign.piece_title', { part: t(`campaign.part.${d.part}`) })}
                  onChange={(e) =>
                    setDrafts(drafts.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)))
                  }
                />
              </div>
              {dated && (
                <input
                  type="date"
                  className="input"
                  style={{ maxWidth: 170 }}
                  value={d.date ?? ''}
                  aria-label={t('campaign.date_for', { part: t(`campaign.part.${d.part}`) })}
                  onChange={(e) =>
                    setDrafts(drafts.map((x, k) => (k === i ? { ...x, date: e.target.value || null } : x)))
                  }
                />
              )}
            </div>
          ))}
        </div>
        {dated && (
          <div className="form-grid">
            <div className="field">
              <label className="lbl" htmlFor="chour">
                {t('campaign.hour')}
              </label>
              <input
                id="chour"
                type="number"
                min={0}
                max={23}
                className="input"
                value={hour}
                onChange={(e) => setHour(Math.max(0, Math.min(23, Number(e.target.value) || 0)))}
              />
            </div>
            <div className="field">
              <span className="lbl">{t('campaign.capacity')}</span>
              <div className={load >= (ws?.weeklyGoal ?? 3) ? 'warn-text' : 'meta'}>
                {t('campaign.load', { count: load })}
              </div>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
