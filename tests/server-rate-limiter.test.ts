import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { authenticateAndRateLimit, createRateLimitResponse } from '../src/lib/server-rate-limiter';

describe('Server Rate Limiter & Auth Guard', () => {
  it('allows requests with valid BYOK client header directly', async () => {
    const req = new NextRequest('http://localhost:3000/api/gemini/chat', {
      headers: {
        'x-gemini-api-key': 'AIzaSyTestUserKey123',
      },
    });

    const result = await authenticateAndRateLimit(req);
    expect(result.allowed).toBe(true);
    expect(result.isByok).toBe(true);
    expect(result.status).toBe(200);
  });

  it('rejects unauthenticated requests when no BYOK is provided and server key is absent', async () => {
    const originalServerKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    try {
      const req = new NextRequest('http://localhost:3000/api/gemini/chat');
      const result = await authenticateAndRateLimit(req);

      expect(result.allowed).toBe(false);
      expect(result.status).toBe(401);
      expect(result.message).toContain('Chiave API Google AI Studio non configurata');
    } finally {
      process.env.GEMINI_API_KEY = originalServerKey;
    }
  });

  it('rejects requests without Supabase Bearer token when server fallback is active', async () => {
    process.env.GEMINI_API_KEY = 'AIzaSyServerFallbackKey';

    const req = new NextRequest('http://localhost:3000/api/gemini/chat');
    const result = await authenticateAndRateLimit(req);

    expect(result.allowed).toBe(false);
    expect(result.status).toBe(401);
    expect(result.message).toContain('Accesso non autorizzato');
  });

  it('generates standard HTTP 429 response with Retry-After header', () => {
    const rateLimitResult = {
      allowed: false,
      status: 429,
      retryAfter: 120,
      message: 'Limite orario superato.',
      isByok: false,
    };

    const response = createRateLimitResponse(rateLimitResult);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('120');
  });
});
