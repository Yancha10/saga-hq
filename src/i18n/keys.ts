/** Readiness key → i18n key. Domain stays language-neutral ('cover'), only labels are translated. */
export const MISSING_LABEL_KEYS = {
  hook: 'missing.hook',
  script: 'missing.script',
  references: 'missing.references',
  finalExport: 'missing.finalExport',
  cover: 'missing.cover',
  coverText: 'missing.coverText',
  caption: 'missing.caption',
  hashtags: 'missing.hashtags',
  publishDate: 'missing.publishDate',
} as const;
