import { createClient } from '@supabase/supabase-js';
import { Lecture } from './types';

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

/**
 * Text-Only Cloud Sync: Upserts AI-generated lecture text & JSON into Supabase PostgreSQL.
 * NEVER uploads the audio file (.mp3 / .wav) to preserve free tier storage limits and bandwidth.
 */
export async function syncLectureToSupabase(
  lecture: Lecture,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  if (!supabase) {
    return { success: false, error: 'Configurazione Supabase mancante.' };
  }

  try {
    const payload = {
      id: lecture.id,
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
      created_at: lecture.createdAt || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('lectures')
      .upsert(payload, { onConflict: 'id' });

    if (error) {
      console.error('Supabase sync error:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
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
        mermaid_mindmap: row.mermaid_mindmap || '',
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
