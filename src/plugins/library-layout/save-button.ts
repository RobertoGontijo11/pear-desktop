/**
 * One "+" button next to the current track, like Spotify's:
 *
 *   not liked  → click adds the track to "Músicas que gostei"; icon becomes ✓
 *   liked      → click opens YouTube Music's "Salvar na playlist" dialog
 *   liked      → Shift+click removes it from "Músicas que gostei"
 *
 * It drives YouTube Music's own controls (the thumbs-up button and the track
 * menu), so likes and playlists stay in the user's account.
 */

const BAR = 'ytmusic-app-layout > ytmusic-player-bar';

const SELECTORS = {
  container: `${BAR} .middle-controls-buttons`,
  likeRenderer: `${BAR} ytmusic-like-button-renderer`,
  likeButton: `${BAR} ytmusic-like-button-renderer #button-shape-like button`,
  menuButton: `${BAR} .middle-controls-buttons ytmusic-menu-renderer #button-shape button`,
  menuItems:
    'ytmusic-menu-popup-renderer ytmusic-menu-navigation-item-renderer',
} as const;

const SVG_NS = 'http://www.w3.org/2000/svg';

type MenuItem = HTMLElement & {
  data?: { navigationEndpoint?: Record<string, unknown> };
};

const isLiked = () =>
  document
    .querySelector(SELECTORS.likeRenderer)
    ?.getAttribute('like-status') === 'LIKE';

const icon = (liked: boolean) => {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '22');
  svg.setAttribute('height', '22');
  svg.setAttribute('aria-hidden', 'true');

  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx', '12');
  circle.setAttribute('cy', '12');
  circle.setAttribute('r', '9');
  circle.setAttribute('fill', liked ? 'currentColor' : 'none');
  circle.setAttribute('stroke', 'currentColor');
  circle.setAttribute('stroke-width', '1.8');

  const mark = document.createElementNS(SVG_NS, 'path');
  mark.setAttribute('d', liked ? 'M7.5 12.2l3 3 6-6.2' : 'M12 7.5v9M7.5 12h9');
  mark.setAttribute('fill', 'none');
  mark.setAttribute('stroke', liked ? '#000' : 'currentColor');
  mark.setAttribute('stroke-width', '2');
  mark.setAttribute('stroke-linecap', 'round');
  mark.setAttribute('stroke-linejoin', 'round');

  svg.append(circle, mark);
  return svg;
};

const waitFor = async <T>(
  find: () => T | null | undefined,
  timeoutMs = 2000,
): Promise<T | null> => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = find();
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
};

/** Opens the track menu and picks the item whose action is "add to playlist". */
const openSaveToPlaylist = async () => {
  document.querySelector<HTMLElement>(SELECTORS.menuButton)?.click();
  const item = await waitFor(() =>
    [...document.querySelectorAll<MenuItem>(SELECTORS.menuItems)].find(
      (candidate) =>
        candidate.isConnected &&
        candidate.getBoundingClientRect().width > 0 &&
        Boolean(candidate.data?.navigationEndpoint?.addToPlaylistEndpoint),
    ),
  );
  if (item) {
    (item.querySelector<HTMLElement>('a, tp-yt-paper-item') ?? item).click();
  } else {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  }
};

export const createSaveButton = () => {
  let button: HTMLButtonElement | null = null;
  let observer: MutationObserver | null = null;
  let shownLiked: boolean | null = null;

  const render = () => {
    if (!button) return;
    const liked = isLiked();
    if (liked === shownLiked) return;
    shownLiked = liked;
    const label = liked
      ? 'Salvo em Músicas que gostei. Clique para adicionar a uma playlist (Shift+clique remove)'
      : 'Salvar em Músicas que gostei';
    button.replaceChildren(icon(liked));
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(liked));
  };

  const onClick = (event: MouseEvent) => {
    event.stopPropagation();
    const like = document.querySelector<HTMLElement>(SELECTORS.likeButton);
    if (!isLiked() || event.shiftKey) {
      // Toggles the like in the user's account, same as the thumbs-up.
      like?.click();
      return;
    }
    openSaveToPlaylist().catch(() => {});
  };

  const ensure = () => {
    const container = document.querySelector(SELECTORS.container);
    if (!container) return;
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'library-layout-save';
      button.addEventListener('click', onClick);
      shownLiked = null;
    }
    if (button.parentElement !== container) container.prepend(button);
    render();
  };

  return {
    start() {
      document.documentElement.dataset.libraryLayoutSave = 'on';
      observer = new MutationObserver(ensure);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['like-status'],
      });
      ensure();
    },
    stop() {
      observer?.disconnect();
      observer = null;
      button?.remove();
      button = null;
      delete document.documentElement.dataset.libraryLayoutSave;
    },
  };
};
