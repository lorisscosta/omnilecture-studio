'use client';

import React, { useState, useEffect } from 'react';
import { Key, X, Check, ExternalLink, ShieldCheck, AlertTriangle } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (key: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, onSaved }) => {
  const [apiKey, setApiKey] = useState('');
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('gemini_api_key') || '';
    setApiKey(saved);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    localStorage.setItem('gemini_api_key', apiKey.trim());
    setIsSaved(true);
    onSaved?.(apiKey.trim());
    setTimeout(() => {
      setIsSaved(false);
      onClose();
    }, 800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-zinc-900 border border-obsidian-border p-6 shadow-2xl text-zinc-100 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Key className="w-5 h-5 text-purple-400" />
            <h2 className="text-lg font-semibold text-zinc-100">Impostazioni API</h2>
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
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
              Chiave Google AI Studio (Gemini Flash / Pro)
            </label>
            <div className="relative">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 font-mono"
              />
            </div>
            <p className="mt-1.5 text-xs text-zinc-400">
              La chiave è memorizzata esclusivamente nel tuo browser (`localStorage`) e viene inviata alle route Next.js server-side per bypassare il blocco CORS.
            </p>
          </div>

          <div className="rounded-lg bg-zinc-950/60 border border-zinc-800 p-3 space-y-2 text-xs">
            <div className="flex items-center gap-2 text-emerald-400 font-medium">
              <ShieldCheck className="w-4 h-4" />
              <span>Elaborazione Audio Multimodale Diretta</span>
            </div>
            <p className="text-zinc-400">
              Usa i motori multimodali <strong>Gemini 2.0 Flash / 1.5 Flash / Pro</strong> per trascrizione audio nativa, calcolo matematico LaTeX e sintesi ad alta fedeltà accademica.
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
              'Salva Chiave'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
