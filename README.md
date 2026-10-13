# Saga HQ

Local-first creative operating system: **idea → planning → production → publication → analytics → learning**.
Static PWA · data in your browser · optional sync through **your own Google Drive** · optional **BYOK** AI.
Zero mandatory infrastructure. Saga HQ is separate from Saga Studio (the generation workshop).

## Run
```bash
npm ci
npm run dev        # http://localhost:5173
npm run build      # production artifact in dist/ (works at / or any subpath)
```

## Verify
```bash
npm run typecheck && npm run lint && npm test     # unit/integration (Vitest + fake IndexedDB + fake Drive)
npm run build && npm run build:test               # prod artifact + e2e-mock artifact
npx playwright test                               # E2E: prod artifact at / and /saga-hq/, phone, offline, PWA, accounts, a11y, responsive, perf
```

## Where things are
| Area | Path |
|---|---|
| Identity invariant (`accountId`) | `src/core/accountId.ts` |
| Data model (zod) / DB / command layer | `src/data/schema.ts`, `src/data/db.ts`, `src/data/store.ts` |
| Today engine & rules (no AI) | `src/rules/` |
| Drive sync (journal, merge, runner) | `src/sync/` |
| Secretary (context, prompts, validator, actions, providers, secrets) | `src/ai/` |
| Saga Studio handoff contracts | `src/studio/handoff.ts` |
| UI | `src/app/`, `src/features/`, `src/ui/` |

## Data notes
- Everything is stored in IndexedDB per workspace (`sagahq-<accountId>` or `sagahq-local-<ULID>`).
- Google Drive (only files Saga HQ creates, folder “Saga HQ”): sync journal, snapshots, weekly backups, media originals.
- Never leaves the device: AI keys, Secretary history, undo history, diagnostics.
- Deletions go to Trash for 30 days. Recovery points are kept before restores, imports, upgrades and large merges.

See `docs/` for deployment, RISK-01, INTEROP-01 and the ADR record.
