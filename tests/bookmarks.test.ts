import { describe, it, expect } from 'vitest';
import { LectureBookmark } from '../src/lib/types';
import { sortLectureBookmarks } from '../src/lib/db';

describe('bookmarks: sorting and formatting', () => {
  it('sorts bookmarks chronologically by partIndex and timestamp', () => {
    const rawBookmarks: LectureBookmark[] = [
      {
        id: 'bm_2',
        partIndex: 0,
        timestampSeconds: 340,
        label: 'Proprietà di traslazione (P1)',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'bm_1',
        partIndex: 0,
        timestampSeconds: 60,
        label: 'Definizione DFT (P1)',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'bm_3',
        partIndex: 1,
        timestampSeconds: 120,
        label: 'Filtraggio Overlap-Add (P2)',
        createdAt: new Date().toISOString(),
      },
    ];

    const sorted = sortLectureBookmarks(rawBookmarks);

    // bm_1 (P1, 60s) comes first
    expect(sorted[0].id).toBe('bm_1');
    // bm_2 (P1, 340s) comes second
    expect(sorted[1].id).toBe('bm_2');
    // bm_3 (P2, 120s) comes third because it is in Part 2!
    expect(sorted[2].id).toBe('bm_3');
  });

  it('correctly filters out removed bookmarks by id', () => {
    const bookmarks: LectureBookmark[] = [
      { id: '1', partIndex: 0, timestampSeconds: 10, label: 'Nota 1', createdAt: '' },
      { id: '2', partIndex: 0, timestampSeconds: 20, label: 'Nota 2', createdAt: '' },
    ];

    const filtered = bookmarks.filter((b) => b.id !== '1');
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe('2');
  });
});
