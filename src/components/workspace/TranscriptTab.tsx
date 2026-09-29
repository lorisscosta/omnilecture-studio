'use client';

import React, { useState, useEffect, useRef } from 'react';
import { TranscriptSegment } from '@/lib/types';
import { Play, Search, Volume2, AlignLeft, ListFilter, Copy, Check } from 'lucide-react';

interface TranscriptTabProps {
  segments: TranscriptSegment[];
  currentTime: number;
  onSeek: (seconds: number) => void;
}

function formatSeconds(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export const TranscriptTab: React.FC<TranscriptTabProps> = ({ segments, currentTime, onSeek }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'bilingual' | 'en' | 'it'>('bilingual');
  const [layoutMode, setLayoutMode] = useState<'timestamped' | 'continuous'>('timestamped');
  const [autoScroll, setAutoScroll] = useState(true);
  const [isCopied, setIsCopied] = useState(false);
  const activeItemRef = useRef<HTMLDivElement>(null);

  // Determine active segment based on currentTime
  const activeIndex = segments.findIndex(
    (seg) => currentTime >= seg.start && currentTime <= (seg.end || seg.start + 5)
  );

  // Auto scroll to active item in timestamped mode
  useEffect(() => {
    if (layoutMode === 'timestamped' && autoScroll && activeItemRef.current) {
      activeItemRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [activeIndex, autoScroll, layoutMode]);

  const filteredSegments = segments.filter((seg) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return seg.text_en.toLowerCase().includes(q) || seg.text_it.toLowerCase().includes(q);
  });

  // Build continuous text for copying or continuous reading
  const continuousText = filteredSegments
    .map((seg) => {
      if (viewMode === 'it') return seg.text_it;
      if (viewMode === 'en') return seg.text_en;
      return `${seg.text_en}\n(Traduzione IT: ${seg.text_it})`;
    })
    .join('\n\n');

  const handleCopyContinuous = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(continuousText);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = continuousText;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy continuous text:', err);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-4 py-2">
      {/* Search, Layout and Display Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-zinc-900 border border-obsidian-border rounded-xl p-3 shadow-md">
        {/* Search */}
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cerca nella trascrizione..."
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-700 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-purple-500"
          />
        </div>

        {/* Layout Switcher: Timestamped vs Continuous */}
        <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800">
          <button
            onClick={() => setLayoutMode('timestamped')}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded font-medium transition ${
              layoutMode === 'timestamped'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
            title="Mostra intervalli temporali e player sync"
          >
            <ListFilter className="w-3.5 h-3.5" />
            <span>Segmenti Temporizzati</span>
          </button>
          <button
            onClick={() => setLayoutMode('continuous')}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded font-medium transition ${
              layoutMode === 'continuous'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
            title="Mostra come testo unico continuo senza interruzioni di tempo"
          >
            <AlignLeft className="w-3.5 h-3.5" />
            <span>Testo Continuo (Senza Tempo)</span>
          </button>
        </div>

        {/* Language View Mode Toggle */}
        <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800">
          <button
            onClick={() => setViewMode('bilingual')}
            className={`px-2 py-1 text-xs rounded font-medium transition ${
              viewMode === 'bilingual' ? 'bg-purple-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Bilingue
          </button>
          <button
            onClick={() => setViewMode('it')}
            className={`px-2 py-1 text-xs rounded font-medium transition ${
              viewMode === 'it' ? 'bg-purple-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Solo Italiano
          </button>
          <button
            onClick={() => setViewMode('en')}
            className={`px-2 py-1 text-xs rounded font-medium transition ${
              viewMode === 'en' ? 'bg-purple-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Solo Originale
          </button>
        </div>

        {/* Auto Scroll Checkbox (only in timestamped mode) */}
        {layoutMode === 'timestamped' && (
          <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded border-zinc-700 bg-zinc-900 text-purple-600 focus:ring-0"
            />
            <span>Auto-scroll</span>
          </label>
        )}

        {/* Copy Continuous Text Button (available in continuous mode) */}
        {layoutMode === 'continuous' && (
          <button
            onClick={handleCopyContinuous}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded font-medium transition ${
              isCopied
                ? 'bg-emerald-600 text-white'
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
            }`}
            title="Copia tutto il testo continuo negli appunti"
          >
            {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{isCopied ? 'Copiato!' : 'Copia Testo'}</span>
          </button>
        )}
      </div>

      {/* Mode 1: Continuous Full Text (Senza Intervalli Temporali) */}
      {layoutMode === 'continuous' ? (
        <div className="bg-zinc-900/90 border border-obsidian-border rounded-2xl p-6 md:p-8 shadow-xl">
          <div className="flex items-center justify-between pb-4 mb-4 border-b border-zinc-800">
            <div>
              <h3 className="text-base font-bold text-zinc-100 flex items-center gap-2">
                <span>📜</span> Trascrizione Unica e Continua
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Lettura fluida dell&apos;intera lezione come testo continuo privo di interruzioni temporali.
              </p>
            </div>
            <span className="text-xs font-mono text-purple-400 bg-purple-950/80 px-2 py-0.5 rounded border border-purple-800/50">
              {filteredSegments.length} paragrafi
            </span>
          </div>

          <div className="space-y-4 max-h-[700px] overflow-y-auto pr-2 leading-relaxed text-zinc-200">
            {filteredSegments.length === 0 ? (
              <p className="text-center py-8 text-zinc-500 text-sm">
                Nessun contenuto trovato per la ricerca.
              </p>
            ) : (
              filteredSegments.map((seg, idx) => (
                <div key={idx} className="pb-3 border-b border-zinc-800/50 last:border-none">
                  {(viewMode === 'bilingual' || viewMode === 'it') && (
                    <p className="text-sm text-zinc-100 leading-relaxed font-sans">
                      {seg.text_it}
                    </p>
                  )}
                  {(viewMode === 'bilingual' || viewMode === 'en') && (
                    <p
                      className={`text-xs text-zinc-400 leading-relaxed ${
                        viewMode === 'bilingual' ? 'mt-1 italic opacity-85' : 'text-sm text-zinc-200'
                      }`}
                    >
                      {viewMode === 'bilingual' ? `🇬🇧 ${seg.text_en}` : seg.text_en}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        /* Mode 2: Standard Timestamped Segments */
        <div className="space-y-3">
          {filteredSegments.length === 0 ? (
            <div className="text-center py-12 text-zinc-500 text-sm">
              Nessun segmento trovato per la ricerca.
            </div>
          ) : (
            filteredSegments.map((seg, idx) => {
              const isActive = segments.indexOf(seg) === activeIndex;

              return (
                <div
                  key={idx}
                  ref={isActive ? activeItemRef : null}
                  onClick={() => onSeek(seg.start)}
                  className={`group cursor-pointer rounded-xl p-4 transition border ${
                    isActive
                      ? 'bg-purple-950/40 border-purple-500/70 shadow-lg shadow-purple-950/50'
                      : 'bg-zinc-900/60 border-zinc-800/80 hover:bg-zinc-800/60 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      {/* Timestamp Pill */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSeek(seg.start);
                        }}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-medium transition ${
                          isActive
                            ? 'bg-purple-600 text-white shadow-sm'
                            : 'bg-zinc-800 text-purple-300 group-hover:bg-purple-900/50 group-hover:text-purple-200'
                        }`}
                        title="Salta a questo punto dell'audio"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>{formatSeconds(seg.start)}</span>
                      </button>

                      <span className="text-xs font-semibold text-zinc-400">
                        {seg.speaker || 'Docente'}
                      </span>
                    </div>

                    {isActive && (
                      <span className="flex items-center gap-1 text-[10px] text-purple-300 font-semibold uppercase tracking-wider bg-purple-950/80 px-2 py-0.5 rounded border border-purple-800/50">
                        <Volume2 className="w-3 h-3 animate-pulse text-purple-400" />
                        In riproduzione
                      </span>
                    )}
                  </div>

                  {/* English Text */}
                  {(viewMode === 'bilingual' || viewMode === 'en') && (
                    <p className="text-sm text-zinc-200 leading-relaxed font-sans mb-1.5">
                      {seg.text_en}
                    </p>
                  )}

                  {/* Italian Translation */}
                  {(viewMode === 'bilingual' || viewMode === 'it') && (
                    <p className="text-xs text-zinc-400 leading-relaxed italic border-t border-zinc-800/60 pt-1.5 mt-1">
                      🇮🇹 {seg.text_it}
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
