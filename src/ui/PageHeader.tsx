import { useRouter } from '@tanstack/react-router';
import { ChevronLeft, Search, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { useApp } from '../app/context';
import { useT } from '../i18n';
import { IconButton } from './kit';

/** Desktop: inline page heading. Phone: sticky top bar with back, title, search and Secretary. */
export function PageHeader({
  title,
  sub,
  actions,
  back,
}: {
  title: string;
  sub?: ReactNode;
  actions?: ReactNode;
  back?: boolean;
}) {
  const { openPalette, toggleSecretary } = useApp();
  const router = useRouter();
  const { t } = useT();
  return (
    <>
      <header className="topbar">
        {back && (
          <IconButton label={t('common.back')} onClick={() => router.history.back()}>
            <ChevronLeft size={20} />
          </IconButton>
        )}
        <h1>{title}</h1>
        <IconButton label={t('common.search')} onClick={openPalette}>
          <Search size={19} />
        </IconButton>
        <IconButton label={t('nav.secretary')} onClick={() => toggleSecretary()}>
          <Sparkles size={19} />
        </IconButton>
      </header>
      <div className="page-head">
        <div>
          <h1 className="desk">{title}</h1>
          {sub && <div className="page-sub">{sub}</div>}
        </div>
        <span className="spacer" />
        {actions}
      </div>
    </>
  );
}
