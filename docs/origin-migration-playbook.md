# Origin migration playbook (dry-run before public onboarding)

Goal: move Saga HQ from origin **O1** to **O2** with no data loss for users who sync or export.

1. **Prepare O2.** Deploy the same artifact to O2 (`docs/deploy.md`). Add O2 to the *Authorized JavaScript
   origins* of the production OAuth client (keep O1). Re-run brand/authorized-domain verification if required.
2. **Announce in O1.** Ship a build to O1 with a persistent banner: “Saga HQ is moving to O2 — sync or export first”.
   (Implementation: set a `VITE_MOVED_TO` env and show the banner; not built in V1 — add when needed.)
3. **Users on O1:** open Settings › Account & sync → *Sync now* (Google workspaces) or Settings › Backup → *Download backup* (local workspaces).
4. **Users on O2:** sign in with the same Google account → Drive sync restores the workspace (manifest guard checks the same opaque `accountId`). Local workspaces: *Restore* the backup file.
5. **Re-enter API keys** on O2 (never synced, by design). Reinstall the PWA from O2.
6. **Keep O1 alive** (read-only banner) for at least 90 days, then remove O1 from the OAuth client.
7. **Dry run** this between two preview origins with test accounts before any real user is onboarded (H5 DoD).
