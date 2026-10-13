import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useSession } from '../../app/context';
import { toast } from '../../app/status';
import { nowIso } from '../../core/util';
import type { Learning, Platform } from '../../data/schema';
import { mutate } from '../../data/store';
import { Button, Sheet } from '../../ui/kit';
import { PlatformPicker } from '../common';

/**
 * Learnings distinguish OBSERVATION / HYPOTHESIS / CONCLUSION. A conclusion with thin evidence is
 * allowed only with an explicit warning — correlation is not causation.
 */
export function LearningEditor({
  open,
  onClose,
  evidence = [],
  initial,
}: {
  open: boolean;
  onClose: () => void;
  evidence?: { type: 'content' | 'publication'; id: string; label: string }[];
  initial?: Partial<Learning>;
}) {
  const s = useSession();
  const navigate = useNavigate();
  const [statement, setStatement] = useState(initial?.statement ?? '');
  const [kind, setKind] = useState<Learning['kind']>(initial?.kind ?? 'observation');
  const [confidence, setConfidence] = useState<Learning['confidence']>(initial?.confidence ?? 'low');
  const [platforms, setPlatforms] = useState<Platform[]>(initial?.scope?.platforms ?? []);
  const [note, setNote] = useState(initial?.evidenceNote ?? '');
  const weak = kind === 'conclusion' && evidence.length < 5;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Write a learning"
      footer={
        <Button
          variant="primary"
          disabled={!statement.trim()}
          onClick={async () => {
            const l = await mutate(s, { label: 'Save learning' }, async (m) => {
              const rec = await m.create('learnings', {
                statement: statement.trim(),
                kind,
                confidence,
                status: 'active',
                scope: { ...(platforms.length ? { platforms } : {}) },
                evidenceNote: note || null,
                lastValidatedAt: nowIso(),
              });
              for (const e of evidence)
                await m.create('links', {
                  fromType: 'learning',
                  fromId: rec.id,
                  toType: e.type,
                  toId: e.id,
                  type: 'evidence',
                });
              return rec;
            });
            toast('Learning saved', {
              action: {
                label: 'Open',
                run: () => void navigate({ to: '/learnings/$id', params: { id: l.id } }),
              },
            });
            setStatement('');
            onClose();
          }}
        >
          Save learning
        </Button>
      }
    >
      <div className="field">
        <label className="lbl" htmlFor="lstmt">
          Statement
        </label>
        <textarea
          id="lstmt"
          className="textarea"
          rows={3}
          autoFocus
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
          placeholder="e.g. Videos that open with dialogue held viewers longer on TikTok"
        />
      </div>
      <div className="form-grid">
        <div className="field">
          <label className="lbl" htmlFor="lkind">
            Type
          </label>
          <select
            id="lkind"
            className="select"
            value={kind}
            onChange={(e) => setKind(e.target.value as Learning['kind'])}
          >
            <option value="observation">Observation — what happened</option>
            <option value="hypothesis">Hypothesis — a guess to test</option>
            <option value="conclusion">Conclusion — repeatedly supported</option>
          </select>
        </div>
        <div className="field">
          <label className="lbl" htmlFor="lconf">
            Confidence
          </label>
          <select
            id="lconf"
            className="select"
            value={confidence}
            onChange={(e) => setConfidence(e.target.value as Learning['confidence'])}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
      </div>
      {weak && (
        <div className="banner warning" style={{ borderRadius: 8 }}>
          A conclusion usually needs at least 5 supporting pieces. You have {evidence.length}. Consider
          “hypothesis”.
        </div>
      )}
      <div className="field">
        <span className="lbl">Applies to platforms</span>
        <PlatformPicker value={platforms} onChange={setPlatforms} />
      </div>
      <div className="field">
        <label className="lbl" htmlFor="lnote">
          Evidence notes
        </label>
        <textarea
          id="lnote"
          className="textarea"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Numbers, comparisons, sample size…"
        />
      </div>
      {evidence.length > 0 && (
        <div className="meta">Linked evidence: {evidence.map((e) => e.label).join(', ')}</div>
      )}
      <p className="meta">Note: results show correlation, not causation. Revalidate as new results arrive.</p>
    </Sheet>
  );
}
