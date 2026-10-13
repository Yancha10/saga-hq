import {
  type DriveApi,
  type DriveChange,
  DriveError,
  type DriveFile,
  type DriveQuery,
  FOLDER_MIME,
  type StorageQuota,
} from './driveApi';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FILE_FIELDS = 'id,name,mimeType,parents,appProperties,modifiedTime,createdTime,size,trashed';

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** Real Drive v3 client (drive.file scope). The token provider never prompts. */
export class DriveRest implements DriveApi {
  constructor(
    private readonly getToken: () => string | null,
    private readonly signal?: AbortSignal,
  ) {}

  private async req(
    url: string,
    init: RequestInit = {},
    as: 'json' | 'text' | 'blob' | 'none' = 'json',
  ): Promise<unknown> {
    const t = this.getToken();
    if (!t) throw new DriveError('auth', 401, 'Not connected');
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        signal: init.signal ?? this.signal,
        headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t}` },
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      throw new DriveError('network', 0, 'Network unavailable');
    }
    if (!res.ok) throw await toError(res);
    if (as === 'none') return undefined;
    if (as === 'blob') return res.blob();
    if (as === 'text') return res.text();
    return res.json();
  }

  async find(q: DriveQuery): Promise<DriveFile[]> {
    const parts = ['trashed = false'];
    if (q.name) parts.push(`name = '${esc(q.name)}'`);
    if (q.parent) parts.push(`'${esc(q.parent)}' in parents`);
    if (q.folder === true) parts.push(`mimeType = '${FOLDER_MIME}'`);
    if (q.folder === false) parts.push(`mimeType != '${FOLDER_MIME}'`);
    for (const [k, v] of Object.entries(q.appProperties ?? {}))
      parts.push(`appProperties has { key='${esc(k)}' and value='${esc(v)}' }`);
    const out: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q: parts.join(' and '),
        fields: `nextPageToken,files(${FILE_FIELDS})`,
        pageSize: '1000',
        spaces: 'drive',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const r = (await this.req(`${API}/files?${params}`)) as { files: DriveFile[]; nextPageToken?: string };
      out.push(...r.files);
      pageToken = r.nextPageToken;
    } while (pageToken);
    return out;
  }

  async createFolder(
    name: string,
    parent: string | null,
    appProperties: Record<string, string>,
  ): Promise<DriveFile> {
    return (await this.req(`${API}/files?fields=${FILE_FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: FOLDER_MIME,
        appProperties,
        ...(parent ? { parents: [parent] } : {}),
      }),
    })) as DriveFile;
  }

  private multipart(meta: unknown, body: string | Blob, mime: string): { body: Blob; type: string } {
    const boundary = `saga${crypto.getRandomValues(new Uint32Array(2)).join('')}`;
    const blob = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
      body,
      `\r\n--${boundary}--`,
    ]);
    return { body: blob, type: `multipart/related; boundary=${boundary}` };
  }

  async createJson(
    name: string,
    parent: string,
    data: unknown,
    appProperties: Record<string, string>,
  ): Promise<DriveFile> {
    const mp = this.multipart(
      { name, parents: [parent], appProperties, mimeType: 'application/json' },
      JSON.stringify(data),
      'application/json',
    );
    return (await this.req(`${UPLOAD}/files?uploadType=multipart&fields=${FILE_FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': mp.type },
      body: mp.body,
    })) as DriveFile;
  }

  async updateJson(fileId: string, data: unknown): Promise<void> {
    await this.req(`${UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  async readJson<T>(fileId: string): Promise<T> {
    const text = (await this.req(
      `${API}/files/${encodeURIComponent(fileId)}?alt=media`,
      { cache: 'no-store' }, // files can change outside this app (e.g. the voice inbox script)
      'text',
    )) as string;
    return JSON.parse(text) as T; // SyntaxError on malformed content is handled by the engine
  }

  async remove(fileId: string): Promise<void> {
    await this.req(`${API}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' }, 'none');
  }

  async uploadBlob(
    name: string,
    parent: string,
    blob: Blob,
    appProperties: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<DriveFile> {
    const t = this.getToken();
    if (!t) throw new DriveError('auth', 401, 'Not connected');
    let start: Response;
    try {
      start = await fetch(`${UPLOAD}/files?uploadType=resumable&fields=${FILE_FIELDS}`, {
        method: 'POST',
        signal: signal ?? this.signal,
        headers: {
          Authorization: `Bearer ${t}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': blob.type || 'application/octet-stream',
        },
        body: JSON.stringify({ name, parents: [parent], appProperties }),
      });
    } catch {
      throw new DriveError('network', 0, 'Network unavailable');
    }
    if (!start.ok) throw await toError(start);
    const location = start.headers.get('Location');
    if (!location) throw new DriveError('server', 500, 'No upload session');
    let put: Response;
    try {
      put = await fetch(location, { method: 'PUT', signal: signal ?? this.signal, body: blob });
    } catch {
      throw new DriveError('network', 0, 'Upload interrupted');
    }
    if (!put.ok) throw await toError(put);
    return (await put.json()) as DriveFile;
  }

  async downloadBlob(fileId: string, signal?: AbortSignal): Promise<Blob> {
    return (await this.req(
      `${API}/files/${encodeURIComponent(fileId)}?alt=media`,
      signal ? { signal } : {},
      'blob',
    )) as Blob;
  }

  async getStartPageToken(): Promise<string> {
    const r = (await this.req(`${API}/changes/startPageToken`)) as { startPageToken: string };
    return r.startPageToken;
  }

  async listChanges(pageToken: string) {
    const params = new URLSearchParams({
      pageToken,
      pageSize: '200',
      spaces: 'drive',
      includeRemoved: 'true',
      fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FILE_FIELDS}))`,
    });
    return (await this.req(`${API}/changes?${params}`)) as {
      changes: DriveChange[];
      nextPageToken?: string;
      newStartPageToken?: string;
    };
  }

  async quota(): Promise<StorageQuota> {
    const r = (await this.req(`${API}/about?fields=storageQuota`)) as {
      storageQuota: { limit?: string; usage: string };
    };
    return {
      ...(r.storageQuota.limit ? { limit: Number(r.storageQuota.limit) } : {}),
      usage: Number(r.storageQuota.usage),
    };
  }
}

async function toError(res: Response): Promise<DriveError> {
  let reason = '';
  let message = res.statusText;
  try {
    const j = (await res.json()) as { error?: { message?: string; errors?: { reason?: string }[] } };
    reason = j.error?.errors?.[0]?.reason ?? '';
    message = j.error?.message ?? message;
  } catch {
    /* non-JSON body */
  }
  const s = res.status;
  if (s === 401) return new DriveError('auth', s, message);
  if (s === 429 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded')
    return new DriveError('rate', s, message);
  if (reason === 'storageQuotaExceeded' || reason === 'quotaExceeded')
    return new DriveError('quota', s, message);
  if (s === 404) return new DriveError('notFound', s, message);
  if (s === 400 && /page ?token/i.test(message)) return new DriveError('badToken', s, message);
  if (s === 410) return new DriveError('badToken', s, message);
  if (s >= 500) return new DriveError('server', s, message);
  if (s === 403 && /insufficient|permission|admin|policy/i.test(`${reason} ${message}`))
    return new DriveError('auth', s, message);
  return new DriveError('other', s, message);
}
