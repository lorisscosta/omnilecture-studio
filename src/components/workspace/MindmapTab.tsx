'use client';

import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { ZoomIn, ZoomOut, RotateCcw, Network, AlertCircle, Copy, Check } from 'lucide-react';

interface MindmapTabProps {
  mindmapCode: string;
}

export const MindmapTab: React.FC<MindmapTabProps> = ({ mindmapCode }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>('');
  const [zoomLevel, setZoomLevel] = useState(1);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'dark',
      themeVariables: {
        darkMode: true,
        background: '#18181b',
        primaryColor: '#7c3aed',
        primaryTextColor: '#f3f4f6',
        primaryBorderColor: '#8b5cf6',
        lineColor: '#a78bfa',
        secondaryColor: '#312e81',
        tertiaryColor: '#27272a',
      },
      fontFamily: 'Inter, system-ui, sans-serif',
      securityLevel: 'loose',
    });

    if (!mindmapCode || !mindmapCode.trim()) {
      setSvgContent('');
      return;
    }

    let isMounted = true;
    const renderId = 'mermaid-' + Math.random().toString(36).substring(2, 9);

    // Clean up markdown fences if present in AI output
    let cleanCode = mindmapCode.trim();
    if (cleanCode.startsWith('```mermaid')) {
      cleanCode = cleanCode.replace(/^```mermaid/, '').replace(/```$/, '').trim();
    } else if (cleanCode.startsWith('```')) {
      cleanCode = cleanCode.replace(/^```/, '').replace(/```$/, '').trim();
    }

    mermaid
      .render(renderId, cleanCode)
      .then(({ svg }) => {
        if (isMounted) {
          setSvgContent(svg);
          setRenderError(null);
        }
      })
      .catch((err) => {
        console.warn('Mermaid rendering failed:', err);
        if (isMounted) {
          setRenderError('Impossibile renderizzare il diagramma Mermaid. Visualizzazione del codice sorgente.');
        }
      });

    return () => {
      isMounted = false;
    };
  }, [mindmapCode]);

  const handleZoomIn = () => setZoomLevel((z) => Math.min(z + 0.15, 2.5));
  const handleZoomOut = () => setZoomLevel((z) => Math.max(z - 0.15, 0.5));
  const handleResetZoom = () => setZoomLevel(1);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(mindmapCode);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-4 py-2">
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-zinc-900 border border-obsidian-border rounded-xl p-3 shadow-md">
        <div className="flex items-center gap-2">
          <Network className="w-5 h-5 text-purple-400" />
          <h2 className="text-base font-bold text-zinc-100">
            Mappa Concettuale della Lezione
          </h2>
          <span className="text-xs bg-purple-950 text-purple-300 border border-purple-800/60 px-2 py-0.5 rounded-full">
            Mermaid.js
          </span>
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyCode}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 transition"
            title="Copia codice Mermaid"
          >
            {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{isCopied ? 'Copiato' : 'Copia Sintassi'}</span>
          </button>

          <div className="h-4 w-px bg-zinc-700 mx-1" />

          <button
            onClick={handleZoomOut}
            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition"
            title="Rimpicciolisci"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs font-mono text-zinc-400 w-12 text-center">
            {Math.round(zoomLevel * 100)}%
          </span>
          <button
            onClick={handleZoomIn}
            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition"
            title="Ingrandisci"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={handleResetZoom}
            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition"
            title="Reimposta zoom (100%)"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Render Canvas or Source fallback */}
      <div className="rounded-2xl border border-obsidian-border bg-zinc-950 p-6 shadow-xl min-h-[460px] overflow-auto flex items-center justify-center relative">
        {renderError ? (
          <div className="w-full space-y-3">
            <div className="flex items-center gap-2 text-rose-400 text-xs">
              <AlertCircle className="w-4 h-4" />
              <span>{renderError}</span>
            </div>
            <pre className="p-4 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-purple-300 font-mono overflow-x-auto">
              {mindmapCode}
            </pre>
          </div>
        ) : svgContent ? (
          <div
            ref={containerRef}
            style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'top center' }}
            className="transition-transform duration-100 ease-out max-w-none flex items-center justify-center"
            dangerouslySetInnerHTML={{ __html: svgContent }}
          />
        ) : (
          <div className="text-zinc-500 text-sm italic">
            Nessuna mappa concettuale disponibile per questa lezione.
          </div>
        )}
      </div>
    </div>
  );
};
