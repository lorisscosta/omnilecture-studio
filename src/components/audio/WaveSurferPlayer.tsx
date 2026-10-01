'use client';

import React, { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Play, Pause, RotateCcw, RotateCw, Volume2, VolumeX, Layers, BookmarkPlus, Bookmark, X, Check } from 'lucide-react';
import { AudioPart, LectureBookmark } from '@/lib/types';

export interface WaveSurferPlayerHandle {
  seekTo: (seconds: number, partIndex?: number) => void;
  play: () => void;
  pause: () => void;
}

interface WaveSurferPlayerProps {
  audioBlob?: Blob;
  audioUrl?: string;
  audioParts?: AudioPart[];
  bookmarks?: LectureBookmark[];
  onTimeUpdate?: (currentTime: number) => void;
  onDurationChange?: (duration: number) => void;
  onPartChange?: (partIndex: number) => void;
  onAddBookmark?: (timeSeconds: number, partIndex: number, label: string, note?: string) => void;
  onRemoveBookmark?: (id: string) => void;
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export const WaveSurferPlayer = forwardRef<WaveSurferPlayerHandle, WaveSurferPlayerProps>(
  (
    {
      audioBlob,
      audioUrl,
      audioParts,
      bookmarks,
      onTimeUpdate,
      onDurationChange,
      onPartChange,
      onAddBookmark,
      onRemoveBookmark,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const wavesurferRef = useRef<WaveSurfer | null>(null);
    const [activePartIndex, setActivePartIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentPartTime, setCurrentPartTime] = useState(0);
    const [currentPartDuration, setCurrentPartDuration] = useState(0);
    const [playbackRate, setPlaybackRate] = useState(1.0);
    const [isMuted, setIsMuted] = useState(false);
    const [isReady, setIsReady] = useState(false);
    const [isBookmarkModalOpen, setIsBookmarkModalOpen] = useState(false);
    const [bookmarkLabel, setBookmarkLabel] = useState('');
    const [bookmarkNote, setBookmarkNote] = useState('');

    const pendingSeekRef = useRef<number | null>(null);

    const handleSaveBookmark = (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!bookmarkLabel.trim()) return;
      onAddBookmark?.(
        Math.round(currentPartTime),
        activePartIndex,
        bookmarkLabel.trim(),
        bookmarkNote.trim() || undefined
      );
      setBookmarkLabel('');
      setBookmarkNote('');
      setIsBookmarkModalOpen(false);
    };

    const hasMultipleParts = Boolean(audioParts && audioParts.length > 1);
    const totalDuration = audioParts && audioParts.length > 0
      ? audioParts.reduce((acc, p) => acc + (p.duration || 0), 0)
      : currentPartDuration;

    // Active blob: if multi-part, take from audioParts[activePartIndex]; otherwise audioBlob
    const currentAudioBlob = audioParts && audioParts[activePartIndex]
      ? audioParts[activePartIndex].audioBlob
      : audioBlob;

    const currentStartOffset = audioParts && audioParts[activePartIndex]
      ? audioParts[activePartIndex].startOffset
      : 0;

    const continuousCurrentTime = currentStartOffset + currentPartTime;

    const onTimeUpdateRef = useRef(onTimeUpdate);
    onTimeUpdateRef.current = onTimeUpdate;

    const onDurationChangeRef = useRef(onDurationChange);
    onDurationChangeRef.current = onDurationChange;

    const onPartChangeRef = useRef(onPartChange);
    onPartChangeRef.current = onPartChange;

    useEffect(() => {
      onPartChangeRef.current?.(activePartIndex);
    }, [activePartIndex]);

    const playbackRateRef = useRef(playbackRate);
    playbackRateRef.current = playbackRate;

    const isMutedRef = useRef(isMuted);
    isMutedRef.current = isMuted;

    // Speed options
    const speeds = [0.8, 1.0, 1.25, 1.5, 2.0];

    // Handle Seeking across single or multiple parts
    const handleSeekTo = useCallback(
      (seconds: number, partIndex?: number) => {
        if (typeof partIndex === 'number' && audioParts && audioParts[partIndex]) {
          const targetPart = audioParts[partIndex];
          if (partIndex !== activePartIndex) {
            pendingSeekRef.current = seconds;
            setActivePartIndex(partIndex);
          } else {
            if (wavesurferRef.current && currentPartDuration > 0) {
              const progress = Math.min(Math.max(seconds / currentPartDuration, 0), 1);
              wavesurferRef.current.seekTo(progress);
              if (!isPlaying) {
                wavesurferRef.current.play();
                setIsPlaying(true);
              }
            }
          }
          return;
        }

        if (!audioParts || audioParts.length <= 1) {
          // Single audio behavior
          if (wavesurferRef.current && currentPartDuration > 0) {
            const progress = Math.min(Math.max(seconds / currentPartDuration, 0), 1);
            wavesurferRef.current.seekTo(progress);
            if (!isPlaying) {
              wavesurferRef.current.play();
              setIsPlaying(true);
            }
          }
          return;
        }

        // Multi-part seeking: determine which part contains `seconds`
        let targetIdx = audioParts.findIndex(
          (p) => seconds >= p.startOffset && seconds < p.startOffset + p.duration
        );
        if (targetIdx === -1) {
          targetIdx = seconds >= totalDuration ? audioParts.length - 1 : 0;
        }

        const targetPart = audioParts[targetIdx];
        const relativeSec = Math.max(0, seconds - (targetPart?.startOffset || 0));

        if (targetIdx !== activePartIndex) {
          pendingSeekRef.current = relativeSec;
          setActivePartIndex(targetIdx);
        } else {
          if (wavesurferRef.current && currentPartDuration > 0) {
            const progress = Math.min(Math.max(relativeSec / currentPartDuration, 0), 1);
            wavesurferRef.current.seekTo(progress);
            if (!isPlaying) {
              wavesurferRef.current.play();
              setIsPlaying(true);
            }
          }
        }
      },
      [activePartIndex, audioParts, currentPartDuration, isPlaying, totalDuration]
    );

    // Expose control methods via ref
    useImperativeHandle(
      ref,
      () => ({
        seekTo: handleSeekTo,
        play: () => {
          wavesurferRef.current?.play();
          setIsPlaying(true);
        },
        pause: () => {
          wavesurferRef.current?.pause();
          setIsPlaying(false);
        },
      }),
      [handleSeekTo]
    );

    // Stable key representing the active audio track to avoid recreating WaveSurfer on parent re-renders
    const currentTrackKey = React.useMemo(() => {
      if (audioParts && audioParts[activePartIndex]) {
        const p = audioParts[activePartIndex];
        return `part_${activePartIndex}_${p.id || p.fileName}_${p.fileSize}`;
      }
      if (currentAudioBlob) {
        const name = (currentAudioBlob as File).name || 'audio';
        return `blob_${name}_${currentAudioBlob.size}`;
      }
      return audioUrl || '';
    }, [audioParts, activePartIndex, currentAudioBlob, audioUrl]);

    const audioPartsRef = useRef(audioParts);
    audioPartsRef.current = audioParts;

    const currentAudioBlobRef = useRef(currentAudioBlob);
    currentAudioBlobRef.current = currentAudioBlob;

    // Initialize WaveSurfer for active audio part / blob
    useEffect(() => {
      if (!containerRef.current || !currentTrackKey) return;

      let objectUrl: string | null = null;
      let targetSource = audioUrl;

      const blobToLoad = currentAudioBlobRef.current;
      if (blobToLoad) {
        objectUrl = URL.createObjectURL(blobToLoad);
        targetSource = objectUrl;
      }

      if (!targetSource) return;

      setIsReady(false);

      const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;

      const ws = WaveSurfer.create({
        container: containerRef.current,
        waveColor: '#475569',
        progressColor: '#8b5cf6',
        cursorColor: '#c084fc',
        cursorWidth: 2,
        barWidth: 3,
        barGap: 2,
        barRadius: 3,
        height: isMobile ? 48 : 64,
        normalize: true,
      });

      wavesurferRef.current = ws;

      ws.load(targetSource);

      ws.on('ready', () => {
        setIsReady(true);
        const dur = ws.getDuration();
        setCurrentPartDuration(dur);
        if (!hasMultipleParts) {
          onDurationChangeRef.current?.(dur);
        } else if (totalDuration > 0) {
          onDurationChangeRef.current?.(totalDuration);
        }

        // Apply playback rate
        ws.setPlaybackRate(playbackRateRef.current);
        if (isMutedRef.current) ws.setVolume(0);

        // Check if pending seek waiting
        if (pendingSeekRef.current !== null && dur > 0) {
          const seekProgress = Math.min(Math.max(pendingSeekRef.current / dur, 0), 1);
          ws.seekTo(seekProgress);
          pendingSeekRef.current = null;
          ws.play();
          setIsPlaying(true);
        }
      });

      ws.on('timeupdate', (time) => {
        setCurrentPartTime(time);
        const continuous = currentStartOffset + time;
        onTimeUpdateRef.current?.(continuous);
      });

      ws.on('play', () => setIsPlaying(true));
      ws.on('pause', () => setIsPlaying(false));

      ws.on('finish', () => {
        // Auto-advance to next part if available!
        const currentParts = audioPartsRef.current;
        if (hasMultipleParts && currentParts && activePartIndex < currentParts.length - 1) {
          pendingSeekRef.current = 0;
          setActivePartIndex((prev) => prev + 1);
        } else {
          setIsPlaying(false);
        }
      });

      return () => {
        ws.destroy();
        wavesurferRef.current = null;
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
        }
      };
    }, [currentTrackKey, audioUrl, activePartIndex, currentStartOffset, hasMultipleParts, totalDuration]);

    // Fast updates without recreating WaveSurfer instance
    useEffect(() => {
      if (wavesurferRef.current) {
        wavesurferRef.current.setPlaybackRate(playbackRate);
      }
    }, [playbackRate]);

    useEffect(() => {
      if (wavesurferRef.current) {
        wavesurferRef.current.setVolume(isMuted ? 0 : 1);
      }
    }, [isMuted]);

    // Screen Wake Lock API: Keep mobile/tablet screen awake during lecture playback
    useEffect(() => {
      let wakeLock: any = null;
      let isCancelled = false;

      const requestWakeLock = async () => {
        if (
          typeof navigator !== 'undefined' &&
          'wakeLock' in navigator &&
          isPlaying &&
          typeof document !== 'undefined' &&
          !document.hidden
        ) {
          try {
            wakeLock = await (navigator as any).wakeLock.request('screen');
          } catch {
            // Silently ignore if wake lock cannot be granted (e.g. low battery)
          }
        }
      };

      if (isPlaying) {
        requestWakeLock();
      }

      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible' && isPlaying && !isCancelled) {
          requestWakeLock();
        }
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        isCancelled = true;
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        if (wakeLock) {
          wakeLock.release().catch(() => {});
          wakeLock = null;
        }
      };
    }, [isPlaying]);

    // Handle Play / Pause
    const togglePlay = useCallback(() => {
      if (!wavesurferRef.current) return;
      wavesurferRef.current.playPause();
    }, []);

    // Handle Speed Change
    const handleSpeedChange = (speed: number) => {
      setPlaybackRate(speed);
      if (wavesurferRef.current) {
        wavesurferRef.current.setPlaybackRate(speed);
      }
    };

    // Handle Skip +/- 5s
    const skipTime = (offset: number) => {
      if (!wavesurferRef.current || currentPartDuration <= 0) return;
      const newTime = Math.min(Math.max(currentPartTime + offset, 0), currentPartDuration);
      wavesurferRef.current.seekTo(newTime / currentPartDuration);
    };

    // Handle Mute
    const toggleMute = () => {
      if (!wavesurferRef.current) return;
      const nextMuted = !isMuted;
      setIsMuted(nextMuted);
      wavesurferRef.current.setVolume(nextMuted ? 0 : 1);
    };

    return (
      <div className="bg-zinc-900 border border-obsidian-border rounded-xl p-3 sm:p-4 shadow-xl text-zinc-100">
        {/* Multi-part tabs selector */}
        {hasMultipleParts && audioParts && (
          <div className="flex items-center gap-1.5 mb-2.5 overflow-x-auto pb-1 text-xs no-scrollbar">
            <span className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider shrink-0 mr-1 flex items-center gap-1">
              <Layers className="w-3.5 h-3.5 text-purple-400" />
              <span>Parti ({audioParts.length}):</span>
            </span>
            {audioParts.map((part, idx) => {
              const isActive = idx === activePartIndex;
              const startStr = formatTime(part.startOffset);
              const endStr = formatTime(part.startOffset + part.duration);

              return (
                <button
                  key={part.id || idx}
                  onClick={() => {
                    if (idx !== activePartIndex) {
                      pendingSeekRef.current = 0;
                      setActivePartIndex(idx);
                    }
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition shrink-0 border ${
                    isActive
                      ? 'bg-purple-600 border-purple-500 text-white shadow-sm'
                      : 'bg-zinc-800/80 border-zinc-700/80 text-zinc-300 hover:bg-zinc-800 hover:text-white'
                  }`}
                  title={`Passa alla Parte ${idx + 1} (${startStr} - ${endStr})`}
                >
                  <span className="font-bold">Parte {idx + 1}</span>
                  <span className="text-[10px] opacity-80 font-mono">({startStr} - {endStr})</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Waveform Canvas */}
        <div className="relative mb-2.5 sm:mb-3">
          {!isReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/80 backdrop-blur-sm z-10 text-xs text-zinc-400">
              Caricamento forma d&apos;onda audio...
            </div>
          )}
          <div ref={containerRef} className="w-full cursor-pointer" />
        </div>

        {/* Controls and Timers */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 pt-2 border-t border-zinc-800">
          {/* Row 1 on mobile: Main Playback Controls + Timers */}
          <div className="flex flex-wrap items-center justify-between sm:justify-start gap-2">
            <div className="flex items-center gap-1.5 sm:gap-2">
              {/* -5s button */}
              <button
                onClick={() => skipTime(-5)}
                disabled={!isReady}
                title="Indietro di 5 secondi"
                className="p-2 sm:p-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition disabled:opacity-40 touch-manipulation active:scale-95"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              {/* Play/Pause */}
              <button
                onClick={togglePlay}
                disabled={!isReady}
                title={isPlaying ? 'Pausa' : 'Riproduci'}
                className="p-2.5 sm:p-3 rounded-full bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-900/30 transition transform active:scale-95 disabled:opacity-40 touch-manipulation"
              >
                {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
              </button>

              {/* +5s button */}
              <button
                onClick={() => skipTime(5)}
                disabled={!isReady}
                title="Avanti di 5 secondi"
                className="p-2 sm:p-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition disabled:opacity-40 touch-manipulation active:scale-95"
              >
                <RotateCw className="w-4 h-4" />
              </button>
              {/* Add Bookmark button */}
              {onAddBookmark && (
                <button
                  type="button"
                  onClick={() => setIsBookmarkModalOpen(true)}
                  disabled={!isReady}
                  title="Aggiungi Segnalibro e Nota a questo timestamp"
                  className="p-2 sm:p-2.5 rounded-xl bg-purple-950/60 hover:bg-purple-900/80 border border-purple-800/60 text-purple-300 hover:text-white transition disabled:opacity-40 touch-manipulation active:scale-95"
                >
                  <BookmarkPlus className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Time display */}
            <div className="text-xs font-mono text-zinc-400 flex items-center gap-1.5 shrink-0">
              <span className="text-zinc-100 font-semibold">{formatTime(continuousCurrentTime)}</span>
              <span>/</span>
              <span>{formatTime(totalDuration)}</span>
              {hasMultipleParts && (
                <span className="text-[10px] text-purple-400 bg-purple-950/70 border border-purple-800/60 px-1.5 py-0.5 rounded font-sans">
                  P{activePartIndex + 1}/{audioParts?.length}
                </span>
              )}
            </div>
          </div>

          {/* Row 2 on mobile: Speed Toggles & Volume */}
          <div className="flex items-center justify-between sm:justify-end gap-2">
            {/* Speed Pills */}
            <div className="flex items-center bg-zinc-950 p-0.5 sm:p-1 rounded-lg border border-zinc-800">
              {speeds.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSpeedChange(s)}
                  className={`px-1.5 sm:px-2 py-1 text-[11px] sm:text-xs rounded font-medium transition ${
                    playbackRate === s
                      ? 'bg-purple-600 text-white shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>

            {/* Mute button */}
            <button
              onClick={toggleMute}
              className="p-1.5 sm:p-2 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition"
              title={isMuted ? 'Riattiva audio' : 'Muta audio'}
            >
              {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4 text-zinc-300" />}
            </button>
          </div>
        </div>

        {/* Bookmarks Carousel / Chips */}
        {bookmarks && bookmarks.length > 0 && (
          <div className="pt-2 border-t border-zinc-800/60 flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            <span className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider shrink-0 flex items-center gap-1 mr-1">
              <Bookmark className="w-3 h-3 text-purple-400" />
              Note ({bookmarks.length}):
            </span>
            {bookmarks.map((bm) => (
              <div
                key={bm.id}
                className="group flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-800/80 hover:bg-purple-950 border border-zinc-700 hover:border-purple-700 text-xs transition shrink-0 cursor-pointer"
                onClick={() => handleSeekTo(bm.timestampSeconds, bm.partIndex)}
                title={`P${bm.partIndex + 1} ${formatTime(bm.timestampSeconds)}: ${bm.note || bm.label}`}
              >
                <span className="font-mono text-purple-300 text-[10px] font-bold">
                  P{bm.partIndex + 1}:{formatTime(bm.timestampSeconds)}
                </span>
                <span className="text-zinc-200 truncate max-w-[120px] sm:max-w-[200px]">
                  {bm.label}
                </span>
                {onRemoveBookmark && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveBookmark(bm.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 text-zinc-400 hover:text-rose-400 transition"
                    title="Elimina nota"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Bookmark Modal */}
        {isBookmarkModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
            <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-5 max-w-sm w-full space-y-4 shadow-2xl">
              <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                <div className="flex items-center gap-2">
                  <BookmarkPlus className="w-4 h-4 text-purple-400" />
                  <h3 className="text-sm font-bold text-zinc-100">Aggiungi Segnalibro & Nota</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsBookmarkModalOpen(false)}
                  className="p-1 text-zinc-400 hover:text-zinc-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveBookmark} className="space-y-3">
                <div className="flex items-center justify-between text-xs text-zinc-400 bg-zinc-950 p-2 rounded-lg border border-zinc-800">
                  <span>Posizione Audio:</span>
                  <span className="font-mono text-purple-300 font-semibold">
                    {hasMultipleParts ? `Parte ${activePartIndex + 1} • ` : ''}
                    {formatTime(currentPartTime)}
                  </span>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-zinc-300 mb-1">
                    Titolo / Concetto chiave
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={bookmarkLabel}
                    onChange={(e) => setBookmarkLabel(e.target.value)}
                    placeholder="es. Teorema di convoluzione circolare"
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-zinc-300 mb-1">
                    Nota Personale (opzionale)
                  </label>
                  <textarea
                    rows={2}
                    value={bookmarkNote}
                    onChange={(e) => setBookmarkNote(e.target.value)}
                    placeholder="es. Domanda tipica d'esame. Rivedere la dimostrazione."
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500 resize-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsBookmarkModalOpen(false)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 transition"
                  >
                    Annulla
                  </button>
                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-purple-600 hover:bg-purple-500 transition shadow-md"
                  >
                    Salva Segnalibro
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }
);

WaveSurferPlayer.displayName = 'WaveSurferPlayer';
