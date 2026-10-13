export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export async function sha256(data: Uint8Array | string): Promise<Uint8Array> {
  const bytes = typeof data === 'string' ? utf8(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return new Uint8Array(digest);
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const d = await sha256(data);
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomBytes(n: number): Uint8Array {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}
