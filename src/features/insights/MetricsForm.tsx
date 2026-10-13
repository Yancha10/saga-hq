import { useState } from 'react';
import type { Platform } from '../../data/schema';
import { COMMON_METRICS } from '../../rules/analytics';
import { Button } from '../../ui/kit';

const PRIMARY = ['views', 'likes', 'comments', 'shares', 'saves'];

/** Quick manual entry. Only fill what the platform shows; nothing is required. */
export function MetricsForm({
  platform,
  onSubmit,
  initial,
}: {
  platform: Platform;
  onSubmit: (m: Record<string, number>) => Promise<void> | void;
  initial?: Record<string, number>;
}) {
  const [vals, setVals] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(initial ?? {}).map(([k, v]) => [k, String(v)])),
  );
  const [more, setMore] = useState(false);
  const shown = COMMON_METRICS.filter((m) => more || PRIMARY.includes(m.key));
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const out: Record<string, number> = {};
        for (const [k, v] of Object.entries(vals)) {
          const n = Number(String(v).replace(/[, ]/g, '').replace(/k$/i, '000'));
          if (v !== '' && Number.isFinite(n)) out[k] = n;
        }
        if (!Object.keys(out).length) return;
        await onSubmit(out);
      }}
    >
      <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
        {shown.map((m) => (
          <div key={m.key} className="field">
            <label className="lbl" htmlFor={`m-${m.key}`}>
              {m.label}
            </label>
            <input
              id={`m-${m.key}`}
              className="input num"
              inputMode="decimal"
              value={vals[m.key] ?? ''}
              onChange={(e) => setVals((v) => ({ ...v, [m.key]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      <div className="hstack">
        <Button type="submit" variant="primary">
          Save results
        </Button>
        <Button variant="ghost" onClick={() => setMore((x) => !x)}>
          {more ? 'Fewer metrics' : 'More metrics'}
        </Button>
        <span className="meta">
          Metrics are kept per platform ({platform}); they are never summed across platforms.
        </span>
      </div>
    </form>
  );
}
