/**
 * Spotify-style type chips at the top of the left column:
 *
 *   Playlists  → YouTube Music's own guide list (default)
 *   Álbuns     → albums saved in the library
 *   Artistas   → artists of the songs in the library
 *
 * Albums and artists are read from the same library pages YouTube Music's
 * "Biblioteca" uses (first page only) and opened with its in-app navigation.
 * Everything is built with createElement: the page enforces Trusted Types.
 */
import type { MusicPlayerAppElement } from '@/types/music-player-app-element';

export type LibraryKind = 'playlists' | 'albums' | 'artists';

export type LibraryItem = {
  title: string;
  subtitle: string;
  thumbnail?: string;
  endpoint: Record<string, unknown>;
};

const BROWSE_IDS: Record<Exclude<LibraryKind, 'playlists'>, string> = {
  albums: 'FEmusic_liked_albums',
  artists: 'FEmusic_library_corpus_track_artists',
};

const LABELS: Record<LibraryKind, string> = {
  playlists: 'Playlists',
  albums: 'Álbuns',
  artists: 'Artistas',
};

const EMPTY: Record<Exclude<LibraryKind, 'playlists'>, string> = {
  albums: 'Nenhum álbum salvo na biblioteca',
  artists: 'Nenhum artista na biblioteca',
};

const STORAGE_KEY = 'library-layout:filter';
const CACHE_MS = 5 * 60 * 1000;

export const CHIPS_ID = 'library-layout-chips';
export const ITEMS_ID = 'library-layout-items';
export const ITEM_CLASS = 'library-layout-item';
export const ITEM_TITLE_CLASS = 'library-layout-item-title';

// ---- pure helpers (unit-testable) ---------------------------------------

type Runs = { runs?: { text?: string }[] };
type Thumb = { url?: string; width?: number };
type Renderer = {
  title?: Runs;
  subtitle?: Runs;
  flexColumns?: {
    musicResponsiveListItemFlexColumnRenderer?: { text?: Runs };
  }[];
  navigationEndpoint?: Record<string, unknown>;
  thumbnailRenderer?: {
    musicThumbnailRenderer?: { thumbnail?: { thumbnails?: Thumb[] } };
  };
  thumbnail?: {
    musicThumbnailRenderer?: { thumbnail?: { thumbnails?: Thumb[] } };
  };
};

const text = (runs?: Runs) =>
  (runs?.runs ?? []).map((run) => run.text ?? '').join('');

/** Smallest thumbnail that is still at least `min` px wide. */
export const pickThumbnail = (thumbs: Thumb[] = [], min = 40) => {
  const sorted = [...thumbs]
    .filter((thumb) => thumb.url)
    .sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (sorted.find((thumb) => (thumb.width ?? 0) >= min) ?? sorted.at(-1))
    ?.url;
};

/** Every album/artist/playlist card in a `/browse` response, in order. */
export const parseLibraryItems = (response: unknown): LibraryItem[] => {
  const items: LibraryItem[] = [];
  const visit = (node: unknown, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 20) return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, depth + 1);
      return;
    }
    const record = node as Record<string, unknown>;
    for (const key of [
      'musicTwoRowItemRenderer',
      'musicResponsiveListItemRenderer',
    ]) {
      const renderer = record[key] as Renderer | undefined;
      if (!renderer) continue;
      const endpoint = renderer.navigationEndpoint;
      if (!endpoint?.browseEndpoint) continue;
      const columns = renderer.flexColumns ?? [];
      const title =
        text(renderer.title) ||
        text(columns[0]?.musicResponsiveListItemFlexColumnRenderer?.text);
      if (!title) continue;
      const subtitle =
        text(renderer.subtitle) ||
        text(columns[1]?.musicResponsiveListItemFlexColumnRenderer?.text);
      const thumbs = (renderer.thumbnailRenderer ?? renderer.thumbnail)
        ?.musicThumbnailRenderer?.thumbnail?.thumbnails;
      items.push({
        title,
        subtitle,
        thumbnail: pickThumbnail(thumbs),
        endpoint,
      });
    }
    for (const value of Object.values(record)) visit(value, depth + 1);
  };
  visit(response, 0);
  return items;
};

// ---- page integration -----------------------------------------------------

const loadKind = (): LibraryKind => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'albums' || saved === 'artists' ? saved : 'playlists';
  } catch {
    return 'playlists';
  }
};

const saveKind = (kind: LibraryKind) => {
  try {
    localStorage.setItem(STORAGE_KEY, kind);
  } catch {
    // Storage can be unavailable; the filter still works for this session.
  }
};

export const createLibraryFilter = (options: { onRender: () => void }) => {
  let kind = loadKind();
  let chips: HTMLElement | null = null;
  let list: HTMLElement | null = null;
  const cache = new Map<LibraryKind, { at: number; items: LibraryItem[] }>();
  let loading: LibraryKind | null = null;
  const attempted = new Map<LibraryKind, number>();

  const message = (content: string) => {
    const element = document.createElement('div');
    element.className = 'library-layout-message';
    element.textContent = content;
    return element;
  };

  const renderItem = (item: LibraryItem) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = ITEM_CLASS;
    row.title = item.title;

    const image = document.createElement('img');
    image.className = 'library-layout-item-thumb';
    image.alt = '';
    image.loading = 'lazy';
    if (item.thumbnail) image.src = item.thumbnail;

    const texts = document.createElement('span');
    texts.className = 'library-layout-item-texts';
    const title = document.createElement('span');
    title.className = ITEM_TITLE_CLASS;
    title.textContent = item.title;
    const subtitle = document.createElement('span');
    subtitle.className = 'library-layout-item-subtitle';
    subtitle.textContent = item.subtitle;
    texts.append(title, subtitle);

    row.append(image, texts);
    row.addEventListener('click', () => {
      // YouTube Music's in-app navigation, same as clicking its own cards.
      row.dispatchEvent(
        new CustomEvent('yt-navigate', {
          bubbles: true,
          composed: true,
          detail: { endpoint: item.endpoint },
        }),
      );
    });
    return row;
  };

  const renderList = () => {
    if (!list) return;
    if (kind === 'playlists') {
      list.replaceChildren();
      return;
    }
    const cached = cache.get(kind);
    if (!cached) {
      list.replaceChildren(message('Carregando…'));
      return;
    }
    list.replaceChildren(
      ...(cached.items.length
        ? cached.items.map(renderItem)
        : [message(EMPTY[kind])]),
    );
    options.onRender();
  };

  const load = async (target: LibraryKind) => {
    if (target === 'playlists' || loading === target) return;
    // mount() runs on every page mutation: refetch only when the cache is
    // stale, and after a failure wait before retrying.
    const wait = cache.has(target) ? CACHE_MS : 30_000;
    if (Date.now() - (attempted.get(target) ?? 0) < wait) return;
    attempted.set(target, Date.now());
    const app = document.querySelector<MusicPlayerAppElement>('ytmusic-app');
    if (!app) return;
    loading = target;
    try {
      const response = await app.networkManager.fetch<
        unknown,
        { browseId: string }
      >('/browse', { browseId: BROWSE_IDS[target] });
      cache.set(target, { at: Date.now(), items: parseLibraryItems(response) });
    } catch {
      if (!cache.has(target)) {
        list?.replaceChildren(message('Não consegui carregar a biblioteca'));
      }
    } finally {
      loading = null;
    }
    if (kind === target) renderList();
  };

  const reflect = () => {
    const root = document.documentElement;
    if (root.dataset.libraryLayoutFilter !== kind) {
      root.dataset.libraryLayoutFilter = kind;
    }
    for (const chip of chips?.querySelectorAll<HTMLElement>('button') ?? []) {
      const pressed = String(chip.dataset.kind === kind);
      if (chip.getAttribute('aria-pressed') !== pressed) {
        chip.setAttribute('aria-pressed', pressed);
      }
    }
  };

  const select = (next: LibraryKind) => {
    kind = next;
    attempted.delete(next);
    saveKind(kind);
    reflect();
    renderList();
    load(kind).catch(() => {});
  };

  const buildChips = () => {
    const row = document.createElement('div');
    row.id = CHIPS_ID;
    row.setAttribute('role', 'toolbar');
    row.setAttribute('aria-label', 'Filtrar biblioteca');
    for (const value of ['playlists', 'albums', 'artists'] as const) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.dataset.kind = value;
      chip.textContent = LABELS[value];
      chip.addEventListener('click', () => select(value));
      row.append(chip);
    }
    return row;
  };

  return {
    /** Places chips above `anchor` and the album/artist list below it. */
    mount(anchor: HTMLElement) {
      if (!chips) chips = buildChips();
      if (!list) {
        list = document.createElement('div');
        list.id = ITEMS_ID;
      }
      if (chips.nextElementSibling !== anchor) anchor.before(chips);
      if (list.previousElementSibling !== anchor) anchor.after(list);
      reflect();
      if (kind !== 'playlists' && !list.hasChildNodes()) renderList();
      load(kind).catch(() => {});
    },
    unmount() {
      chips?.remove();
      list?.remove();
      chips = null;
      list = null;
      delete document.documentElement.dataset.libraryLayoutFilter;
    },
  };
};
