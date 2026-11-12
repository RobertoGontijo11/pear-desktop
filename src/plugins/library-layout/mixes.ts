/**
 * Daily genre mixes ("Mix Psytrance", "Mix Rock/metal"): one private
 * playlist per mix in the user's YouTube Music account, refilled once a day
 * when the app is open. Each mix is half known tracks (the base playlist and
 * the base artists' songs) and half new tracks from their radios, alternating.
 */
import {
  fetchJson,
  findLibraryPlaylist,
  playlistRows,
  radioFor,
  savePlaylist,
  searchSongs,
  toast,
} from './account';
import {
  buildMix,
  dayKey,
  DEFAULT_MIXES,
  songsBy,
  type MixDefinition,
  type MixesConfig,
} from './mixes-core';
import { parseHistory, shuffled, type Track } from './weekly-core';

const START_DELAY_MS = 45_000;
const BASE_SEEDS = 3;
const ARTIST_SEEDS = 4;

type MixesContext = {
  getConfig: () =>
    | Promise<{ mixes?: Partial<MixesConfig> }>
    | { mixes?: Partial<MixesConfig> };
  setConfig: (config: { mixes: MixesConfig }) => Promise<void> | void;
};

export const createGenreMixes = (context: MixesContext) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  const readConfig = async (): Promise<MixesConfig> => {
    const config = (await context.getConfig()).mixes ?? {};
    return {
      definitions: config.definitions?.length
        ? config.definitions
        : DEFAULT_MIXES,
      state: config.state ?? {},
    };
  };

  const buildOne = async (mix: MixDefinition, heard: ReadonlySet<string>) => {
    // Base playlist tracks (may be empty, e.g. a playlist still being filled).
    const baseId = mix.basePlaylist
      ? await findLibraryPlaylist(mix.basePlaylist)
      : undefined;
    const baseTracks: Track[] = baseId
      ? ((await playlistRows(baseId)) ?? []).map(({ videoId, artists }) => ({
          videoId,
          artists,
        }))
      : [];

    // A few songs by each base artist.
    const artistTracks: Track[][] = [];
    for (const artist of mix.artists) {
      artistTracks.push(songsBy(await searchSongs(artist), artist));
    }

    const seeds = [
      ...shuffled(baseTracks).slice(0, BASE_SEEDS),
      ...shuffled(artistTracks.filter((list) => list.length))
        .slice(0, ARTIST_SEEDS)
        .map((list) => list[0]),
    ];
    const radios: Track[][] = [];
    for (const seed of seeds) radios.push(await radioFor(seed.videoId));

    return buildMix([...baseTracks, ...artistTracks.flat()], radios, heard);
  };

  /** Refills every mix not yet refilled today. `force` refills them all. */
  const generate = async (force = false) => {
    if (running) return 'busy';
    running = true;
    const results: string[] = [];
    try {
      const config = await readConfig();
      const today = dayKey(new Date());
      const due = config.definitions.filter(
        (mix) => force || config.state[mix.key]?.lastDay !== today,
      );
      if (!due.length) return 'up-to-date';

      const history = parseHistory(
        await fetchJson<unknown>('/browse', { browseId: 'FEmusic_history' }),
      );
      const heard = new Set(history.map((track) => track.videoId));

      for (const mix of due) {
        try {
          const videoIds = await buildOne(mix, heard);
          if (videoIds.length < 10) {
            results.push(`${mix.key}: too-few (${videoIds.length})`);
            continue;
          }
          const playlistId = await savePlaylist({
            playlistId: config.state[mix.key]?.playlistId,
            title: mix.title,
            description: `Mix diário gerado em ${today}: metade faixas que você já curte${
              mix.basePlaylist ? ` (${mix.basePlaylist} e artistas-base)` : ''
            }, metade novas. Renovado todo dia.`,
            videoIds,
          });
          config.state[mix.key] = { playlistId, lastDay: today };
          await context.setConfig({ mixes: config });
          results.push(`${mix.key}: saved ${videoIds.length}`);
        } catch (error) {
          results.push(`${mix.key}: error ${String(error)}`);
        }
      }
      const saved = results.filter((line) => line.includes('saved')).length;
      if (saved) toast(`Mixes do dia atualizados (${saved})`);
      return results.join('; ');
    } finally {
      running = false;
    }
  };

  return {
    generate,
    start() {
      // After the weekly playlist (20s), so both never run at once.
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
