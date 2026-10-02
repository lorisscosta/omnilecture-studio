import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFrom, mockDelete, mockEq } = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://mock-project.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'mock-anon-key';

  const mockEq = vi.fn();
  const mockDelete = vi.fn(() => ({
    eq: mockEq,
  }));
  const mockFrom = vi.fn(() => ({
    delete: mockDelete,
  }));

  return { mockFrom, mockDelete, mockEq };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: mockFrom,
  })),
}));

import { deleteCloudLecture, removeLectureFromCloud, isSupabaseConfigured } from '../src/lib/supabase';
import { db } from '../src/lib/db';

describe('Supabase Cloud Removal & Sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes Supabase client when env vars are present', () => {
    expect(isSupabaseConfigured).toBe(true);
  });

  it('deletes lecture from Supabase PostgreSQL table with optional userId filter', async () => {
    // Case 1: Without userId
    mockEq.mockResolvedValueOnce({ error: null });
    const successWithoutUser = await deleteCloudLecture('lec-123');
    expect(successWithoutUser).toBe(true);
    expect(mockFrom).toHaveBeenCalledWith('lectures');
    expect(mockEq).toHaveBeenCalledWith('id', 'lec-123');

    // Case 2: With userId scoping
    const mockUserEq = vi.fn().mockResolvedValueOnce({ error: null });
    mockEq.mockReturnValueOnce({ eq: mockUserEq });
    const successWithUser = await deleteCloudLecture('lec-123', 'user-456');
    expect(successWithUser).toBe(true);
    expect(mockUserEq).toHaveBeenCalledWith('user_id', 'user-456');
  });

  it('successfully removes lecture from cloud and resets Dexie record without deleting local copy', async () => {
    mockEq.mockResolvedValueOnce({ error: null });
    const updateSpy = vi.spyOn(db.lectures, 'update').mockReturnValue(Promise.resolve(1) as any);

    const res = await removeLectureFromCloud('lec-789');

    expect(res.success).toBe(true);
    expect(updateSpy).toHaveBeenCalledWith('lec-789', {
      isCloudSynced: false,
      cloudSyncedAt: undefined,
    });
  });

  it('returns failure when Supabase delete call fails with an error', async () => {
    mockEq.mockResolvedValueOnce({ error: { message: 'Database RLS violation' } });
    const updateSpy = vi.spyOn(db.lectures, 'update');

    const res = await removeLectureFromCloud('lec-failed');

    expect(res.success).toBe(false);
    expect(res.error).toBe('Impossibile eliminare la registrazione dal cloud Supabase.');
    // Local dexie should NOT be updated if remote deletion fails
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
