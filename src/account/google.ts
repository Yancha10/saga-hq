import { deriveAccountHint, deriveAccountId } from '../core/accountId';
import { env } from '../config/env';
import { CORE_SCOPES } from '../config/scopes';
import { logger, registerSensitive } from '../diagnostics/logger';

/**
 * Google Identity Services (token model), loaded ON DEMAND only — no Google script runs on the
 * page until the user connects or reconnects. Access tokens live in memory only.
 * The raw OIDC `sub` exists only inside `identify()` long enough to derive opaque identifiers.
 */
interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}
interface TokenClient {
  requestAccessToken(o?: { prompt?: string; hint?: string }): void;
}
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(cfg: {
            client_id: string;
            scope: string;
            callback: (r: TokenResponse) => void;
            error_callback?: (e: { type: string; message?: string }) => void;
            include_granted_scopes?: boolean;
          }): TokenClient;
          revoke(token: string, done?: () => void): void;
        };
      };
    };
  }
}

export interface Identity {
  accountId: string;
  accountHint: string;
  email: string;
  displayName: string;
  avatarHint?: string;
}

let gisPromise: Promise<void> | null = null;
let token: { value: string; expiresAt: number; accountId?: string } | null = null;

export function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisPromise = null;
      reject(new Error('Could not load Google sign-in (offline?)'));
    };
    document.head.appendChild(s);
  });
  return gisPromise;
}

async function requestToken(scopes: readonly string[], hint?: string): Promise<{ value: string; expiresIn: number }> {
  if (!env.googleClientId) throw new Error('Google is not configured for this build.');
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: env.googleClientId,
      scope: scopes.join(' '),
      include_granted_scopes: false,
      callback: (r) => {
        if (r.error || !r.access_token) reject(new Error(r.error_description || r.error || 'Sign-in was cancelled'));
        else {
          registerSensitive(r.access_token);
          resolve({ value: r.access_token, expiresIn: r.expires_in ?? 3600 });
        }
      },
      error_callback: (e) => reject(new Error(e.message || e.type || 'Sign-in failed')),
    });
    client.requestAccessToken(hint ? { prompt: '', hint } : { prompt: 'select_account' });
  });
}

/** Fetch userinfo, derive opaque ids, and drop the raw subject. */
export async function identify(accessToken: string): Promise<Identity> {
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Could not verify Google identity (${res.status})`);
  const info = (await res.json()) as { sub?: string; email?: string; name?: string; picture?: string };
  if (!info.sub) throw new Error('Google identity missing subject');
  const accountId = await deriveAccountId(info.sub);
  const accountHint = await deriveAccountHint(info.sub);
  info.sub = undefined; // raw subject is not retained anywhere
  return { accountId, accountHint, email: info.email ?? '', displayName: info.name ?? info.email ?? 'Google account', ...(info.picture ? { avatarHint: info.picture } : {}) };
}

export async function signIn(): Promise<Identity> {
  const t = await requestToken(CORE_SCOPES);
  const id = await identify(t.value);
  token = { value: t.value, expiresAt: Date.now() + t.expiresIn * 1000, accountId: id.accountId };
  return id;
}

/** Interactive re-authorization for an existing account; rejects a different Google account. */
export async function reconnect(expectedAccountId: string, emailHint?: string): Promise<void> {
  const t = await requestToken(CORE_SCOPES, emailHint);
  const id = await identify(t.value);
  if (id.accountId !== expectedAccountId) {
    window.google?.accounts.oauth2.revoke(t.value);
    throw new Error('You signed in with a different Google account than this workspace belongs to.');
  }
  token = { value: t.value, expiresAt: Date.now() + t.expiresIn * 1000, accountId: id.accountId };
}

/** Never prompts. Returns null when the user must reconnect. Bound to the expected account. */
export function currentToken(expectedAccountId: string): string | null {
  if (!token || token.accountId !== expectedAccountId) return null;
  if (Date.now() > token.expiresAt - 60_000) return null;
  return token.value;
}

export function invalidateToken(): void {
  token = null;
}

export function signOutGoogle(): void {
  if (token) {
    try {
      window.google?.accounts.oauth2.revoke(token.value);
    } catch (e) {
      logger.warn('auth', 'revoke failed', e);
    }
  }
  token = null;
}

/** E2E-only: a mock identity that exercises the same derivation path. Tree-shaken from prod builds. */
export async function mockSignIn(sub: string, email: string): Promise<Identity> {
  if (!env.e2eMocks) throw new Error('Mock sign-in unavailable');
  const accountId = await deriveAccountId(sub);
  const accountHint = await deriveAccountHint(sub);
  token = { value: 'mock-token', expiresAt: Date.now() + 3600_000, accountId };
  return { accountId, accountHint, email, displayName: email.split('@')[0] ?? email };
}
