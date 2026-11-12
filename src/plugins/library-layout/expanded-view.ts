/**
 * The right column can grow over the centre column ("expanded") so the
 * video, lyrics, comments and related tracks get room:
 *
 *   • picking Letra, Comentários or Relacionados, or switching to Vídeo,
 *     expands it
 *   • the ⤢ / ⤡ button at the top of the column toggles it by hand
 *   • Esc, or picking "A seguir", docks it back
 *
 * Only a data attribute on <html> changes; the layout lives in style.css.
 */

const PAGE = 'ytmusic-app-layout > ytmusic-player-page';
const EXPAND_TABS = new Set(['Letra', 'Comentários', 'Relacionados']);
const DOCK_TABS = new Set(['A seguir']);
const SVG_NS = 'http://www.w3.org/2000/svg';

const icon = (expanded: boolean) => {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  // outward arrows to expand, inward arrows to dock
  path.setAttribute(
    'd',
    expanded
      ? 'M10 4v6H4M14 20v-6h6M10 10L4 4M14 14l6 6'
      : 'M4 10V4h6M20 14v6h-6M4 4l6 6M20 20l-6-6',
  );
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.8');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
};

export const createExpandedView = () => {
  let button: HTMLButtonElement | null = null;
  let observer: MutationObserver | null = null;
  let page: HTMLElement | null = null;

  const isExpanded = () =>
    document.documentElement.dataset.libraryLayoutExpanded === 'on';

  /** YouTube Music re-measures carousels, video and lyrics on resize. */
  const relayout = () =>
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));

  const render = () => {
    if (!button) return;
    const expanded = isExpanded();
    const label = expanded ? 'Recolher (Esc)' : 'Expandir';
    button.replaceChildren(icon(expanded));
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(expanded));
  };

  const setExpanded = (expanded: boolean) => {
    if (expanded === isExpanded()) return;
    if (expanded) document.documentElement.dataset.libraryLayoutExpanded = 'on';
    else delete document.documentElement.dataset.libraryLayoutExpanded;
    render();
    relayout();
  };

  /** Tab and Música/Vídeo clicks decide the size. */
  const onPageClick = (event: Event) => {
    const target = event.target as Element | null;
    const tab = target?.closest('tp-yt-paper-tab');
    if (tab) {
      const name = tab.textContent?.trim() ?? '';
      if (EXPAND_TABS.has(name)) setExpanded(true);
      if (DOCK_TABS.has(name)) setExpanded(false);
      return;
    }
    const avButton = target?.closest('ytmusic-av-toggle button');
    if (avButton?.textContent?.trim() === 'Vídeo') setExpanded(true);
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !isExpanded()) return;
    const active = document.activeElement;
    if (
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement
    )
      return;
    if ((active as HTMLElement | null)?.isContentEditable) return;
    setExpanded(false);
  };

  const attach = () => {
    const current = document.querySelector<HTMLElement>(PAGE);
    if (!current) return;
    if (current !== page) {
      page?.removeEventListener('click', onPageClick, true);
      page = current;
      page.addEventListener('click', onPageClick, true);
    }
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'library-layout-expand';
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        setExpanded(!isExpanded());
      });
      render();
    }
    if (button.parentElement !== page) page.append(button);
  };

  return {
    start() {
      observer = new MutationObserver(() => {
        if (!button?.isConnected || document.querySelector(PAGE) !== page)
          attach();
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
      document.addEventListener('keydown', onKey);
      attach();
    },
    stop() {
      observer?.disconnect();
      observer = null;
      document.removeEventListener('keydown', onKey);
      page?.removeEventListener('click', onPageClick, true);
      page = null;
      button?.remove();
      button = null;
      delete document.documentElement.dataset.libraryLayoutExpanded;
    },
  };
};
