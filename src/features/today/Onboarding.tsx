import { useState } from 'react';
import { useSession } from '../../app/context';
import { requestPersistence } from '../../app/pwa';
import { nowIso } from '../../core/util';
import type { Platform } from '../../data/schema';
import { create, update } from '../../data/store';
import { t, useT } from '../../i18n';
import { platformName } from '../../i18n/render';
import { Button } from '../../ui/kit';
import { PlatformPicker } from '../common';
import { LanguageSelect } from '../settings/LanguageSelect';

/** Short, optional, skippable setup — shown inline on Today, never a wizard maze. */
export function Onboarding() {
  useT();
  const s = useSession();
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [cadence, setCadence] = useState<Record<string, number>>({});
  const [project, setProject] = useState('');
  const finish = async (skip = false) => {
    if (!skip) {
      await update(s, 'workspace', 'workspace', {
        platforms,
        cadence: platforms.filter((p) => cadence[p]).map((p) => ({ platform: p, perWeek: cadence[p]! })),
        onboardedAt: nowIso(),
      });
      if (project.trim())
        await create(s, 'projects', { name: project.trim(), status: 'active', isFocus: true, color: 1 });
    } else await update(s, 'workspace', 'workspace', { onboardedAt: nowIso() });
    void requestPersistence();
  };
  return (
    <section className="box" style={{ marginBottom: 24 }} aria-labelledby="ob">
      <div className="hstack">
        <h3 id="ob">{t('onboarding.title')}</h3>
        <span className="spacer" />
        <Button size="sm" variant="ghost" onClick={() => void finish(true)}>
          {t('onboarding.skip')}
        </Button>
      </div>
      <LanguageSelect />
      <div className="field">
        <span className="lbl">{t('onboarding.where')}</span>
        <PlatformPicker value={platforms} onChange={setPlatforms} />
      </div>
      {platforms.length > 0 && (
        <div className="field">
          <span className="lbl">{t('onboarding.cadence')}</span>
          <div className="hstack">
            {platforms.map((p) => (
              <label key={p} className="hstack meta">
                {platformName(p)}
                <input
                  type="number"
                  min={0}
                  max={50}
                  className="input"
                  style={{ width: 70 }}
                  value={cadence[p] ?? ''}
                  onChange={(e) => setCadence((c) => ({ ...c, [p]: Number(e.target.value) }))}
                  aria-label={t('onboarding.per_week', { platform: platformName(p) })}
                />
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="field">
        <label className="lbl" htmlFor="ob-proj">
          {t('onboarding.first_project')}
        </label>
        <input
          id="ob-proj"
          className="input"
          placeholder={t('onboarding.project_placeholder')}
          value={project}
          onChange={(e) => setProject(e.target.value)}
        />
      </div>
      <div>
        <Button variant="primary" onClick={() => void finish()}>
          {t('onboarding.save')}
        </Button>
      </div>
    </section>
  );
}
