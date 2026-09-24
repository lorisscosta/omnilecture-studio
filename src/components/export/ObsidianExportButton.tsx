'use client';

import React, { useState } from 'react';
import { Share2, Download, FolderArchive, Check, Loader2, AlertCircle } from 'lucide-react';
import { exportToObsidian, ExportResult } from '@/lib/export-vault';
import { Lecture } from '@/lib/types';

interface ObsidianExportButtonProps {
  lecture: Lecture;
}

export const ObsidianExportButton: React.FC<ObsidianExportButtonProps> = ({ lecture }) => {
  const [isExporting, setIsExporting] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);

  const handleExport = async () => {
    setIsExporting(true);
    setResult(null);

    try {
      const res = await exportToObsidian(lecture);
      setResult(res);
    } catch (err: any) {
      setResult({
        success: false,
        method: 'download',
        message: err.message || 'Errore durante l\'esportazione.',
      });
    } finally {
      setIsExporting(false);
      // Auto-clear message after 5 seconds if successful
      setTimeout(() => {
        setResult((prev) => (prev?.success ? null : prev));
      }, 5000);
    }
  };

  return (
    <div className="relative inline-block">
      <button
        onClick={handleExport}
        disabled={isExporting || !lecture.data}
        className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-purple-950/70 border border-purple-800/60 hover:bg-purple-900/80 text-purple-200 text-xs font-semibold shadow-md transition disabled:opacity-40 disabled:cursor-not-allowed"
        title="Esporta appunti in formato Markdown per Obsidian"
      >
        {isExporting ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Esportazione...</span>
          </>
        ) : (
          <>
            <FolderArchive className="w-3.5 h-3.5 text-purple-400" />
            <span>Esporta in Obsidian (.md)</span>
          </>
        )}
      </button>

      {/* Result notification popover */}
      {result && (
        <div
          className={`absolute right-0 top-full mt-2 w-72 p-3 rounded-xl border text-xs shadow-2xl z-30 animate-in fade-in zoom-in-95 ${
            result.success
              ? 'bg-zinc-900 border-emerald-500/50 text-emerald-300'
              : 'bg-zinc-900 border-rose-500/50 text-rose-300'
          }`}
        >
          <div className="flex items-start gap-2">
            {result.success ? (
              <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <p className="font-semibold">{result.success ? 'Esportato!' : 'Attenzione'}</p>
              <p className="mt-0.5 text-zinc-300 leading-normal">{result.message}</p>
              <p className="mt-1 text-[10px] text-zinc-400">
                Metodo: {result.method === 'directory-picker' ? 'Desktop Vault' : result.method === 'web-share' ? 'Condivisione Android/iOS' : 'Download File'}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
