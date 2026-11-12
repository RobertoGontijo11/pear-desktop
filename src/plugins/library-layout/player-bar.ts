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

export const createPlayerBar = () => {
  let rightVisible = loadRight();
  const buttons: Partial<Record<Side, HTMLButtonElement>> = {};
  let observer: MutationObserver | null = null;

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
      const root = document.documentElement;
      delete root.dataset.libraryLayoutBar;
      delete root.dataset.libraryLayoutRight;
    },
  };
};
