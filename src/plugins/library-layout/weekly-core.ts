/** Pure helpers for the weekly playlist and the genre mixes (no DOM). */
export const PLAYLIST_TITLE = 'Descobertas da semana';
export const SIZE = 30;
export const PER_ARTIST = 2;
export const SEEDS = 8;
export const START_DELAY_MS = 20_000;

/** `altIds`: other versions of the same song (music vs. video upload). */
export type Track = { videoId: string; artists: string[]; altIds?: string[] };

export type WeeklyState = { playlistId?: string; lastWeek?: string };

export type WeeklyContext = {
  getConfig: () => Promise<{ weekly?: WeeklyState }> | { weekly?: WeeklyState };
  setConfig: (config: { weekly: WeeklyState }) => Promise<void> | void;
};

// ---- pure helpers (unit-testable) ---------------------------------------

type Run = {
  text?: string;
  navigationEndpoint?: {
    browseEndpoint?: {
      browseId?: string;
      browseEndpointContextSupportedConfigs?: {
        browseEndpointContextMusicConfig?: { pageType?: string };
      };
    };
  };
};

/**
 * Artist names in a byline, by their link to an artist page. Video uploads
 * often have no link ("Artist • 40 mi de visualizações"); then the text
 * before the first " • " is used, so the per-artist limit still applies.
 */
export const artistsOf = (runs: Run[] = []) => {
  const linked = runs
    .filter(
      (run) =>
        run.navigationEndpoint?.browseEndpoint
          ?.browseEndpointContextSupportedConfigs
          ?.browseEndpointContextMusicConfig?.pageType ===
        'MUSIC_PAGE_TYPE_ARTIST',
    )
    .map((run) => (run.text ?? '').trim())
    .filter(Boolean);
  if (linked.length) return linked;
  const first = runs
    .map((run) => run.text ?? '')
    .join('')
    .split(' • ')[0]
    .trim();
  return first ? [first] : [];
};

export const walk = (
  node: unknown,
  visit: (record: Record<string, unknown>) => void,
  depth = 0,
) => {
  if (!node || typeof node !== 'object' || depth > 24) return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit, depth + 1);
    return;
  }
  const record = node as Record<string, unknown>;
  visit(record);
  for (const value of Object.values(record)) walk(value, visit, depth + 1);
};

type HistoryRow = {
  playlistItemData?: { videoId?: string };
  flexColumns?: {
    musicResponsiveListItemFlexColumnRenderer?: { text?: { runs?: Run[] } };
  }[];
};

/** History rows, most recent first. */
export const parseHistory = (response: unknown): Track[] => {
  const tracks: Track[] = [];
  walk(response, (record) => {
    const row = record.musicResponsiveListItemRenderer as
      | HistoryRow
      | undefined;
    const videoId = row?.playlistItemData?.videoId;
    if (!row || !videoId) return;
    tracks.push({
      videoId,
      artists: artistsOf(
        row.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text
          ?.runs,
      ),
    });
  });
  return tracks;
};

type RadioItem = { videoId?: string; longBylineText?: { runs?: Run[] } };
type RadioWrapper = {
  primaryRenderer?: { playlistPanelVideoRenderer?: RadioItem };
  counterpart?: {
    counterpartRenderer?: { playlistPanelVideoRenderer?: RadioItem };
  }[];
};

/**
 * Tracks of a radio (`/next`) response, in order. A song that exists as both
 * a music track and a video counts once, with the other id in `altIds`.
 */
export const parseRadio = (response: unknown): Track[] => {
  const tracks: Track[] = [];
  const visit = (node: unknown, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 24) return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, depth + 1);
      return;
    }
    const record = node as Record<string, unknown>;
    const wrapper = record.playlistPanelVideoWrapperRenderer as
      | RadioWrapper
      | undefined;
    const plain = record.playlistPanelVideoRenderer as RadioItem | undefined;
    const item = wrapper?.primaryRenderer?.playlistPanelVideoRenderer ?? plain;
    if (item?.videoId) {
      const altIds = (wrapper?.counterpart ?? [])
        .map((c) => c.counterpartRenderer?.playlistPanelVideoRenderer?.videoId)
        .filter((id): id is string => Boolean(id));
      tracks.push({
        videoId: item.videoId,
        artists: artistsOf(item.longBylineText?.runs),
        ...(altIds.length ? { altIds } : {}),
      });
      return; // do not descend into the counterpart copies
    }
    for (const value of Object.values(record)) visit(value, depth + 1);
  };
  visit(response, 0);
  return tracks;
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

export const mainArtist = (track: Track) =>
  (track.artists[0] ?? '').toLowerCase() || `?${track.videoId}`;

/** Most recent track of each of the most played artists. */
export const pickSeeds = (history: readonly Track[], count = SEEDS) => {
  const plays = new Map<string, number>();
  const latest = new Map<string, Track>();
  for (const track of history) {
    if (!track.artists.length) continue;
    const artist = mainArtist(track);
    plays.set(artist, (plays.get(artist) ?? 0) + 1);
    if (!latest.has(artist)) latest.set(artist, track);
  }
  return [...plays.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([artist]) => latest.get(artist))
    .filter((track): track is Track => Boolean(track));
};

/**
 * Takes one candidate from each seed's list in turn, skipping what was heard
 * already, duplicates and artists that already have `perArtist` tracks.
 */
export const buildWeekly = (
  candidateLists: readonly (readonly Track[])[],
  heard: ReadonlySet<string>,
  size = SIZE,
  perArtist = PER_ARTIST,
): string[] => {
  const chosen: string[] = [];
  const used = new Set<string>();
  const perArtistCount = new Map<string, number>();
  const cursors = candidateLists.map(() => 0);
  let progressed = true;
  while (chosen.length < size && progressed) {
    progressed = false;
    candidateLists.forEach((list, index) => {
      while (cursors[index] < list.length && chosen.length < size) {
        const track = list[cursors[index]++];
        const artist = mainArtist(track);
        const ids = [track.videoId, ...(track.altIds ?? [])];
        if (ids.some((id) => heard.has(id) || used.has(id))) continue;
        if ((perArtistCount.get(artist) ?? 0) >= perArtist) continue;
        for (const id of ids) used.add(id);
        perArtistCount.set(artist, (perArtistCount.get(artist) ?? 0) + 1);
        chosen.push(track.videoId);
        progressed = true;
        return;
      }
    });
  }
  return chosen;
};

/** Monday of the date's week, local time, as YYYY-MM-DD. */
export const weekKey = (date: Date) => {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
};
