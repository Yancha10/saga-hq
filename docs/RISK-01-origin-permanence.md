# RISK-01 — Origin permanence

**Risk.** IndexedDB, service-worker caches, installed PWAs and the BYOK secrets store are bound to the
*origin* (`scheme://host:port`). Serving Saga HQ from a different origin later (e.g. GitHub Pages → Cloudflare
Pages, or a different GitHub organization) strands every device's local data at the old origin, uninstalls
the PWA, and drops locally stored API keys (by design they never sync).

**Likelihood.** High if Saga HQ becomes commercial (GitHub Pages terms discourage commercial SaaS); medium otherwise.

**Impact.** Users without Google Drive sync or a recent export lose access to local-only data in the new app.

**Mitigations (implemented).**
1. Drive sync is origin-independent and is the primary migration path (`src/sync/*`).
2. Full JSON export/import from day one (Settings › Backup & restore).
3. Settings shows sync state and the last sync time; local workspaces are clearly labelled “not synced”.
4. The app is host-neutral, so moving is a deploy change only (`docs/deploy.md`).
5. Origin migration playbook: `docs/origin-migration-playbook.md` — run a dry run before any public onboarding.

**Accepted residual.** Users who never connect Drive and never export can lose local-only data in a move.
**Decision.** Initial deployment: GitHub Pages under a free GitHub organization, labelled *dev/personal*.
Re-decide the production host before any public/commercial launch. No custom domain purchased.
