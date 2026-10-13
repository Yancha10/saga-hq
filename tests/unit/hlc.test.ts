import { describe, expect, it } from 'vitest';
import { Hlc, parseHlc } from '../../src/core/hlc';
import { isUlid, ulid } from '../../src/core/ulid';

describe('HLC', () => {
  it('is monotonic even when the wall clock stalls or goes back', () => {
    let t = 1000;
    const h = new Hlc('dev1', undefined, () => t);
    const a = h.now();
    t = 900;
    const b = h.now();
    const c = h.now();
    expect(a < b && b < c).toBe(true);
  });
  it('orders after received remote stamps', () => {
    const t = 1000;
    const a = new Hlc('a', undefined, () => t);
    const b = new Hlc('b', undefined, () => t - 500);
    const ra = a.now();
    b.receive(ra);
    expect(b.now() > ra).toBe(true);
  });
  it('ignores absurd future clocks', () => {
    const h = new Hlc('a', undefined, () => 1000);
    h.receive(new Hlc('z', undefined, () => 1000 + 10 * 86400000).now());
    expect(parseHlc(h.now()).ms).toBe(1000);
  });
});

describe('ULID', () => {
  it('is valid, unique and sortable within a millisecond', () => {
    const ids = Array.from({ length: 1000 }, () => ulid(5));
    expect(new Set(ids).size).toBe(1000);
    expect([...ids].sort()).toEqual(ids);
    expect(ids.every(isUlid)).toBe(true);
  });
});
