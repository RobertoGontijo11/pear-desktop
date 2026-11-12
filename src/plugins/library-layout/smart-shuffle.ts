/**
 * Second shuffle mode. The shuffle button cycles:
 *
 *   off  →  shuffle (queue only)  →  shuffle + discoveries  →  off
 *
 * "Shuffle + discoveries" keeps YouTube Music's own shuffle on and mixes
 * similar tracks that are not in the queue in between the upcoming ones,
 * roughly one new track for every two from the playlist.
 *
 * Similar tracks come from YouTube Music's own radio for a few tracks of the
 * queue (the same `/next` request the page makes for "Start radio").
 */
import type { QueueItem } from '@/types/datahost-get-state';
import type { MusicPlayerAppElement } from '@/types/music-player-app-element';
import type { QueueElement } from '@/types/queue';

const BAR = 'ytmusic-app-layout > ytmusic-player-bar';
const SHUFFLE_BUTTON = `${BAR} .shuffle`;

const SEED_COUNT = 3;
const MAX_DISCOVERIES = 15;
/** One discovery after every this many queue tracks. */
const SPACING = 2;

export type ShuffleMode = 'off' | 'shuffle' | 'smart';

// ---- pure helpers (unit-testable) ---------------------------------------

export const videoIdOf = (item: QueueItem) =>
  (
    item.playlistPanelVideoRenderer ??
    item.playlistPanelVideoWrapperRenderer?.primaryRenderer
      .playlistPanelVideoRenderer
  )?.videoId;

export const isSelected = (item: QueueItem) =>
  Boolean(
    (
      item.playlistPanelVideoRenderer ??
      item.playlistPanelVideoWrapperRenderer?.primaryRenderer
        .playlistPanelVideoRenderer
    )?.selected,
  );

/** Collects every playlistPanelVideoRenderer.videoId in a `/next` response. */
export const extractVideoIds = (response: unknown): string[] => {
  const found: string[] = [];
  const visit = (node: unknown, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 14) return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, depth + 1);
      return;
    }
    const record = node as Record<string, unknown>;
    const renderer = record.playlistPanelVideoRenderer;
    if (renderer && typeof renderer === 'object') {
      const id = (renderer as Record<string, unknown>).videoId;
      if (typeof id === 'string') found.push(id);
    }
    for (const value of Object.values(record)) visit(value, depth + 1);
  };
  visit(response, 0);
  return found;
};

/** Fisher–Yates on a copy. */
export const shuffled = <T>(list: readonly T[], random = Math.random): T[] => {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

/**
 * Which candidates to add: not already queued, no duplicates, and at most one
 * per `SPACING` upcoming tracks (capped).
 */
export const pickDiscoveries = (
  candidates: readonly string[],
  queuedIds: ReadonlySet<string>,
  upcomingCount: number,
  random = Math.random,
): string[] => {
  const unique = [...new Set(candidates)].filter((id) => !queuedIds.has(id));
  const wanted = Math.min(
    MAX_DISCOVERIES,
    Math.max(1, Math.floor(upcomingCount / SPACING)),
  );
  return shuffled(unique, random).slice(0, wanted);
};

/**
 * Queue indexes at which to insert `count` items, given the index of the
 * current track. Indexes are final positions, to be applied in order: the
 * n-th discovery lands after n * SPACING playlist tracks.
 */
export const insertionIndexes = (
  currentIndex: number,
  queueLength: number,
  count: number,
): number[] => {
  const indexes: number[] = [];
  let length = queueLength;
  for (let n = 1; n <= count; n++) {
    const offset = n * (SPACING + 1);
    const index = Math.min(currentIndex + offset, length);
    indexes.push(index);
    length++;
  }
  return indexes;
};

// ---- page integration -----------------------------------------------------

type QueueDatasResponse = { queueDatas?: { content?: unknown }[] };

export const createSmartShuffle = () => {
  let smart = false;
  let busy = false;
  let injected = new Set<string>();
  let lastContext: string | null = null;
  let button: HTMLElement | null = null;
  let observer: MutationObserver | null = null;
  let unsubscribeTimer: ReturnType<typeof setTimeout> | null = null;

  const queueEl = () => document.querySelector<QueueElement>('#queue');
  const appEl = () =>
    document.querySelector<MusicPlayerAppElement>('ytmusic-app');
  const store = () => queueEl()?.queue.store.store;
  const nativeOn = () =>
    document.querySelector(BAR)?.hasAttribute('shuffle-on') ?? false;

  const mode = (): ShuffleMode =>
    !nativeOn() ? 'off' : smart ? 'smart' : 'shuffle';

  const toast = (message: string) => {
    const app = appEl() as
      | (MusicPlayerAppElement & {
          toastService?: { show?: (text: string) => void };
        })
      | null;
    try {
      app?.toastService?.show?.(message);
    } catch {
      // Toasts are a nicety; never let them break the mode switch.
    }
  };

  const reflect = () => {
    const current = mode();
    document.documentElement.dataset.libraryLayoutShuffle = current;
    const label =
      current === 'off'
        ? 'Aleatório: desligado'
        : current === 'shuffle'
          ? 'Aleatório: só a fila'
          : 'Aleatório: fila + descobertas';
    if (button) {
      button.title = label;
      button.setAttribute('aria-label', label);
    }
  };

  const fetchRadio = async (videoId: string) => {
    const app = appEl();
    if (!app) return [];
    try {
      const response = await app.networkManager.fetch<
        unknown,
        { videoId: string; playlistId: string; isAudioOnly: boolean }
      >('/next', {
        videoId,
        playlistId: `RDAMVM${videoId}`,
        isAudioOnly: true,
      });
      return extractVideoIds(response);
    } catch {
      return [];
    }
  };

  const inject = async () => {
    const queue = queueEl();
    const app = appEl();
    const currentStore = store();
    if (!queue || !app || !currentStore || busy) return;
    busy = true;
    try {
      const items = currentStore.getState().queue.items;
      const ids = items.map(videoIdOf).filter((id): id is string => !!id);
      const currentIndex = Math.max(0, items.findIndex(isSelected));
      const upcoming = ids.slice(currentIndex + 1);
      if (ids.length === 0) return;

      const seeds = shuffled(upcoming.length ? upcoming : ids).slice(
        0,
        SEED_COUNT,
      );
      const candidates = (await Promise.all(seeds.map(fetchRadio))).flat();
      const chosen = pickDiscoveries(
        candidates,
        new Set(ids),
        Math.max(upcoming.length, SPACING),
      );
      if (!smart) return; // switched off while fetching
      if (chosen.length === 0) {
        toast('Não encontrei faixas parecidas para misturar');
        return;
      }

      const state = currentStore.getState().queue;
      const result = await app.networkManager.fetch<
        QueueDatasResponse,
        { queueContextParams: string; videoIds: string[] }
      >('/music/get_queue', {
        queueContextParams: state.queueContextParams,
        videoIds: chosen,
      });
      const contents = (result?.queueDatas ?? [])
        .map((data) => data?.content)
        .filter(Boolean);
      if (!smart || contents.length === 0) return;

      const live = currentStore.getState().queue.items;
      const liveIndex = Math.max(0, live.findIndex(isSelected));
      const indexes = insertionIndexes(liveIndex, live.length, contents.length);
      contents.forEach((content, n) => {
        queue.dispatch({
          type: 'ADD_ITEMS',
          payload: {
            nextQueueItemId: currentStore.getState().queue.nextQueueItemId,
            index: indexes[n],
            items: [content],
            shuffleEnabled: false,
            shouldAssignIds: true,
          },
        });
      });
      injected = new Set([...injected, ...chosen]);
      lastContext = currentStore.getState().queue.queueContextParams;
      toast(`${contents.length} descobertas misturadas na fila`);
    } finally {
      busy = false;
    }
  };

  /** Removes the not-yet-played discoveries, last to first. */
  const removeInjected = () => {
    const queue = queueEl();
    const currentStore = store();
    if (!queue || !currentStore) return;
    const items = currentStore.getState().queue.items;
    for (let index = items.length - 1; index >= 0; index--) {
      const id = videoIdOf(items[index]);
      if (id && injected.has(id) && !isSelected(items[index])) {
        queue.dispatch({ type: 'REMOVE_ITEM', payload: index });
      }
    }
    injected = new Set();
  };

  /** Re-mixes when a different playlist starts while the mode is on. */
  const watchContext = () => {
    if (unsubscribeTimer) clearTimeout(unsubscribeTimer);
    unsubscribeTimer = setTimeout(() => {
      unsubscribeTimer = null;
      if (!smart) return;
      const context = store()?.getState().queue.queueContextParams ?? null;
      if (context && context !== lastContext && !busy) {
        lastContext = context;
        injected = new Set();
        inject().catch(() => {});
      }
      watchContext();
    }, 4000);
  };

  const onClick = (event: Event) => {
    const current = mode();
    if (current === 'off') {
      // Let YouTube Music turn its shuffle on.
      smart = false;
      setTimeout(reflect, 300);
      return;
    }
    if (current === 'shuffle') {
      // Second click: keep native shuffle on and add discoveries.
      event.preventDefault();
      event.stopImmediatePropagation();
      smart = true;
      reflect();
      watchContext();
      inject().catch(() => {});
      return;
    }
    // Third click: drop discoveries, then let the native click turn it off.
    smart = false;
    removeInjected();
    setTimeout(reflect, 300);
  };

  const attach = () => {
    const found = document.querySelector<HTMLElement>(SHUFFLE_BUTTON);
    if (!found || found === button) return;
    button?.removeEventListener('click', onClick, true);
    button = found;
    button.addEventListener('click', onClick, true);
    reflect();
  };

  return {
    start() {
      observer = new MutationObserver(() => {
        attach();
        reflect();
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['shuffle-on'],
      });
      attach();
    },
    stop() {
      observer?.disconnect();
      observer = null;
      if (unsubscribeTimer) clearTimeout(unsubscribeTimer);
      unsubscribeTimer = null;
      button?.removeEventListener('click', onClick, true);
      button = null;
      if (smart) removeInjected();
      smart = false;
      delete document.documentElement.dataset.libraryLayoutShuffle;
    },
  };
};
