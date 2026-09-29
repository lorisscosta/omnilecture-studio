'use client';

import React, { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Play, Pause, RotateCcw, RotateCw, Volume2, VolumeX, Layers } from 'lucide-react';
import { AudioPart } from '@/lib/types';

export interface WaveSurferPlayerHandle {
  seekTo: (seconds: number) => void;
  play: () => void;
  pause: () => void;
}

interface WaveSurferPlayerProps {
  audioBlob?: Blob;
  audioUrl?: string;
  audioParts?: AudioPart[];
  onTimeUpdate?: (currentTime: number) => void;
  onDurationChange?: (duration: number) => void;
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export const WaveSurferPlayer = forwardRef<WaveSurferPlayerHandle, WaveSurferPlayerProps>(
  ({ audioBlob, audioUrl, audioParts, onTimeUpdate, onDurationChange }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const wavesurferRef = useRef<WaveSurfer | null>(null);
    const [activePartIndex, setActivePartIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentPartTime, setCurrentPartTime] = useState(0);
    const [currentPartDuration, setCurrentPartDuration] = useState(0);
    const [playbackRate, setPlaybackRate] = useState(1.0);
    const [isMuted, setIsMuted] = useState(false);
    const [isReady, setIsReady] = useState(false);

    const pendingSeekRef = useRef<number | null>(null);

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

    // Speed options
    const speeds = [0.8, 1.0, 1.25, 1.5, 2.0];

    // Expose control methods via ref
    useImperativeHandle(ref, () => ({
      seekTo: (seconds: number) => {
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
      play: () => {
        wavesurferRef.current?.play();
        setIsPlaying(true);
      },
      pause: () => {
        wavesurferRef.current?.pause();
        setIsPlaying(false);
      },
    }), [currentPartDuration, isPlaying, audioParts, activePartIndex, totalDuration]);

    // Initialize WaveSurfer for active audio part / blob
    useEffect(() => {
      if (!containerRef.current) return;

      let objectUrl: string | null = null;
      let targetSource = audioUrl;

      if (currentAudioBlob) {
        objectUrl = URL.createObjectURL(currentAudioBlob);
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
          onDurationChange?.(dur);
        } else if (totalDuration > 0) {
          onDurationChange?.(totalDuration);
        }

        // Apply playback rate
        ws.setPlaybackRate(playbackRate);
        if (isMuted) ws.setVolume(0);

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
        onTimeUpdate?.(continuous);
      });

      ws.on('play', () => setIsPlaying(true));
      ws.on('pause', () => setIsPlaying(false));

      ws.on('finish', () => {
        // Auto-advance to next part if available!
        if (hasMultipleParts && audioParts && activePartIndex < audioParts.length - 1) {
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
    }, [currentAudioBlob, audioUrl, activePartIndex, currentStartOffset, hasMultipleParts, totalDuration]);

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
          <div className="flex items-center justify-between sm:justify-start gap-2">
            <div className="flex items-center gap-1.5 sm:gap-2">
              {/* -5s button */}
              <button
                onClick={() => skipTime(-5)}
                disabled={!isReady}
                title="Indietro di 5 secondi"
                className="p-2 sm:p-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition disabled:opacity-40"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              {/* Play/Pause */}
              <button
                onClick={togglePlay}
                disabled={!isReady}
                title={isPlaying ? 'Pausa' : 'Riproduci'}
                className="p-2.5 sm:p-3 rounded-full bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-900/30 transition transform active:scale-95 disabled:opacity-40"
              >
                {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
              </button>

              {/* +5s button */}
              <button
                onClick={() => skipTime(5)}
                disabled={!isReady}
                title="Avanti di 5 secondi"
                className="p-2 sm:p-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition disabled:opacity-40"
              >
                <RotateCw className="w-4 h-4" />
              </button>
            </div>

            {/* Time display */}
            <div className="text-xs font-mono text-zinc-400 flex items-center gap-1.5">
              <span className="text-zinc-100 font-semibold">{formatTime(continuousCurrentTime)}</span>
              <span>/</span>
              <span>{formatTime(totalDuration)}</span>
              {hasMultipleParts && (
                <span className="text-[10px] text-purple-400 bg-purple-950/70 border border-purple-800/60 px-1.5 py-0.5 rounded font-sans">
                  Parte {activePartIndex + 1}/{audioParts?.length}
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
      </div>
    );
  }
);

WaveSurferPlayer.displayName = 'WaveSurferPlayer';
