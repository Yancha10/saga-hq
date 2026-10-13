import { Link, useSearch } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useApp, useSession } from '../../app/context';
import { toast } from '../../app/status';
import { applyReturn, decodePayload, previewReturn, type ReturnPreview } from '../../studio/handoff';
import { Button } from '../../ui/kit';
import { PageHeader } from '../../ui/PageHeader';

/** Import a saga.return from Studio: deep link (#/studio/import?r=…), pasted JSON, or a file. */
export function StudioImportPage() {
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
        .catch(() => setPv({ ok: false, error: 'Could not read the link payload.' }));
  }, [search.r, s, account]);
  const check = async (t: string) => {
    try {
      setPv(await previewReturn(s, await decodePayload(t.trim()), account?.accountHint));
    } catch {
      setPv({ ok: false, error: 'Not valid JSON.' });
    }
  };
  return (
    <div className="page narrow">
      <PageHeader
        back
        title="Import Saga Studio results"
        sub="saga.return v1 — selected outputs become assets linked to the content."
      />
      <div className="stack">
        <textarea
          className="textarea"
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste saga.return JSON"
          aria-label="saga.return JSON"
        />
        <div className="hstack">
          <Button onClick={() => void check(text)}>Check</Button>
          <label className="btn">
            Choose file
            <input
              type="file"
              accept=".json,application/json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) {
                  const t = await f.text();
                  setText(t);
                  void check(t);
                }
              }}
            />
          </label>
        </div>
        {pv && !pv.ok && (
          <div className="banner error" style={{ borderRadius: 8 }}>
            {pv.error}
          </div>
        )}
        {pv?.ok && pv.data && pv.content && (
          <div className="box">
            <div>
              For{' '}
              <Link to="/content/$id" params={{ id: pv.content.id }}>
                {pv.content.title}
              </Link>
              : {pv.data.generations.length} generation(s),{' '}
              {pv.data.generations.reduce((n, g) => n + g.outputs.length, 0)} output(s).
            </div>
            {pv.accountMismatch && (
              <label className="check banner warning" style={{ borderRadius: 8 }}>
                <input
                  type="checkbox"
                  checked={confirmMismatch}
                  onChange={(e) => setConfirmMismatch(e.target.checked)}
                />
                This package came from a different Saga account. Import anyway?
              </label>
            )}
            <div>
              <Button
                variant="primary"
                disabled={pv.accountMismatch && !confirmMismatch}
                onClick={async () => {
                  const n = await applyReturn(s, pv.data!);
                  toast(`${n} output(s) attached`);
                  setPv(null);
                  setText('');
                }}
              >
                Attach to content
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
