import { createClient } from '@supabase/supabase-js';
import { Lecture } from './types';
import { db } from './db';

// Clean Supabase URL (strip /rest/v1 or trailing slashes if present)
const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseUrl = rawUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Text-Only Cloud Sync: Upserts AI-generated lecture text & JSON into Supabase PostgreSQL.
 * NEVER uploads the audio file (.mp3 / .wav) to preserve free tier storage limits and bandwidth.
 */
export async function syncLectureToSupabase(
  lecture: Lecture,
  userId: string
): Promise<{ success: boolean; error?: string; updatedId?: string }> {
  if (!supabase) {
    return { success: false, error: 'Configurazione Supabase mancante.' };
  }

  try {
    let targetId = lecture.id;

    // Backward compatibility: If ID is not a valid UUID (e.g. legacy 'lec_...' or 'demo_dsp_...'),
    // generate a valid UUID and safely migrate the local Dexie record to prevent PostgreSQL 22P02 error.
    if (!UUID_REGEX.test(targetId)) {
      const newUuid = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : '00000000-0000-4000-8000-' + Date.now().toString(16).padStart(12, '0');

      try {
        await db.lectures.delete(lecture.id);
        lecture.id = newUuid;
        await db.lectures.put(lecture);
        targetId = newUuid;
      } catch (migrationErr) {
        console.warn('Could not migrate legacy lecture ID in Dexie:', migrationErr);
        targetId = newUuid;
      }
    }

    const payload: Record<string, any> = {
      id: targetId,
      user_id: userId,
      title: lecture.title,
      course: lecture.course,
      date: lecture.date,
      audio_filename: lecture.fileName || 'audio_locale.wav', // String reference only!
      duration: lecture.duration || 0,
      glossary: lecture.data?.glossary || [],
      timestamped_transcript: lecture.data?.timestamped_transcript || [],
      study_guide_it: lecture.data?.study_guide_it || '',
      potential_exam_questions: lecture.data?.potential_exam_questions || [],
      mermaid_mindmap: lecture.data?.mermaid_mindmap || '',
      slides_filename: lecture.slidesFileName || null,
      slides_markdown: lecture.slidesMarkdown || null,
      slides_alignment: lecture.slidesAlignment || lecture.data?.slides_alignment || [],
      bookmarks: lecture.bookmarks || lecture.data?.bookmarks || [],
      created_at: lecture.createdAt || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    let { error } = await supabase
      .from('lectures')
      .upsert(payload, { onConflict: 'id' });

    // Fallback: If remote Postgres doesn't have slides or bookmarks columns yet, retry without them
    if (error && (error.message.includes('slides_') || error.message.includes('bookmarks') || error.message.includes('schema cache'))) {
      console.warn('Supabase lectures table lacks optional columns, falling back to core fields.');
      delete payload.slides_filename;
      delete payload.slides_markdown;
      delete payload.slides_alignment;
      delete payload.bookmarks;
      const retryResult = await supabase
        .from('lectures')
        .upsert(payload, { onConflict: 'id' });
      error = retryResult.error;
    }

    if (error) {
      console.error('Supabase sync error:', error);
      return { success: false, error: error.message };
    }

    return { success: true, updatedId: targetId };
  } catch (err: any) {
    console.error('Exception during Supabase sync:', err);
    return { success: false, error: err.message || 'Errore durante la sincronizzazione.' };
  }
}

/**
 * Fetches all text-only lectures for the authenticated user from Supabase.
 */
export async function fetchCloudLectures(userId: string): Promise<Lecture[]> {
  if (!supabase) return [];

  try {
    const { data, error } = await supabase
      .from('lectures')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching lectures from Supabase:', error);
      return [];
    }

    if (!data) return [];

    return data.map((row: any) => ({
      id: row.id,
      title: row.title,
      course: row.course,
      date: row.date || row.created_at,
      duration: row.duration || 0,
      fileSize: 0, // Audio is not present in cloud
      fileName: row.audio_filename || 'audio_locale',
      audioBlob: undefined, // Audio is strictly local
      slidesFileName: row.slides_filename || undefined,
      slidesMarkdown: row.slides_markdown || undefined,
      slidesAlignment: Array.isArray(row.slides_alignment) ? row.slides_alignment : undefined,
      hasSlides: !!row.slides_markdown || Array.isArray(row.slides_alignment),
      bookmarks: Array.isArray(row.bookmarks) ? row.bookmarks : [],
      status: 'completed',
      chatMessages: [],
      userId: row.user_id,
      isCloudSynced: true,
      cloudSyncedAt: row.updated_at || row.created_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      data: {
        glossary: Array.isArray(row.glossary) ? row.glossary : [],
        timestamped_transcript: Array.isArray(row.timestamped_transcript)
          ? row.timestamped_transcript
          : [],
        study_guide_it: row.study_guide_it || '',
        potential_exam_questions: Array.isArray(row.potential_exam_questions)
          ? row.potential_exam_questions
          : [],
        slides_alignment: Array.isArray(row.slides_alignment) ? row.slides_alignment : undefined,
        bookmarks: Array.isArray(row.bookmarks) ? row.bookmarks : [],
        mermaid_mindmap: row.mermaid_mindmap || '',
        slides_markdown: row.slides_markdown || undefined,
        slides_filename: row.slides_filename || undefined,
        has_slides: !!row.slides_markdown || Array.isArray(row.slides_alignment),
      },
    }));
  } catch (err) {
    console.error('Exception fetching cloud lectures:', err);
    return [];
  }
}

/**
 * Deletes a lecture from Supabase PostgreSQL table.
 */
export async function deleteCloudLecture(lectureId: string): Promise<boolean> {
  if (!supabase) return false;

  try {
    const { error } = await supabase.from('lectures').delete().eq('id', lectureId);
    if (error) {
      console.error('Error deleting lecture from Supabase:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Exception deleting from Supabase:', err);
    return false;
  }
}
