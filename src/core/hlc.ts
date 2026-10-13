/**
 * Hybrid logical clock. Serialized as `<ms base36, 9>-<counter base36, 4>-<deviceId>` so plain
 * string comparison gives a total causal-consistent order across devices.
 */
export interface HlcState {
  ms: number;
  c: number;
}

const MAX_DRIFT_MS = 24 * 3600 * 1000;

export function formatHlc(ms: number, c: number, device: string): string {
  return `${ms.toString(36).padStart(9, '0')}-${c.toString(36).padStart(4, '0')}-${device}`;
}

export function parseHlc(h: string): { ms: number; c: number; device: string } {
  const [a, b, ...rest] = h.split('-');
  return { ms: Number.parseInt(a ?? '0', 36), c: Number.parseInt(b ?? '0', 36), device: rest.join('-') };
}

export class Hlc {
  private state: HlcState;
  constructor(
    readonly device: string,
    initial: HlcState = { ms: 0, c: 0 },
    private readonly clock: () => number = Date.now,
  ) {
    this.state = { ...initial };
  }

  now(): string {
    const pt = this.clock();
    if (pt > this.state.ms) {
      this.state = { ms: pt, c: 0 };
    } else {
      this.state = { ms: this.state.ms, c: this.state.c + 1 };
    }
    return formatHlc(this.state.ms, this.state.c, this.device);
  }

  /** Advance on receipt of a remote timestamp so later local writes sort after it. */
  receive(remote: string): void {
    const r = parseHlc(remote);
    const pt = this.clock();
    if (r.ms > pt + MAX_DRIFT_MS) return; // ignore absurd future clocks rather than poisoning ours
    const ms = Math.max(this.state.ms, r.ms, pt);
    let c: number;
    if (ms === this.state.ms && ms === r.ms) c = Math.max(this.state.c, r.c) + 1;
    else if (ms === this.state.ms) c = this.state.c + 1;
    else if (ms === r.ms) c = r.c + 1;
    else c = 0;
    this.state = { ms, c };
  }

  /** Adopt a persisted state written by another tab of the same device (shared IndexedDB). */
  observe(st: HlcState | undefined): void {
    if (!st) return;
    if (st.ms > this.state.ms || (st.ms === this.state.ms && st.c > this.state.c)) this.state = { ...st };
  }

  snapshot(): HlcState {
    return { ...this.state };
  }
}

export function maxHlc(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}
