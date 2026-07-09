import type { Locator } from '@playwright/test';

// Visual-correctness annotation: outline the exact element an assertion is about,
// IN the browser, right before the step's auto-screenshot fires. The highlight
// lands on the real cell regardless of layout, so each shot is self-proving —
// you can see WHICH element the PASS refers to.
//
// The tone is a SEVERITY CLAIM, not decoration — a human eyeballing the still
// reads the color as the verdict, so it must match what the assertion says
// about the element:
//
//   ok       green — the asserted value is present/correct; a safe or
//            confirmed-good state.
//   warn     amber — a warning-severity state is (correctly) being shown:
//            needs-review, suspicious, degraded. The test passing does not
//            make the state green; the state itself is amber.
//   bad      red — a violation, an exposure, a danger state: something is
//            wrong (or asserted absent/wrong) for the app's user.
//   neutral  slate — a pure "this element" pointer with no severity claim
//            (e.g. locating the control a later step will drive).
//
// Never mark an amber/red state with the ok tone just because the assertion
// passed — the color speaks for the STATE, the verdict speaks for the test.
const TONES = {
  ok: { color: '#1fc16b', bg: 'rgba(31,193,107,0.14)' },
  warn: { color: '#f5a623', bg: 'rgba(245,166,35,0.16)' },
  bad: { color: '#f04457', bg: 'rgba(240,68,87,0.14)' },
  neutral: { color: '#64748b', bg: 'rgba(100,116,139,0.14)' },
} as const;

export type MarkTone = keyof typeof TONES;

export async function mark(locator: Locator, tone: MarkTone, label?: string): Promise<void> {
  const { color, bg } = TONES[tone];
  await locator.evaluate(
    (el, { color, bg, label }) => {
      const node = el as HTMLElement;
      node.style.outline = `3px solid ${color}`;
      node.style.outlineOffset = '2px';
      node.style.background = bg;
      node.style.borderRadius = '4px';
      if (label) {
        const tag = document.createElement('span');
        tag.textContent = label;
        tag.style.cssText = `position:absolute;transform:translateY(-125%);left:0;background:${color};color:#fff;font:600 11px/1.4 system-ui,sans-serif;padding:1px 6px;border-radius:4px;z-index:2147483647;white-space:nowrap;`;
        node.style.position = node.style.position || 'relative';
        node.appendChild(tag);
      }
    },
    { color, bg, label },
  );
}
