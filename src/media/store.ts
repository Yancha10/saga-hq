import type { Session } from '../app/session';
import { sha256Hex } from '../core/crypto';
import type { MediaMeta } from '../data/schema';
import { create, update } from '../data/store';
import { logger } from '../diagnostics/logger';
import type { DriveApi } from '../sync/driveApi';

export const MAX_LOCAL_VIDEO_BYTES = 100 * 1024 * 1024;
export const AUTO_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_EDGE = 2560;
const THUMB_EDGE = 512;

export class MediaTooLargeError extends Error {
  constructor() {
    super(
      'This file is larger than 100 MB. Link it instead (e.g. a Drive or Studio URL) — Saga HQ is not a video store.',
    );
    this.name = 'MediaTooLargeError';
  }
}

async function resizeImage(
  blob: Blob,
  maxEdge: number,
  quality: number,
): Promise<{ blob: Blob; width: number; height: number } | null> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', quality));
    const fallback =
      out?.type === 'image/webp'
        ? out
        : await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
    if (!fallback) return null;
    return { blob: fallback, width: w, height: h };
  } catch (e) {
    logger.warn('media', 'image resize failed', e);
    return null;
  }
}

/** Store a captured file: compress images, keep a thumbnail, pin until uploaded (never the only copy evicted). */
export async function addMedia(s: Session, file: Blob, name?: string): Promise<MediaMeta> {
  s.assertLive();
  if (file.size > MAX_LOCAL_VIDEO_BYTES) throw new MediaTooLargeError();
  let blob = file;
  let width: number | undefined;
  let height: number | undefined;
  let thumb: Blob | null = null;
  if (file.type.startsWith('image/') && file.type !== 'image/gif' && file.type !== 'image/svg+xml') {
    const r = await resizeImage(file, MAX_IMAGE_EDGE, 0.85);
    if (r && r.blob.size < file.size) blob = r.blob;
    if (r) {
      width = r.width;
      height = r.height;
    }
    thumb = (await resizeImage(file, THUMB_EDGE, 0.75))?.blob ?? null;
  }
  const hash = await sha256Hex(new Uint8Array(await blob.arrayBuffer()));
  s.assertLive();
  const meta = await create(s, 'media', {
    name: name ?? (file as File).name ?? null,
    mime: blob.type || 'application/octet-stream',
    bytes: blob.size,
    sha256: hash,
    width: width ?? null,
    height: height ?? null,
    hasThumb: !!thumb,
  });
  await s.db.mediaBlobs.put({
    id: meta.id,
    kind: 'full',
    blob,
    bytes: blob.size,
    lastUsedAt: Date.now(),
    pinned: 1,
  });
  if (thumb)
    await s.db.mediaBlobs.put({
      id: meta.id,
      kind: 'thumb',
      blob: thumb,
      bytes: thumb.size,
      lastUsedAt: Date.now(),
      pinned: 0,
    });
  if (s.ref.kind === 'account' && blob.size <= AUTO_UPLOAD_MAX_BYTES) {
    await s.db.uploads.put({
      id: meta.id,
      state: 'queued',
      attempts: 0,
      createdAt: new Date().toISOString(),
    });
  }
  return meta;
}

export async function queueUpload(s: Session, mediaId: string): Promise<void> {
  await s.db.uploads.put({ id: mediaId, state: 'queued', attempts: 0, createdAt: new Date().toISOString() });
}

const urlCache = new Map<string, string>();

/** Object URL for local media; registers revocation with the session so nothing leaks across accounts. */
export async function mediaUrl(
  s: Session,
  id: string,
  prefer: 'thumb' | 'full' = 'thumb',
  drive?: DriveApi | null,
): Promise<string | null> {
  const cacheKey = `${s.generation}:${id}:${prefer}`;
  const hit = urlCache.get(cacheKey);
  if (hit) return hit;
  let row = await s.db.mediaBlobs.get([id, prefer]);
  if (!row && prefer === 'thumb') row = await s.db.mediaBlobs.get([id, 'full']);
  if (!row && drive) {
    // Synced from another device or evicted from the cache: fetch the original from the user's Drive.
    const meta = await s.db.media.get(id);
    if (meta?.driveFileId) {
      try {
        const blob = await drive.downloadBlob(meta.driveFileId, s.signal);
        s.assertLive();
        await storeDownloaded(s, id, blob);
        row = await s.db.mediaBlobs.get([id, 'full']);
      } catch (e) {
        logger.warn('media', 'download from Drive failed', e);
      }
    }
  }
  if (!row) return null;
  s.assertLive();
  void s.db.mediaBlobs.update([row.id, row.kind], { lastUsedAt: Date.now() });
  const url = URL.createObjectURL(row.blob);
  urlCache.set(cacheKey, url);
  s.addDisposer(() => {
    URL.revokeObjectURL(url);
    urlCache.delete(cacheKey);
  });
  return url;
}

export async function storeDownloaded(s: Session, id: string, blob: Blob): Promise<void> {
  s.assertLive();
  await s.db.mediaBlobs.put({ id, kind: 'full', blob, bytes: blob.size, lastUsedAt: Date.now(), pinned: 0 });
}

export async function markUploaded(s: Session, id: string, driveFileId: string): Promise<void> {
  await update(s, 'media', id, { driveFileId }, { label: 'Media uploaded', history: false });
  await s.db.mediaBlobs.update([id, 'full'], { pinned: 0 });
}

export async function localMediaBytes(s: Session): Promise<{ total: number; pinned: number; cache: number }> {
  let total = 0;
  let pinned = 0;
  await s.db.mediaBlobs.each((r) => {
    total += r.bytes;
    if (r.pinned) pinned += r.bytes;
  });
  return { total, pinned, cache: total - pinned };
}

/**
 * Conservative LRU: only evicts full-size blobs that are already safely stored in Drive
 * (pinned = 0). Thumbnails and not-yet-uploaded originals are never evicted.
 */
export async function evictCache(s: Session, limitBytes: number): Promise<number> {
  const rows = (await s.db.mediaBlobs.toArray()).filter((r) => r.kind === 'full' && !r.pinned);
  let cacheBytes = rows.reduce((n, r) => n + r.bytes, 0);
  if (cacheBytes <= limitBytes) return 0;
  rows.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  let freed = 0;
  for (const r of rows) {
    if (cacheBytes <= limitBytes) break;
    const meta = await s.db.media.get(r.id);
    if (!meta?.driveFileId) continue; // safety: never delete the only copy
    await s.db.mediaBlobs.delete([r.id, 'full']);
    cacheBytes -= r.bytes;
    freed += r.bytes;
  }
  return freed;
}
