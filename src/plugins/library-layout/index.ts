import { createPlugin } from '@/utils';

import { createExpandedView } from './expanded-view';
import { createGenreMixes } from './mixes';
import { createPlayerBar } from './player-bar';
import { createSaveButton } from './save-button';
import { createSidebarSearch } from './sidebar-search';
import { createSmartShuffle } from './smart-shuffle';
import style from './style.css?inline';
import { createWeeklyPlaylist, type WeeklyState } from './weekly';

import type { MixesConfig } from './mixes-core';

// Keep in sync with the @media breakpoint in style.css.
const WIDE_QUERY = '(min-width: 960px)';

const SELECTORS = {
  layout: 'ytmusic-app-layout',
  // The page has a second, hidden player bar inside ytmusic-player-page;
  // only the one that is a direct child of the layout reacts to clicks.
  togglePlayerPage:
    'ytmusic-app-layout > ytmusic-player-bar .toggle-player-page-button',
} as const;

const sidebarSearch = createSidebarSearch();
const playerBar = createPlayerBar();
const smartShuffle = createSmartShuffle();
const saveButton = createSaveButton();
const expandedView = createExpandedView();
let stateObserver: MutationObserver | null = null;
let attachObserver: MutationObserver | null = null;
let wide: MediaQueryList | null = null;
let weekly: ReturnType<typeof createWeeklyPlaylist> | null = null;
let mixes: ReturnType<typeof createGenreMixes> | null = null;

/**
 * The player page is docked as the right column by CSS. YouTube Music hides
 * the browse content while that page is "open", so in the wide layout we keep
 * it in the closed state and let the CSS show it anyway.
 */
const keepPlayerPageClosed = () => {
  if (!wide?.matches) return;
  const layout = document.querySelector(SELECTORS.layout);
  if (layout?.getAttribute('player-ui-state') !== 'PLAYER_PAGE_OPEN') return;
  document.querySelector<HTMLElement>(SELECTORS.togglePlayerPage)?.click();
};

const attachToLayout = () => {
  const layout = document.querySelector(SELECTORS.layout);
  if (!layout || !stateObserver) return false;
  stateObserver.observe(layout, {
    attributes: true,
    attributeFilter: ['player-ui-state'],
  });
  keepPlayerPageClosed();
  return true;
};

// Strings are kept inline (not in src/i18n) so the whole plugin lives in this
// folder and upstream merges never touch it.
export default createPlugin({
  name: () => 'Library Layout',
  description: () =>
    'Three-column layout with a fixed library sidebar, folders and local discovery mixes',
  restartNeeded: false,
  config: {
    enabled: true,
    // Pointer to the "Descobertas da semana" playlist and the week it was
    // last filled; the playlist itself lives in the YouTube Music account.
    weekly: {} as WeeklyState,
    // Daily genre mixes: definitions (editable) and their playlists' state.
    mixes: {} as Partial<MixesConfig>,
  },
  stylesheets: [style],
  renderer: {
    start(context) {
      document.documentElement.dataset.libraryLayout = 'on';
      weekly = createWeeklyPlaylist(context);
      weekly.start();
      mixes = createGenreMixes(context);
      mixes.start();
      // Manual trigger for the DevTools console: libraryLayoutWeekly(true)
      (window as unknown as Record<string, unknown>).libraryLayoutWeekly = (
        force?: boolean,
      ) => weekly?.generate(Boolean(force));
      // Manual trigger for the DevTools console: libraryLayoutMixes(true)
      (window as unknown as Record<string, unknown>).libraryLayoutMixes = (
        force?: boolean,
      ) => mixes?.generate(Boolean(force));
      sidebarSearch.start();
      playerBar.start();
      smartShuffle.start();
      saveButton.start();
      expandedView.start();

      wide = window.matchMedia(WIDE_QUERY);
      wide.addEventListener('change', keepPlayerPageClosed);

      stateObserver = new MutationObserver(keepPlayerPageClosed);
      if (!attachToLayout()) {
        attachObserver = new MutationObserver(() => {
          if (attachToLayout()) attachObserver?.disconnect();
        });
        attachObserver.observe(document.documentElement, {
          childList: true,
          subtree: true,
        });
      }
    },

    stop() {
      delete document.documentElement.dataset.libraryLayout;
      sidebarSearch.stop();
      playerBar.stop();
      smartShuffle.stop();
      saveButton.stop();
      expandedView.stop();
      weekly?.stop();
      weekly = null;
      mixes?.stop();
      mixes = null;
      stateObserver?.disconnect();
      stateObserver = null;
      attachObserver?.disconnect();
      attachObserver = null;
      wide?.removeEventListener('change', keepPlayerPageClosed);
      wide = null;
    },
  },
});
