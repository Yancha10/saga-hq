import Dexie, { type Table } from 'dexie';
import { ulid } from '../core/ulid';
import { nowIso } from '../core/util';
import { accountRef, localRef, parseRefKey, type WorkspaceRef } from './workspaceRef';

/** Local-only display registry. Email/name are display data, never identifiers. */
export interface AccountEntry {
  accountId: string;
  email: string;
  displayName: string;
  avatarHint?: string;
  accountHint?: string; // saga-handoff namespace hash (opaque)
  lastUsedAt: string;
}
export interface LocalEntry {
  localId: string;
  name: string;
  createdAt: string;
  lastUsedAt: string;
  attachedTo?: string; // accountId it was moved into (local copy kept until user removes it)
}

class RegistryDB extends Dexie {
  accounts!: Table<AccountEntry, string>;
  locals!: Table<LocalEntry, string>;
  constructor() {
    super('sagahq-registry');
    this.version(1).stores({ accounts: 'accountId, lastUsedAt', locals: 'localId, lastUsedAt' });
  }
}

let registry: RegistryDB | null = null;
function reg(): RegistryDB {
  if (!registry) registry = new RegistryDB();
  return registry;
}

const LAST_KEY = 'hq:last-workspace';

export async function listAccounts(): Promise<AccountEntry[]> {
  return reg().accounts.orderBy('lastUsedAt').reverse().toArray();
}
export async function listLocals(): Promise<LocalEntry[]> {
  return reg().locals.orderBy('lastUsedAt').reverse().toArray();
}
export async function upsertAccount(e: Omit<AccountEntry, 'lastUsedAt'>): Promise<void> {
  await reg().accounts.put({ ...e, lastUsedAt: nowIso() });
}
export async function getAccount(accountId: string): Promise<AccountEntry | undefined> {
  return reg().accounts.get(accountId);
}
export async function createLocal(name = 'Local workspace'): Promise<LocalEntry> {
  const e: LocalEntry = { localId: ulid(), name, createdAt: nowIso(), lastUsedAt: nowIso() };
  await reg().locals.put(e);
  return e;
}
export async function updateLocal(localId: string, patch: Partial<LocalEntry>): Promise<void> {
  await reg().locals.update(localId, patch);
}
export async function touch(ref: WorkspaceRef): Promise<void> {
  if (ref.kind === 'account') await reg().accounts.update(ref.accountId, { lastUsedAt: nowIso() });
  else await reg().locals.update(ref.localId, { lastUsedAt: nowIso() });
  setLastRef(ref);
}
export async function removeAccountEntry(accountId: string): Promise<void> {
  await reg().accounts.delete(accountId);
  if (getLastRefKey() === accountRef(accountId).key) clearLastRef();
}
export async function removeLocalEntry(localId: string): Promise<void> {
  await reg().locals.delete(localId);
  if (getLastRefKey() === localRef(localId).key) clearLastRef();
}

function getLastRefKey(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}
export function setLastRef(ref: WorkspaceRef): void {
  try {
    localStorage.setItem(LAST_KEY, ref.key);
  } catch {
    /* storage unavailable: the picker will be shown next time */
  }
}
export function clearLastRef(): void {
  try {
    localStorage.removeItem(LAST_KEY);
  } catch {
    /* ignore */
  }
}

/** Resolve the workspace to open at startup, without any network access. */
export async function resolveStartupRef(): Promise<WorkspaceRef | null> {
  const last = parseRefKey(getLastRefKey());
  if (last) {
    if (last.kind === 'account' && (await reg().accounts.get(last.accountId))) return last;
    if (last.kind === 'local' && (await reg().locals.get(last.localId))) return last;
  }
  const acc = (await listAccounts())[0];
  const loc = (await listLocals())[0];
  if (acc && (!loc || acc.lastUsedAt >= loc.lastUsedAt)) return accountRef(acc.accountId);
  if (loc) return localRef(loc.localId);
  return null;
}

export function closeRegistry(): void {
  registry?.close();
  registry = null;
}
