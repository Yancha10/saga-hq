/** ULID: 48-bit time + 80-bit randomness, Crockford base32, monotonic within one millisecond. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let lastTime = -1;
let lastRandom: number[] = [];

function encodeTime(t: number): string {
  let out = '';
  for (let i = 9; i >= 0; i--) {
    const mod = t % 32;
    out = CROCKFORD[mod] + out;
    t = (t - mod) / 32;
  }
  return out;
}

function freshRandom(): number[] {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b & 31);
}

export function ulid(now: number = Date.now()): string {
  let rand: number[];
  if (now === lastTime) {
    rand = lastRandom.slice();
    for (let i = rand.length - 1; i >= 0; i--) {
      if (rand[i]! < 31) {
        rand[i]!++;
        break;
      }
      rand[i] = 0;
    }
  } else {
    rand = freshRandom();
  }
  lastTime = now;
  lastRandom = rand;
  return encodeTime(now) + rand.map((r) => CROCKFORD[r]).join('');
}

export function isUlid(v: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(v);
}
