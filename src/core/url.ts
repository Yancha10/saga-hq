/** Local-only URL handling. No network fetch (no CORS proxy in V1). The raw URL is always kept. */
export interface ParsedUrl {
  original: string;
  canonical: string;
  host: string;
  platform?: 'youtube' | 'tiktok' | 'instagram' | 'x' | 'reddit' | 'web';
  externalId?: string;
  handle?: string;
  thumbUrl?: string;
  kind?: 'video' | 'post' | 'account' | 'link';
}

const TRACKING = /^(utm_.*|fbclid|gclid|igshid|igsh|si|feature|ref|ref_src|s|t)$/i;

export function safeHttpUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export function looksLikeUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim()) || /^(www\.)?[a-z0-9-]+\.[a-z]{2,}\/\S*$/i.test(text.trim());
}

export function extractUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"']+/i);
  return m ? safeHttpUrl(m[0]) : null;
}

export function parseUrl(raw: string): ParsedUrl | null {
  const withScheme = /^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
  const safe = safeHttpUrl(withScheme);
  if (!safe) return null;
  const u = new URL(safe);
  const host = u.hostname.replace(/^www\.|^m\./, '');
  const params = [...u.searchParams.keys()];
  for (const k of params)
    if (TRACKING.test(k) && !(host.includes('youtube') && k === 'v')) u.searchParams.delete(k);
  u.hash = '';
  const out: ParsedUrl = {
    original: raw.trim(),
    canonical: u.toString(),
    host,
    platform: 'web',
    kind: 'link',
  };
  const path = u.pathname.split('/').filter(Boolean);
  if (host === 'youtu.be' || host.endsWith('youtube.com')) {
    out.platform = 'youtube';
    const id =
      host === 'youtu.be'
        ? path[0]
        : path[0] === 'shorts' || path[0] === 'live'
          ? path[1]
          : (u.searchParams.get('v') ?? undefined);
    if (id && /^[\w-]{6,20}$/.test(id)) {
      out.externalId = id;
      out.kind = 'video';
      out.thumbUrl = `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
    } else if (path[0]?.startsWith('@')) {
      out.handle = path[0];
      out.kind = 'account';
    }
  } else if (host.endsWith('tiktok.com')) {
    out.platform = 'tiktok';
    if (path[0]?.startsWith('@')) out.handle = path[0];
    const vi = path.indexOf('video');
    if (vi >= 0 && path[vi + 1]) {
      out.externalId = path[vi + 1];
      out.kind = 'video';
    } else if (out.handle) out.kind = 'account';
  } else if (host.endsWith('instagram.com')) {
    out.platform = 'instagram';
    if ((path[0] === 'p' || path[0] === 'reel' || path[0] === 'reels') && path[1]) {
      out.externalId = path[1];
      out.kind = path[0] === 'p' ? 'post' : 'video';
    } else if (path[0]) {
      out.handle = `@${path[0]}`;
      out.kind = 'account';
    }
  } else if (host === 'x.com' || host.endsWith('twitter.com')) {
    out.platform = 'x';
    if (path[0]) out.handle = `@${path[0]}`;
    if (path[1] === 'status' && path[2]) {
      out.externalId = path[2];
      out.kind = 'post';
    } else out.kind = 'account';
  } else if (host.endsWith('reddit.com')) {
    out.platform = 'reddit';
    out.kind = 'post';
  }
  return out;
}

export function displayTitleForUrl(p: ParsedUrl): string {
  const where =
    p.platform && p.platform !== 'web' ? p.platform[0]!.toUpperCase() + p.platform.slice(1) : p.host;
  if (p.handle && p.kind !== 'account') return `${where} ${p.kind ?? 'link'} · ${p.handle}`;
  if (p.handle) return `${where} · ${p.handle}`;
  return `${where} ${p.kind && p.kind !== 'link' ? p.kind : 'link'}`;
}
