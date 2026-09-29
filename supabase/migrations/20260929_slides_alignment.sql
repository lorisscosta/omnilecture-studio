-- ==============================================================================
-- Migration: 20260929_slides_alignment.sql
-- Descrizione: Aggiunta colonna slides_alignment (JSONB) su public.lectures per
-- supportare l'allineamento sincronizzato tra le slide PDF e la registrazione audio.
-- ==============================================================================

-- Aggiunge la colonna slides_alignment se non esiste già
ALTER TABLE public.lectures
  ADD COLUMN IF NOT EXISTS slides_alignment JSONB DEFAULT '[]'::jsonb;

-- Commento esplicativo per documentazione schema Supabase
COMMENT ON COLUMN public.lectures.slides_alignment IS
  'Array JSON di oggetti SlideAlignment contenenti slide_number, title, part, start_time_seconds, end_time_seconds e summary derivati da Gemini multimodale.';
