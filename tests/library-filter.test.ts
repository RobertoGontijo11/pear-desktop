import { test, expect } from '@playwright/test';

import {
  parseLibraryItems,
  pickThumbnail,
} from '../src/plugins/library-layout/library-filter';

// Pure logic only: these tests never launch the app.

const artistRow = (title: string, browseId: string) => ({
  musicResponsiveListItemRenderer: {
    flexColumns: [
      {
        musicResponsiveListItemFlexColumnRenderer: {
          text: { runs: [{ text: title }] },
        },
      },
      {
        musicResponsiveListItemFlexColumnRenderer: {
          text: { runs: [{ text: '1 música' }] },
        },
      },
    ],
    navigationEndpoint: { browseEndpoint: { browseId } },
    thumbnail: {
      musicThumbnailRenderer: {
        thumbnail: {
          thumbnails: [
            { url: 'small', width: 60 },
            { url: 'big', width: 120 },
          ],
        },
      },
    },
  },
});

test('parseLibraryItems reads list rows (artists page)', () => {
  const response = {
    contents: {
      shelf: {
        contents: [artistRow('HOZHO', 'MPLA1'), artistRow('Massano', 'MPLA2')],
      },
    },
  };
  expect(parseLibraryItems(response)).toEqual([
    {
      title: 'HOZHO',
      subtitle: '1 música',
      thumbnail: 'small',
      endpoint: { browseEndpoint: { browseId: 'MPLA1' } },
    },
    {
      title: 'Massano',
      subtitle: '1 música',
      thumbnail: 'small',
      endpoint: { browseEndpoint: { browseId: 'MPLA2' } },
    },
  ]);
});

test('parseLibraryItems reads grid cards and skips cards without a page', () => {
  const response = {
    grid: [
      {
        musicTwoRowItemRenderer: {
          title: { runs: [{ text: 'Album' }] },
          subtitle: {
            runs: [{ text: 'Álbum' }, { text: ' • ' }, { text: 'Astrix' }],
          },
          navigationEndpoint: { browseEndpoint: { browseId: 'MPRE1' } },
        },
      },
      // "Nova playlist" tile: no browse endpoint
      {
        musicTwoRowItemRenderer: {
          title: { runs: [{ text: 'Nova playlist' }] },
          navigationEndpoint: {},
        },
      },
    ],
  };
  const items = parseLibraryItems(response);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    title: 'Album',
    subtitle: 'Álbum • Astrix',
  });
});

test('parseLibraryItems returns nothing for the empty-library message', () => {
  expect(
    parseLibraryItems({
      messageRenderer: { text: { runs: [{ text: 'Não tem álbuns' }] } },
    }),
  ).toEqual([]);
});

test('pickThumbnail prefers the smallest image that is at least 40px', () => {
  expect(
    pickThumbnail([
      { url: 'a', width: 226 },
      { url: 'b', width: 60 },
      { url: 'c', width: 30 },
    ]),
  ).toBe('b');
  expect(pickThumbnail([{ url: 'tiny', width: 20 }])).toBe('tiny');
  expect(pickThumbnail()).toBeUndefined();
});
