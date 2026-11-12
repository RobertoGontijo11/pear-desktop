/**
 * Quick search box above the playlist list in the left column. Typing hides
 * the playlists whose title does not match.
 *
 * Built with createElement only: YouTube Music enforces Trusted Types, so
 * innerHTML is not available to plugins.
 */

const SELECTORS = {
  // The visible guide; a second, collapsed copy lives in #mini-guide.
  guide: '#guide-content ytmusic-guide-renderer',
  section: 'ytmusic-guide-section-renderer',
  entry: 'ytmusic-guide-entry-renderer',
  entryTitle: '.title',
} as const;

const INPUT_ID = 'library-layout-search';
const HIDDEN_ATTR = 'data-library-layout-hidden';

/** Case- and accent-insensitive form, so "psicodelico" finds "Psicodélico". */
export const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

export const matches = (title: string, query: string) =>
  normalize(title).includes(normalize(query));

export const createSidebarSearch = () => {
  let query = '';
  let observer: MutationObserver | null = null;
  let input: HTMLInputElement | null = null;

  /** The playlist section is the one with the most entries (nav has 3). */
  const playlistSection = () => {
    const sections = [
      ...document.querySelectorAll<HTMLElement>(
        `${SELECTORS.guide} ${SELECTORS.section}`,
      ),
    ];
    return sections.length > 1 ? sections[sections.length - 1] : null;
  };

  const applyFilter = () => {
    const section = playlistSection();
    if (!section) return;
    for (const entry of section.querySelectorAll<HTMLElement>(
      SELECTORS.entry,
    )) {
      const title =
        entry.querySelector(SELECTORS.entryTitle)?.textContent ?? '';
      entry.toggleAttribute(
        HIDDEN_ATTR,
        query !== '' && !matches(title, query),
      );
    }
  };

  const ensureInput = () => {
    const section = playlistSection();
    if (!section) return;
    const firstEntry = section.querySelector(SELECTORS.entry);
    const list = firstEntry?.parentElement;
    if (!list) return;
    if (input?.isConnected) return;

    input = document.createElement('input');
    input.id = INPUT_ID;
    input.type = 'search';
    input.placeholder = 'Buscar na biblioteca';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = query;
    input.addEventListener('input', () => {
      query = input?.value ?? '';
      applyFilter();
    });
    // Keep YouTube Music's global shortcuts (space = play/pause, etc.) from
    // firing while typing here.
    for (const type of ['keydown', 'keyup', 'keypress'] as const) {
      input.addEventListener(type, (event) => event.stopPropagation());
    }
    list.parentElement?.insertBefore(input, list);
  };

  const sync = () => {
    ensureInput();
    applyFilter();
  };

  return {
    start() {
      observer = new MutationObserver(sync);
      // The guide is rendered late and re-rendered when playlists change.
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
      sync();
    },
    stop() {
      observer?.disconnect();
      observer = null;
      input?.remove();
      input = null;
      query = '';
      for (const entry of document.querySelectorAll(`[${HIDDEN_ATTR}]`)) {
        entry.removeAttribute(HIDDEN_ATTR);
      }
    },
  };
};
