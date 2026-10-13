import { useNavigate } from '@tanstack/react-router';
import {
  BookMarked,
  CalendarRange,
  CheckSquare,
  Clapperboard,
  FileUp,
  Lightbulb,
  Radar,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';
import { useSession } from '../../app/context';
import { toast } from '../../app/status';
import { logger } from '../../diagnostics/logger';
import { fmt, t, useT } from '../../i18n';
import {
  applyImport,
  IMPORT_KINDS,
  type ImportKind,
  type ImportMode,
  type ImportPlan,
  planImport,
} from '../../import/apply';
import { PackageError, parsePackage, type SagaPackage } from '../../import/sagaLai';
import { Button, Section } from '../../ui/kit';

const KIND_ICON = {
  chapters: BookMarked,
  pieces: Clapperboard,
  radar: Radar,
  tasks: CheckSquare,
  ideas: Lightbulb,
  sessions: Sparkles,
} as const;

/** Settings › Import: the Saga Lai package (document, HTML v2 or JSON backup), read on this device only. */
export function ImportPackageSec() {
  useT();
  const s = useSession();
  const navigate = useNavigate();
  const [pkg, setPkg] = useState<SagaPackage | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [file, setFile] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [series, setSeries] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ created: number; updated: number; skipped: number } | null>(null);
  const existing = plan ? IMPORT_KINDS.reduce((n, k) => n + plan.kinds[k].existing, 0) : 0;

  const choose = async (f: File) => {
    setErr(null);
    setDone(null);
    setPkg(null);
    setPlan(null);
    try {
      const p = parsePackage(await f.text(), f.name);
      setPkg(p);
      setFile(f.name);
      setPlan(await planImport(s, p));
      setSeries([]);
    } catch (e) {
      logger.warn('import', 'package not readable', e);
      setErr(e instanceof PackageError ? e.code : 'PKG_UNKNOWN');
    }
  };

  return (
    <>
      <Section title={t('import.title')}>
        <div className="box import-drop">
          <p className="muted">{t('import.desc')}</p>
          <label className="btn primary" style={{ alignSelf: 'flex-start' }}>
            <FileUp size={16} aria-hidden /> {t('import.choose')}
            <input
              type="file"
              accept=".md,.markdown,.txt,.html,.htm,.json,text/markdown,text/html,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void choose(f);
                e.target.value = '';
              }}
            />
          </label>
          <p className="meta explain">{t('import.privacy')}</p>
          {err && (
            <div className="banner error" role="alert" style={{ borderRadius: 8 }}>
              {t(`import.error.${err}`)} {t('settings.nothing_changed')}
            </div>
          )}
        </div>
      </Section>
      {pkg && plan && (
        <Section title={t('import.preview', { file })}>
          <div className="import-grid">
            {IMPORT_KINDS.filter((k) => plan.kinds[k].total).map((k: ImportKind) => {
              const Icon = KIND_ICON[k];
              return (
                <div key={k} className="import-tile">
                  <Icon size={18} aria-hidden />
                  <div className="num big">{fmt.num(plan.kinds[k].total)}</div>
                  <div className="meta">{t(`import.kind.${k}`)}</div>
                  {plan.kinds[k].existing > 0 && (
                    <div className="pill">{t('import.already', { count: plan.kinds[k].existing })}</div>
                  )}
                </div>
              );
            })}
            {plan.checklist > 0 && (
              <div className="import-tile">
                <CheckSquare size={18} aria-hidden />
                <div className="num big">{fmt.num(plan.checklist)}</div>
                <div className="meta">{t('import.kind.checklist')}</div>
              </div>
            )}
          </div>
          <div className="box">
            {plan.span && (
              <div className="hstack">
                <CalendarRange size={16} aria-hidden />
                {t('import.span', {
                  count: plan.dated,
                  from: fmt.date(plan.span.from),
                  to: fmt.date(plan.span.to),
                })}
              </div>
            )}
            {!!plan.prefs.length && <div className="meta">{t('import.prefs_note')}</div>}
            <div className="meta">{t('import.unverified_note')}</div>
            {pkg.warnings.length > 0 && (
              <div className="meta">{t('import.skipped', { count: pkg.warnings.length })}</div>
            )}
          </div>
          {plan.pillars.length > 0 && (
            <fieldset className="box">
              <legend className="lbl">{t('import.series_q')}</legend>
              <p className="meta explain">{t('import.series_hint')}</p>
              <div className="chips">
                {plan.pillars.map((p) => (
                  <label key={p} className="check chip-check">
                    <input
                      type="checkbox"
                      checked={series.includes(p)}
                      onChange={(e) =>
                        setSeries(e.target.checked ? [...series, p] : series.filter((x) => x !== p))
                      }
                    />{' '}
                    {p}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {existing > 0 && (
            <fieldset className="box">
              <legend className="lbl">{t('import.mode_q', { count: existing })}</legend>
              {(['merge', 'keep', 'replace'] as const).map((m) => (
                <label key={m} className="check">
                  <input type="radio" name="imode" checked={mode === m} onChange={() => setMode(m)} />{' '}
                  <span>
                    <strong>{t(`import.mode.${m}`)}</strong>{' '}
                    <span className="meta">{t(`import.mode_desc.${m}`)}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <div className="hstack">
            <Button
              variant="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await applyImport(s, pkg, {
                    mode,
                    seriesPillars: series,
                    sourceLabel: file,
                  });
                  setDone(r);
                  setPlan(await planImport(s, pkg));
                  toast(t('import.done_toast', { count: r.created + r.updated }));
                } catch (e) {
                  logger.error('import', 'apply failed', e);
                  setErr('PKG_APPLY');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? t('import.applying') : t('import.apply')}
            </Button>
            <Button variant="ghost" onClick={() => (setPkg(null), setPlan(null))}>
              {t('common.cancel')}
            </Button>
          </div>
          {done && (
            <div className="banner ok" role="status" style={{ borderRadius: 8 }}>
              {t('import.result', { created: done.created, updated: done.updated, skipped: done.skipped })}{' '}
              <span className="meta">{t('import.undo_hint')}</span>
              <div className="hstack" style={{ marginTop: 8 }}>
                <Button size="sm" onClick={() => void navigate({ to: '/content' })}>
                  {t('nav.content')}
                </Button>
                <Button size="sm" onClick={() => void navigate({ to: '/bible' })}>
                  {t('nav.bible')}
                </Button>
                <Button size="sm" onClick={() => void navigate({ to: '/radar' })}>
                  {t('nav.radar')}
                </Button>
              </div>
            </div>
          )}
        </Section>
      )}
    </>
  );
}
