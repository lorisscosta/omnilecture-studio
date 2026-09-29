/**
 * Centralized Gemini Model Configuration & Capability Discovery
 * Supports dynamic fetching from Google AI Studio ListModels API,
 * deprecation handling, normalization of legacy aliases, and static fallback.
 */

export interface GeminiModelInfo {
  id: string; // Clean model name without 'models/' prefix
  displayName: string;
  description: string;
  supportsAudio: boolean;
  isRecommended?: boolean;
  isPro?: boolean;
  isExperimental?: boolean;
  isDeprecated?: boolean;
}

/**
 * Curated metadata dictionary for known official models.
 */
const MODEL_METADATA: Record<string, { displayName: string; description: string; recommended?: boolean; pro?: boolean; experimental?: boolean }> = {
  'gemini-2.0-flash': {
    displayName: 'Gemini 2.0 Flash',
    description: 'Nuova generazione multimodale: velocissimo, audio nativo e alta fedeltà LaTeX.',
    recommended: true,
  },
  'gemini-1.5-flash-latest': {
    displayName: 'Gemini 1.5 Flash (Stabile)',
    description: 'Modello ultra-affidabile ad altissima velocità con 1 milione di token di contesto.',
    recommended: true,
  },
  'gemini-1.5-flash-002': {
    displayName: 'Gemini 1.5 Flash 002',
    description: 'Versione ottimizzata di 1.5 Flash a bassa latenza e costo computazionale ridotto.',
  },
  'gemini-1.5-pro-latest': {
    displayName: 'Gemini 1.5 Pro',
    description: 'Massimo ragionamento accademico, ideale per dimostrazioni matematiche e corsi avanzati.',
    pro: true,
  },
  'gemini-1.5-pro-002': {
    displayName: 'Gemini 1.5 Pro 002',
    description: 'Versione calibrata di 1.5 Pro con maggiore precisione nelle formule complesse.',
    pro: true,
  },
  'gemini-2.0-flash-exp': {
    displayName: 'Gemini 2.0 Flash (Experimental)',
    description: 'Versione sperimentale con le feature più recenti di Google DeepMind.',
    experimental: true,
  },
};

/**
 * Robust static fallback list when offline or when API discovery is unavailable.
 */
export const STATIC_FALLBACK_MODELS: GeminiModelInfo[] = [
  {
    id: 'gemini-2.0-flash',
    displayName: MODEL_METADATA['gemini-2.0-flash'].displayName,
    description: MODEL_METADATA['gemini-2.0-flash'].description,
    supportsAudio: true,
    isRecommended: true,
  },
  {
    id: 'gemini-1.5-flash-latest',
    displayName: MODEL_METADATA['gemini-1.5-flash-latest'].displayName,
    description: MODEL_METADATA['gemini-1.5-flash-latest'].description,
    supportsAudio: true,
    isRecommended: true,
  },
  {
    id: 'gemini-1.5-flash-002',
    displayName: MODEL_METADATA['gemini-1.5-flash-002'].displayName,
    description: MODEL_METADATA['gemini-1.5-flash-002'].description,
    supportsAudio: true,
  },
  {
    id: 'gemini-1.5-pro-latest',
    displayName: MODEL_METADATA['gemini-1.5-pro-latest'].displayName,
    description: MODEL_METADATA['gemini-1.5-pro-latest'].description,
    supportsAudio: true,
    isPro: true,
  },
  {
    id: 'gemini-1.5-pro-002',
    displayName: MODEL_METADATA['gemini-1.5-pro-002'].displayName,
    description: MODEL_METADATA['gemini-1.5-pro-002'].description,
    supportsAudio: true,
    isPro: true,
  },
];

export const DEFAULT_MODEL_ID = 'gemini-2.0-flash';

/**
 * Normalizes user-input or legacy stored model names.
 * Maps legacy/fictitious names (e.g. gemini-3.8-flash, gemini-3.6-flash)
 * and strips any 'models/' prefix.
 */
export function normalizeModelName(rawName?: string | null): string {
  if (!rawName || typeof rawName !== 'string') {
    return DEFAULT_MODEL_ID;
  }

  const clean = rawName.trim().replace(/^models\//, '');

  // Handle legacy / fictitious names
  if (clean === 'gemini-3.8-flash' || clean === 'gemini-3.6-flash' || clean === 'gemini-3.0-flash') {
    return 'gemini-2.0-flash';
  }

  // Handle general flash/pro aliases
  if (clean === 'gemini-flash' || clean === 'flash') {
    return 'gemini-2.0-flash';
  }
  if (clean === 'gemini-pro' || clean === 'pro') {
    return 'gemini-1.5-pro-latest';
  }

  return clean;
}

/**
 * Determines whether a model name supports multimodal audio input.
 */
export function isAudioCapableModel(modelId: string): boolean {
  const normalized = normalizeModelName(modelId);
  // Known audio-capable families
  return (
    normalized.startsWith('gemini-1.5-') ||
    normalized.startsWith('gemini-2.0-') ||
    normalized.startsWith('gemini-2.5-')
  );
}

/**
 * Dynamically fetches and filters all available content-generation models
 * from Google AI Studio ListModels API for the provided key.
 */
export async function fetchAvailableModels(apiKey: string): Promise<GeminiModelInfo[]> {
  if (!apiKey || !apiKey.trim()) {
    return STATIC_FALLBACK_MODELS;
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey.trim())}`,
      { cache: 'no-store' }
    );

    if (!res.ok) {
      console.warn(`ListModels returned HTTP ${res.status}. Using static fallback.`);
      return STATIC_FALLBACK_MODELS;
    }

    const data = await res.json();
    if (!data || !Array.isArray(data.models)) {
      return STATIC_FALLBACK_MODELS;
    }

    interface RawModel {
      name?: string;
      displayName?: string;
      description?: string;
      supportedGenerationMethods?: string[];
    }

    const rawModels: RawModel[] = data.models;

    // Filter models supporting generateContent and excluding embeddings, tts, imagen, aqa
    const validModels = rawModels
      .filter((m) => {
        const methods = m.supportedGenerationMethods || [];
        return methods.includes('generateContent');
      })
      .map((m) => {
        const id = (m.name || '').replace(/^models\//, '');
        return {
          id,
          rawDisplayName: m.displayName || id,
          rawDescription: m.description || '',
        };
      })
      .filter(({ id }) => {
        const lower = id.toLowerCase();
        return (
          !lower.includes('embedding') &&
          !lower.includes('tts') &&
          !lower.includes('imagen') &&
          !lower.includes('aqa') &&
          !lower.includes('live') &&
          (lower.includes('gemini') || lower.includes('flash') || lower.includes('pro'))
        );
      });

    if (validModels.length === 0) {
      return STATIC_FALLBACK_MODELS;
    }

    // Build rich list with metadata and priority ordering
    const result: GeminiModelInfo[] = validModels.map(({ id, rawDisplayName, rawDescription }) => {
      const meta = MODEL_METADATA[id];
      return {
        id,
        displayName: meta?.displayName || rawDisplayName,
        description: meta?.description || rawDescription,
        supportsAudio: isAudioCapableModel(id),
        isRecommended: meta?.recommended ?? id.includes('flash'),
        isPro: meta?.pro ?? id.includes('pro'),
        isExperimental: meta?.experimental ?? id.includes('exp'),
      };
    });

    // Preferred sort order: Recommended Flash models first, then Pro models, then Experimental
    result.sort((a, b) => {
      const getScore = (m: GeminiModelInfo) => {
        if (m.id === 'gemini-2.0-flash') return 100;
        if (m.id === 'gemini-1.5-flash-latest') return 90;
        if (m.id === 'gemini-1.5-flash-002') return 80;
        if (m.id === 'gemini-1.5-flash') return 70;
        if (m.id === 'gemini-1.5-pro-latest') return 60;
        if (m.id === 'gemini-1.5-pro-002') return 50;
        if (m.id === 'gemini-2.0-flash-exp') return 40;
        if (m.isRecommended) return 30;
        if (m.isPro) return 20;
        return 10;
      };
      return getScore(b) - getScore(a);
    });

    return result;
  } catch (err) {
    console.warn('Network error during ListModels, falling back to static model list:', err);
    return STATIC_FALLBACK_MODELS;
  }
}

/**
 * Returns prioritized fallback array of model IDs to try during audio generation.
 */
export function getModelFallbackChain(preferredModel?: string): string[] {
  const normalized = normalizeModelName(preferredModel);
  const chain: string[] = [normalized];

  const defaultChain = [
    'gemini-2.0-flash',
    'gemini-1.5-flash-latest',
    'gemini-1.5-flash-002',
    'gemini-1.5-flash',
    'gemini-1.5-pro-latest',
    'gemini-1.5-pro-002',
    'gemini-2.0-flash-exp',
  ];

  for (const m of defaultChain) {
    if (!chain.includes(m)) {
      chain.push(m);
    }
  }

  return chain;
}
