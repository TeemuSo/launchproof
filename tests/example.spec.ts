// COPY ME. This is the starting pattern for a LaunchProof test. Duplicate this
// file to tests/<your-feature>.spec.ts and edit the two gates for your feature.
// ONE test() per file -- only the first test is recorded (a second is dropped
// with a warning; a describe around a single test is fine). Split scenarios
// into separate <feature>-<case>.spec.ts files.
//
// RULES this file follows (keep them -- they kill flakiness and fake passes):
//   1. LOCATORS: user-facing, role-based, in priority order getByRole ->
//      getByLabel -> getByText / getByPlaceholder. data-testid only as a last
//      resort (kebab-case, e.g. data-testid="login-submit"). Never CSS or XPath.
//   2. ASSERTIONS: awaited web-first auto-retrying assertions only
//      (await expect(locator).toBeVisible()). Never expect(await x.isVisible()).
//   3. NO HARD WAITS: never page.waitForTimeout / sleep. Wait on real conditions
//      (toBeVisible, toHaveURL, waitForResponse).
//   4. DRIVE THE REAL UI: click / fill on locators like a user. No page.evaluate,
//      no direct API calls. Assert user-VISIBLE behavior, not internal state.
//      The whole point is proving a user can do it, not that a handler exists.
//   5. TWO GATES in named recordedStep()s: gate A reaches the real state and
//      asserts it (toHaveURL / a visible landmark / non-error status), never
//      "no exception thrown"; gate B is ONE crisp acceptance expect on the
//      outcome a user cares about.
//   6. ASSERT THE REAL VALUE, never a placeholder. The classic AI failure is a
//      test that passes while the price still shows $0.00. Check what matters.
//      Name it the way the user would point at it on screen (the visible label,
//      the price, the chip) -- not a numeric proxy like a magic rgb() or pixel
//      width, which proves nothing to whoever reads the dashboard.
//   7. METADATA IS NATIVE PLAYWRIGHT, not comments: declare the intent as a
//      native tag ('@functional' or '@security') and the plain-English meaning
//      as a native annotation ({ type: 'meaning', ... }) in the test's details
//      object below. Both flow through the JSON reporter into result.json and
//      the dashboard; the meaning is what a non-author reads to understand
//      what green/red MEANS for the product.
//
// Everything runs against TARGET_URL (default http://localhost:3000).
// Point it at your app:  export TARGET_URL=http://localhost:5173

import { test, expect } from '@playwright/test';
import { recordedStep } from './helpers/shot';

test(
  'the home page loads and renders real content',
  {
    tag: '@functional',
    annotation: {
      type: 'meaning',
      description:
        'REPLACE ME with one or two plain-English sentences: what must work for this ' +
        'test to be green, and what a red verdict means for the product/user.',
    },
  },
  async ({ page }, testInfo) => {
    // GATE A -- reach the real state and PROVE you are there. Never settle for
    // "the goto didn't throw". Assert the navigation actually succeeded.
    await recordedStep(page, testInfo, 'reach the home page', async () => {
      const response = await page.goto('/');
      // The server really served the page (not a 4xx/5xx). Portable, real gate.
      expect(response?.status(), 'home page HTTP status').toBeLessThan(400);
    });

    // GATE B -- ONE crisp acceptance check on what a user actually cares about.
    //
    // The live assertion below is a portable smoke check: a blank or errored page
    // has no <title>. It lets this template pass out of the box against any app.
    // REPLACE it with a REAL user-facing check for YOUR feature. For example, to
    // prove an "Add to cart" flow, you would drive the UI and assert the outcome:
    //
    //   await page.getByRole('button', { name: /add to cart/i }).click();
    //   await expect(page.getByText('1 item in cart')).toBeVisible();  // real outcome
    //   await expect(page.getByText('$49.00')).toBeVisible();          // the REAL price
    //
    // Use getByRole first (rule 1), a user action not an API call (rule 4), and
    // assert the meaningful value, not a placeholder (rule 6).
    await recordedStep(page, testInfo, 'the page rendered real content', async () => {
      await expect(page).toHaveTitle(/.+/);
    });
  }
);
