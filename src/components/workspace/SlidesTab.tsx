'use client';

import React, { useState } from 'react';
import { SlideAlignment } from '@/lib/types';
import {
  FileText,
  Play,
  Clock,
  Search,
  ExternalLink,
  Presentation,
  Sparkles,
} from 'lucide-react';

interface SlidesTabProps {
  slidesAlignment?: SlideAlignment[];
  slidesFileName?: string;
  hasSlides?: boolean;
  currentTime?: number;
  currentPartIndex?: number;
  onSeek?: (seconds: number, partIndex?: number) => void;
  onOpenSlidesModal?: () => void;
}

function formatTime(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export const SlidesTab: React.FC<SlidesTabProps> = ({
  slidesAlignment = [],
  slidesFileName,
  hasSlides = false,
  currentTime = 0,
  currentPartIndex = 0,
  onSeek,
  onOpenSlidesModal,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredSlides = slidesAlignment.filter((slide) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      slide.title.toLowerCase().includes(query) ||
      slide.summary.toLowerCase().includes(query) ||
      slide.slide_number.toString().includes(query)
    );
  });

  if (!hasSlides && slidesAlignment.length === 0) {
    return (
      <div className="text-center py-16 px-4 bg-zinc-900/60 border border-zinc-800 rounded-2xl max-w-xl mx-auto space-y-4">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-purple-950/80 border border-purple-800/60 flex items-center justify-center text-purple-400">
          <Presentation className="w-7 h-7" />
        </div>
        <div className="space-y-1">
          <h3 className="text-base font-bold text-zinc-100">Nessuna Slide Collegata</h3>
          <p className="text-xs text-zinc-400 max-w-md mx-auto">
            Carica il PDF delle slide per ottenere l&apos;allineamento temporale sincronizzato con la registrazione e i riferimenti puntuali.
          </p>
        </div>
        {onOpenSlidesModal && (
          <button
            onClick={onOpenSlidesModal}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white shadow-md shadow-purple-950/40 transition"
          >
            <FileText className="w-4 h-4" />
            <span>Allega Slide PDF</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4 rounded-xl bg-zinc-900 border border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-purple-950/80 border border-purple-800/60 text-purple-400 shrink-0">
            <Presentation className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-zinc-100">Allineamento Multimodale Slide</h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-950 text-purple-300 border border-purple-800">
                {slidesAlignment.length} slide
              </span>
            </div>
            {slidesFileName && (
              <p className="text-xs text-zinc-400 font-mono truncate max-w-xs sm:max-w-md mt-0.5">
                {slidesFileName}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative flex-1 sm:w-60">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              placeholder="Cerca slide o argomento..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-purple-600"
            />
          </div>

          {onOpenSlidesModal && (
            <button
              onClick={onOpenSlidesModal}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition shrink-0"
              title="Apri gestione e visualizzatore Markdown (.md)"
            >
              <ExternalLink className="w-3.5 h-3.5 text-purple-400" />
              <span className="hidden sm:inline">Markdown</span>
            </button>
          )}
        </div>
      </div>

      {/* Slide Timeline Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {filteredSlides.map((slide) => {
          const isPartMatch = slide.part === currentPartIndex;
          const isActive =
            isPartMatch &&
            currentTime >= slide.start_time_seconds &&
            currentTime <= slide.end_time_seconds;

          return (
            <div
              key={`${slide.part}-${slide.slide_number}-${slide.start_time_seconds}`}
              onClick={() => onSeek?.(slide.start_time_seconds, slide.part)}
              className={`p-4 rounded-xl border transition cursor-pointer flex flex-col justify-between group ${
                isActive
                  ? 'bg-purple-950/40 border-purple-500 shadow-lg shadow-purple-950/50 ring-1 ring-purple-500/40'
                  : 'bg-zinc-900/80 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900'
              }`}
            >
              <div>
                {/* Top Row: Slide badge + Time seek pill */}
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-md text-xs font-bold font-mono bg-purple-950 text-purple-300 border border-purple-800">
                      Slide {slide.slide_number}
                    </span>
                    {isActive && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-950/80 border border-emerald-800/80 px-2 py-0.5 rounded-full animate-pulse">
                        <Sparkles className="w-3 h-3" />
                        In Riproduzione
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSeek?.(slide.start_time_seconds, slide.part);
                    }}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono font-medium transition ${
                      isActive
                        ? 'bg-purple-600 text-white shadow-md'
                        : 'bg-zinc-800 text-zinc-300 hover:bg-purple-600 hover:text-white border border-zinc-700'
                    }`}
                    title={`Vai a ${formatTime(slide.start_time_seconds)} (Parte ${slide.part + 1})`}
                  >
                    <Play className="w-3 h-3 fill-current" />
                    <span>
                      {slide.part > 0 ? `P${slide.part + 1}: ` : ''}
                      {formatTime(slide.start_time_seconds)} - {formatTime(slide.end_time_seconds)}
                    </span>
                  </button>
                </div>

                {/* Slide Title */}
                <h4 className="text-sm font-semibold text-zinc-100 group-hover:text-purple-300 transition line-clamp-1 mb-1.5">
                  {slide.title}
                </h4>

                {/* Slide Summary */}
                <p className="text-xs text-zinc-400 leading-relaxed line-clamp-3">
                  {slide.summary}
                </p>
              </div>

              {/* Bottom Info Bar */}
              <div className="pt-3 mt-3 border-t border-zinc-800/60 flex items-center justify-between text-[11px] text-zinc-500">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-zinc-400" />
                  Durata discussa: ~{Math.max(1, Math.round((slide.end_time_seconds - slide.start_time_seconds) / 60))} min
                </span>
                <span className="text-purple-400 group-hover:translate-x-0.5 transition-transform text-xs font-medium">
                  Ascolta spiegazione &rarr;
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
