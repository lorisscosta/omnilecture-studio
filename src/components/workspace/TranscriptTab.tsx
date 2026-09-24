'use client';

import React, { useState, useEffect, useRef } from 'react';
import { TranscriptSegment } from '@/lib/types';
import { Play, Search, Languages, Volume2 } from 'lucide-react';

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
  const [autoScroll, setAutoScroll] = useState(true);
  const activeItemRef = useRef<HTMLDivElement>(null);

  // Determine active segment based on currentTime
  const activeIndex = segments.findIndex(
    (seg) => currentTime >= seg.start && currentTime <= (seg.end || seg.start + 5)
  );

  // Auto scroll to active item
  useEffect(() => {
    if (autoScroll && activeItemRef.current) {
      activeItemRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [activeIndex, autoScroll]);

  const filteredSegments = segments.filter((seg) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return seg.text_en.toLowerCase().includes(q) || seg.text_it.toLowerCase().includes(q);
  });

  return (
    <div className="max-w-4xl mx-auto space-y-4 py-2">
      {/* Search and Display Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-zinc-900 border border-obsidian-border rounded-xl p-3 shadow-md">
        {/* Search */}
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cerca nella trascrizione..."
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-700 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-purple-500"
          />
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800">
          <button
            onClick={() => setViewMode('bilingual')}
            className={`px-2.5 py-1 text-xs rounded font-medium transition ${
              viewMode === 'bilingual' ? 'bg-purple-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Bilingue (EN/IT)
          </button>
          <button
            onClick={() => setViewMode('en')}
            className={`px-2.5 py-1 text-xs rounded font-medium transition ${
              viewMode === 'en' ? 'bg-purple-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Solo Inglese
          </button>
          <button
            onClick={() => setViewMode('it')}
            className={`px-2.5 py-1 text-xs rounded font-medium transition ${
              viewMode === 'it' ? 'bg-purple-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Solo Italiano
          </button>
        </div>

        {/* Auto Scroll Checkbox */}
        <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="rounded border-zinc-700 bg-zinc-900 text-purple-600 focus:ring-0"
          />
          <span>Auto-scroll</span>
        </label>
      </div>

      {/* Transcript Segments List */}
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
    </div>
  );
};
