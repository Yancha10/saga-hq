import { useRouter } from '@tanstack/react-router';
import { ChevronLeft, Search, Sparkles } from 'lucide-react';
import { type ReactNode, useEffect } from 'react';
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
  useCollapsingTitle();
  return (
    <>
      <header className="topbar">
        {back && (
          <IconButton label={t('common.back')} onClick={() => router.history.back()}>
            <ChevronLeft size={20} />
          </IconButton>
        )}
        <div className="topbar-title" aria-hidden>
          {title}
        </div>
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

/** Marks the document as scrolled so the compact top-bar title can fade in (phone only, via CSS). */
function useCollapsingTitle(): void {
  useEffect(() => {
    const root = document.documentElement;
    const on = () => root.toggleAttribute('data-scrolled', window.scrollY > 36);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
}
