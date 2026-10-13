import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CORE_SCOPES, FORBIDDEN_SCOPE_PATTERNS, OPTIONAL_SCOPES } from '../../src/config/scopes';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('OAuth scopes (ADR-13)', () => {
  it('core scopes are exactly the approved set', () => {
    expect([...CORE_SCOPES]).toEqual([
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/drive.file',
    ]);
  });
  it('no broad or restricted scope anywhere in the scope config', () => {
    for (const s of [...CORE_SCOPES, ...Object.values(OPTIONAL_SCOPES)])
      for (const re of FORBIDDEN_SCOPE_PATTERNS) expect(re.test(s), s).toBe(false);
  });
  it('no scope URL string is used outside the central config', () => {
    for (const f of walk('src')) {
      if (f.endsWith('config/scopes.ts')) continue;
      expect(readFileSync(f, 'utf8').includes('googleapis.com/auth/'), f).toBe(false);
    }
  });
});

describe('host neutrality', () => {
  it('application source contains no deployment host literals', () => {
    for (const f of walk('src')) {
      const t = readFileSync(f, 'utf8');
      expect(/github\.io|pages\.dev/.test(t), f).toBe(false);
    }
  });
});
