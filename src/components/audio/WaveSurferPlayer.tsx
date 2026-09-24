'use client';

import React, { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Play, Pause, RotateCcw, RotateCw, Volume2, VolumeX } from 'lucide-react';

export interface WaveSurferPlayerHandle {
  seekTo: (seconds: number) => void;
  play: () => void;
  pause: () => void;
}

interface WaveSurferPlayerProps {
  audioBlob?: Blob;
  audioUrl?: string;
  onTimeUpdate?: (currentTime: number) => void;
  onDurationChange?: (duration: number) => void;
}

function formatTime(seconds: number): string {
  if (isNaN(seconds)) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export const WaveSurferPlayer = forwardRef<WaveSurferPlayerHandle, WaveSurferPlayerProps>(
  ({ audioBlob, audioUrl, onTimeUpdate, onDurationChange }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const wavesurferRef = useRef<WaveSurfer | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [playbackRate, setPlaybackRate] = useState(1.0);
    const [isMuted, setIsMuted] = useState(false);
    const [isReady, setIsReady] = useState(false);

    // Speed options
    const speeds = [0.8, 1.0, 1.25, 1.5, 2.0];

    // Expose control methods via ref
    useImperativeHandle(ref, () => ({
      seekTo: (seconds: number) => {
        if (wavesurferRef.current && duration > 0) {
          const progress = Math.min(Math.max(seconds / duration, 0), 1);
          wavesurferRef.current.seekTo(progress);
          if (!isPlaying) {
            wavesurferRef.current.play();
            setIsPlaying(true);
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
    }), [duration, isPlaying]);

    // Initialize WaveSurfer
    useEffect(() => {
      if (!containerRef.current) return;

      let objectUrl: string | null = null;
      let targetSource = audioUrl;

      if (audioBlob) {
        objectUrl = URL.createObjectURL(audioBlob);
        targetSource = objectUrl;
      }

      if (!targetSource) return;

      setIsReady(false);

      const ws = WaveSurfer.create({
        container: containerRef.current,
        waveColor: '#475569',
        progressColor: '#8b5cf6',
        cursorColor: '#c084fc',
        cursorWidth: 2,
        barWidth: 3,
        barGap: 2,
        barRadius: 3,
        height: 64,
        normalize: true,
      });

      wavesurferRef.current = ws;

      ws.load(targetSource);

      ws.on('ready', () => {
        setIsReady(true);
        const dur = ws.getDuration();
        setDuration(dur);
        onDurationChange?.(dur);
      });

      ws.on('timeupdate', (time) => {
        setCurrentTime(time);
        onTimeUpdate?.(time);
      });

      ws.on('play', () => setIsPlaying(true));
      ws.on('pause', () => setIsPlaying(false));
      ws.on('finish', () => setIsPlaying(false));

      return () => {
        ws.destroy();
        wavesurferRef.current = null;
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
        }
      };
    }, [audioBlob, audioUrl]);

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
      if (!wavesurferRef.current || duration <= 0) return;
      const newTime = Math.min(Math.max(currentTime + offset, 0), duration);
      wavesurferRef.current.seekTo(newTime / duration);
    };

    // Handle Mute
    const toggleMute = () => {
      if (!wavesurferRef.current) return;
      const nextMuted = !isMuted;
      setIsMuted(nextMuted);
      wavesurferRef.current.setVolume(nextMuted ? 0 : 1);
    };

    return (
      <div className="bg-zinc-900 border border-obsidian-border rounded-xl p-4 shadow-xl text-zinc-100">
        {/* Waveform Canvas */}
        <div className="relative mb-3">
          {!isReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/80 backdrop-blur-sm z-10 text-xs text-zinc-400">
              Caricamento forma d&apos;onda audio...
            </div>
          )}
          <div ref={containerRef} className="w-full cursor-pointer" />
        </div>

        {/* Controls and Timers */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-zinc-800">
          {/* Playback Controls */}
          <div className="flex items-center gap-2">
            {/* -5s button */}
            <button
              onClick={() => skipTime(-5)}
              disabled={!isReady}
              title="Indietro di 5 secondi"
              className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition disabled:opacity-40"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            {/* Play/Pause */}
            <button
              onClick={togglePlay}
              disabled={!isReady}
              title={isPlaying ? 'Pausa' : 'Riproduci'}
              className="p-3 rounded-full bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-900/30 transition transform active:scale-95 disabled:opacity-40"
            >
              {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
            </button>

            {/* +5s button */}
            <button
              onClick={() => skipTime(5)}
              disabled={!isReady}
              title="Avanti di 5 secondi"
              className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition disabled:opacity-40"
            >
              <RotateCw className="w-4 h-4" />
            </button>

            {/* Time display */}
            <div className="text-xs font-mono text-zinc-400 ml-2">
              <span className="text-zinc-100 font-semibold">{formatTime(currentTime)}</span>
              <span className="mx-1">/</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Speed Toggles & Volume */}
          <div className="flex items-center gap-2">
            {/* Speed Pills */}
            <div className="flex items-center bg-zinc-950 p-1 rounded-lg border border-zinc-800">
              {speeds.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSpeedChange(s)}
                  className={`px-2 py-1 text-xs rounded font-medium transition ${
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
              className="p-2 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition"
              title={isMuted ? 'Riattiva audio' : 'Muta audio'}
            >
              {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    );
  }
);

WaveSurferPlayer.displayName = 'WaveSurferPlayer';
