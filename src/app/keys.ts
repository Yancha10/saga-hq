import { useEffect } from 'react';

/** True when typing in a text field — single-key shortcuts must not fire then. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

export interface Shortcut {
  combo: string; // e.g. "mod+k", "c", "g t", "?"
  run: (e: KeyboardEvent) => void;
  allowInInput?: boolean;
}

/** Minimal shortcut handler supporting mod+key, single keys and two-key "g x" sequences. */
export function useShortcuts(list: Shortcut[]): void {
  useEffect(() => {
    let pending: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      for (const sc of list) {
        const parts = sc.combo.split(' ');
        if (parts.length === 2) {
          if (isTyping(e) || mod) continue;
          if (pending === parts[0] && key === parts[1]) {
            e.preventDefault();
            pending = null;
            sc.run(e);
            return;
          }
          continue;
        }
        const wantsMod = sc.combo.startsWith('mod+');
        const k = wantsMod ? sc.combo.slice(4) : sc.combo;
        if (wantsMod !== mod) continue;
        if (!sc.allowInInput && isTyping(e)) continue;
        if (!wantsMod && (e.altKey || e.metaKey || e.ctrlKey)) continue;
        if (key === k || (k === '?' && e.key === '?')) {
          e.preventDefault();
          sc.run(e);
          return;
        }
      }
      if (!isTyping(e) && !mod && key === 'g') {
        pending = 'g';
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          pending = null;
        }, 1200);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [list]);
}
