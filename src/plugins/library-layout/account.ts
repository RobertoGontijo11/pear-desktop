import { parseRadio, walk, artistsOf, type Track } from './weekly-core';

/**
 * Small helpers around YouTube Music's own requests (the same ones the page
 * makes), shared by the weekly playlist and the genre mixes. Everything here
 * acts on the signed-in account.
 */
import type { MusicPlayerAppElement } from '@/types/music-player-app-element';

const app = () => document.querySelector<MusicPlayerAppElement>('ytmusic-app');

export const fetchJson = <T>(path: string, body: unknown) => {
  const element = app();
  if (!element) return Promise.reject(new Error('no app'));
  return element.networkManager.fetch<T, unknown>(path, body);
};

export const toast = (message: string) => {
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

type Run = Parameters<typeof artistsOf>[0];
type ListRow = {
  playlistItemData?: { videoId?: string; playlistSetVideoId?: string };
  flexColumns?: {
    musicResponsiveListItemFlexColumnRenderer?: { text?: { runs?: Run } };
  }[];
};

/** Tracks (with their playlist row ids) of a playlist, or null if it is gone. */
export const playlistRows = async (playlistId: string, title?: string) => {
  try {
    const response = await fetchJson<unknown>('/browse', {
      browseId: `VL${playlistId}`,
    });
    const rows: (Track & { setVideoId?: string })[] = [];
    walk(response, (record) => {
      const row = record.musicResponsiveListItemRenderer as ListRow | undefined;
      const data = row?.playlistItemData;
      if (!data?.videoId) return;
      rows.push({
        videoId: data.videoId,
        setVideoId: data.playlistSetVideoId,
        artists: artistsOf(
          row?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text
            ?.runs,
        ),
      });
    });
    if (title && !JSON.stringify(response).includes(title)) return null;
    return rows;
  } catch {
    return null;
  }
};

/** Id of a playlist in the user's library with exactly this title. */
export const findLibraryPlaylist = async (title: string) => {
  const response = await fetchJson<unknown>('/browse', {
    browseId: 'FEmusic_liked_playlists',
  });
  let id: string | undefined;
  walk(response, (record) => {
    const card = record.musicTwoRowItemRenderer as
      | {
          title?: { runs?: { text?: string }[] };
          navigationEndpoint?: { browseEndpoint?: { browseId?: string } };
        }
      | undefined;
    const name = card?.title?.runs?.map((run) => run.text ?? '').join('');
    const browseId = card?.navigationEndpoint?.browseEndpoint?.browseId;
    if (!id && name === title && browseId) id = browseId.replace(/^VL/, '');
  });
  return id;
};

/** YouTube Music's radio for one track. */
export const radioFor = async (videoId: string) => {
  try {
    return parseRadio(
      await fetchJson<unknown>('/next', {
        videoId,
        playlistId: `RDAMVM${videoId}`,
        isAudioOnly: true,
      }),
    );
  } catch {
    return [];
  }
};

/** Song results for a search (first page). */
export const searchSongs = async (query: string): Promise<Track[]> => {
  try {
    const response = await fetchJson<unknown>('/search', { query });
    const tracks: Track[] = [];
    walk(response, (record) => {
      const row = record.musicResponsiveListItemRenderer as ListRow | undefined;
      const videoId = row?.playlistItemData?.videoId;
      if (!videoId) return;
      tracks.push({
        videoId,
        artists: artistsOf(
          row?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text
            ?.runs,
        ),
      });
    });
    return tracks;
  } catch {
    return [];
  }
};

/**
 * Creates the private playlist, or replaces the contents of the existing one
 * (`playlistId`, if it still exists with that title). Returns its id.
 */
export const savePlaylist = async (options: {
  playlistId?: string;
  title: string;
  description: string;
  videoIds: string[];
}) => {
  const { playlistId, title, description, videoIds } = options;
  const rows = playlistId ? await playlistRows(playlistId, title) : null;
  if (playlistId && rows) {
    await fetchJson('/browse/edit_playlist', {
      playlistId,
      actions: [
        ...rows
          .filter((row) => row.setVideoId)
          .map((row) => ({
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
          playlistDescription: description,
        },
      ],
    });
    return playlistId;
  }
  const created = await fetchJson<{ playlistId?: string }>('/playlist/create', {
    title,
    description,
    privacyStatus: 'PRIVATE',
    videoIds,
  });
  if (!created?.playlistId) throw new Error('playlist not created');
  return created.playlistId;
};
