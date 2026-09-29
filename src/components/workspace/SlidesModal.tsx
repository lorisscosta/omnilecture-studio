'use client';

import React, { useState, useRef } from 'react';
import { Lecture } from '@/lib/types';
import {
  FileText,
  Upload,
  Check,
  Copy,
  Download,
  Sparkles,
  Loader2,
  AlertCircle,
  X,
  FileCode,
  Eye,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer';
import { convertPdfToMarkdown, enrichLectureWithSlides } from '@/lib/gemini-service';
import { updateLectureSlides, getLectureById } from '@/lib/db';

interface SlidesModalProps {
  isOpen: boolean;
  onClose: () => void;
  lecture: Lecture;
  onSlidesUpdated: (updatedLecture: Lecture) => void;
  onOpenSettings?: () => void;
}

export const SlidesModal: React.FC<SlidesModalProps> = ({
  isOpen,
  onClose,
  lecture,
  onSlidesUpdated,
  onOpenSettings,
}) => {
  const [selectedPdf, setSelectedPdf] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStage, setProcessingStage] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'upload' | 'preview'>(
    lecture.slidesMarkdown ? 'preview' : 'upload'
  );
  const [previewMode, setPreviewMode] = useState<'rendered' | 'raw'>('rendered');
  const [isCopied, setIsCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        setErrorMessage('Seleziona un file in formato PDF.');
        return;
      }
      setSelectedPdf(file);
      setErrorMessage(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        setErrorMessage('Seleziona un file in formato PDF.');
        return;
      }
      setSelectedPdf(file);
      setErrorMessage(null);
    }
  };

  const handleStartProcess = async () => {
    if (!selectedPdf) return;

    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) {
      setErrorMessage('Chiave API Google AI Studio non configurata. Inseriscila nelle impostazioni.');
      onOpenSettings?.();
      return;
    }

    if (!lecture.data) {
      setErrorMessage('I dati della lezione non sono ancora pronti per essere correlati.');
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);

    try {
      // Step 1: Convert PDF to Markdown (.md)
      setProcessingStage('Passo 1/2: Conversione slide PDF in Markdown (.md)...');
      const slidesMarkdown = await convertPdfToMarkdown(
        selectedPdf,
        selectedPdf.name,
        apiKey,
        (stage) => setProcessingStage(`Passo 1/2: ${stage}`)
      );

      // Step 2: Cross-reference with existing lecture data
      setProcessingStage('Passo 2/2: Correlazione con la registrazione e arricchimento Guida Overleaf LaTeX...');
      const enrichedData = await enrichLectureWithSlides(
        lecture.data,
        slidesMarkdown,
        lecture.course,
        lecture.title,
        apiKey,
        (stage) => setProcessingStage(`Passo 2/2: ${stage}`)
      );

      // Step 3: Save to Dexie DB
      await updateLectureSlides(
        lecture.id,
        selectedPdf.name,
        slidesMarkdown,
        enrichedData
      );

      const updated = await getLectureById(lecture.id);
      if (updated) {
        onSlidesUpdated(updated);
      }

      setIsProcessing(false);
      setSelectedPdf(null);
      setActiveTab('preview');
    } catch (err: any) {
      console.error('Errore durante l\'elaborazione delle slide:', err);
      setIsProcessing(false);
      setErrorMessage(err.message || 'Si è verificato un errore durante l\'integrazione delle slide.');
    }
  };

  const handleCopyMarkdown = async () => {
    if (!lecture.slidesMarkdown) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(lecture.slidesMarkdown);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = lecture.slidesMarkdown;
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
      console.error('Errore copia markdown:', err);
    }
  };

  const handleDownloadMarkdown = () => {
    if (!lecture.slidesMarkdown) return;
    const safeTitle = (lecture.title || 'slide_lezione')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_');
    const fileName = `${safeTitle}_slides.md`;
    const blob = new Blob([lecture.slidesMarkdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-4xl max-h-[94vh] sm:max-h-[90vh] flex flex-col rounded-2xl bg-zinc-950 border border-obsidian-border shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-3.5 sm:p-4 border-b border-zinc-800 bg-zinc-900/60">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="p-1.5 sm:p-2 rounded-xl bg-purple-950/80 border border-purple-800 text-purple-400">
              <FileText className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-zinc-100 flex items-center gap-1.5 sm:gap-2">
                <span>Slide della Lezione & Riferimenti</span>
                {lecture.hasSlides && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-800 text-emerald-300">
                    Collegate
                  </span>
                )}
              </h3>
              <p className="text-[11px] sm:text-xs text-zinc-400 line-clamp-1">
                Carica il PDF delle slide per convertirle in Markdown e correlarle con l'audio
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Navigation Tabs (if slides exist) */}
        {lecture.slidesMarkdown && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 pt-2.5 pb-2 border-b border-zinc-800 bg-zinc-900/30">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                onClick={() => setActiveTab('preview')}
                className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  activeTab === 'preview'
                    ? 'bg-purple-600 text-white'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                <span><span className="hidden sm:inline">Anteprima </span>Markdown</span>
              </button>

              <button
                onClick={() => setActiveTab('upload')}
                className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  activeTab === 'upload'
                    ? 'bg-purple-600 text-white'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                }`}
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span><span className="hidden sm:inline">Aggiorna / </span>Ricarica PDF</span>
              </button>
            </div>

            {activeTab === 'preview' && (
              <div className="flex items-center gap-1.5 sm:gap-2">
                <div className="flex items-center bg-zinc-900 rounded-lg p-0.5 border border-zinc-800 text-[11px]">
                  <button
                    onClick={() => setPreviewMode('rendered')}
                    className={`px-2 py-0.5 sm:py-1 rounded-md transition ${
                      previewMode === 'rendered'
                        ? 'bg-purple-950 text-purple-200 font-medium'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Formattato
                  </button>
                  <button
                    onClick={() => setPreviewMode('raw')}
                    className={`px-2 py-0.5 sm:py-1 rounded-md transition ${
                      previewMode === 'raw'
                        ? 'bg-purple-950 text-purple-200 font-medium'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Sorgente
                  </button>
                </div>

                <button
                  onClick={handleCopyMarkdown}
                  className="flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg text-xs bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 transition"
                  title="Copia l'intero Markdown delle slide"
                >
                  {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{isCopied ? 'Copiato' : 'Copia'}</span>
                </button>

                <button
                  onClick={handleDownloadMarkdown}
                  className="flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg text-xs bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 transition"
                  title="Scarica file slides.md"
                >
                  <Download className="w-3.5 h-3.5 text-purple-400" />
                  <span>.md</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-3.5 sm:p-5 md:p-6 space-y-3 sm:space-y-4">
          {errorMessage && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {activeTab === 'upload' ? (
            <div className="space-y-4">
              {lecture.slidesFileName && (
                <div className="flex items-center justify-between p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-800/80 text-xs text-emerald-300">
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span>
                      Slide attualmente collegate: <strong>{lecture.slidesFileName}</strong>
                    </span>
                  </div>
                  <span className="text-[10px] text-zinc-400 font-mono">
                    Markdown estratto disponibile
                  </span>
                </div>
              )}

              {/* PDF Dropzone */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => !isProcessing && fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition flex flex-col items-center justify-center gap-3 ${
                  selectedPdf
                    ? 'border-purple-500 bg-purple-950/20'
                    : 'border-zinc-800 hover:border-purple-600/60 bg-zinc-900/40 hover:bg-zinc-900/70'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  onChange={handleFileChange}
                  disabled={isProcessing}
                />

                <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 text-purple-400">
                  <Upload className="w-8 h-8" />
                </div>

                {selectedPdf ? (
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-zinc-100">{selectedPdf.name}</p>
                    <p className="text-xs text-zinc-400">
                      {(selectedPdf.size / (1024 * 1024)).toFixed(2)} MB • Pronto per l'elaborazione
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-zinc-200">
                      Trascina qui il file PDF delle slide oppure clicca per sfogliare
                    </p>
                    <p className="text-xs text-zinc-500">
                      Supporta documenti di presentazione (.pdf) con formule, grafici e teoremi
                    </p>
                  </div>
                )}
              </div>

              {/* Processing Progress */}
              {isProcessing && (
                <div className="p-4 rounded-xl bg-purple-950/50 border border-purple-800/80 space-y-2 animate-in fade-in">
                  <div className="flex items-center gap-2 text-xs font-semibold text-purple-200">
                    <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                    <span>{processingStage || 'Elaborazione in corso...'}</span>
                  </div>
                  <div className="w-full bg-zinc-900 h-1.5 rounded-full overflow-hidden">
                    <div className="bg-gradient-to-r from-purple-500 to-indigo-500 h-full w-full animate-pulse" />
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  onClick={onClose}
                  disabled={isProcessing}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 transition"
                >
                  Annulla
                </button>

                <button
                  onClick={handleStartProcess}
                  disabled={!selectedPdf || isProcessing}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white shadow-lg shadow-purple-950/50 transition"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Elaborazione Slide in corso...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>Converti in .md e Correla alla Lezione</span>
                    </>
                  )}
                </button>
              </div>

              {/* Informative Note */}
              <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-[11px] text-zinc-400 space-y-1">
                <p className="font-semibold text-zinc-300">💡 Come funziona l'integrazione con Gemini:</p>
                <ul className="list-disc list-inside space-y-0.5 text-zinc-400">
                  <li>Il PDF viene convertito in un documento Markdown pulito con formule LaTeX ($...$).</li>
                  <li>Gemini confronta l'audio parlato con le slide proiettate dal docente.</li>
                  <li>La Guida allo Studio Overleaf LaTeX viene arricchita con riferimenti puntuali es. <code>\subsection&#123;... [Rif. Slide 3]&#125;</code>.</li>
                  <li>Glossario e domande d'esame integrano sia ciò che è stato spiegato a voce sia ciò che è scritto sulle slide.</li>
                </ul>
              </div>
            </div>
          ) : (
            /* Converted Markdown Preview */
            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-zinc-900/80 border border-zinc-800 text-xs text-zinc-300 flex items-center justify-between">
                <span>
                  Documento Markdown generato dalle slide: <strong>{lecture.slidesFileName || 'slide.pdf'}</strong>
                </span>
                <span className="text-[10px] text-purple-400 font-mono">
                  {lecture.slidesMarkdown?.split('\n').length} righe estratte
                </span>
              </div>

              {previewMode === 'rendered' ? (
                <div className="p-4 rounded-xl bg-zinc-900/40 border border-obsidian-border text-xs text-zinc-200 max-h-[55vh] overflow-y-auto space-y-4">
                  <MarkdownRenderer content={lecture.slidesMarkdown || ''} />
                </div>
              ) : (
                <pre className="p-4 rounded-xl bg-black/70 border border-zinc-800 text-[11px] font-mono text-zinc-300 max-h-[55vh] overflow-y-auto whitespace-pre-wrap leading-relaxed select-text">
                  {lecture.slidesMarkdown}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
