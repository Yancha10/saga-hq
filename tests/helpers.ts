import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { accountRef, localRef, type WorkspaceRef } from '../src/account/workspaceRef';
import { Session } from '../src/app/session';
import { ulid } from '../src/core/ulid';

export const ACCT_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
export const ACCT_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
export const ACCT_C = 'cccccccccccccccccccccccccccccccc';

/** Each simulated device gets its own isolated IndexedDB factory. */
export async function openDevice(ref: WorkspaceRef = accountRef(ACCT_A)): Promise<Session> {
  return Session.open(ref, { indexedDB: new IDBFactory(), IDBKeyRange });
}

export async function openLocal(): Promise<Session> {
  return Session.open(localRef(ulid()), { indexedDB: new IDBFactory(), IDBKeyRange });
}

export async function openAccount(accountId: string, factory = new IDBFactory()): Promise<Session> {
  return Session.open(accountRef(accountId), { indexedDB: factory, IDBKeyRange });
}
