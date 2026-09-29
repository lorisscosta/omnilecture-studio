import { describe, it, expect } from 'vitest';
import { LectureBookmark } from '../src/lib/types';

describe('bookmarks: sorting and formatting', () => {
  it('sorts bookmarks chronologically by timestamp', () => {
    const rawBookmarks: LectureBookmark[] = [
      {
        id: 'bm_2',
        partIndex: 0,
        timestampSeconds: 340,
        label: 'Proprietà di traslazione',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'bm_1',
        partIndex: 0,
        timestampSeconds: 60,
        label: 'Definizione DFT',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'bm_3',
        partIndex: 1,
        timestampSeconds: 120,
        label: 'Filtraggio Overlap-Add',
        createdAt: new Date().toISOString(),
      },
    ];

    const sorted = [...rawBookmarks].sort((a, b) => a.timestampSeconds - b.timestampSeconds);

    expect(sorted[0].id).toBe('bm_1');
    expect(sorted[1].id).toBe('bm_3');
    expect(sorted[2].id).toBe('bm_2');
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
