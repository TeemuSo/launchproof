// LaunchProof dogfood spec: drives the login-gated fixture app the same way a
// real project's spec would. Its job is to produce a WORKING run whose captured
// evidence (screenshot + DOM + storageState per step) the acceptance verifier
// then checks against ground truth.
//
// Follows the harness's own rules: role/label locators, awaited web-first
// assertions, real UI actions, two named recordedStep gates, native metadata.

import { test, expect } from '@playwright/test';
import { recordedStep } from './helpers/shot';

test(
  'a user can sign in and reach their dashboard',
  {
    tag: '@functional',
    annotation: {
      type: 'meaning',
      description:
        'Green means a user with valid credentials can sign in and land on the ' +
        'protected dashboard greeting them by name. Red means login or the session ' +
        'gate is broken and users cannot reach their account.',
    },
  },
  async ({ page }, testInfo) => {
    // GATE A — drive the real login UI and prove we landed on the protected page.
    await recordedStep(page, testInfo, 'sign in with valid credentials', async () => {
      await page.goto('/');
      await page.getByLabel('Username').fill('alice');
      await page.getByLabel('Password').fill('secret');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
    });

    // GATE B — one crisp acceptance check on the real value: the dashboard
    // greets THIS user by name. This is the value captured into the DOM that
    // the acceptance verifier greps for.
    await recordedStep(page, testInfo, 'the dashboard greets the user by name', async () => {
      await expect(page.getByTestId('current-user')).toHaveText('alice');
      await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    });
  }
);
