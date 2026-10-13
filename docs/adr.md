# Architecture decisions — implementation record

| ADR | Decision (final, rev. 3 > 2 > 1) | Implemented in | Status |
|---|---|---|---|
| 01 Framework | React 19 + TS strict + Vite, React Aria Components (dialogs/menus), TanStack Router (hash history) | `src/app`, `src/ui` | Done |
| 02 Storage | IndexedDB via Dexie, one database per workspace, repository/command layer, MiniSearch in a worker | `src/data`, `src/search` | Done |
| 03 Sync | Per-entity journal in the user's Drive (`drive.file`), `changes.list` adaptive polling, per-field HLC LWW, conflict copies for long text, tombstones, snapshots/compaction | `src/sync` | Done (fake-Drive tested; real Drive not exercised here) |
| 04 Identity | `accountId = base32(SHA-256("saga-hq:"+sub))[0..160 bits]`; N peer accounts; local-only workspaces; raw sub transient only | `src/core/accountId.ts`, `src/account` | Done |
| 05 Media | Compress on capture, pinned until uploaded, thumbnails, conservative LRU; >100 MB link only | `src/media` | Done |
| 06 PWA | Precached shell, prompt-style updates (never mid-edit), relative scope, zero-network start | `vite.config.ts`, `src/app/pwa.ts` | Done |
| 07 AI providers | BYOK only; Anthropic via official SDK (lazy), OpenAI via REST; AES-GCM non-extractable local key store; copy-prompt fallback | `src/ai` | Done |
| 08 Secretary actions | zod-validated proposals, risk classes, confirm/undo, no destructive AI actions, grounding validator | `src/ai/actions.ts`, `src/ai/validate.ts` | Done |
| 09 Mobile nav | Today · Ideas · (+) · Content · More; rail at medium width | `src/app/Shell.tsx` | Done |
| 10 Studio | `saga.handoff` / `saga.return` v1; URL fragment + JSON file; Drive interchange gated on INTEROP-01 | `src/studio` | V1 done; v1.1 blocked on INTEROP-01 |
| 11 Hosting | Host-neutral static artifact; GitHub Pages initial (manual deploy); Cloudflare Pages fallback | `vite.config.ts`, `.github/workflows` | Done (not deployed) |
| 12 Zero-cost rule | No mandatory backend; backend-only features out of V1 | whole repo | Done |
| 13 OAuth | Core scopes only; optional scopes incremental (none in V1); dev/prod client via env | `src/config/scopes.ts` | Code done; Google console steps HUMAN |
