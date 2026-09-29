-- ==============================================================================
-- Migration: 20260929_bookmarks.sql
-- Descrizione: Aggiunta colonna bookmarks (JSONB) su public.lectures per
-- supportare note personali e segnalibri audio sincronizzati con il player.
-- ==============================================================================

-- Aggiunge la colonna bookmarks se non esiste già
ALTER TABLE public.lectures
  ADD COLUMN IF NOT EXISTS bookmarks JSONB DEFAULT '[]'::jsonb;

-- Commento esplicativo per documentazione schema Supabase
COMMENT ON COLUMN public.lectures.bookmarks IS
  'Array JSON di oggetti LectureBookmark con id, partIndex, timestampSeconds, label, note e createdAt creati dallo studente durante l''ascolto.';
