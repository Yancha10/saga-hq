import { useId } from 'react';
import { LOCALE_NAME, LOCALES, type Locale, setLocale, useT } from '../../i18n';

/** Explicit language choice (names, not flags). Device preference; never touches workspace data. */
export function LanguageSelect({ compact }: { compact?: boolean }) {
  const { t, locale } = useT();
  const id = useId();
  return (
    <div className={compact ? 'hstack' : 'field'} style={compact ? { gap: 6 } : undefined}>
      <label className="lbl" htmlFor={id}>
        {t('settings.language')}
      </label>
      <select
        id={id}
        data-testid="ui-lang"
        className="select"
        style={compact ? { width: 'auto', minHeight: 32 } : undefined}
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>
            {LOCALE_NAME[l]}
          </option>
        ))}
      </select>
    </div>
  );
}
