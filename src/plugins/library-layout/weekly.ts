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
import { fetchJson, radioFor, savePlaylist, toast } from './account';
import {
  buildWeekly,
  parseHistory,
  pickSeeds,
  PLAYLIST_TITLE,
  START_DELAY_MS,
  weekKey,
  type Track,
  type WeeklyContext,
} from './weekly-core';

export type { WeeklyState } from './weekly-core';

export const createWeeklyPlaylist = (context: WeeklyContext) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  const description = (week: string) =>
    `Gerada em ${week} a partir do seu histórico do YouTube Music. Renovada toda segunda-feira.`;

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
      for (const seed of seeds) lists.push(await radioFor(seed.videoId));
      const heard = new Set(history.map((track) => track.videoId));
      const videoIds = buildWeekly(lists, heard);
      if (videoIds.length < 10) return 'too-few';

      const playlistId = await savePlaylist({
        playlistId: state.playlistId,
        title: PLAYLIST_TITLE,
        description: description(week),
        videoIds,
      });
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
