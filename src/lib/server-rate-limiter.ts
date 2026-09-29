import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export interface RateLimitCheckResult {
  allowed: boolean;
  status: number;
  message?: string;
  retryAfter?: number;
  userId?: string;
  isByok: boolean;
}

// In-memory fallback for local development or when Supabase RPC is not yet applied
interface MemoryLimitEntry {
  hourlyCount: number;
  hourlyStart: number;
  dailyCount: number;
  dailyStart: number;
}
const memoryRateLimitStore = new Map<string, MemoryLimitEntry>();

function checkMemoryRateLimit(
  key: string,
  hourlyLimit: number,
  dailyLimit: number
): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  let entry = memoryRateLimitStore.get(key);

  if (!entry) {
    entry = {
      hourlyCount: 0,
      hourlyStart: now,
      dailyCount: 0,
      dailyStart: now,
    };
    memoryRateLimitStore.set(key, entry);
  }

  // Check hourly window (3600000 ms)
  if (now - entry.hourlyStart >= 3600000) {
    entry.hourlyCount = 0;
    entry.hourlyStart = now;
  }

  // Check daily window (86400000 ms)
  if (now - entry.dailyStart >= 86400000) {
    entry.dailyCount = 0;
    entry.dailyStart = now;
  }

  if (entry.hourlyCount >= hourlyLimit) {
    const retryAfter = Math.ceil((3600000 - (now - entry.hourlyStart)) / 1000);
    return { allowed: false, retryAfter: Math.max(1, retryAfter) };
  }

  if (entry.dailyCount >= dailyLimit) {
    const retryAfter = Math.ceil((86400000 - (now - entry.dailyStart)) / 1000);
    return { allowed: false, retryAfter: Math.max(1, retryAfter) };
  }

  entry.hourlyCount += 1;
  entry.dailyCount += 1;

  return { allowed: true, retryAfter: 0 };
}

/**
 * Validates request authorization and applies atomic rate limiting.
 * - If client provides BYOK (`x-gemini-api-key`), they use their own Google quota.
 * - If relying on server fallback (`process.env.GEMINI_API_KEY`), the user MUST be authenticated via Supabase JWT.
 */
export async function authenticateAndRateLimit(
  req: NextRequest
): Promise<RateLimitCheckResult> {
  const byokKey = (req.headers.get('x-gemini-api-key') || '').trim();

  // If user provided BYOK, request is allowed without consuming server quota
  if (byokKey) {
    return {
      allowed: true,
      status: 200,
      isByok: true,
    };
  }

  // Server fallback requires server GEMINI_API_KEY to be configured
  const serverApiKey = process.env.GEMINI_API_KEY;
  if (!serverApiKey) {
    return {
      allowed: false,
      status: 401,
      message: 'Chiave API Google AI Studio non configurata. Inserisci la tua chiave BYOK nelle impostazioni.',
      isByok: false,
    };
  }

  // Extract Supabase Bearer token
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : '';

  if (!token) {
    return {
      allowed: false,
      status: 401,
      message: 'Accesso non autorizzato. Effettua l\'accesso con Supabase per utilizzare il server proxy, oppure inserisci la tua chiave personale nelle impostazioni.',
      isByok: false,
    };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      allowed: false,
      status: 500,
      message: 'Configurazione Supabase non disponibile sul server.',
      isByok: false,
    };
  }

  // Verify JWT token with Supabase client
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
  });

  const { data: userData, error: authError } = await supabase.auth.getUser(token);

  if (authError || !userData?.user) {
    return {
      allowed: false,
      status: 401,
      message: 'Sessione di autenticazione non valida o scaduta. Effettua nuovamente il login.',
      isByok: false,
    };
  }

  const userId = userData.user.id;
  const hourlyLimit = parseInt(process.env.GEMINI_PROXY_HOURLY_LIMIT || '15', 10);
  const dailyLimit = parseInt(process.env.GEMINI_PROXY_DAILY_LIMIT || '50', 10);

  // Attempt atomic Supabase stored procedure
  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'check_and_increment_gemini_proxy_rate_limit',
      {
        p_user_id: userId,
        p_hourly_limit: hourlyLimit,
        p_daily_limit: dailyLimit,
      }
    );

    if (!rpcError && rpcData) {
      const allowed = Boolean(rpcData.allowed);
      const retryAfter = Number(rpcData.retry_after) || 0;
      const reason = rpcData.reason === 'hourly_limit_exceeded' ? 'orario' : 'giornaliero';

      if (!allowed) {
        return {
          allowed: false,
          status: 429,
          retryAfter,
          message: `Limite ${reason} di richieste proxy raggiunto. Riprova tra ${retryAfter} secondi o inserisci la tua chiave personale nelle impostazioni.`,
          userId,
          isByok: false,
        };
      }

      return {
        allowed: true,
        status: 200,
        userId,
        isByok: false,
      };
    }
  } catch (rpcErr) {
    console.warn('RPC check_and_increment_gemini_proxy_rate_limit failed, falling back to memory store:', rpcErr);
  }

  // Fallback to memory store if RPC is not yet created in PostgreSQL
  const memoryCheck = checkMemoryRateLimit(userId, hourlyLimit, dailyLimit);
  if (!memoryCheck.allowed) {
    return {
      allowed: false,
      status: 429,
      retryAfter: memoryCheck.retryAfter,
      message: `Limite di richieste proxy raggiunto. Riprova tra ${memoryCheck.retryAfter} secondi.`,
      userId,
      isByok: false,
    };
  }

  return {
    allowed: true,
    status: 200,
    userId,
    isByok: false,
  };
}

/**
 * Creates standard Next.js rate limit / auth error response with Retry-After header.
 */
export function createRateLimitResponse(result: RateLimitCheckResult): NextResponse {
  const headers = new Headers();
  if (result.retryAfter && result.retryAfter > 0) {
    headers.set('Retry-After', result.retryAfter.toString());
  }

  return NextResponse.json(
    {
      error: result.message || 'Richiesta non autorizzata o limitata.',
      retryAfter: result.retryAfter,
    },
    {
      status: result.status,
      headers,
    }
  );
}
