import { test, expect } from '@playwright/test';

import {
  artistsOf,
  buildWeekly,
  parseHistory,
  parseRadio,
  pickSeeds,
  weekKey,
  type Track,
} from '../src/plugins/library-layout/weekly-core';

// Pure logic only: these tests never launch the app or touch the account.

const artistRun = (name: string) => ({
  text: name,
  navigationEndpoint: {
    browseEndpoint: {
      browseId: `UC${name}`,
      browseEndpointContextSupportedConfigs: {
        browseEndpointContextMusicConfig: {
          pageType: 'MUSIC_PAGE_TYPE_ARTIST',
        },
      },
    },
  },
});

const t = (videoId: string, artist: string): Track => ({
  videoId,
  artists: [artist],
});

test('artistsOf keeps only linked artists', () => {
  expect(
    artistsOf([
      artistRun('Astrix'),
      { text: ' e ' },
      artistRun('Ace Ventura'),
      { text: ' • 2008' },
    ]),
  ).toEqual(['Astrix', 'Ace Ventura']);
});

test('parseHistory and parseRadio read video ids and artists', () => {
  const history = {
    shelves: [
      {
        musicResponsiveListItemRenderer: {
          playlistItemData: { videoId: 'h1' },
          flexColumns: [
            {},
            {
              musicResponsiveListItemFlexColumnRenderer: {
                text: { runs: [artistRun('Astrix')] },
              },
            },
          ],
        },
      },
    ],
  };
  expect(parseHistory(history)).toEqual([t('h1', 'Astrix')]);

  const radio = {
    panel: [
      {
        playlistPanelVideoRenderer: {
          videoId: 'r1',
          longBylineText: { runs: [artistRun('Vini Vici')] },
        },
      },
    ],
  };
  expect(parseRadio(radio)).toEqual([t('r1', 'Vini Vici')]);
});

test('artistsOf falls back to the byline text for video uploads', () => {
  expect(
    artistsOf([{ text: 'Grupo Menos É Mais • 40 mi de visualizações' }]),
  ).toEqual(['Grupo Menos É Mais']);
});

test('parseRadio counts a song and its video version once', () => {
  const radio = {
    panel: [
      {
        playlistPanelVideoWrapperRenderer: {
          primaryRenderer: {
            playlistPanelVideoRenderer: {
              videoId: 'song',
              longBylineText: { runs: [artistRun('A')] },
            },
          },
          counterpart: [
            {
              counterpartRenderer: {
                playlistPanelVideoRenderer: {
                  videoId: 'video',
                  longBylineText: { runs: [{ text: 'A • 1 mi' }] },
                },
              },
            },
          ],
        },
      },
    ],
  };
  expect(parseRadio(radio)).toEqual([
    { videoId: 'song', artists: ['A'], altIds: ['video'] },
  ]);
});

test('buildWeekly treats a track as heard when its other version was heard', () => {
  const lists = [
    [{ videoId: 'song', artists: ['A'], altIds: ['video'] }, t('new', 'B')],
  ];
  expect(buildWeekly(lists, new Set(['video']), 10)).toEqual(['new']);
});

test('pickSeeds takes the latest track of the most played artists', () => {
  const history = [
    t('a3', 'A'),
    t('b2', 'B'),
    t('a2', 'A'),
    t('c1', 'C'),
    t('a1', 'A'),
    t('b1', 'B'),
  ];
  expect(pickSeeds(history, 2).map((s) => s.videoId)).toEqual(['a3', 'b2']);
});

test('buildWeekly skips heard tracks and duplicates', () => {
  const lists = [
    [t('x1', 'X'), t('heard', 'Y'), t('x2', 'Z')],
    [t('x1', 'X'), t('y1', 'W')],
  ];
  expect(buildWeekly(lists, new Set(['heard']), 10, 5)).toEqual([
    'x1',
    'y1',
    'x2',
  ]);
});

test('buildWeekly mixes seeds in turns and caps tracks per artist', () => {
  const lists = [
    [t('a1', 'A'), t('a2', 'A'), t('a3', 'A'), t('a4', 'D')],
    [t('b1', 'B'), t('b2', 'B'), t('b3', 'B')],
  ];
  expect(buildWeekly(lists, new Set(), 10, 2)).toEqual([
    'a1',
    'b1',
    'a2',
    'b2',
    'a4',
  ]);
});

test('buildWeekly stops at the requested size', () => {
  const list = Array.from({ length: 50 }, (_, i) => t(`v${i}`, `artist${i}`));
  expect(buildWeekly([list], new Set(), 30)).toHaveLength(30);
});

test('weekKey is the Monday of the week, local time', () => {
  expect(weekKey(new Date(2026, 10, 12))).toBe('2026-11-09'); // Thursday
  expect(weekKey(new Date(2026, 10, 16))).toBe('2026-11-16'); // Monday
  expect(weekKey(new Date(2026, 10, 15, 23, 59))).toBe('2026-11-09'); // Sunday night
});
