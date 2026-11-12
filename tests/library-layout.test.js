import path from 'node:path';
import process from 'node:process';

import { test, expect, _electron as electron } from '@playwright/test';

// NODE_ENV=test is deliberately not set: upstream enables the renderer sandbox
// in test mode, which stops preload.cjs (and every plugin) from loading.
delete process.env.NODE_ENV;

const appPath = path.resolve(import.meta.dirname, '..');

test('library-layout plugin starts and injects its stylesheet', async () => {
  const app = await electron.launch({
    cwd: appPath,
    args: [
      appPath,
      '--no-sandbox',
      '--disable-gpu',
      '--whitelisted-ips=',
      '--disable-dev-shm-usage',
    ],
  });

  const window = await app.firstWindow();

  // Renderer hook ran.
  await expect(window.locator('html')).toHaveAttribute(
    'data-library-layout',
    'on',
    { timeout: 30_000 },
  );

  // Stylesheet is applied (custom property defined on :root).
  const accent = await window.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue('--library-layout-accent')
      .trim(),
  );
  expect(accent).toBe('#7c5cff');

  await app.close();
});
