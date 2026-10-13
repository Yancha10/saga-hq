import { useState } from 'react';
import { useSession } from '../../app/context';
import { requestPersistence } from '../../app/pwa';
import { nowIso } from '../../core/util';
import { PLATFORM_LABEL, type Platform } from '../../data/schema';
import { create, update } from '../../data/store';
import { Button } from '../../ui/kit';
import { PlatformPicker } from '../common';

/** Short, optional, skippable setup — shown inline on Today, never a wizard maze. */
export function Onboarding() {
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
        <h3 id="ob">Set up Saga HQ (optional)</h3>
        <span className="spacer" />
        <Button size="sm" variant="ghost" onClick={() => void finish(true)}>
          Skip
        </Button>
      </div>
      <div className="field">
        <span className="lbl">Where do you publish?</span>
        <PlatformPicker value={platforms} onChange={setPlatforms} />
      </div>
      {platforms.length > 0 && (
        <div className="field">
          <span className="lbl">
            Target posts per week (optional — used only to spot gaps, never to auto-schedule)
          </span>
          <div className="hstack">
            {platforms.map((p) => (
              <label key={p} className="hstack meta">
                {PLATFORM_LABEL[p]}
                <input
                  type="number"
                  min={0}
                  max={50}
                  className="input"
                  style={{ width: 70 }}
                  value={cadence[p] ?? ''}
                  onChange={(e) => setCadence((c) => ({ ...c, [p]: Number(e.target.value) }))}
                  aria-label={`${PLATFORM_LABEL[p]} posts per week`}
                />
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="field">
        <label className="lbl" htmlFor="ob-proj">
          First project (optional)
        </label>
        <input
          id="ob-proj"
          className="input"
          placeholder="e.g. Halloween 2026"
          value={project}
          onChange={(e) => setProject(e.target.value)}
        />
      </div>
      <div>
        <Button variant="primary" onClick={() => void finish()}>
          Save setup
        </Button>
      </div>
    </section>
  );
}
