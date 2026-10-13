import { DriveError, FOLDER_MIME, type DriveApi, type DriveChange, type DriveFile, type DriveQuery } from './driveApi';

interface Stored {
  meta: DriveFile;
  body?: string;
  blob?: Blob;
}

/**
 * Deterministic in-memory Drive for sync tests. Several FakeDriveClient instances can share one
 * FakeDriveServer to simulate multiple devices on the same Google account. Supports fault injection.
 */
export class FakeDriveServer {
  files = new Map<string, Stored>();
  changes: DriveChange[] = [];
  private counter = 0;
  quotaLimit: number | undefined = 15 * 1024 ** 3;
  faults: { kind: DriveError['kind']; status: number; count: number; match?: string }[] = [];
  calls: string[] = [];
  expiredTokensBefore = 0;

  nextId(): string {
    return `f${++this.counter}`;
  }
  record(fileId: string, removed = false): void {
    const s = this.files.get(fileId);
    this.changes.push({ fileId, removed, ...(s && !removed ? { file: { ...s.meta } } : {}) });
  }
  usage(): number {
    let n = 0;
    for (const f of this.files.values()) n += f.body?.length ?? f.blob?.size ?? 0;
    return n;
  }
  injectFault(kind: DriveError['kind'], status: number, count = 1, match?: string): void {
    this.faults.push({ kind, status, count, ...(match ? { match } : {}) });
  }
  check(op: string): void {
    this.calls.push(op);
    const f = this.faults.find((x) => x.count > 0 && (!x.match || op.startsWith(x.match)));
    if (f) {
      f.count--;
      throw new DriveError(f.kind, f.status, `injected ${f.kind}`);
    }
  }
}

export class FakeDriveClient implements DriveApi {
  constructor(readonly server: FakeDriveServer) {}

  private matches(f: DriveFile, q: DriveQuery): boolean {
    if (f.trashed) return false;
    if (q.name && f.name !== q.name) return false;
    if (q.parent && !(f.parents ?? []).includes(q.parent)) return false;
    if (q.folder !== undefined && (f.mimeType === FOLDER_MIME) !== q.folder) return false;
    for (const [k, v] of Object.entries(q.appProperties ?? {})) if (f.appProperties?.[k] !== v) return false;
    return true;
  }

  async find(q: DriveQuery): Promise<DriveFile[]> {
    this.server.check('find');
    return [...this.server.files.values()].map((s) => s.meta).filter((f) => this.matches(f, q)).map((f) => ({ ...f }));
  }
  async createFolder(name: string, parent: string | null, appProperties: Record<string, string>): Promise<DriveFile> {
    this.server.check('createFolder');
    const id = this.server.nextId();
    const meta: DriveFile = { id, name, mimeType: FOLDER_MIME, parents: parent ? [parent] : [], appProperties, createdTime: new Date().toISOString() };
    this.server.files.set(id, { meta });
    this.server.record(id);
    return { ...meta };
  }
  private quotaCheck(add: number): void {
    if (this.server.quotaLimit !== undefined && this.server.usage() + add > this.server.quotaLimit)
      throw new DriveError('quota', 403, 'storageQuotaExceeded');
  }
  async createJson(name: string, parent: string, data: unknown, appProperties: Record<string, string>): Promise<DriveFile> {
    this.server.check(`createJson:${name}`);
    const body = JSON.stringify(data);
    this.quotaCheck(body.length);
    const id = this.server.nextId();
    const meta: DriveFile = { id, name, mimeType: 'application/json', parents: [parent], appProperties, createdTime: new Date().toISOString(), size: String(body.length) };
    this.server.files.set(id, { meta, body });
    this.server.record(id);
    return { ...meta };
  }
  async updateJson(fileId: string, data: unknown): Promise<void> {
    this.server.check('updateJson');
    const s = this.server.files.get(fileId);
    if (!s) throw new DriveError('notFound', 404, 'not found');
    s.body = JSON.stringify(data);
    s.meta.modifiedTime = new Date().toISOString();
    this.server.record(fileId);
  }
  async readJson<T>(fileId: string): Promise<T> {
    this.server.check('readJson');
    const s = this.server.files.get(fileId);
    if (!s || s.body === undefined) throw new DriveError('notFound', 404, 'not found');
    return JSON.parse(s.body) as T;
  }
  async remove(fileId: string): Promise<void> {
    this.server.check('remove');
    this.server.files.delete(fileId);
    this.server.record(fileId, true);
  }
  async uploadBlob(name: string, parent: string, blob: Blob, appProperties: Record<string, string>): Promise<DriveFile> {
    this.server.check('uploadBlob');
    this.quotaCheck(blob.size);
    const id = this.server.nextId();
    const meta: DriveFile = { id, name, mimeType: blob.type, parents: [parent], appProperties, size: String(blob.size) };
    this.server.files.set(id, { meta, blob });
    this.server.record(id);
    return { ...meta };
  }
  async downloadBlob(fileId: string): Promise<Blob> {
    this.server.check('downloadBlob');
    const s = this.server.files.get(fileId);
    if (!s?.blob) throw new DriveError('notFound', 404, 'not found');
    return s.blob;
  }
  async getStartPageToken(): Promise<string> {
    this.server.check('getStartPageToken');
    return String(this.server.changes.length);
  }
  async listChanges(pageToken: string) {
    this.server.check('listChanges');
    const start = Number(pageToken);
    if (!Number.isFinite(start) || start < 0 || start > this.server.changes.length) throw new DriveError('badToken', 400, 'Invalid page token');
    const PAGE = 50;
    const slice = this.server.changes.slice(start, start + PAGE);
    const next = start + slice.length;
    return next < this.server.changes.length
      ? { changes: slice, nextPageToken: String(next) }
      : { changes: slice, newStartPageToken: String(next) };
  }
  async quota() {
    this.server.check('quota');
    return { limit: this.server.quotaLimit, usage: this.server.usage() };
  }
}
