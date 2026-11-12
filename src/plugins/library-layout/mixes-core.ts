/** Pure helpers for the daily genre mixes (no DOM, unit-tested). */
import { buildWeekly, mainArtist, shuffled, type Track } from './weekly-core';

export type MixDefinition = {
  key: string;
  title: string;
  /** Title of one of the user's playlists whose tracks are the base. */
  basePlaylist?: string;
  /** Artists whose songs are also base tracks and radio seeds. */
  artists: string[];
};

export type MixState = { playlistId?: string; lastDay?: string };

export type MixesConfig = {
  definitions: MixDefinition[];
  state: Record<string, MixState>;
};

/** Approved by Roberto on 2026-11-12; editable in the app's config file. */
export const DEFAULT_MIXES: MixDefinition[] = [
  {
    key: 'psytrance',
    title: 'Mix Psytrance',
    basePlaylist: 'Underground Psychedelics',
    artists: [
      'Phaxe',
      'Neelix',
      'Ghost Rider',
      'Vegas (Brazil)',
      'Astrix',
      'Sesto Sento',
      'Infected Mushroom',
      'Freedom Fighters',
      'Captain Hook',
      'Special M',
    ],
  },
  {
    key: 'rock',
    title: 'Mix Rock/metal',
    basePlaylist: 'Roquezim',
    artists: [
      'Dream Theater',
      'Metallica',
      'Avenged Sevenfold',
      'Slipknot',
      'Iron Maiden',
      'System Of A Down',
      'Pantera',
      'Dio',
    ],
  },
];

export const MIX_SIZE = 40;

/** Local date as YYYY-MM-DD. */
export const dayKey = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const sameArtist = (track: Track, name: string) =>
  track.artists.some((artist) => artist.toLowerCase() === name.toLowerCase());

/** Search results that really are by `name` (search also returns covers). */
export const songsBy = (results: readonly Track[], name: string, count = 3) =>
  results.filter((track) => sameArtist(track, name)).slice(0, count);

/**
 * Known tracks: shuffled, no duplicates, at most `perArtist` per artist.
 */
export const pickKnown = (
  known: readonly Track[],
  count: number,
  perArtist = 3,
  random = Math.random,
) => {
  const picked: Track[] = [];
  const used = new Set<string>();
  const perArtistCount = new Map<string, number>();
  for (const track of shuffled(known, random)) {
    if (picked.length >= count) break;
    if (used.has(track.videoId)) continue;
    const artist = mainArtist(track);
    if ((perArtistCount.get(artist) ?? 0) >= perArtist) continue;
    used.add(track.videoId);
    perArtistCount.set(artist, (perArtistCount.get(artist) ?? 0) + 1);
    picked.push(track);
  }
  return picked;
};

/** a1 b1 a2 b2 …, then whatever is left of the longer list. */
export const interleave = <T>(a: readonly T[], b: readonly T[]) => {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
};

/**
 * Half known tracks (base playlist + base artists), half new ones from the
 * seeds' radios, alternating. New tracks skip anything known or heard.
 */
export const buildMix = (
  known: readonly Track[],
  radios: readonly (readonly Track[])[],
  heard: ReadonlySet<string>,
  size = MIX_SIZE,
  random = Math.random,
) => {
  const knownPicked = pickKnown(known, Math.floor(size / 2), 3, random);
  const exclude = new Set([...heard, ...known.map((track) => track.videoId)]);
  const fresh = buildWeekly(
    shuffled(radios, random),
    exclude,
    size - knownPicked.length,
    2,
  );
  return interleave(
    knownPicked.map((track) => track.videoId),
    fresh,
  );
};
