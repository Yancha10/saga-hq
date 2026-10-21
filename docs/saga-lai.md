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

## Voice capture (Settings › Voice capture)

Siri / Share sheet → an iOS Shortcut → the user's own Google Apps Script (free, their account) →
appends to an inbox JSON file that Saga HQ created in its Drive folder → Saga HQ reads it on sync
(every ~30 s while open, and on open) and files each item:

- leading word routes it: `Idea:`, `Tarea:` (with spoken dates), `Guion/Gancho/Caption/Prompt para
  <pieza>:` (variant, never replaces approved text), `Radar:` (unverified, honest precision),
  `Pieza:`; a `[SAGA] … [/SAGA]` block from ChatGPT/Claude is parsed field by field;
- anything else waits in the Inbox with a suggestion. Today shows "Arrivals" with an undo per item.

The app never rewrites the inbox file (no race with the script); records use ids derived from the
item id, so several devices converge without duplicates. The capture key (it only allows the user's own script to append to
the inbox) is shared by the user's devices through the workspace; the settings page can adopt the
key shown in the script if they ever diverge. The script prunes items older
than 60 days. The app keeps only the `drive.file` scope.

## Plan keeper: pause, late work and reminders

- **Pause** (Settings › Plan & reminders, or a project's Status › Paused): nothing counts as late while paused. Resuming moves every pending date from the pause day on forward by the days paused. A project paused on its own keeps its own pause.
- **Late work slides** (on by default): when an unfinished task or planned piece is overdue, it moves to today and everything after it in the same root project moves by the same number of days (spacing kept). Loose items only move themselves. Today shows what moved, with Undo (undo also stops sliding for the rest of that day). On synced workspaces it runs only after this device has pulled the latest changes.
- **Never moved:** fixed-date tasks (hard deadline), deadlines and external events, Radar dates, platform-scheduled or published pieces.
- **Big events:** milestones, deadlines and external events, Radar dates (not discarded) and fixed-date tasks. Today lists those in the next 14 days. Reminders 14 and 7 days before: as system notifications while the app is open (permission needed; iOS requires the home-screen app), and as Calendar alerts through the .ics export, which work with the app closed.
