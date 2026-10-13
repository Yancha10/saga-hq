# INTEROP-01 — Saga Studio ↔ Saga HQ `drive.file` interoperability

**Status: NOT RUN.** This environment has no access to a Google Cloud console, OAuth clients or a test Google
account, so the test could not be executed. Saga Studio was **not** modified. V1 does not depend on the result:
the shipped handoff uses the URL-fragment deep link + explicit JSON file (`src/studio/handoff.ts`).

Never broaden Drive scopes to solve this, whatever the result (no `drive`, `drive.readonly`, `drive.metadata*`).

## Harness

`tools/interop-01/harness.html` is a throwaway static page (not part of the app). Serve it from two origins
(e.g. `npx serve -l 5501 tools/interop-01` and `-l 5502`), each with its own OAuth client id passed as `?client=`.

| Case | Setup | Steps | Record |
|------|-------|-------|--------|
| T1 | Same project, same client id, both origins authorized | A (origin 1) “Create handoff file” → copy file id → B (origin 2) “Read file by id” and “List folder” | PASS / FAIL / REQUIRES_EXPLICIT_USER_GRANT |
| T2 | Same project, different client ids | same | same |
| T3 | Different projects (control, expect FAIL) | same | same |
| T4 | Failing config + Google Picker on B (needs a referrer-restricted Picker API key) | B “Pick file” → then “Read file by id” in a new session/device | persists? |
| T5 | Picker on the *folder* | A creates a new file later; can B read it without re-picking? | yes/no |
| T6 | Reverse direction (B writes, A reads) for the winning config | | |
| T7 | Write access: can the reader update the file? | B “Update file” | yes/no |

## Decision tree (ADR-10)
- PASS (T1/T2) → shared `/Saga/Handoff/` interchange; HQ prod shares that project/client with Studio (single “Saga” consent brand).
- REQUIRES_EXPLICIT_USER_GRANT (T4/T5) → Google Picker (one-time folder grant if T5 passes, else per handoff). HQ keeps its own project.
- FAIL → keep explicit deep link / file handoff (already shipped).

## Result log
| Date | Case | Result | Google docs version consulted | Tester |
|------|------|--------|-------------------------------|--------|
| — | — | NOT RUN | — | — |
