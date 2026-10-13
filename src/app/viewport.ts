/**
 * Tracks the *visible* viewport (iOS shrinks it when the keyboard opens and may leave the page
 * scrolled after it closes). Bottom sheets size and position themselves from these variables, so
 * they always fit the screen and keep their action button visible above the keyboard.
 */
export function trackVisualViewport(): void {
  const vv = window.visualViewport;
  const root = document.documentElement;
  if (!vv) return;
  let raf = 0;
  const apply = () => {
    raf = 0;
    root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
    root.style.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`);
    // Keyboard open: the visible area is much shorter than the layout viewport.
    root.dataset.kb = window.innerHeight - vv.height > 120 ? '1' : '0';
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(apply);
  };
  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  window.addEventListener('orientationchange', schedule);
  apply();
}
