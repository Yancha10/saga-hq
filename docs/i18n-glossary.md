# Saga HQ — i18n architecture and Spanish glossary

## Architecture (summary)

- **Dictionaries**: `src/i18n/en.ts` (source of keys, technical fallback) and `src/i18n/es.ts`
  (typed `Record<MessageKey, string>`, so a missing Spanish key fails `tsc`). No dependency.
- **API**: `t(key, params)` with `{param}` interpolation, plurals through `Intl.PluralRules`
  (`key_one` / `key_other`), `fmt.*` formatters built on `Intl.DateTimeFormat`, `Intl.NumberFormat`,
  `Intl.RelativeTimeFormat` and `Intl.ListFormat`, `parseNum()` for locale-typed numbers.
  `useT()` re-renders on a language change, so switching is hot (no reload, no state lost).
- **Locale** is a *device preference* (`localStorage['hq.locale']`). Detection: the first browser
  language starting with `es` gives Spanish, otherwise English. An explicit choice is persisted and
  always wins. `<html lang>` is updated on every change, and every open tab follows the choice
  (`storage` event).
- **Neutral data**: rules, sync, history, errors and recovery points store *codes*
  (`reason.only_missing`, `h.status`, `SYNC_NEEDS_AUTH`, `BACKUP_CHECKSUM`, `restore_backup`…).
  `src/i18n/render.ts` turns them into text at render time. Enums such as `status: 'ready'` are never
  translated in storage, Drive, backups, handoffs or IDs. User content is never translated.
- **Built-in template names** stay canonical in data. They are shown localized while the user has not
  renamed them (`templateName()`).
- **Search** is language-independent: it indexes user content as written. Filter keywords accept both
  languages (`type:`/`tipo:`, `status:`/`estado:`, `is:archived`/`es:archivado`, Spanish status
  values). Palette navigation matches names in both languages (“proyectos” and “projects”). Routes are
  not localized.
- **Secretary**: the system prompt asks for answers in the UI language unless the request explicitly
  asks for another language. Deterministic facts and notes are localized. Action JSON (types, keys and
  status values) stays neutral English identifiers.
- **Guards (CI)** live in `tests/unit/i18n.test.ts`:
  - key parity between languages;
  - matching placeholders;
  - plural pairs;
  - every literal key used in the source exists;
  - complete dynamic families for every enum value;
  - the hard-coded-string audit;
  - detection and persistence;
  - plural and number formats;
  - no raw keys;
  - glossary checks;
  - neutral data and byte-identical data across a language switch.

  `e2e/i18n.spec.ts` and `e2e/i18n-offline.spec.ts` run the app in a Spanish browser.

## Adding a string

1. Add the key to `en.ts` and `es.ts` (the build fails if Spanish is missing).
2. Use `t('area.key')` in a component that calls `useT()`, or a render helper for codes.
3. Never build sentences by concatenating translated fragments when word order can differ. Use one
   key with parameters. Use `_one`/`_other` for anything with a count.

## Glossary (neutral Spanish, tú form)

| English | Español |
|---|---|
| Today | Hoy |
| Inbox | Bandeja |
| Quick Capture / Capture | Captura rápida / Capturar |
| Ideas | Ideas |
| Idea Lab | Laboratorio de ideas |
| Shortlist / Shortlisted | Preseleccionar / Preseleccionada |
| Parked | Aparcada |
| Projects | Proyectos |
| Focus | Foco |
| Tasks / All tasks | Tareas / Todas las tareas |
| Blocker / Blocked | Bloqueante / Bloqueado |
| Decision | Decisión |
| Due / Overdue / Hard deadline | Vence / Vencida / Fecha límite estricta |
| Content | Contenido |
| Production sheet | Hoja de producción |
| Planned / Producing | Planificado / En producción |
| Ready to publish | Listo para publicar |
| Scheduled / Published / Reviewed | Programado / Publicado / Revisado |
| Hook | Gancho |
| Script | Guion |
| Caption | Descripción |
| Cover / Cover text | Portada / Texto de portada |
| Final export | Exportación final |
| Shot | Plano |
| Calendar / Agenda | Calendario / Agenda |
| Production block / Milestone | Bloque de producción / Hito |
| Cadence / Gap | Frecuencia / Hueco |
| Library | Biblioteca |
| Research / Reference / Asset | Investigación / Referencia / Recurso |
| Insights | Análisis |
| Results / Checkpoint | Resultados / Punto de control |
| Views | Visualizaciones |
| Learning | Aprendizaje |
| Observation / Hypothesis / Conclusion | Observación / Hipótesis / Conclusión |
| Secretary | Secretaria |
| Daily brief | Resumen del día |
| Workspace | Espacio (de trabajo) |
| Sync / Sync paused | Sincronización / Sincronización en pausa |
| Reconnect | Reconectar |
| Backup / Restore | Copia de seguridad / Restaurar |
| Recovery point | Punto de recuperación |
| Trash | Papelera |
| Settings | Ajustes |
| Undo | Deshacer |
| API key | Clave de API |
| Handoff | Traspaso |

Brand and product names (Saga HQ, Saga Studio, Google Drive, ChatGPT, Claude, TikTok, Instagram,
YouTube, X) are not translated. Technical identifiers (`saga.handoff`, `saga.return`, JSON, CSV,
URL) are not translated either.
