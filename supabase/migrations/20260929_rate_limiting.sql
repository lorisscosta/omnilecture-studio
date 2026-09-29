-- ==============================================================================
-- Migration: 20260929_rate_limiting.sql
-- Descrizione: Rate limiting atomico per proxy serverless Gemini su Supabase
-- ==============================================================================

-- 1. Tabella tracciamento rate limit per utente
CREATE TABLE IF NOT EXISTS public.gemini_proxy_rate_limits (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    hourly_count INT NOT NULL DEFAULT 0,
    hourly_window_start TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    daily_count INT NOT NULL DEFAULT 0,
    daily_window_start TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 2. Abilitazione Row Level Security (RLS)
ALTER TABLE public.gemini_proxy_rate_limits ENABLE ROW LEVEL SECURITY;

-- 3. Policy RLS: L'utente autenticato può visualizzare solo i propri limiti
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'gemini_proxy_rate_limits' 
        AND policyname = 'Users can view own rate limit status'
    ) THEN
        CREATE POLICY "Users can view own rate limit status"
            ON public.gemini_proxy_rate_limits
            FOR SELECT
            TO authenticated
            USING (auth.uid() = user_id);
    END IF;
END $$;

-- 4. Funzione PL/pgSQL atomica per verifica e incremento transazionale del limite
CREATE OR REPLACE FUNCTION public.check_and_increment_gemini_proxy_rate_limit(
    p_user_id UUID,
    p_hourly_limit INT DEFAULT 15,
    p_daily_limit INT DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
    v_hourly_count INT := 0;
    v_daily_count INT := 0;
    v_hourly_start TIMESTAMPTZ;
    v_daily_start TIMESTAMPTZ;
    v_hourly_retry_after INT := 0;
    v_daily_retry_after INT := 0;
BEGIN
    -- Inserimento record se non esistente (idempotente)
    INSERT INTO public.gemini_proxy_rate_limits (
        user_id, hourly_count, hourly_window_start, daily_count, daily_window_start, updated_at
    )
    VALUES (p_user_id, 0, v_now, 0, v_now, v_now)
    ON CONFLICT (user_id) DO NOTHING;

    -- Lock riga utente per consistenza atomica concorrente
    SELECT hourly_count, hourly_window_start, daily_count, daily_window_start
    INTO v_hourly_count, v_hourly_start, v_daily_count, v_daily_start
    FROM public.gemini_proxy_rate_limits
    WHERE user_id = p_user_id
    FOR UPDATE;

    -- Reset finestra oraria se trascorsi 3600 secondi
    IF EXTRACT(EPOCH FROM (v_now - v_hourly_start)) >= 3600 THEN
        v_hourly_count := 0;
        v_hourly_start := v_now;
    END IF;

    -- Reset finestra giornaliera se trascorsi 86400 secondi
    IF EXTRACT(EPOCH FROM (v_now - v_daily_start)) >= 86400 THEN
        v_daily_count := 0;
        v_daily_start := v_now;
    END IF;

    -- Verifica cap orario
    IF v_hourly_count >= p_hourly_limit THEN
        v_hourly_retry_after := CEIL(3600 - EXTRACT(EPOCH FROM (v_now - v_hourly_start)));
        RETURN jsonb_build_object(
            'allowed', false,
            'reason', 'hourly_limit_exceeded',
            'retry_after', GREATEST(1, v_hourly_retry_after),
            'hourly_count', v_hourly_count,
            'daily_count', v_daily_count
        );
    END IF;

    -- Verifica cap giornaliero
    IF v_daily_count >= p_daily_limit THEN
        v_daily_retry_after := CEIL(86400 - EXTRACT(EPOCH FROM (v_now - v_daily_start)));
        RETURN jsonb_build_object(
            'allowed', false,
            'reason', 'daily_limit_exceeded',
            'retry_after', GREATEST(1, v_daily_retry_after),
            'hourly_count', v_hourly_count,
            'daily_count', v_daily_count
        );
    END IF;

    -- Incremento atomico
    v_hourly_count := v_hourly_count + 1;
    v_daily_count := v_daily_count + 1;

    UPDATE public.gemini_proxy_rate_limits
    SET hourly_count = v_hourly_count,
        hourly_window_start = v_hourly_start,
        daily_count = v_daily_count,
        daily_window_start = v_daily_start,
        updated_at = v_now
    WHERE user_id = p_user_id;

    RETURN jsonb_build_object(
        'allowed', true,
        'retry_after', 0,
        'hourly_count', v_hourly_count,
        'daily_count', v_daily_count
    );
END;
$$;
