# Saga Lai integration

Saga HQ hosts the Saga Lai secretary modules. Saga Studio stays an independent app (bridge only).

## Import (Settings › Import)

Accepted files, read on the device only (never uploaded, scripts never executed):

- the integration document (`.md`) — annexes A (Bible), B (pieces), C (radar), D (tasks, checklist,
  emergency ideas, decisions, preferences);
- the HTML v2 file — its `script#seed` JSON is read as text;
- a v2 JSON backup — mapped tolerantly; invalid records are skipped and counted.

A preview shows counts, matches and the date span before anything changes. Records are matched by
their package id (`externalId`), so re-importing never duplicates. On matches the user chooses
**merge** (fill only empty fields), **keep** or **replace**. The imported original card
(`content.original`, `chapters.originalBody`) is never replaced. A recovery point is taken first and
the import is one undo.

Mapping: Idea→planned, Guion→script, Producción→producing, Lista→ready, Publicada→published,
Archivada→archived. Planned dates are converted from the package zone (Europe/Oslo, DST-aware) and
create *planned* publications — never "published". Radar entries keep the period as written plus an
honest precision (day, range, several dates, month, season, year, every year) and start unverified.

## Modules

- **Bible** (`/bible`): chapters with status (in force, proposed, historical, to check), Markdown
  reader/editor, original vs current, history; an edit suggests pieces to review (never rewrites).
- **Radar** (`/radar`): grouped by month, precision and verification badges, sources, "turn into
  campaign" (teaser, main, making of, follow-up) — unverified dates create no calendar dates.
- **My week** (`/week`): publications, tasks and blocks per day against weekly hours and goal,
  overload warning, move-to-day (drag alternative), ICS export (VTIMEZONE, stable UIDs).
- **AI Workshop** (`/workshop`): 13 requests, contextual brief (piece, chapters, decisions, tasks,
  capacity), copy + open ChatGPT/Claude, paste answer with declared source, optional BYOK API;
  answers become variants, approved explicitly with the previous text kept.
- **Piece editorial card**: pillar, DM keyword ("text prepared · manual delivery"), CTA, original
  card, art/sound/continuity, master prompt, stories, pinned comment, variants, editorial checklist
  (versioned), continuity/dependency/reuse relations; extended shot direction, reorder, duplicate.
- Metrics: shares/reach and saves/reach, "no data" without reach; windows are never invented.
