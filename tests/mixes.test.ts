import { test, expect } from '@playwright/test';

import {
  buildMix,
  dayKey,
  interleave,
  pickKnown,
  songsBy,
} from '../src/plugins/library-layout/mixes-core';
import type { Track } from '../src/plugins/library-layout/weekly-core';

// Pure logic only: these tests never launch the app or touch the account.

const t = (videoId: string, artist: string): Track => ({
  videoId,
  artists: [artist],
});
const fixed = () => 0.3;

test('songsBy keeps only songs by that artist (search also returns covers)', () => {
  const results = [
    t('a', 'Metallica'),
    t('b', 'Apocalyptica'),
    t('c', 'metallica'),
    t('d', 'Metallica'),
    t('e', 'Metallica'),
  ];
  expect(songsBy(results, 'Metallica').map((x) => x.videoId)).toEqual([
    'a',
    'c',
    'd',
  ]);
});

test('pickKnown removes duplicates and caps tracks per artist', () => {
  const known = [
    t('a1', 'A'),
    t('a2', 'A'),
    t('a3', 'A'),
    t('a4', 'A'),
    t('b1', 'B'),
    t('a1', 'A'),
  ];
  const picked = pickKnown(known, 10, 3, fixed);
  expect(picked.filter((x) => x.artists[0] === 'A')).toHaveLength(3);
  expect(new Set(picked.map((x) => x.videoId)).size).toBe(picked.length);
});

test('interleave alternates and keeps the leftovers', () => {
  expect(interleave(['k1', 'k2', 'k3'], ['n1'])).toEqual([
    'k1',
    'n1',
    'k2',
    'k3',
  ]);
});

test('buildMix is half known, half new, alternating, with no known track as "new"', () => {
  const known = Array.from({ length: 30 }, (_, i) => t(`k${i}`, `KA${i}`));
  const radio = [
    [
      t('k0', 'KA0'),
      ...Array.from({ length: 30 }, (_, i) => t(`n${i}`, `NA${i}`)),
    ],
  ];
  const mix = buildMix(known, radio, new Set(['n0']), 20, fixed);
  expect(mix).toHaveLength(20);
  const knownIds = new Set(known.map((x) => x.videoId));
  expect(mix.filter((id) => knownIds.has(id))).toHaveLength(10);
  expect(mix).not.toContain('n0'); // heard
  // alternating: even positions known, odd positions new
  expect(mix.every((id, i) => knownIds.has(id) === (i % 2 === 0))).toBe(true);
});

test('buildMix still works with an empty base playlist', () => {
  const mix = buildMix(
    [],
    [[t('n1', 'X'), t('n2', 'Y')]],
    new Set(),
    20,
    fixed,
  );
  expect(mix).toEqual(['n1', 'n2']);
});

test('dayKey is the local date', () => {
  expect(dayKey(new Date(2026, 10, 12, 23, 59))).toBe('2026-11-12');
});
