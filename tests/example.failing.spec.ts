// This is what a BROKEN verdict looks like. Gate A passes (the page really
// loads), then Gate B asserts on a control that does not exist, so it fails
// with a genuine Playwright assertion timeout -- not a scripted throw. Run it
// with `node run.mjs example.failing` to see the dashboard's BROKEN state.
import { test, expect } from '@playwright/test';
import { recordedStep } from './helpers/shot';

test(
  'a broken feature: the acceptance gate fails on the real page',
  {
    tag: '@functional',
    annotation: {
      type: 'meaning',
      description:
        'Demo of a red verdict: the page loads, but the control the acceptance ' +
        'gate expects is deliberately absent, so the run classifies as BROKEN.',
    },
  },
  async ({ page }, testInfo) => {
    await recordedStep(page, testInfo, 'reach the home page', async () => {
      const response = await page.goto('/');
      expect(response?.status(), 'home page HTTP status').toBeLessThan(400);
    });

    await recordedStep(page, testInfo, 'acceptance gate (intentionally unmet)', async () => {
      // No such control exists, so this auto-retrying assertion times out and the
      // run is classified BROKEN: the test reached the app and saw the wrong thing.
      await expect(
        page.getByRole('button', { name: /this-button-does-not-exist-xyz/i })
      ).toBeVisible();
    });
  }
);
