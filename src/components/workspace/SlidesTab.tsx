'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { SlideAlignment, AudioPart, TranscriptSegment } from '@/lib/types';
import {
  getSlideTimes,
  findActiveSlideIndex,
  adjustSlideTimestamps,
  clampAndNormalizeSlideTimestamps,
} from '@/lib/slides-sync';
import { realignSlidesWithGemini } from '@/lib/gemini-service';
import { PdfPresentationViewer } from './PdfPresentationViewer';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer';
import {
  FileText,
  Play,
  Clock,
  Search,
  Presentation,
  Sparkles,
  RefreshCw,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Pin,
  Check,
  LayoutGrid,
  FileCode,
} from 'lucide-react';

interface SlidesTabProps {
  slidesBlob?: Blob;
  slidesAlignment?: SlideAlignment[];
  slidesFileName?: string;
  hasSlides?: boolean;
  currentTime?: number;
  currentPartIndex?: number;
  audioParts?: AudioPart[];
  totalDuration?: number;
  transcript?: TranscriptSegment[];
  slidesMarkdown?: string;
  lectureTitle?: string;
  course?: string;
  onSeek?: (seconds: number, partIndex?: number) => void;
  onOpenSlidesModal?: () => void;
  onUpdateSlides?: (updatedSlides: SlideAlignment[]) => Promise<void> | void;
  onAttachPdf?: (file: File) => Promise<void> | void;
}

function formatTime(totalSeconds: number): string {
  if (isNaN(totalSeconds) || totalSeconds < 0) return '00:00';
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export const SlidesTab: React.FC<SlidesTabProps> = ({
  slidesBlob,
  slidesAlignment = [],
  slidesFileName,
  hasSlides = false,
  currentTime = 0,
  currentPartIndex = 0,
  audioParts,
  totalDuration = 0,
  transcript = [],
  slidesMarkdown,
  lectureTitle = '',
  course = '',
  onSeek,
  onOpenSlidesModal,
  onUpdateSlides,
  onAttachPdf,
}) => {
  const [viewMode, setViewMode] = useState<'presentation' | 'grid' | 'markdown'>(
    slidesBlob ? 'presentation' : 'grid'
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [isRealigning, setIsRealigning] = useState(false);
  const [realignStatus, setRealignStatus] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // If a PDF blob is provided or becomes available, switch to presentation mode
  useEffect(() => {
    if (slidesBlob) {
      setViewMode('presentation');
    }
  }, [slidesBlob]);

  // Auto-heal / normalize any slide alignment where timestamps severely exceed total audio duration
  useEffect(() => {
    if (totalDuration > 0 && slidesAlignment.length > 0) {
      const maxEnd = Math.max(...slidesAlignment.map((s) => s.end_time_seconds || 0), 0);
      if (maxEnd > totalDuration + 10) {
        const normalized = clampAndNormalizeSlideTimestamps(slidesAlignment, totalDuration);
        const isIdentical =
          normalized.length === slidesAlignment.length &&
          normalized.every((norm, i) => {
            const orig = slidesAlignment[i];
            return (
              norm.slide_number === orig.slide_number &&
              norm.start_time_seconds === orig.start_time_seconds &&
              norm.end_time_seconds === orig.end_time_seconds &&
              norm.status === orig.status &&
              norm.needs_review === orig.needs_review
            );
          });
        if (!isIdentical) {
          onUpdateSlides?.(normalized);
        }
      }
    }
  }, [totalDuration, slidesAlignment, onUpdateSlides]);

  const activeIndex = useMemo(
    () => findActiveSlideIndex(slidesAlignment, currentTime, currentPartIndex, audioParts),
    [slidesAlignment, currentTime, currentPartIndex, audioParts]
  );

  const filteredSlides = useMemo(() => {
    return slidesAlignment.filter((slide) => {
      if (!searchQuery.trim()) return true;
      const query = searchQuery.toLowerCase();
      return (
        slide.title.toLowerCase().includes(query) ||
        slide.summary.toLowerCase().includes(query) ||
        slide.slide_number.toString().includes(query)
      );
    });
  }, [slidesAlignment, searchQuery]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Adjust timestamp for a single slide (+/- offset seconds)
  const handleShiftTime = async (
    slideNumber: number,
    offsetSeconds: number,
    e?: React.MouseEvent
  ) => {
    e?.stopPropagation();
    const target = slidesAlignment.find((s) => s.slide_number === slideNumber);
    if (!target) return;

    const times = getSlideTimes(target, audioParts);
    const newStart = Math.max(0, times.relativeStart + offsetSeconds);
    const newEnd = Math.max(newStart, times.relativeEnd + offsetSeconds);

    const updated = adjustSlideTimestamps(slidesAlignment, slideNumber, newStart, newEnd);
    await onUpdateSlides?.(updated);
    showToast(`Slide ${slideNumber}: tempo regolato a ${formatTime(newStart)}`);
  };

  // Pin slide start time to current audio playback position
  const handlePinCurrentTime = async (slideNumber: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const target = slidesAlignment.find((s) => s.slide_number === slideNumber);
    if (!target) return;

    const partOffset =
      audioParts && audioParts[currentPartIndex] ? audioParts[currentPartIndex].startOffset : 0;
    const relativeCurrentTime = Math.max(0, Math.round(currentTime - partOffset));

    const times = getSlideTimes(target, audioParts);
    const duration = Math.max(30, times.relativeEnd - times.relativeStart);
    const newEnd = relativeCurrentTime + duration;

    const updated = adjustSlideTimestamps(slidesAlignment, slideNumber, relativeCurrentTime, newEnd);
    await onUpdateSlides?.(updated);
    showToast(`Slide ${slideNumber} fissata a ${formatTime(relativeCurrentTime)}`);
  };

  // Run AI Re-alignment with transcript and strict duration boundary
  const handleRealignAI = async () => {
    const apiKey = typeof window !== 'undefined' ? localStorage.getItem('gemini_api_key') : null;
    if (!apiKey) {
      alert('Chiave API Gemini mancante. Configurala nelle impostazioni.');
      return;
    }

    if (!slidesMarkdown || transcript.length === 0) {
      alert('Trascrizione o contenuto slide mancante per eseguire il riallineamento.');
      return;
    }

    if (
      !confirm(
        `Vuoi ricalcolare la sincronizzazione temporale delle slide con la trascrizione audio${
          totalDuration > 0 ? ` (durata massima: ${formatTime(totalDuration)})` : ''
        }?`
      )
    ) {
      return;
    }

    setIsRealigning(true);
    setRealignStatus('Confronto semantico trascrizione e slide con vincolo di durata audio...');

    try {
      const realigned = await realignSlidesWithGemini(
        transcript,
        slidesMarkdown,
        course,
        lectureTitle,
        apiKey,
        (stage) => setRealignStatus(stage),
        totalDuration
      );

      await onUpdateSlides?.(realigned);
      showToast('Sincronizzazione slide aggiornata con successo!');
    } catch (err: any) {
      console.error('Riallineamento slide fallito:', err);
      alert('Errore durante il riallineamento: ' + err.message);
    } finally {
      setIsRealigning(false);
      setRealignStatus(null);
    }
  };

  if (!hasSlides && slidesAlignment.length === 0 && !slidesBlob) {
    return (
      <div className="text-center py-16 px-4 bg-zinc-900/60 border border-zinc-800 rounded-2xl max-w-xl mx-auto space-y-4">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-purple-950/80 border border-purple-800/60 flex items-center justify-center text-purple-400">
          <Presentation className="w-7 h-7" />
        </div>
        <div className="space-y-1">
          <h3 className="text-base font-bold text-zinc-100">Nessuna Slide Collegata</h3>
          <p className="text-xs text-zinc-400 max-w-md mx-auto">
            Carica il PDF delle slide per ottenere la presentazione sincronizzata in stile PowerPoint con audio contestuale e navigazione rapida.
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
      {/* Toast Feedback */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-purple-900 border border-purple-500 text-white text-xs font-semibold px-4 py-2.5 rounded-xl shadow-2xl animate-in fade-in flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3.5 sm:p-4 rounded-xl bg-zinc-900 border border-zinc-800 shadow-md">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-purple-950/80 border border-purple-800/60 text-purple-400 shrink-0">
            <Presentation className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-zinc-100">Slide Lezione & Presentazione</h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-950 text-purple-300 border border-purple-800">
                {slidesAlignment.length} slide
              </span>
              {totalDuration > 0 && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">
                  Audio: {formatTime(totalDuration)}
                </span>
              )}
            </div>
            {slidesFileName && (
              <p className="text-xs text-zinc-400 font-mono truncate max-w-xs sm:max-w-md mt-0.5">
                {slidesFileName}
              </p>
            )}
          </div>
        </div>

        {/* Action Controls & View Switcher */}
        <div className="flex flex-wrap items-center gap-2">
          {/* View Mode Selector */}
          <div className="flex items-center p-0.5 bg-zinc-950 border border-zinc-800 rounded-lg">
            <button
              type="button"
              onClick={() => setViewMode('presentation')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition ${
                viewMode === 'presentation'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Presentazione interattiva a schermo / pagina sincronizzata con audio"
            >
              <Presentation className="w-3.5 h-3.5" />
              <span>Presentazione</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition ${
                viewMode === 'grid'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Visualizzazione a griglia con timeline delle slide"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Griglia</span>
            </button>
            {slidesMarkdown && (
              <button
                type="button"
                onClick={() => setViewMode('markdown')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition ${
                  viewMode === 'markdown'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title="Visualizzazione testo Markdown delle slide"
              >
                <FileCode className="w-3.5 h-3.5" />
                <span>Markdown</span>
              </button>
            )}
          </div>

          {/* AI Re-alignment Button */}
          {transcript.length > 0 && slidesMarkdown && (
            <button
              onClick={handleRealignAI}
              disabled={isRealigning}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white shadow-md shadow-purple-950/40 transition shrink-0 disabled:opacity-50"
              title="Ricalcola la sincronizzazione di ogni slide basandosi esattamente sui secondi dell'audio"
            >
              {isRealigning ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              <span>{isRealigning ? 'Riallineamento...' : 'Riallinea con AI'}</span>
            </button>
          )}

          {onOpenSlidesModal && (
            <button
              onClick={onOpenSlidesModal}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition shrink-0"
              title="Gestisci file o converti slide PDF"
            >
              <FileText className="w-3.5 h-3.5 text-purple-400" />
              <span className="hidden sm:inline">Gestione File</span>
            </button>
          )}
        </div>
      </div>

      {/* Progress banner during AI re-alignment */}
      {isRealigning && (
        <div className="flex items-center gap-2.5 p-3 rounded-xl bg-purple-950/50 border border-purple-800/60 text-xs text-purple-200 animate-pulse">
          <Loader2 className="w-4 h-4 animate-spin text-purple-400 shrink-0" />
          <span>{realignStatus || 'Ricalcolo della sincronizzazione audio in corso...'}</span>
        </div>
      )}

      {/* VIEW MODE 1: PowerPoint Presentation View */}
      {viewMode === 'presentation' && (
        <PdfPresentationViewer
          pdfBlob={slidesBlob}
          pdfFileName={slidesFileName}
          slidesAlignment={slidesAlignment}
          currentTime={currentTime}
          currentPartIndex={currentPartIndex}
          audioParts={audioParts}
          totalDuration={totalDuration}
          onSeek={(sec, pIdx) => onSeek?.(sec, pIdx)}
          onAttachPdf={onAttachPdf}
          onAdjustSlideTime={(num, offset) => handleShiftTime(num, offset)}
          onPinSlideTime={(num) => handlePinCurrentTime(num)}
        />
      )}

      {/* VIEW MODE 2: Card Grid View */}
      {viewMode === 'grid' && (
        <div className="space-y-4">
          {/* Search bar */}
          <div className="relative max-w-sm">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              placeholder="Cerca slide o argomento..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-purple-600"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5 sm:gap-4">
            {filteredSlides.map((slide) => {
              const originalIndex = slidesAlignment.findIndex(
                (s) => s.slide_number === slide.slide_number && s.part === slide.part
              );
              const isActive = originalIndex === activeIndex;
              const times = getSlideTimes(slide, audioParts);

              return (
                <div
                  key={`${slide.part}-${slide.slide_number}-${slide.start_time_seconds}`}
                  onClick={() => onSeek?.(times.relativeStart, slide.part ?? currentPartIndex)}
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
                          onSeek?.(times.relativeStart, slide.part ?? currentPartIndex);
                        }}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono font-medium transition ${
                          isActive
                            ? 'bg-purple-600 text-white shadow-md'
                            : 'bg-zinc-800 text-zinc-300 hover:bg-purple-600 hover:text-white border border-zinc-700'
                        }`}
                        title={`Vai a ${formatTime(times.relativeStart)} (Parte ${(slide.part ?? 0) + 1})`}
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>
                          {(slide.part ?? 0) > 0 ? `P${(slide.part ?? 0) + 1}: ` : ''}
                          {formatTime(times.relativeStart)} - {formatTime(times.relativeEnd)}
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

                  {/* Bottom Row: Manual Timestamp Adjustment Controls */}
                  <div className="pt-3 mt-3 border-t border-zinc-800/60 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => handleShiftTime(slide.slide_number, -15, e)}
                        className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white text-[10px] font-mono border border-zinc-700 transition"
                        title="Anticipa inizio di 15 secondi"
                      >
                        -15s
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleShiftTime(slide.slide_number, 15, e)}
                        className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white text-[10px] font-mono border border-zinc-700 transition"
                        title="Posticipa inizio di 15 secondi"
                      >
                        +15s
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handlePinCurrentTime(slide.slide_number, e)}
                        className="flex items-center gap-1 px-2 py-0.5 rounded bg-purple-950/70 hover:bg-purple-900 border border-purple-800/60 text-purple-300 hover:text-white text-[10px] transition"
                        title="Fissa l'inizio di questa slide al timestamp audio attualmente in riproduzione"
                      >
                        <Pin className="w-2.5 h-2.5" />
                        <span>Fissa a tempo</span>
                      </button>
                    </div>

                    <span className="text-purple-400 group-hover:translate-x-0.5 transition-transform text-[11px] font-medium hidden sm:inline">
                      Ascolta &rarr;
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* VIEW MODE 3: Markdown Document View */}
      {viewMode === 'markdown' && slidesMarkdown && (
        <div className="p-4 sm:p-6 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-md">
          <MarkdownRenderer content={slidesMarkdown} />
        </div>
      )}
    </div>
  );
};
