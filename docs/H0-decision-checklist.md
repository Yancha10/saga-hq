# H0 — Decision & safety checklist

Status as of the `feature/saga-hq-v1` implementation. Authority: architecture revisions 1 → 2 → 3 (3 wins).

| # | Item | Status |
|---|------|--------|
| 1 | Account namespace `saga-hq:` frozen | **Done.** `src/core/accountId.ts`; fixed-vector test `tests/unit/accountId.test.ts` (vector computed independently with Python). |
| 2 | Handoff namespace `saga-handoff:` for `accountHint` | **Done.** Same file + fixed vector. |
| 3 | Raw `sub` never persisted | **Done.** Derived in memory in `src/account/google.ts` then discarded. Unit scan (`tests/unit/safety.test.ts`) and E2E scan across 3 peer accounts (`e2e/accounts.spec.ts`). |
| 4 | RISK-01 origin permanence recorded | **Done.** `docs/RISK-01-origin-permanence.md`. |
| 5 | Host neutrality | **Done.** Relative base, hash routing, relative manifest/SW scope; CI + unit test reject `github.io` / `pages.dev` in `src/`; E2E runs the exact artifact at `/` and `/saga-hq/`. |
| 6 | Google OAuth docs re-verified (Testing vs In production, brand verification, authorized domains on `*.github.io`, Calendar scope class, Picker pre-selection) | **OPEN — HUMAN.** Could not be verified from this environment (no Google Cloud console access). Calendar and YouTube scopes are therefore **not** requested in V1 at all (`OPTIONAL_SCOPES` is empty). |
| 7 | Dev/prod Google Cloud projects | **OPEN — HUMAN.** App supports both via `VITE_GOOGLE_CLIENT_ID` per build; no project was created (would need the owner's Google account). |
| 8 | INTEROP-01 | **NOT RUN — blocked here.** Plan + throwaway harness in `docs/INTEROP-01.md` and `tools/interop-01/`. V1 does not depend on it. |
| 9 | ADRs validated against implementation | **Done.** See `docs/adr.md`. |
| 10 | Separate repository `saga-hq` | **BLOCKED.** The GitHub integration available to this session could not create repositories (HTTP 403). Code lives on branch `feature/saga-hq-v1` of a standalone local repository; see final report for how it was delivered. |
