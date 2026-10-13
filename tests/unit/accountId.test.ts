import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_NAMESPACE,
  deriveAccountHint,
  deriveAccountId,
  HANDOFF_NAMESPACE,
  isAccountId,
} from '../../src/core/accountId';
import { base32Lower } from '../../src/core/base32';

// Fixed vectors computed independently (Python hashlib + base64.b32encode).
const SUB = '109876543210987654321';

describe('accountId invariant (revision 3)', () => {
  it('namespace is permanent', () => {
    expect(ACCOUNT_NAMESPACE).toBe('saga-hq:');
    expect(HANDOFF_NAMESPACE).toBe('saga-handoff:');
  });
  it('matches the fixed vector', async () => {
    const id = await deriveAccountId(SUB);
    expect(id).toBe('tpcrzqgkf42tm3e75lb44bk3fuwkmgyb');
    expect(id).toHaveLength(32);
    expect(isAccountId(id)).toBe(true);
    expect(id).not.toContain(SUB);
  });
  it('accountHint uses its own namespace', async () => {
    expect(await deriveAccountHint(SUB)).toBe('gun77qtn6hxyafxwvnrh6ncmbm4rx7ea');
  });
  it('is deterministic and distinct per subject', async () => {
    expect(await deriveAccountId(SUB)).toBe(await deriveAccountId(SUB));
    expect(await deriveAccountId('1')).not.toBe(await deriveAccountId('2'));
  });
  it('base32 matches RFC 4648 test vectors (lowercase, unpadded)', () => {
    const enc = (s: string) => base32Lower(new TextEncoder().encode(s));
    expect(enc('f')).toBe('my');
    expect(enc('foobar')).toBe('mzxw6ytboi');
  });
});
