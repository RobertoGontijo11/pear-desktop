/**
 * "Descobertas da semana": one private playlist in the user's YouTube Music
 * account, refilled every week (Monday) with ~30 tracks they have not heard.
 *
 *   1. Read the account history (includes listening on TV and phone).
 *   2. Seeds: the most recent track of each of the most played artists.
 *   3. Candidates: YouTube Music's radio for each seed.
 *   4. Drop anything already in the history, mix the seeds' lists in turns
 *      and allow at most two tracks per artist.
 *   5. Create the playlist the first time; afterwards replace its contents.
 *
 * Runs once per week when the app is open; the week is recorded only after
 * the playlist was saved, so a failed run is retried next time.
 */
import type { MusicPlayerAppElement } from '@/types/music-player-app-element';

export const PLAYLIST_TITLE = 'Descobertas da semana';
const SIZE = 30;
const PER_ARTIST = 2;
const SEEDS = 8;
const START_DELAY_MS = 20_000;

/** `altIds`: other versions of the same song (music vs. video upload). */
export type Track = { videoId: string; artists: string[]; altIds?: string[] };

export type WeeklyState = { playlistId?: string; lastWeek?: string };

type WeeklyContext = {
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

const walk = (
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

const mainArtist = (track: Track) =>
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

// ---- account integration --------------------------------------------------

type PlaylistRow = {
  playlistItemData?: { videoId?: string; playlistSetVideoId?: string };
};

export const createWeeklyPlaylist = (context: WeeklyContext) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  const app = () =>
    document.querySelector<MusicPlayerAppElement>('ytmusic-app');

  const fetchJson = <T>(path: string, body: unknown) => {
    const element = app();
    if (!element) return Promise.reject(new Error('no app'));
    return element.networkManager.fetch<T, unknown>(path, body);
  };

  const toast = (message: string) => {
    const element = app() as
      | (MusicPlayerAppElement & {
          toastService?: { show?: (text: string) => void };
        })
      | null;
    try {
      element?.toastService?.show?.(message);
    } catch {
      // Toasts are a nicety only.
    }
  };

  /** Rows (videoId + setVideoId) of an existing playlist, or null if gone. */
  const playlistRows = async (playlistId: string) => {
    try {
      const response = await fetchJson<unknown>('/browse', {
        browseId: `VL${playlistId}`,
      });
      const rows: { videoId: string; setVideoId: string }[] = [];
      walk(response, (record) => {
        const row = record.musicResponsiveListItemRenderer as
          | PlaylistRow
          | undefined;
        const data = row?.playlistItemData;
        if (data?.videoId && data.playlistSetVideoId) {
          rows.push({
            videoId: data.videoId,
            setVideoId: data.playlistSetVideoId,
          });
        }
      });
      const exists = JSON.stringify(response).includes(PLAYLIST_TITLE);
      return exists ? rows : null;
    } catch {
      return null;
    }
  };

  const description = (week: string) =>
    `Gerada em ${week} a partir do seu histórico do YouTube Music. Renovada toda segunda-feira.`;

  const save = async (videoIds: string[], state: WeeklyState, week: string) => {
    const rows = state.playlistId ? await playlistRows(state.playlistId) : null;
    if (state.playlistId && rows) {
      await fetchJson('/browse/edit_playlist', {
        playlistId: state.playlistId,
        actions: [
          ...rows.map((row) => ({
            action: 'ACTION_REMOVE_VIDEO',
            removedVideoId: row.videoId,
            setVideoId: row.setVideoId,
          })),
          ...videoIds.map((videoId) => ({
            action: 'ACTION_ADD_VIDEO',
            addedVideoId: videoId,
            dedupeOption: 'DEDUPE_OPTION_SKIP',
          })),
          {
            action: 'ACTION_SET_PLAYLIST_DESCRIPTION',
            playlistDescription: description(week),
          },
        ],
      });
      return state.playlistId;
    }
    const created = await fetchJson<{ playlistId?: string }>(
      '/playlist/create',
      {
        title: PLAYLIST_TITLE,
        description: description(week),
        privacyStatus: 'PRIVATE',
        videoIds,
      },
    );
    if (!created?.playlistId) throw new Error('playlist not created');
    return created.playlistId;
  };

  /** Builds and saves this week's playlist. `force` ignores the week check. */
  const generate = async (force = false) => {
    if (running) return 'busy';
    const config = await context.getConfig();
    const state = config.weekly ?? {};
    const week = weekKey(new Date());
    if (!force && state.lastWeek === week) return 'up-to-date';
    running = true;
    try {
      const history = parseHistory(
        await fetchJson<unknown>('/browse', { browseId: 'FEmusic_history' }),
      );
      const seeds = pickSeeds(history);
      if (seeds.length === 0) return 'no-history';

      const lists: Track[][] = [];
      for (const seed of seeds) {
        try {
          lists.push(
            parseRadio(
              await fetchJson<unknown>('/next', {
                videoId: seed.videoId,
                playlistId: `RDAMVM${seed.videoId}`,
                isAudioOnly: true,
              }),
            ),
          );
        } catch {
          lists.push([]);
        }
      }
      const heard = new Set(history.map((track) => track.videoId));
      const videoIds = buildWeekly(lists, heard);
      if (videoIds.length < 10) return 'too-few';

      const playlistId = await save(videoIds, state, week);
      await context.setConfig({ weekly: { playlistId, lastWeek: week } });
      toast(
        `${PLAYLIST_TITLE}: ${videoIds.length} faixas novas na sua biblioteca`,
      );
      return `saved ${videoIds.length}`;
    } catch (error) {
      toast(
        'Não consegui gerar as Descobertas da semana; tento de novo depois',
      );
      return `error ${String(error)}`;
    } finally {
      running = false;
    }
  };

  return {
    generate,
    start() {
      // Wait for the page and player to settle before touching the account.
      timer = setTimeout(() => {
        timer = null;
        generate().catch(() => {});
      }, START_DELAY_MS);
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
};
