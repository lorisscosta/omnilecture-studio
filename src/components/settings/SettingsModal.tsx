'use client';

import React, { useState, useEffect } from 'react';
import { Key, X, Check, ExternalLink, ShieldCheck, Cpu, RefreshCw, AlertCircle } from 'lucide-react';
import {
  GeminiModelInfo,
  STATIC_FALLBACK_MODELS,
  fetchAvailableModels,
  DEFAULT_MODEL_ID,
  normalizeModelName,
} from '@/lib/gemini-config';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (key: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, onSaved }) => {
  const [apiKey, setApiKey] = useState('');
  const [isSaved, setIsSaved] = useState(false);
  const [models, setModels] = useState<GeminiModelInfo[]>(STATIC_FALLBACK_MODELS);
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL_ID);
  const [isValidating, setIsValidating] = useState(false);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const savedKey = localStorage.getItem('gemini_api_key') || '';
    setApiKey(savedKey);

    const savedModel = localStorage.getItem('gemini_selected_model') || DEFAULT_MODEL_ID;
    setSelectedModel(normalizeModelName(savedModel));

    if (savedKey) {
      setIsValidating(true);
      fetchAvailableModels(savedKey)
        .then((fetched) => {
          if (fetched && fetched.length > 0) {
            setModels(fetched);
            setValidationMessage(`${fetched.length} modelli multimodali verificati.`);
          }
        })
        .catch(() => {
          setValidationMessage('Utilizzo modelli predefiniti offline.');
        })
        .finally(() => {
          setIsValidating(false);
        });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTestKey = async () => {
    if (!apiKey.trim()) {
      setValidationMessage('Inserisci una chiave prima di verificare.');
      return;
    }

    setIsValidating(true);
    setValidationMessage(null);

    try {
      const fetched = await fetchAvailableModels(apiKey.trim());
      setModels(fetched);
      setValidationMessage(`Chiave valida! ${fetched.length} modelli rilevati.`);
    } catch {
      setValidationMessage('Impossibile verificare la chiave. Controlla la connessione.');
    } finally {
      setIsValidating(false);
    }
  };

  const handleSave = () => {
    const cleanKey = apiKey.trim();
    localStorage.setItem('gemini_api_key', cleanKey);
    localStorage.setItem('gemini_selected_model', selectedModel);
    setIsSaved(true);
    onSaved?.(cleanKey);
    setTimeout(() => {
      setIsSaved(false);
      onClose();
    }, 800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl bg-zinc-900 border border-zinc-800 p-6 shadow-2xl text-zinc-100 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Key className="w-5 h-5 text-purple-400" />
            <h2 className="text-lg font-semibold text-zinc-100">Impostazioni AI & Chiavi</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="py-4 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Chiave Google AI Studio (BYOK)
              </label>
              {apiKey && (
                <button
                  type="button"
                  onClick={handleTestKey}
                  disabled={isValidating}
                  className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1 transition"
                >
                  <RefreshCw className={`w-3 h-3 ${isValidating ? 'animate-spin' : ''}`} />
                  <span>Verifica Modelli</span>
                </button>
              )}
            </div>
            <div className="relative">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 font-mono"
              />
            </div>
            {validationMessage && (
              <p className="mt-1.5 text-xs text-purple-300 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 text-purple-400" />
                {validationMessage}
              </p>
            )}
            <p className="mt-1.5 text-xs text-zinc-400">
              La chiave è salvata nel tuo browser (`localStorage`) per l&apos;accesso diretto ad altissima quota.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-purple-400" />
              <span>Modello Predefinito</span>
            </label>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-purple-500 cursor-pointer"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} {m.isRecommended ? '★ (Consigliato)' : m.isPro ? '◆ (Pro)' : ''}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-zinc-500">
              {models.find((m) => m.id === selectedModel)?.description ||
                'Modello multimodale ottimizzato per sintesi e trascrizione.'}
            </p>
          </div>

          <div className="rounded-lg bg-zinc-950/60 border border-zinc-800 p-3 space-y-2 text-xs">
            <div className="flex items-center gap-2 text-emerald-400 font-medium">
              <ShieldCheck className="w-4 h-4" />
              <span>Elaborazione Audio Multimodale Diretta</span>
            </div>
            <p className="text-zinc-400">
              Usa i motori multimodali per trascrizione audio nativa, calcolo matematico LaTeX e sintesi ad alta fedeltà accademica.
            </p>
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-purple-400 hover:text-purple-300 font-medium transition"
            >
              Ottieni una chiave gratuita su Google AI Studio
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-zinc-800">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
          >
            Annulla
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-900/30 transition"
          >
            {isSaved ? (
              <>
                <Check className="w-4 h-4" />
                Salvato!
              </>
            ) : (
              'Salva Impostazioni'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
