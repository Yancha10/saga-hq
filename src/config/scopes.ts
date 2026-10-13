/**
 * The ONLY OAuth scopes Saga HQ may request (ADR-13). Centralized; a unit test fails if a broad or
 * restricted scope is added. Optional scopes are requested incrementally, never at sign-in.
 */
export const CORE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.file',
] as const;

/** Optional feature scopes (incremental authorization). Empty in V1: Calendar/YouTube not shipped. */
export const OPTIONAL_SCOPES: Record<string, string> = {};

export const FORBIDDEN_SCOPE_PATTERNS = [
  /auth\/drive$/,
  /auth\/drive\.readonly/,
  /auth\/drive\.metadata/,
  /auth\/drive\.photos/,
  /auth\/drive\.scripts/,
  /mail\.google\.com/,
  /auth\/gmail/,
  /auth\/cloud-platform/,
];
