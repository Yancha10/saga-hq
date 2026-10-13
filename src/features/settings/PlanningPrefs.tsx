import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useLive, useSession } from '../../app/context';
import { toast } from '../../app/status';
import { ulid } from '../../core/ulid';
import { checklistOf, DEFAULT_PREFS, saveChecklist, workspaceTz } from '../../data/saga';
import type { CheckItem } from '../../data/schema';
import { update } from '../../data/store';
import { t, useT } from '../../i18n';
import { Button, IconButton, Section } from '../../ui/kit';

const zones = (): string[] => {
  try {
    return (
      (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ??
      []
    );
  } catch {
    return [];
  }
};

/** Capacity, goal, time zone and the editorial checklist. Values are the user's, never assumed decisions. */
export function PlanningPrefs() {
  useT();
  const s = useSession();
  const ws = useLive((ss) => ss.db.workspace.get('workspace'), [], undefined);
  const [draft, setDraft] = useState<CheckItem[] | null>(null);
  const [newItem, setNewItem] = useState('');
  if (!ws) return null;
  const cl = checklistOf(ws);
  const items: CheckItem[] =
    draft ?? cl.items.map((i) => ({ id: i.id, text: i.text ?? t(`checklist.default.${i.id}`) }));
  const tz = workspaceTz(ws);
  const all = zones();
  const up = (patch: Record<string, unknown>) =>
    update(s, 'workspace', 'workspace', patch as never, { label: 'h.prefs' });
  return (
    <>
      <Section title={t('prefs.title')}>
        <p className="meta explain">{t('prefs.hint')}</p>
        <div className="form-grid">
          <div className="field">
            <label className="lbl" htmlFor="ptz">
              {t('prefs.timezone')}
            </label>
            {all.length ? (
              <select
                id="ptz"
                className="select"
                value={tz}
                onChange={(e) => void up({ timezone: e.target.value })}
              >
                {all.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="ptz"
                className="input"
                defaultValue={tz}
                onBlur={(e) => void up({ timezone: e.target.value.trim() || null })}
              />
            )}
          </div>
          <div className="field">
            <label className="lbl" htmlFor="powner">
              {t('prefs.owner')}
            </label>
            <input
              id="powner"
              className="input"
              defaultValue={ws.ownerName ?? ''}
              onBlur={(e) => void up({ ownerName: e.target.value.trim() || null })}
            />
          </div>
          <div className="field">
            <label className="lbl" htmlFor="phours">
              {t('prefs.weekly_hours')}
            </label>
            <input
              id="phours"
              type="number"
              min={0}
              max={168}
              step={0.5}
              className="input"
              defaultValue={ws.weeklyHours ?? DEFAULT_PREFS.weeklyHours}
              onBlur={(e) =>
                e.target.value !== '' &&
                void up({ weeklyHours: Math.max(0, Math.min(168, Number(e.target.value))) })
              }
            />
          </div>
          <div className="field">
            <label className="lbl" htmlFor="pgoal">
              {t('prefs.weekly_goal')}
            </label>
            <input
              id="pgoal"
              type="number"
              min={0}
              max={100}
              className="input"
              defaultValue={ws.weeklyGoal ?? DEFAULT_PREFS.weeklyGoal}
              onBlur={(e) =>
                e.target.value !== '' &&
                void up({ weeklyGoal: Math.max(0, Math.min(100, Number(e.target.value))) })
              }
            />
          </div>
        </div>
        {(ws.weeklyHours === undefined || ws.weeklyHours === null) && (
          <p className="meta">{t('prefs.example_values')}</p>
        )}
      </Section>
      <Section title={t('prefs.checklist')}>
        <p className="meta explain">{t('prefs.checklist_hint', { version: cl.version })}</p>
        <ol className="check-editor">
          {items.map((it, i) => (
            <li key={it.id}>
              <input
                className="input"
                value={it.text}
                aria-label={t('prefs.check_item', { n: i + 1 })}
                onChange={(e) =>
                  setDraft(items.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))
                }
              />
              <IconButton
                size="sm"
                label={t('saga.shot_up', { n: i + 1 })}
                disabled={i === 0}
                onClick={() => {
                  const n = [...items];
                  [n[i - 1], n[i]] = [n[i]!, n[i - 1]!];
                  setDraft(n);
                }}
              >
                <ArrowUp size={14} />
              </IconButton>
              <IconButton
                size="sm"
                label={t('saga.shot_down', { n: i + 1 })}
                disabled={i === items.length - 1}
                onClick={() => {
                  const n = [...items];
                  [n[i + 1], n[i]] = [n[i]!, n[i + 1]!];
                  setDraft(n);
                }}
              >
                <ArrowDown size={14} />
              </IconButton>
              <IconButton
                size="sm"
                label={t('prefs.remove_item', { n: i + 1 })}
                onClick={() => setDraft(items.filter((_, k) => k !== i))}
              >
                <Trash2 size={14} />
              </IconButton>
            </li>
          ))}
        </ol>
        <div className="hstack">
          <input
            className="input"
            value={newItem}
            placeholder={t('prefs.new_item')}
            aria-label={t('prefs.new_item')}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newItem.trim()) {
                setDraft([...items, { id: `u${ulid().slice(-8).toLowerCase()}`, text: newItem.trim() }]);
                setNewItem('');
              }
            }}
          />
          <Button
            size="sm"
            disabled={!newItem.trim()}
            onClick={() => {
              setDraft([...items, { id: `u${ulid().slice(-8).toLowerCase()}`, text: newItem.trim() }]);
              setNewItem('');
            }}
          >
            <Plus size={13} aria-hidden /> {t('common.add')}
          </Button>
        </div>
        {draft && (
          <div className="hstack">
            <Button
              variant="primary"
              onClick={async () => {
                await saveChecklist(
                  s,
                  ws,
                  draft
                    .filter((x) => x.text.trim())
                    .map((x) => ({ id: x.id.slice(0, 40), text: x.text.trim().slice(0, 500) })),
                );
                setDraft(null);
                toast(t('prefs.checklist_saved'));
              }}
            >
              {t('prefs.save_checklist')}
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        )}
      </Section>
    </>
  );
}
