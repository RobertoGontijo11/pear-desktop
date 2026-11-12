/**
 * Player bar arranged as: now playing (left) · transport (centre) · tools
 * (right), with shuffle and repeat next to the transport buttons and two
 * buttons that show/hide the side columns.
 *
 * The grid itself is defined in style.css; this module only moves the
 * shuffle/repeat buttons and adds the column toggles. Every step is a no-op
 * when a selector is missing, so a YouTube Music markup change degrades to
 * the stock bar instead of breaking it.
 */

const BAR = 'ytmusic-app-layout > ytmusic-player-bar';

const SELECTORS = {
  bar: BAR,
  transport: `${BAR} .left-controls-buttons`,
  previous: `${BAR} .previous-button`,
  next: `${BAR} .next-button`,
  shuffle: `${BAR} .shuffle`,
  repeat: `${BAR} .repeat`,
  tools: `${BAR} .right-controls-buttons`,
  video: 'video',
  // YouTube Music's own guide: the hamburger button collapses it to the
  // mini guide and remembers the choice, so the left toggle drives that.
  guideDrawer: 'tp-yt-app-drawer#guide',
  guideButton: 'ytmusic-nav-bar #guide-button',
} as const;

const SVG_NS = 'http://www.w3.org/2000/svg';
const STORAGE_KEY = 'library-layout:right-column';

type Side = 'left' | 'right';

const loadRight = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
};

const saveRight = (visible: boolean) => {
  try {
    localStorage.setItem(STORAGE_KEY, visible ? 'on' : 'off');
  } catch {
    // Storage can be unavailable; the toggle still works for this session.
  }
};

/** A window outline with one side panel filled in. */
const panelIcon = (side: Side) => {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('aria-hidden', 'true');

  const frame = document.createElementNS(SVG_NS, 'rect');
  frame.setAttribute('x', '3');
  frame.setAttribute('y', '5');
  frame.setAttribute('width', '18');
  frame.setAttribute('height', '14');
  frame.setAttribute('rx', '2');
  frame.setAttribute('fill', 'none');
  frame.setAttribute('stroke', 'currentColor');
  frame.setAttribute('stroke-width', '1.8');

  const panel = document.createElementNS(SVG_NS, 'rect');
  panel.setAttribute('x', side === 'left' ? '5' : '14');
  panel.setAttribute('y', '7');
  panel.setAttribute('width', '5');
  panel.setAttribute('height', '10');
  panel.setAttribute('rx', '1');
  panel.setAttribute('fill', 'currentColor');

  svg.append(frame, panel);
  return svg;
};

/** Seconds as m:ss or h:mm:ss, like the player shows them. */
export const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};

export const createPlayerBar = () => {
  let rightVisible = loadRight();
  const buttons: Partial<Record<Side, HTMLButtonElement>> = {};
  let observer: MutationObserver | null = null;
  // Created on first use: this module is also loaded in the main process,
  // where there is no document.
  let times: { elapsed: HTMLSpanElement; total: HTMLSpanElement } | null = null;
  const timeLabels = () => {
    if (!times) {
      const label = (side: string) => {
        const span = document.createElement('span');
        span.className = 'library-layout-time';
        span.dataset.side = side;
        return span;
      };
      times = { elapsed: label('elapsed'), total: label('total') };
    }
    return times;
  };
  let video: HTMLVideoElement | null = null;

  const updateTimes = () => {
    const labels = timeLabels();
    labels.elapsed.textContent = formatTime(video?.currentTime ?? 0);
    labels.total.textContent = formatTime(video?.duration ?? 0);
  };

  const attachTimes = () => {
    const bar = document.querySelector(SELECTORS.bar);
    const labels = timeLabels();
    if (bar && !labels.elapsed.isConnected) {
      bar.append(labels.elapsed, labels.total);
    }
    const current = document.querySelector<HTMLVideoElement>(SELECTORS.video);
    if (current && current !== video) {
      for (const type of ['timeupdate', 'durationchange', 'loadedmetadata'])
        video?.removeEventListener(type, updateTimes);
      video = current;
      for (const type of ['timeupdate', 'durationchange', 'loadedmetadata'])
        video.addEventListener(type, updateTimes);
      updateTimes();
    }
  };

  const leftVisible = () =>
    document.querySelector(SELECTORS.guideDrawer)?.hasAttribute('opened') ??
    true;

  /** Lets YouTube Music re-measure carousels and grids for the new width. */
  const relayout = () => {
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  };

  const applyState = () => {
    const root = document.documentElement;
    const next = rightVisible ? 'on' : 'off';
    if (root.dataset.libraryLayoutRight !== next) {
      root.dataset.libraryLayoutRight = next;
      relayout();
    }
    buttons.left?.setAttribute('aria-pressed', String(leftVisible()));
    buttons.right?.setAttribute('aria-pressed', String(rightVisible));
  };

  const makeToggle = (side: Side, label: string, onToggle: () => void) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'library-layout-toggle';
    button.dataset.side = side;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.append(panelIcon(side));
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      onToggle();
    });
    return button;
  };

  const toggleLeft = () => {
    document.querySelector<HTMLElement>(SELECTORS.guideButton)?.click();
    // The drawer's `opened` attribute changes after the click; the observer
    // picks it up and refreshes the pressed state.
  };

  const toggleRight = () => {
    rightVisible = !rightVisible;
    saveRight(rightVisible);
    applyState();
  };

  const moveShuffleAndRepeat = () => {
    const transport = document.querySelector(SELECTORS.transport);
    const previous = document.querySelector(SELECTORS.previous);
    const next = document.querySelector(SELECTORS.next);
    const shuffle = document.querySelector(SELECTORS.shuffle);
    const repeat = document.querySelector(SELECTORS.repeat);
    if (!transport || !previous || !next) return;

    if (shuffle && shuffle.parentElement !== transport) {
      transport.insertBefore(shuffle, previous);
    }
    if (repeat && repeat.parentElement !== transport) {
      next.after(repeat);
    }
  };

  const addToggles = () => {
    const tools = document.querySelector(SELECTORS.tools);
    if (!tools) return;
    buttons.left ??= makeToggle('left', 'Biblioteca', toggleLeft);
    buttons.right ??= makeToggle('right', 'Fila', toggleRight);
    if (!buttons.left.isConnected) tools.append(buttons.left);
    if (!buttons.right.isConnected) tools.append(buttons.right);
  };

  const sync = () => {
    attachTimes();
    moveShuffleAndRepeat();
    addToggles();
    applyState();
  };

  return {
    start() {
      document.documentElement.dataset.libraryLayoutBar = 'on';
      observer = new MutationObserver((records) => {
        // Guide opened/closed: only the pressed state needs refreshing.
        if (records.every((record) => record.type === 'attributes')) {
          applyState();
          relayout();
          return;
        }
        // Otherwise only act while something is still missing, so our own
        // DOM moves do not retrigger this forever.
        const transport = document.querySelector(SELECTORS.transport);
        const shuffle = document.querySelector(SELECTORS.shuffle);
        const settled =
          times?.elapsed.isConnected &&
          document.querySelector(SELECTORS.video) === video &&
          buttons.left?.isConnected &&
          buttons.right?.isConnected &&
          (!shuffle || shuffle.parentElement === transport);
        if (!settled) sync();
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['opened'],
      });
      sync();
    },
    stop() {
      observer?.disconnect();
      observer = null;
      buttons.left?.remove();
      buttons.right?.remove();
      times?.elapsed.remove();
      times?.total.remove();
      for (const type of ['timeupdate', 'durationchange', 'loadedmetadata'])
        video?.removeEventListener(type, updateTimes);
      video = null;
      const root = document.documentElement;
      delete root.dataset.libraryLayoutBar;
      delete root.dataset.libraryLayoutRight;
    },
  };
};
