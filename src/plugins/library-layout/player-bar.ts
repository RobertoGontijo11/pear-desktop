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
} as const;

const SVG_NS = 'http://www.w3.org/2000/svg';
const STORAGE_KEY = 'library-layout:columns';

type Side = 'left' | 'right';
type ColumnState = Record<Side, boolean>;

const loadState = (): ColumnState => {
  try {
    const saved = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? '{}',
    ) as Partial<ColumnState>;
    return { left: saved.left !== false, right: saved.right !== false };
  } catch {
    return { left: true, right: true };
  }
};

const saveState = (state: ColumnState) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be unavailable; the toggles still work for this session.
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
  const state = loadState();
  const buttons: Partial<Record<Side, HTMLButtonElement>> = {};
  let observer: MutationObserver | null = null;

  const applyState = () => {
    const root = document.documentElement;
    root.dataset.libraryLayoutLeft = state.left ? 'on' : 'off';
    root.dataset.libraryLayoutRight = state.right ? 'on' : 'off';
    for (const side of ['left', 'right'] as const) {
      buttons[side]?.setAttribute('aria-pressed', String(state[side]));
    }
  };

  const makeToggle = (side: Side, label: string) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'library-layout-toggle';
    button.dataset.side = side;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.append(panelIcon(side));
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      state[side] = !state[side];
      saveState(state);
      applyState();
    });
    return button;
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
    if (!buttons.left) buttons.left = makeToggle('left', 'Biblioteca');
    if (!buttons.right) buttons.right = makeToggle('right', 'Fila');
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
      observer = new MutationObserver(() => {
        // Only act while something is still missing; avoids reacting to our
        // own DOM moves forever.
        const transport = document.querySelector(SELECTORS.transport);
        const settled =
          buttons.left?.isConnected &&
          buttons.right?.isConnected &&
          (!document.querySelector(SELECTORS.shuffle) ||
            document.querySelector(SELECTORS.shuffle)?.parentElement ===
              transport);
        if (!settled) sync();
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
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
      delete root.dataset.libraryLayoutLeft;
      delete root.dataset.libraryLayoutRight;
    },
  };
};
