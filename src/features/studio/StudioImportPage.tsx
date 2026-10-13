import { Link, useSearch } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useApp, useSession } from '../../app/context';
import { toast } from '../../app/status';
import { t, useT } from '../../i18n';
import { applyReturn, decodePayload, previewReturn, type ReturnPreview } from '../../studio/handoff';
import { Button } from '../../ui/kit';
import { PageHeader } from '../../ui/PageHeader';

/** Import a saga.return from Studio: deep link (#/studio/import?r=…), pasted JSON, or a file. */
export function StudioImportPage() {
  useT();
  const s = useSession();
  const { account } = useApp();
  const search = useSearch({ strict: false }) as { r?: string };
  const [text, setText] = useState('');
  const [pv, setPv] = useState<ReturnPreview | null>(null);
  const [confirmMismatch, setConfirmMismatch] = useState(false);
  useEffect(() => {
    if (search.r)
      void decodePayload(search.r)
        .then((raw) => previewReturn(s, raw, account?.accountHint))
        .then(setPv)
        .catch(() => setPv({ ok: false, error: 'RETURN_LINK' }));
  }, [search.r, s, account]);
  const check = async (raw: string) => {
    try {
      setPv(await previewReturn(s, await decodePayload(raw.trim()), account?.accountHint));
    } catch {
      setPv({ ok: false, error: 'RETURN_JSON' });
    }
  };
  return (
    <div className="page narrow">
      <PageHeader back title={t('h.studioImport')} sub={t('studio.import_sub')} />
      <div className="stack">
        <textarea
          className="textarea"
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('studio.paste')}
          aria-label={t('studio.return_json')}
        />
        <div className="hstack">
          <Button onClick={() => void check(text)}>{t('studio.check')}</Button>
          <label className="btn">
            {t('common.choose_file')}
            <input
              type="file"
              accept=".json,application/json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) {
                  const raw = await f.text();
                  setText(raw);
                  void check(raw);
                }
              }}
            />
          </label>
        </div>
        {pv && !pv.ok && (
          <div className="banner error" style={{ borderRadius: 8 }}>
            {t(`studio.error.${pv.error}`)}
          </div>
        )}
        {pv?.ok && pv.data && pv.content && (
          <div className="box">
            <div>
              <Link to="/content/$id" params={{ id: pv.content.id }}>
                {pv.content.title || t('common.untitled')}
              </Link>
              {': '}
              {t('studio.gens', { count: pv.data.generations.length })},{' '}
              {t('studio.outs', { count: pv.data.generations.reduce((n, g) => n + g.outputs.length, 0) })}
            </div>
            {pv.accountMismatch && (
              <label className="check banner warning" style={{ borderRadius: 8 }}>
                <input
                  type="checkbox"
                  checked={confirmMismatch}
                  onChange={(e) => setConfirmMismatch(e.target.checked)}
                />
                {t('studio.mismatch')}
              </label>
            )}
            <div>
              <Button
                variant="primary"
                disabled={pv.accountMismatch && !confirmMismatch}
                onClick={async () => {
                  const n = await applyReturn(s, pv.data!);
                  toast(t('studio.attached', { count: n }));
                  setPv(null);
                  setText('');
                }}
              >
                {t('studio.attach')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
