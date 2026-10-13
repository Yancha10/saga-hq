import { isAccountId } from '../core/accountId';
import { isUlid } from '../core/ulid';

export type WorkspaceRef =
  | { kind: 'account'; accountId: string; dbName: string; workspaceId: string; key: string }
  | { kind: 'local'; localId: string; dbName: string; workspaceId: string; key: string };

export function accountRef(accountId: string): WorkspaceRef {
  if (!isAccountId(accountId)) throw new Error('Invalid accountId');
  // One workspace per account in V1: the workspace id is the opaque account id.
  return {
    kind: 'account',
    accountId,
    dbName: `sagahq-${accountId}`,
    workspaceId: accountId,
    key: `account:${accountId}`,
  };
}

export function localRef(localId: string): WorkspaceRef {
  if (!isUlid(localId)) throw new Error('Invalid local workspace id');
  return {
    kind: 'local',
    localId,
    dbName: `sagahq-local-${localId}`,
    workspaceId: `local-${localId}`,
    key: `local:${localId}`,
  };
}

export function parseRefKey(key: string | null | undefined): WorkspaceRef | null {
  if (!key) return null;
  try {
    if (key.startsWith('account:')) return accountRef(key.slice(8));
    if (key.startsWith('local:')) return localRef(key.slice(6));
  } catch {
    return null;
  }
  return null;
}

/** Scope string for secrets — opaque, never a raw Google subject. */
export function secretScope(ref: WorkspaceRef): string {
  return ref.kind === 'account' ? ref.accountId : `local-${ref.localId}`;
}
