import { describe, it, expect, vi } from 'vitest';
import {
  normalizeModelName,
  isAudioCapableModel,
  getModelFallbackChain,
  fetchAvailableModels,
  STATIC_FALLBACK_MODELS,
  DEFAULT_MODEL_ID,
} from '../src/lib/gemini-config';

describe('Gemini Model Config & Discovery', () => {
  describe('normalizeModelName', () => {
    it('normalizes legacy or fictitious model names to gemini-2.0-flash', () => {
      expect(normalizeModelName('gemini-3.8-flash')).toBe('gemini-2.0-flash');
      expect(normalizeModelName('gemini-3.6-flash')).toBe('gemini-2.0-flash');
      expect(normalizeModelName('gemini-3.0-flash')).toBe('gemini-2.0-flash');
      expect(normalizeModelName('flash')).toBe('gemini-2.0-flash');
      expect(normalizeModelName('gemini-flash')).toBe('gemini-2.0-flash');
    });

    it('normalizes pro alias to gemini-1.5-pro-latest', () => {
      expect(normalizeModelName('pro')).toBe('gemini-1.5-pro-latest');
      expect(normalizeModelName('gemini-pro')).toBe('gemini-1.5-pro-latest');
    });

    it('strips models/ prefix from official names', () => {
      expect(normalizeModelName('models/gemini-2.0-flash')).toBe('gemini-2.0-flash');
      expect(normalizeModelName('models/gemini-1.5-pro')).toBe('gemini-1.5-pro');
    });

    it('returns DEFAULT_MODEL_ID for empty or invalid input', () => {
      expect(normalizeModelName('')).toBe(DEFAULT_MODEL_ID);
      expect(normalizeModelName(null)).toBe(DEFAULT_MODEL_ID);
      expect(normalizeModelName(undefined)).toBe(DEFAULT_MODEL_ID);
    });
  });

  describe('isAudioCapableModel', () => {
    it('recognizes 1.5 and 2.0 families as audio capable', () => {
      expect(isAudioCapableModel('gemini-2.0-flash')).toBe(true);
      expect(isAudioCapableModel('gemini-1.5-flash-latest')).toBe(true);
      expect(isAudioCapableModel('gemini-1.5-pro')).toBe(true);
    });

    it('rejects unsupported model families', () => {
      expect(isAudioCapableModel('text-bison-001')).toBe(false);
      expect(isAudioCapableModel('embedding-001')).toBe(false);
    });
  });

  describe('getModelFallbackChain', () => {
    it('places the preferred model first in the chain', () => {
      const chain = getModelFallbackChain('gemini-1.5-pro-latest');
      expect(chain[0]).toBe('gemini-1.5-pro-latest');
      expect(chain).toContain('gemini-2.0-flash');
      expect(chain).toContain('gemini-1.5-flash-latest');
    });

    it('normalizes the requested model before placing it first', () => {
      const chain = getModelFallbackChain('gemini-3.8-flash');
      expect(chain[0]).toBe('gemini-2.0-flash');
    });
  });

  describe('fetchAvailableModels', () => {
    it('returns static fallback when apiKey is empty', async () => {
      const models = await fetchAvailableModels('');
      expect(models).toEqual(STATIC_FALLBACK_MODELS);
    });

    it('filters API models based on generateContent capability', async () => {
      const mockApiResponse = {
        models: [
          {
            name: 'models/gemini-2.0-flash',
            displayName: 'Gemini 2.0 Flash',
            supportedGenerationMethods: ['generateContent'],
          },
          {
            name: 'models/embedding-001',
            displayName: 'Text Embedding',
            supportedGenerationMethods: ['embedContent'],
          },
          {
            name: 'models/gemini-1.5-pro-latest',
            displayName: 'Gemini 1.5 Pro',
            supportedGenerationMethods: ['generateContent', 'countTokens'],
          },
        ],
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockApiResponse,
      } as Response);

      try {
        const result = await fetchAvailableModels('test-api-key');
        expect(result.some((m) => m.id === 'gemini-2.0-flash')).toBe(true);
        expect(result.some((m) => m.id === 'gemini-1.5-pro-latest')).toBe(true);
        expect(result.some((m) => m.id === 'embedding-001')).toBe(false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
