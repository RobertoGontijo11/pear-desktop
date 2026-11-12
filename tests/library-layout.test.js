import path from 'node:path';
import process from 'node:process';

import { test, expect, _electron as electron } from '@playwright/test';

// NODE_ENV=test is deliberately not set: upstream enables the renderer sandbox
// in test mode, which stops preload.cjs (and every plugin) from loading.
delete process.env.NODE_ENV;

const appPath = path.resolve(import.meta.dirname, '..');

// Column widths at the 1280px test window (compact tier, below 1400px).
const LEFT = 240;
const RIGHT = 300;

/** @type {import('@playwright/test').ElectronApplication} */
let app;
/** @type {import('@playwright/test').Page} */
let window;

test.beforeAll(async () => {
  // --mute-audio: test runs must never be audible, even if the app resumes
  // the last track on start.
  app = await electron.launch({
    cwd: appPath,
    args: ['--mute-audio', appPath],
  });
  window = await app.firstWindow({ timeout: 60_000 });
  // The page can raise a dialog that is gone before Playwright's default
  // handler answers it, which fails the running test with a protocol error.
  window.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
  await window.waitForSelector('ytmusic-nav-bar', { timeout: 60_000 });
  // Dev builds open DevTools docked, which eats window width. It can open
  // after this hook runs, so close it now and whenever it shows up later.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.on('devtools-opened', () =>
      win.webContents.closeDevTools(),
    );
    win.webContents.closeDevTools();
    win.setBounds({ x: 0, y: 25, width: 1280, height: 800 });
  });
  // Stop playback too, so a test run does not advance the user's queue or
  // count as listening time.
  await window.evaluate(() => {
    const pause = () =>
      document.querySelectorAll('video').forEach((video) => video.pause());
    pause();
    document.addEventListener('playing', pause, true);
  });
  await expect
    .poll(() => window.evaluate(() => window.innerWidth))
    .toBeGreaterThanOrEqual(960);
});

test.afterAll(async () => {
  if (!app) return;
  const pid = app.process().pid;
  await app.close().catch(() => {});
  // The app is single-instance and its main process can outlive close();
  // a run started before it exits hangs waiting for a window.
  const alive = () => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  for (let i = 0; i < 50 && alive(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (alive()) process.kill(pid, 'SIGKILL');
});

const box = (selector) =>
  window.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, width: r.width, right: r.right };
  }, selector);

test('test run is silent: audio muted and playback paused', async () => {
  const muted = await app.evaluate(({ app: electronApp }) =>
    electronApp.commandLine.hasSwitch('mute-audio'),
  );
  expect(muted).toBe(true);
  await expect
    .poll(() =>
      window.evaluate(() =>
        [...document.querySelectorAll('video')].every((video) => video.paused),
      ),
    )
    .toBe(true);
});

test('plugin starts and injects its stylesheet', async () => {
  await expect(window.locator('html')).toHaveAttribute(
    'data-library-layout',
    'on',
    { timeout: 30_000 },
  );
  const accent = await window.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue('--library-layout-accent')
      .trim(),
  );
  expect(accent).toBe('#7c5cff');
});

test('left column is the widened library guide', async () => {
  await expect.poll(async () => (await box('#guide-wrapper'))?.width).toBe(LEFT);
  expect((await box('#guide-wrapper')).x).toBe(0);
});

test('right column docks the player page while something is loaded', async () => {
  const playerVisible = await window.evaluate(() =>
    document.querySelector('ytmusic-app-layout').hasAttribute('player-visible'),
  );
  test.skip(!playerVisible, 'needs a track loaded in the player (signed-in session)');

  // The page must stay in the "closed" state so the centre content is shown.
  await expect(window.locator('ytmusic-app-layout')).toHaveAttribute(
    'player-ui-state',
    'PLAYER_BAR_ONLY',
  );

  // Poll: the column settles a moment after the window is resized.
  await expect
    .poll(async () =>
      (await box('ytmusic-app-layout > ytmusic-player-page'))?.width,
    )
    .toBe(RIGHT);
  const page = await box('ytmusic-app-layout > ytmusic-player-page');
  const content = await box('#content');
  // Centre column ends where the right column starts.
  expect(Math.abs(content.right - page.x)).toBeLessThanOrEqual(1);
  await expect(
    window.locator('ytmusic-app-layout > ytmusic-player-page #side-panel'),
  ).toBeVisible();
});
