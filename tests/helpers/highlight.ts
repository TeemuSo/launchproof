import type { Locator } from '@playwright/test';

// Visual-correctness annotation: outline the exact element an assertion is about,
// IN the browser, right before the step's auto-screenshot fires. Green = the value
// we asserted is correct/present; red = something we asserted is absent/wrong.
// The highlight lands on the real cell regardless of layout, so each shot is
// self-proving — you can see WHICH element the PASS refers to.
export async function mark(locator: Locator, kind: 'ok' | 'bad', label?: string): Promise<void> {
  const color = kind === 'ok' ? '#1fc16b' : '#f04457';
  const bg = kind === 'ok' ? 'rgba(31,193,107,0.14)' : 'rgba(240,68,87,0.14)';
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
