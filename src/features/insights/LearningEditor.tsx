import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useSession } from '../../app/context';
import { toast } from '../../app/status';
import { nowIso } from '../../core/util';
import type { Learning, Platform } from '../../data/schema';
import { mutate } from '../../data/store';
import { t, useT } from '../../i18n';
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
  useT();
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
      title={t('learning.write')}
      footer={
        <Button
          variant="primary"
          disabled={!statement.trim()}
          onClick={async () => {
            const l = await mutate(s, { label: 'h.saveLearning' }, async (m) => {
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
            toast(t('learning.saved'), {
              action: {
                label: t('common.open'),
                run: () => void navigate({ to: '/learnings/$id', params: { id: l.id } }),
              },
            });
            setStatement('');
            onClose();
          }}
        >
          {t('ai.action.saveLearning')}
        </Button>
      }
    >
      <div className="field">
        <label className="lbl" htmlFor="lstmt">
          {t('field.statement')}
        </label>
        <textarea
          id="lstmt"
          className="textarea"
          rows={3}
          autoFocus
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
          placeholder={t('learning.statement_placeholder')}
        />
      </div>
      <div className="form-grid">
        <div className="field">
          <label className="lbl" htmlFor="lkind">
            {t('task.kind_label')}
          </label>
          <select
            id="lkind"
            className="select"
            value={kind}
            onChange={(e) => setKind(e.target.value as Learning['kind'])}
          >
            <option value="observation">{t('learning.kind_opt.observation')}</option>
            <option value="hypothesis">{t('learning.kind_opt.hypothesis')}</option>
            <option value="conclusion">{t('learning.kind_opt.conclusion')}</option>
          </select>
        </div>
        <div className="field">
          <label className="lbl" htmlFor="lconf">
            {t('learning.confidence')}
          </label>
          <select
            id="lconf"
            className="select"
            value={confidence}
            onChange={(e) => setConfidence(e.target.value as Learning['confidence'])}
          >
            <option value="low">{t('priority.low')}</option>
            <option value="medium">{t('priority.med')}</option>
            <option value="high">{t('priority.high')}</option>
          </select>
        </div>
      </div>
      {weak && (
        <div className="banner warning" style={{ borderRadius: 8 }}>
          {t('learning.weak', { count: evidence.length })}
        </div>
      )}
      <div className="field">
        <span className="lbl">{t('learning.applies_to')}</span>
        <PlatformPicker value={platforms} onChange={setPlatforms} />
      </div>
      <div className="field">
        <label className="lbl" htmlFor="lnote">
          {t('learning.evidence_notes')}
        </label>
        <textarea
          id="lnote"
          className="textarea"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('learning.note_placeholder')}
        />
      </div>
      {evidence.length > 0 && (
        <div className="meta">
          {t('learning.linked_list', { list: evidence.map((e) => e.label).join(', ') })}
        </div>
      )}
      <p className="meta">{t('learning.note')}</p>
    </Sheet>
  );
}
