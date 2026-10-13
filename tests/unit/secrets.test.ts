import { afterEach, describe, expect, it } from 'vitest';
import { getSecret, removeAllSecrets, saveSecret, secretHints } from '../../src/ai/secrets';
import type { Session } from '../../src/app/session';
import { buildBackup, previewBackup, restoreBackup } from '../../src/data/backup';
import { createRecoveryPoint } from '../../src/data/recovery';
import { serializeWorkspace } from '../../src/data/serialize';
import { create } from '../../src/data/store';
import { getLogs, logger } from '../../src/diagnostics/logger';
import { buildDiagnostics } from '../../src/diagnostics/report';
import { SyncEngine } from '../../src/sync/engine';
import { FakeDriveClient, FakeDriveServer } from '../../src/sync/fakeDrive';
import { openDevice } from '../helpers';

const MARKER = 'sk-ant-TESTMARKER-9f8e7d6c5b4a39281706';
let s: Session;
afterEach(() => s?.close());

describe('secret isolation (release gate)', () => {
  it('a marker secret never appears in sync, Drive, snapshots, backups, exports, recovery, logs or diagnostics', async () => {
    s = await openDevice();
    await saveSecret(s, 'anthropic', MARKER);
    expect(await getSecret(s, 'anthropic')).toBe(MARKER);
    await create(s, 'ideas', { title: 'idea with context', status: 'new' });
    logger.error('test', `provider failed with key ${MARKER}`);
    logger.info('test', `Authorization: Bearer ${MARKER}`);

    const srv = new FakeDriveServer();
    const e = new SyncEngine(s, new FakeDriveClient(srv), s.workspaceId);
    await e.push();
    await e.maybeCompact(true);
    await e.maybeBackup(() => buildBackup(s), true);
    const driveDump = [...srv.files.values()].map((f) => f.body ?? '').join('\n');

    const backup = JSON.stringify(await buildBackup(s, { includeMedia: true }));
    const serialized = JSON.stringify(await serializeWorkspace(s.db));
    const rp = await createRecoveryPoint(s, 'test');
    const logs = JSON.stringify(getLogs());
    const diag = JSON.stringify(await buildDiagnostics(s));

    for (const [name, blob] of Object.entries({
      driveDump,
      backup,
      serialized,
      recovery: rp.data,
      logs,
      diag,
    })) {
      expect(blob.includes(MARKER), `${name} leaked the secret`).toBe(false);
      expect(blob.includes('TESTMARKER'), `${name} leaked part of the secret`).toBe(false);
    }
    // Stored ciphertext is not the plaintext
    const row = (await s.db.secrets.toArray())[0]!;
    expect(new TextDecoder().decode(row.ciphertext).includes('TESTMARKER')).toBe(false);
    expect((await secretHints(s)).anthropic?.hint).toBe('sk-…1706');
  });

  it('secrets are scoped per workspace and removable', async () => {
    s = await openDevice();
    await saveSecret(s, 'openai', 'sk-proj-abcdefghijkl1234');
    const other = await openDevice();
    expect(await getSecret(other, 'openai')).toBeNull();
    other.close();
    await removeAllSecrets(s);
    expect(await getSecret(s, 'openai')).toBeNull();
  });
});

describe('backup / restore', () => {
  it('round-trips and validates; malformed backups never touch current state', async () => {
    s = await openDevice();
    const i = await create(s, 'ideas', { title: 'precious', status: 'new' });
    const file = await buildBackup(s);
    const text = JSON.stringify(file);
    expect((await previewBackup('{oops')).ok).toBe(false);
    expect((await previewBackup(JSON.stringify({ ...file, checksum: 'x' }))).ok).toBe(false);
    expect((await previewBackup(JSON.stringify({ ...file, schemaVersion: 99 }))).ok).toBe(false);
    expect((await s.db.ideas.get(i.id))?.title).toBe('precious');

    const target = await openDevice();
    await create(target, 'tasks', {
      title: 'will be replaced',
      status: 'todo',
      kind: 'task',
      isBlocker: false,
    });
    const p = await previewBackup(text);
    expect(p.ok).toBe(true);
    const after = await restoreBackup(target, p.file!, 'replace');
    expect(after.ideas).toBe(1);
    expect(await target.db.tasks.count()).toBe(0);
    expect(await target.db.tombstones.count()).toBe(1);
    expect((await target.db.ideas.get(i.id))?.workspaceId).toBe(target.workspaceId);
    expect(await target.db.recovery.count()).toBeGreaterThan(0);
    target.close();
  });
});
