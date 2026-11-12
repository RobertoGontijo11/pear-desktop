import { test, expect } from '@playwright/test';

import {
  extractVideoIds,
  insertionIndexes,
  pickDiscoveries,
  shuffled,
} from '../src/plugins/library-layout/smart-shuffle';

// Pure logic only: these tests never launch the app.

test('extractVideoIds finds queue renderers at any depth', () => {
  const response = {
    contents: {
      tabs: [
        {
          content: {
            contents: [
              { playlistPanelVideoRenderer: { videoId: 'a' } },
              {
                playlistPanelVideoWrapperRenderer: {
                  primaryRenderer: {
                    playlistPanelVideoRenderer: { videoId: 'b' },
                  },
                },
              },
              { somethingElse: { videoId: 'ignored' } },
            ],
          },
        },
      ],
    },
  };
  expect(extractVideoIds(response)).toEqual(['a', 'b']);
  expect(extractVideoIds(null)).toEqual([]);
});

test('pickDiscoveries skips queued tracks and duplicates', () => {
  const picked = pickDiscoveries(
    ['q1', 'n1', 'n1', 'n2', 'q2', 'n3'],
    new Set(['q1', 'q2']),
    20,
  );
  expect([...picked].sort()).toEqual(['n1', 'n2', 'n3']);
});

test('pickDiscoveries adds about one new track per two queued', () => {
  const candidates = Array.from({ length: 40 }, (_, i) => `n${i}`);
  expect(pickDiscoveries(candidates, new Set(), 6)).toHaveLength(3);
  expect(pickDiscoveries(candidates, new Set(), 1)).toHaveLength(1);
  // capped
  expect(pickDiscoveries(candidates, new Set(), 500)).toHaveLength(15);
});

test('insertionIndexes spaces discoveries two queue tracks apart', () => {
  // current track at 0, ten tracks queued, three discoveries
  expect(insertionIndexes(0, 10, 3)).toEqual([3, 6, 9]);

  // Applying them in order gives: P P P D P P D P P D P P P
  const queue = Array.from({ length: 10 }, (_, i) => `p${i}`);
  insertionIndexes(0, queue.length, 3).forEach((index, n) => {
    queue.splice(index, 0, `d${n}`);
  });
  expect(queue.slice(0, 10)).toEqual([
    'p0',
    'p1',
    'p2',
    'd0',
    'p3',
    'p4',
    'd1',
    'p5',
    'p6',
    'd2',
  ]);
});

test('insertionIndexes never points past the end of a short queue', () => {
  expect(insertionIndexes(1, 2, 3)).toEqual([2, 3, 4]);
});

test('shuffled keeps every element and does not mutate the input', () => {
  const input = [1, 2, 3, 4, 5];
  const output = shuffled(input, () => 0.42);
  expect(input).toEqual([1, 2, 3, 4, 5]);
  expect([...output].sort()).toEqual(input);
});
