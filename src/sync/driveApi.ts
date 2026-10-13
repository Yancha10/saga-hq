export interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
  parents?: string[];
  appProperties?: Record<string, string>;
  modifiedTime?: string;
  createdTime?: string;
  size?: string;
  trashed?: boolean;
}

export interface DriveChange {
  fileId: string;
  removed?: boolean;
  file?: DriveFile;
}

export interface DriveQuery {
  name?: string;
  parent?: string;
  folder?: boolean;
  appProperties?: Record<string, string>;
}

export interface StorageQuota {
  limit?: number; // undefined = unlimited
  usage: number;
}

export type DriveErrorKind = 'auth' | 'rate' | 'quota' | 'server' | 'notFound' | 'network' | 'badToken' | 'other';

export class DriveError extends Error {
  constructor(
    readonly kind: DriveErrorKind,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'DriveError';
  }
  get retryable(): boolean {
    return this.kind === 'rate' || this.kind === 'server' || this.kind === 'network';
  }
}

/** Minimal Drive v3 surface Saga HQ needs. Implemented by DriveRest (real) and FakeDrive (tests). */
export interface DriveApi {
  find(q: DriveQuery): Promise<DriveFile[]>;
  createFolder(name: string, parent: string | null, appProperties: Record<string, string>): Promise<DriveFile>;
  createJson(name: string, parent: string, data: unknown, appProperties: Record<string, string>): Promise<DriveFile>;
  updateJson(fileId: string, data: unknown): Promise<void>;
  readJson<T = unknown>(fileId: string): Promise<T>;
  remove(fileId: string): Promise<void>;
  uploadBlob(name: string, parent: string, blob: Blob, appProperties: Record<string, string>, signal?: AbortSignal): Promise<DriveFile>;
  downloadBlob(fileId: string, signal?: AbortSignal): Promise<Blob>;
  getStartPageToken(): Promise<string>;
  listChanges(pageToken: string): Promise<{ changes: DriveChange[]; nextPageToken?: string; newStartPageToken?: string }>;
  quota(): Promise<StorageQuota>;
}

export const FOLDER_MIME = 'application/vnd.google-apps.folder';
