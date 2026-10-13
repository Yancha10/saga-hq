import { Link } from '@tanstack/react-router';
import { Clipboard, Download, ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApp, useLive, useSession } from '../../app/context';
import { toast } from '../../app/status';
import { getMeta } from '../../data/db';
import type { LibraryItem, Shot } from '../../data/schema';
import { t, useT } from '../../i18n';
import {
  buildHandoff,
  encodePayload,
  type Handoff,
  MAX_FRAGMENT_CHARS,
  studioDeepLink,
} from '../../studio/handoff';
import { Button, Sheet } from '../../ui/kit';
import { downloadText } from '../common';
import type { Bundle } from '../content/ContentDetail';

/** V1 handoff: fragment deep link for small payloads, JSON copy/download otherwise. No Drive cross-access. */
export function StudioHandoffSheet({
  open,
  onClose,
  b,
  shot,
}: {
  open: boolean;
  onClose: () => void;
  b: Bundle;
  shot?: Shot;
}) {
  useT();
  const s = useSession();
  const { account } = useApp();
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [payload, setPayload] = useState('');
  const [studioUrl, setStudioUrl] = useState('');
  const project = useLive(
    async (ss) => (b.content.projectId ? ss.db.projects.get(b.content.projectId) : undefined),
    [b.content.projectId],
    undefined,
  );
  useEffect(() => {
    if (!open) return;
    void (async () => {
      const refIds = b.links
        .filter((l) => l.type === 'references' && l.toType === 'library')
        .map((l) => l.toId);
      const refs = ((await s.db.library.bulkGet(refIds)) as (LibraryItem | undefined)[]).filter(
        (r): r is LibraryItem => !!r && !r.deletedAt,
      );
      const h = buildHandoff(
        b.content,
        project ?? undefined,
        refs,
        shot,
        account?.accountHint,
        b.template?.ratio,
      );
      setHandoff(h);
      setPayload(await encodePayload(h));
      setStudioUrl((await getMeta<string>(s.db, 'studioUrl')) ?? '');
    })();
  }, [open, b, shot, project, account, s]);
  const link = studioUrl && payload.length <= MAX_FRAGMENT_CHARS ? studioDeepLink(studioUrl, payload) : null;
  const json = handoff ? JSON.stringify(handoff, null, 2) : '';
  return (
    <Sheet open={open} onClose={onClose} title={shot ? t('studio.send_shot') : t('studio.send')} wide>
      <p className="meta">{t('studio.handoff_intro')}</p>
      <div className="hstack">
        {link ? (
          <a className="btn primary" href={link} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={14} /> {t('studio.open_in')}
          </a>
        ) : (
          <span className="meta">{studioUrl ? t('studio.too_large') : t('studio.set_url')}</span>
        )}
        <Button
          onClick={() => void navigator.clipboard?.writeText(json).then(() => toast(t('studio.json_copied')))}
        >
          <Clipboard size={14} /> {t('studio.copy_json')}
        </Button>
        <Button
          onClick={() =>
            downloadText(
              `${(b.content.title || 'content').slice(0, 40).replace(/[^\w-]+/g, '-')}.sagahandoff.json`,
              json,
            )
          }
        >
          <Download size={14} /> {t('studio.download')}
        </Button>
      </div>
      <details>
        <summary className="meta">{t('studio.preview', { n: payload.length })}</summary>
        <pre className="json">{json}</pre>
      </details>
      <p className="meta">
        {t('studio.results_back')} <Link to="/studio/import">{t('studio.import_here')}</Link>
      </p>
    </Sheet>
  );
}
