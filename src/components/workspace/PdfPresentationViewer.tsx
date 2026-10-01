'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { SlideAlignment, AudioPart } from '@/lib/types';
import { getSlideTimes, findActiveSlideIndex } from '@/lib/slides-sync';
import {
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  Maximize2,
  Minimize2,
  Volume2,
  VolumeX,
  Sparkles,
  Upload,
  Pin,
  Clock,
  Layers,
  FileText,
  Loader2,
  Check,
} from 'lucide-react';

interface PdfPresentationViewerProps {
  pdfBlob?: Blob;
  pdfFileName?: string;
  slidesAlignment: SlideAlignment[];
  currentTime: number;
  currentPartIndex?: number;
  audioParts?: AudioPart[];
  totalDuration?: number;
  onSeek: (seconds: number, partIndex?: number) => void;
  onAttachPdf?: (file: File) => void;
  onAdjustSlideTime?: (slideNumber: number, offsetSeconds: number) => void;
  onPinSlideTime?: (slideNumber: number) => void;
}

function formatTime(totalSeconds: number): string {
  if (isNaN(totalSeconds) || totalSeconds < 0) return '00:00';
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export const PdfPresentationViewer: React.FC<PdfPresentationViewerProps> = ({
  pdfBlob,
  pdfFileName,
  slidesAlignment,
  currentTime,
  currentPartIndex = 0,
  audioParts,
  totalDuration = 0,
  onSeek,
  onAttachPdf,
  onAdjustSlideTime,
  onPinSlideTime,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [isLoadingPdf, setIsLoadingPdf] = useState(false);
  const [isRenderingPage, setIsRenderingPage] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isAutoSyncEnabled, setIsAutoSyncEnabled] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Active rendering task reference to cancel when page flips rapidly
  const renderTaskRef = useRef<any>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  // Find which slide corresponds to the current audio playback position
  const activeAudioSlideIndex = useMemo(
    () => findActiveSlideIndex(slidesAlignment, currentTime, currentPartIndex, audioParts),
    [slidesAlignment, currentTime, currentPartIndex, audioParts]
  );

  const activeAudioSlide = useMemo(() => {
    if (activeAudioSlideIndex >= 0 && activeAudioSlideIndex < slidesAlignment.length) {
      return slidesAlignment[activeAudioSlideIndex];
    }
    return null;
  }, [activeAudioSlideIndex, slidesAlignment]);

  // Current slide metadata based on viewed page
  const currentSlideMeta = useMemo(() => {
    return slidesAlignment.find((s) => s.slide_number === currentPage);
  }, [slidesAlignment, currentPage]);

  // Initialize PDF.js and load document
  useEffect(() => {
    let isCancelled = false;

    if (!pdfBlob) {
      setPdfDoc(null);
      setTotalPages(0);
      return;
    }

    const loadPdf = async () => {
      setIsLoadingPdf(true);
      setRenderError(null);

      try {
        const pdfjsLib = await import('pdfjs-dist');
        if (typeof window !== 'undefined') {
          try {
            pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
          } catch {
            pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
          }
        }

        const arrayBuffer = await pdfBlob.arrayBuffer();
        if (isCancelled) return;

        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const loadedDoc = await loadingTask.promise;

        if (isCancelled) return;
        setPdfDoc(loadedDoc);
        setTotalPages(loadedDoc.numPages);
        setCurrentPage((prev) => (prev > loadedDoc.numPages ? 1 : prev));
      } catch (err: any) {
        if (!isCancelled) {
          console.error('Errore nel caricamento del file PDF:', err);
          setRenderError('Impossibile caricare o visualizzare il PDF delle slide.');
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingPdf(false);
        }
      }
    };

    loadPdf();

    return () => {
      isCancelled = true;
    };
  }, [pdfBlob]);

  // Render current page to canvas with high resolution
  const renderCurrentPage = useCallback(async () => {
    if (!pdfDoc || !canvasRef.current) return;

    if (renderTaskRef.current) {
      try {
        renderTaskRef.current.cancel();
      } catch {
        // Ignore cancellation error
      }
    }

    setIsRenderingPage(true);
    try {
      const page = await pdfDoc.getPage(currentPage);
      const canvas = canvasRef.current;
      if (!canvas) return;

      const containerWidth = containerRef.current?.clientWidth || 800;
      // Desired CSS display width
      const targetWidth = Math.min(containerWidth - 32, 1100);
      const initialViewport = page.getViewport({ scale: 1.0 });
      const scale = Math.max(0.5, targetWidth / initialViewport.width);
      const viewport = page.getViewport({ scale });

      const pixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      canvas.width = Math.floor(viewport.width * pixelRatio);
      canvas.height = Math.floor(viewport.height * pixelRatio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.save();
      ctx.scale(pixelRatio, pixelRatio);

      const renderContext = {
        canvasContext: ctx,
        viewport,
      };

      const renderTask = page.render(renderContext);
      renderTaskRef.current = renderTask;
      await renderTask.promise;
      ctx.restore();
    } catch (err: any) {
      if (err?.name !== 'RenderingCancelledException') {
        console.warn('Errore di rendering della pagina PDF:', err);
      }
    } finally {
      setIsRenderingPage(false);
    }
  }, [pdfDoc, currentPage]);

  useEffect(() => {
    renderCurrentPage();
  }, [renderCurrentPage]);

  // Re-render on container resize
  useEffect(() => {
    const handleResize = () => {
      renderCurrentPage();
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [renderCurrentPage]);

  // Auto-sync: Advance PDF slide as audio plays (when AutoSync is ON)
  useEffect(() => {
    if (!isAutoSyncEnabled) return;
    if (activeAudioSlide && activeAudioSlide.slide_number !== currentPage) {
      if (activeAudioSlide.slide_number >= 1 && (!totalPages || activeAudioSlide.slide_number <= totalPages)) {
        setCurrentPage(activeAudioSlide.slide_number);
      }
    }
  }, [activeAudioSlide, isAutoSyncEnabled, totalPages, currentPage]);

  // User-driven slide navigation: "scorrendo le pagine parte l'audio riferito a quella pagina"
  const goToPage = useCallback(
    (pageNumber: number, triggerAudio = true) => {
      const maxPage = totalPages || slidesAlignment.length || 1;
      const targetPage = Math.max(1, Math.min(pageNumber, maxPage));
      setCurrentPage(targetPage);

      if (triggerAudio) {
        // Find matching slide alignment
        const matched = slidesAlignment.find((s) => s.slide_number === targetPage);
        if (matched) {
          const times = getSlideTimes(matched, audioParts);
          onSeek(times.relativeStart, matched.part ?? currentPartIndex);
          showToast(`Audio sincronizzato: Slide ${targetPage} (${formatTime(times.relativeStart)})`);
        } else if (totalDuration > 0 && totalPages > 0) {
          // Fallback estimation if this specific slide has no AI alignment record
          const estimatedSec = Math.round(((targetPage - 1) / totalPages) * totalDuration);
          onSeek(estimatedSec, currentPartIndex);
          showToast(`Audio stimato: Slide ${targetPage} (${formatTime(estimatedSec)})`);
        }
      }
    },
    [totalPages, slidesAlignment, audioParts, currentPartIndex, totalDuration, onSeek]
  );

  const handlePrevPage = () => {
    if (currentPage > 1) {
      goToPage(currentPage - 1, true);
    }
  };

  const handleNextPage = () => {
    const maxPage = totalPages || slidesAlignment.length || 1;
    if (currentPage < maxPage) {
      goToPage(currentPage + 1, true);
    }
  };

  const handlePrevPageRef = useRef(handlePrevPage);
  handlePrevPageRef.current = handlePrevPage;

  const handleNextPageRef = useRef(handleNextPage);
  handleNextPageRef.current = handleNextPage;

  // Keyboard navigation for presentation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return;
      }

      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        handleNextPageRef.current();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        handlePrevPageRef.current();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Toggle fullscreen
  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(console.warn);
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(console.warn);
    }
  };

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        onAttachPdf?.(file);
      }
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onAttachPdf?.(e.target.files[0]);
    }
  };

  // If no PDF is loaded yet, show the presentation setup dropzone
  if (!pdfBlob) {
    return (
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleFileDrop}
        className="p-8 sm:p-12 rounded-2xl bg-zinc-900 border-2 border-dashed border-zinc-800 hover:border-purple-600/70 transition text-center space-y-4 max-w-2xl mx-auto my-6"
      >
        <div className="w-16 h-16 mx-auto rounded-2xl bg-purple-950/80 border border-purple-800/60 flex items-center justify-center text-purple-400">
          <Layers className="w-8 h-8" />
        </div>
        <div className="space-y-2">
          <h3 className="text-lg font-bold text-zinc-100">Modalità Presentazione PowerPoint Sincronizzata</h3>
          <p className="text-xs text-zinc-400 max-w-md mx-auto leading-relaxed">
            Visualizza direttamente il documento PDF delle slide con navigazione a pagina intera: scorrendo le pagine l&apos;audio parte automaticamente al secondo corrispondente.
          </p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          onChange={handleFileInputChange}
          className="hidden"
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-950/40 transition"
        >
          <Upload className="w-4 h-4" />
          <span>Carica PDF Slide per la Presentazione</span>
        </button>

        {pdfFileName && (
          <p className="text-[11px] text-zinc-500 font-mono">
            File di riferimento: {pdfFileName}
          </p>
        )}
      </div>
    );
  }

  const times = currentSlideMeta ? getSlideTimes(currentSlideMeta, audioParts) : null;
  const isPlayingThisSlide = activeAudioSlide?.slide_number === currentPage;

  return (
    <div
      ref={containerRef}
      className={`flex flex-col bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl relative select-none ${
        isFullscreen ? 'fixed inset-0 z-50 rounded-none border-none' : ''
      }`}
    >
      {/* Toast Feedback */}
      {toastMessage && (
        <div className="absolute top-16 right-6 z-50 bg-purple-900/90 backdrop-blur-md border border-purple-500 text-white text-xs font-semibold px-4 py-2.5 rounded-xl shadow-2xl animate-in fade-in flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Presentation Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 bg-zinc-900 border-b border-zinc-800/80 text-zinc-200">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-purple-950/80 border border-purple-800/60 px-2.5 py-1 rounded-lg">
            <span className="text-xs font-mono font-bold text-purple-300">
              Slide {currentPage} / {totalPages || slidesAlignment.length || 1}
            </span>
            {isPlayingThisSlide && (
              <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium pl-1 border-l border-purple-800/60 animate-pulse">
                <Sparkles className="w-3 h-3" />
                In Audio
              </span>
            )}
          </div>

          {currentSlideMeta && (
            <h3 className="text-xs font-semibold text-zinc-300 truncate max-w-[200px] sm:max-w-md hidden sm:block">
              {currentSlideMeta.title}
            </h3>
          )}
        </div>

        {/* Toolbar Controls */}
        <div className="flex items-center gap-2">
          {/* Auto-sync Toggle */}
          <button
            type="button"
            onClick={() => {
              setIsAutoSyncEnabled(!isAutoSyncEnabled);
              showToast(
                !isAutoSyncEnabled
                  ? 'Sincronizzazione automatica audio attivata'
                  : 'Sincronizzazione automatica audio in pausa'
              );
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition ${
              isAutoSyncEnabled
                ? 'bg-emerald-950/60 border-emerald-700/80 text-emerald-300'
                : 'bg-zinc-800 border-zinc-700 text-zinc-400'
            }`}
            title="Se attivo, la presentazione avanza automaticamente seguendo l'audio"
          >
            <Clock className="w-3.5 h-3.5" />
            <span className="hidden md:inline">
              Auto-sync: {isAutoSyncEnabled ? 'Attivo' : 'Pausa'}
            </span>
          </button>

          {/* Change PDF */}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={handleFileInputChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white border border-zinc-700 transition"
            title="Cambia file PDF delle slide"
          >
            <Upload className="w-3.5 h-3.5" />
          </button>

          {/* Fullscreen */}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white border border-zinc-700 transition"
            title={isFullscreen ? 'Esci da schermo intero' : 'Presentazione a schermo intero'}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Main Slide Canvas Stage */}
      <div className="relative flex-1 min-h-[380px] sm:min-h-[520px] bg-zinc-950 flex items-center justify-center p-3 sm:p-6 overflow-hidden group">
        {/* Loading overlay */}
        {(isLoadingPdf || isRenderingPage) && (
          <div className="absolute inset-0 z-20 bg-zinc-950/60 backdrop-blur-sm flex items-center justify-center gap-2 text-xs text-purple-300">
            <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
            <span>Rendering slide {currentPage}...</span>
          </div>
        )}

        {/* Error message */}
        {renderError && (
          <div className="text-center p-6 text-red-400 text-xs space-y-2">
            <p>{renderError}</p>
          </div>
        )}

        {/* Slide Canvas */}
        <div className="relative shadow-2xl rounded-lg overflow-hidden border border-zinc-800/80 bg-zinc-900">
          <canvas ref={canvasRef} className="block max-w-full max-h-[75vh] object-contain transition-opacity" />
        </div>

        {/* Big Side Arrow Overlays (PowerPoint style) */}
        <button
          type="button"
          onClick={handlePrevPage}
          disabled={currentPage <= 1}
          className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-zinc-900/80 hover:bg-purple-600/90 text-white flex items-center justify-center backdrop-blur-md border border-zinc-700/80 shadow-xl opacity-0 group-hover:opacity-100 transition-all disabled:opacity-0 disabled:pointer-events-none hover:scale-105 active:scale-95"
          title="Slide precedente (Tasto freccia sinistra)"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>

        <button
          type="button"
          onClick={handleNextPage}
          disabled={currentPage >= (totalPages || slidesAlignment.length || 1)}
          className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-zinc-900/80 hover:bg-purple-600/90 text-white flex items-center justify-center backdrop-blur-md border border-zinc-700/80 shadow-xl opacity-0 group-hover:opacity-100 transition-all disabled:opacity-0 disabled:pointer-events-none hover:scale-105 active:scale-95"
          title="Slide successiva (Tasto freccia destra)"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      </div>

      {/* Bottom Interactive Control Deck */}
      <div className="bg-zinc-900 border-t border-zinc-800 p-3 sm:p-4 space-y-3">
        {/* Navigation & Playback Row */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Previous / Next buttons & Slider */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrevPage}
              disabled={currentPage <= 1}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-800 hover:bg-purple-600 text-zinc-200 hover:text-white border border-zinc-700 disabled:opacity-40 disabled:hover:bg-zinc-800 disabled:hover:text-zinc-200 transition"
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Precedente</span>
            </button>

            <span className="text-xs font-mono text-zinc-300 px-2">
              {currentPage} / {totalPages || slidesAlignment.length || 1}
            </span>

            <button
              type="button"
              onClick={handleNextPage}
              disabled={currentPage >= (totalPages || slidesAlignment.length || 1)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-800 hover:bg-purple-600 text-zinc-200 hover:text-white border border-zinc-700 disabled:opacity-40 disabled:hover:bg-zinc-800 disabled:hover:text-zinc-200 transition"
            >
              <span className="hidden sm:inline">Successiva</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Audio Seek & Play Button for Current Slide */}
          <div className="flex items-center gap-2">
            {times ? (
              <button
                type="button"
                onClick={() => {
                  onSeek(times.relativeStart, currentSlideMeta?.part ?? currentPartIndex);
                  showToast(`Riproduzione slide ${currentPage}: ${formatTime(times.relativeStart)}`);
                }}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition shadow-md ${
                  isPlayingThisSlide
                    ? 'bg-purple-600 text-white shadow-purple-900/50'
                    : 'bg-zinc-800 hover:bg-purple-600 text-zinc-200 hover:text-white border border-zinc-700'
                }`}
                title="Ascolta la spiegazione del docente per questa specifica slide"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>
                  {(currentSlideMeta?.part ?? 0) > 0 ? `P${(currentSlideMeta?.part ?? 0) + 1}: ` : ''}
                  {formatTime(times.relativeStart)} - {formatTime(times.relativeEnd)}
                </span>
              </button>
            ) : (
              <span className="text-[11px] text-zinc-500 font-mono">
                Slide non ancora associata a timestamp
              </span>
            )}

            {/* Quick manual timestamp adjustments for this slide */}
            {currentSlideMeta && (
              <div className="flex items-center gap-1 border-l border-zinc-800 pl-2">
                <button
                  type="button"
                  onClick={() => onAdjustSlideTime?.(currentPage, -15)}
                  className="px-1.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white text-[10px] font-mono border border-zinc-700 transition"
                  title="Anticipa inizio audio di 15 secondi"
                >
                  -15s
                </button>
                <button
                  type="button"
                  onClick={() => onAdjustSlideTime?.(currentPage, 15)}
                  className="px-1.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white text-[10px] font-mono border border-zinc-700 transition"
                  title="Posticipa inizio audio di 15 secondi"
                >
                  +15s
                </button>
                <button
                  type="button"
                  onClick={() => onPinSlideTime?.(currentPage)}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-purple-950/70 hover:bg-purple-900 border border-purple-800/60 text-purple-300 hover:text-white text-[10px] transition"
                  title="Fissa inizio audio al punto attualmente in riproduzione"
                >
                  <Pin className="w-2.5 h-2.5" />
                  <span className="hidden sm:inline">Fissa a tempo</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Current Slide Info Card (Title + Summary) */}
        {currentSlideMeta && (
          <div className="p-2.5 sm:p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/80 text-xs">
            <h4 className="font-semibold text-zinc-200 line-clamp-1 mb-1">
              {currentSlideMeta.title}
            </h4>
            <p className="text-zinc-400 text-[11px] leading-relaxed line-clamp-2">
              {currentSlideMeta.summary}
            </p>
          </div>
        )}

        {/* Filmstrip / Slide Thumbnails Carousel */}
        <div className="pt-1 overflow-x-auto pb-1 flex items-center gap-1.5 scrollbar-thin">
          {Array.from({ length: totalPages || slidesAlignment.length || 1 }).map((_, idx) => {
            const pageNum = idx + 1;
            const slide = slidesAlignment.find((s) => s.slide_number === pageNum);
            const isSelected = currentPage === pageNum;
            const isPlaying = activeAudioSlide?.slide_number === pageNum;

            return (
              <button
                key={pageNum}
                type="button"
                onClick={() => goToPage(pageNum, true)}
                className={`flex-shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-mono transition text-left flex flex-col justify-between border ${
                  isSelected
                    ? 'bg-purple-600 text-white border-purple-400 shadow-md scale-105'
                    : isPlaying
                    ? 'bg-emerald-950/70 text-emerald-300 border-emerald-700/80'
                    : 'bg-zinc-950/80 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 border-zinc-800'
                }`}
                title={slide?.title || `Slide ${pageNum}`}
              >
                <div className="flex items-center gap-1 text-[11px] font-bold">
                  <span>{pageNum}</span>
                  {isPlaying && <Sparkles className="w-2.5 h-2.5 text-emerald-400 animate-pulse" />}
                </div>
                {slide && (
                  <span className="text-[9px] opacity-80 truncate max-w-[60px]">
                    {formatTime(slide.start_time_seconds)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
