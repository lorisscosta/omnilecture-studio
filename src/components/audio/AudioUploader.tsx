'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  UploadCloud,
  FileAudio,
  AlertTriangle,
  Loader2,
  Sparkles,
  CheckCircle2,
  FileText,
  X,
  ChevronUp,
  ChevronDown,
  Trash2,
  Plus,
  Layers,
} from 'lucide-react';
import { db, saveLecture, updateLectureStatus, updateLectureData, updateLectureSlides } from '@/lib/db';
import { Lecture, AudioPart } from '@/lib/types';
import { processAudioDirectly, convertPdfToMarkdown, enrichLectureWithSlides } from '@/lib/gemini-service';
import {
  GeminiModelInfo,
  STATIC_FALLBACK_MODELS,
  fetchAvailableModels,
  DEFAULT_MODEL_ID,
  normalizeModelName,
} from '@/lib/gemini-config';

interface AudioUploaderProps {
  onLectureCreated: (lectureId: string) => void;
  onOpenSettings: () => void;
}

const MAX_FILE_SIZE_BYTES = 250 * 1024 * 1024; // 250 MB per file

export const AudioUploader: React.FC<AudioUploaderProps> = ({ onLectureCreated, onOpenSettings }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const [audioFiles, setAudioFiles] = useState<File[]>([]);
  const [selectedPdf, setSelectedPdf] = useState<File | null>(null);
  const [course, setCourse] = useState('');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [availableModels, setAvailableModels] = useState<GeminiModelInfo[]>(STATIC_FALLBACK_MODELS);
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('gemini_selected_model');
      if (saved) return normalizeModelName(saved);
    }
    return DEFAULT_MODEL_ID;
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStage, setProcessingStage] = useState('');
  const [sizeWarning, setSizeWarning] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const key = typeof window !== 'undefined' ? localStorage.getItem('gemini_api_key') : null;
    if (key) {
      fetchAvailableModels(key).then((models) => {
        if (models && models.length > 0) {
          setAvailableModels(models);
        }
      }).catch(console.warn);
    }
  }, []);

  const handleModelChange = (modelId: string) => {
    setSelectedModel(modelId);
    if (typeof window !== 'undefined') {
      localStorage.setItem('gemini_selected_model', modelId);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setSizeWarning(null);
    setErrorMessage(null);

    const validFiles: File[] = [];
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE_BYTES) {
        setSizeWarning(
          `Il file "${file.name}" supera i 250MB. Consigliamo di registrare in formato MP3 a 128/192 kbps.`
        );
      } else {
        validFiles.push(file);
      }
    }

    if (validFiles.length === 0) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setAudioFiles((prev) => {
      const updated = [...prev, ...validFiles];
      // Auto-fill title if empty from the first file
      if (!title && updated.length > 0) {
        const nameWithoutExt = updated[0].name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
        setTitle(nameWithoutExt);
      }
      return updated;
    });

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const moveUp = (index: number) => {
    if (index <= 0) return;
    setAudioFiles((prev) => {
      const copy = [...prev];
      const temp = copy[index - 1];
      copy[index - 1] = copy[index];
      copy[index] = temp;
      return copy;
    });
  };

  const moveDown = (index: number) => {
    if (index >= audioFiles.length - 1) return;
    setAudioFiles((prev) => {
      const copy = [...prev];
      const temp = copy[index + 1];
      copy[index + 1] = copy[index];
      copy[index] = temp;
      return copy;
    });
  };

  const removeFile = (index: number) => {
    setAudioFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const clearFiles = () => {
    setAudioFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePdfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setErrorMessage('Il file delle slide deve essere in formato PDF.');
      return;
    }
    setSelectedPdf(file);
    setErrorMessage(null);
  };

  const totalBytes = audioFiles.reduce((acc, f) => acc + f.size, 0);

  const handleProcess = async () => {
    if (audioFiles.length === 0) {
      setErrorMessage('Seleziona almeno un file audio della lezione.');
      return;
    }

    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) {
      onOpenSettings();
      setErrorMessage('Inserisci la chiave API Google AI Studio nelle impostazioni per procedere.');
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);
    setProcessingStage('Inizializzazione sessione di studio...');

    const lectureId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : '00000000-0000-4000-8000-' + Date.now().toString(16).padStart(12, '0');

    const effectiveCourse = course.trim() || 'Corso Universitario';
    const effectiveTitle = title.trim() || 'Lezione Senza Titolo';

    try {
      // 1. Save initially in Dexie.js
      const primaryFileName =
        audioFiles.length === 1
          ? audioFiles[0].name
          : `${audioFiles.length} registrazioni: ${audioFiles.map((f) => f.name).join(', ')}`;

      const newLecture: Lecture = {
        id: lectureId,
        title: effectiveTitle,
        course: effectiveCourse,
        date: date || new Date().toISOString(),
        duration: 0,
        fileSize: totalBytes,
        fileName: primaryFileName,
        audioBlob: audioFiles[0], // primary or part 0 for fallback
        slidesFileName: selectedPdf ? selectedPdf.name : undefined,
        hasSlides: !!selectedPdf,
        status: 'processing',
        processingProgress:
          audioFiles.length > 1
            ? `Inizializzazione elaborazione unificata (${audioFiles.length} parti)...`
            : 'Inizializzazione elaborazione...',
        chatMessages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await saveLecture(newLecture);
      onLectureCreated(lectureId);

      // 2. Perform direct multimodal processing with Google AI Studio
      let lectureData: any = null;
      let calculatedTotalDuration = 0;
      let finalAudioParts: AudioPart[] = [];

      try {
        const result = await processAudioDirectly(
          audioFiles,
          effectiveCourse,
          effectiveTitle,
          apiKey,
          (stage) => {
            setProcessingStage(stage);
            updateLectureStatus(lectureId, 'processing', undefined, stage).catch(console.error);
          },
          selectedModel
        );

        lectureData = result.data;
        calculatedTotalDuration = result.totalDuration || 0;
        finalAudioParts = result.audioParts || [];
      } catch (directErr: any) {
        console.error('Direct upload failed:', directErr);

        // Fallback for single file under 4MB via server proxy
        if (audioFiles.length === 1 && audioFiles[0].size < 4 * 1024 * 1024) {
          try {
            setProcessingStage('Tentativo tramite proxy server...');
            const formData = new FormData();
            formData.append('audio', audioFiles[0]);
            formData.append('course', effectiveCourse);
            formData.append('title', effectiveTitle);

            const response = await fetch('/api/gemini/process-audio', {
              method: 'POST',
              headers: {
                'x-gemini-api-key': apiKey,
              },
              body: formData,
            });

            if (response.ok) {
              const serverResult = await response.json();
              if (serverResult.success && serverResult.data) {
                lectureData = serverResult.data;
              }
            }
          } catch (e) {
            console.warn('Server fallback failed too:', e);
          }
        }

        if (!lectureData) {
          throw new Error(directErr.message || 'Errore durante l\'elaborazione dell\'audio.');
        }
      }

      // 3. Optional: Process Slides PDF and enrich lecture
      let slidesMarkdown = '';
      if (selectedPdf) {
        setProcessingStage('Conversione slide PDF in Markdown (.md)...');
        await updateLectureStatus(lectureId, 'processing', undefined, 'Conversione slide PDF in Markdown (.md)...');
        slidesMarkdown = await convertPdfToMarkdown(selectedPdf, selectedPdf.name, apiKey, (stg) => {
          setProcessingStage(stg);
        });

        setProcessingStage('Correlazione tra registrazione e slide...');
        await updateLectureStatus(lectureId, 'processing', undefined, 'Correlazione tra registrazione e slide...');
        lectureData = await enrichLectureWithSlides(lectureData, slidesMarkdown, effectiveCourse, effectiveTitle, apiKey, (stg) => {
          setProcessingStage(stg);
        });
      }

      setProcessingStage('Salvataggio dei risultati e generazione appunti...');

      // 4. Update Lecture in Dexie.js
      if (selectedPdf && slidesMarkdown) {
        await updateLectureSlides(lectureId, selectedPdf.name, slidesMarkdown, lectureData);
      } else {
        await updateLectureData(lectureId, lectureData);
      }

      // Update duration and audio parts
      await db.lectures.update(lectureId, {
        duration: calculatedTotalDuration,
        audioParts: finalAudioParts.length > 0 ? finalAudioParts : undefined,
      });

      setIsProcessing(false);
      setProcessingStage('');
      setAudioFiles([]);
      setSelectedPdf(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (pdfInputRef.current) pdfInputRef.current.value = '';
    } catch (err: any) {
      console.error('Error during audio processing:', err);
      setIsProcessing(false);
      setProcessingStage('');
      setErrorMessage(err.message || 'Errore imprevisto durante l\'elaborazione.');
      await updateLectureStatus(lectureId, 'error', err.message || 'Errore imprevisto.');
    }
  };

  return (
    <div className="bg-zinc-900 border border-obsidian-border rounded-2xl p-4 sm:p-6 shadow-xl text-zinc-100 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-zinc-800">
        <div className="p-3 bg-purple-950/60 border border-purple-800/50 rounded-xl text-purple-400">
          <UploadCloud className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-zinc-100">Nuova Registrazione / Lezione</h2>
          <p className="text-xs text-zinc-400">
            Carica una o più registrazioni audio ordinate della stessa lezione (es. prima e dopo la pausa)
          </p>
        </div>
      </div>

      {/* Warning Toast for >250MB */}
      {sizeWarning && (
        <div className="mb-5 rounded-xl border border-amber-600/50 bg-amber-950/30 p-4 text-amber-200 text-sm flex items-start gap-3 animate-in fade-in">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-amber-300">Dimensione file eccessiva</p>
            <p className="text-xs mt-0.5 text-amber-200/90">{sizeWarning}</p>
          </div>
        </div>
      )}

      {/* Error Message */}
      {errorMessage && (
        <div className="mb-5 rounded-xl border border-rose-600/50 bg-rose-950/30 p-4 text-rose-200 text-sm flex items-start gap-3 animate-in fade-in">
          <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-rose-300">Attenzione</p>
            <p className="text-xs mt-0.5 text-rose-200/90">{errorMessage}</p>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {/* Hidden Multi-file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="audio/*"
          onChange={handleFileChange}
          disabled={isProcessing}
          className="hidden"
        />

        {/* Audio Files Management Area */}
        {audioFiles.length === 0 ? (
          /* Empty state: big dropzone */
          <div
            onClick={() => !isProcessing && fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 sm:p-8 text-center cursor-pointer transition flex flex-col items-center justify-center border-zinc-700 hover:border-purple-500/50 hover:bg-zinc-800/50 ${
              isProcessing ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            <UploadCloud className="w-10 h-10 text-zinc-400 mb-2" />
            <p className="text-sm font-medium text-zinc-200">
              Clicca per selezionare i file audio della lezione
            </p>
            <p className="text-xs text-zinc-400 mt-1 max-w-md">
              Puoi selezionare <span className="text-purple-300 font-semibold">uno o più file audio</span> contemporaneamente (MP3, WAV, M4A) se hai registrato a spezzoni con pause.
            </p>
            <span className="mt-3 px-3 py-1 rounded-full bg-zinc-800/80 border border-zinc-700 text-[11px] text-zinc-400">
              Supporta registratori vocali OTG, smartphone o file locali (max 250MB per file)
            </span>
          </div>
        ) : (
          /* Selected Audio Files Ordered List */
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800/70">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-purple-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                  Registrazioni Audio in Ordine Cronologico ({audioFiles.length})
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => !isProcessing && fileInputRef.current?.click()}
                  disabled={isProcessing}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-purple-950/80 border border-purple-800/60 hover:bg-purple-900 text-purple-300 transition"
                  title="Aggiungi altri spezzoni audio a questa lezione"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Aggiungi parte</span>
                </button>
                <button
                  type="button"
                  onClick={clearFiles}
                  disabled={isProcessing}
                  className="px-2 py-1 rounded-lg text-xs text-zinc-400 hover:text-rose-400 transition"
                  title="Rimuovi tutte le registrazioni"
                >
                  Svuota
                </button>
              </div>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {audioFiles.map((file, idx) => (
                <div
                  key={`${file.name}-${idx}`}
                  className="flex items-center justify-between p-2.5 sm:p-3 rounded-xl bg-zinc-900/90 border border-zinc-800/80 hover:border-zinc-700 transition"
                >
                  <div className="flex items-center gap-2.5 sm:gap-3 truncate min-w-0">
                    <span className="w-6 h-6 shrink-0 rounded-full bg-purple-950 border border-purple-800 text-purple-300 text-xs font-bold flex items-center justify-center">
                      {idx + 1}
                    </span>
                    <FileAudio className="w-4 h-4 text-purple-400 shrink-0" />
                    <div className="truncate">
                      <p className="text-xs font-semibold text-zinc-200 truncate">
                        {file.name}
                      </p>
                      <p className="text-[10px] text-zinc-400">
                        Parte {idx + 1} • {(file.size / (1024 * 1024)).toFixed(1)} MB
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    <button
                      type="button"
                      onClick={() => moveUp(idx)}
                      disabled={isProcessing || idx === 0}
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition disabled:opacity-30 disabled:hover:bg-transparent"
                      title="Sposta prima (anticipa)"
                    >
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveDown(idx)}
                      disabled={isProcessing || idx === audioFiles.length - 1}
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition disabled:opacity-30 disabled:hover:bg-transparent"
                      title="Sposta dopo (posticipa)"
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeFile(idx)}
                      disabled={isProcessing}
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-rose-950/40 transition"
                      title="Rimuovi questa registrazione"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-2 flex items-center justify-between text-[11px] text-zinc-400 border-t border-zinc-800/70">
              <span>Totale: {(totalBytes / (1024 * 1024)).toFixed(1)} MB</span>
              <span className="text-purple-300 font-medium">
                Verranno unificate in un&apos;unica trascrizione e Guida LaTeX
              </span>
            </div>
          </div>
        )}

        {/* Optional Slide PDF Input Box */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-purple-400" />
              <span>Slide della Lezione (PDF) • Opzionale</span>
            </label>
            <span className="text-[10px] text-zinc-500">
              Genera riferimenti incrociati alle slide
            </span>
          </div>

          <input
            ref={pdfInputRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={handlePdfChange}
            disabled={isProcessing}
            className="hidden"
          />

          {selectedPdf ? (
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-purple-950/30 border border-purple-800/60 text-xs">
              <div className="flex items-center gap-2 truncate">
                <FileText className="w-4 h-4 text-purple-400 shrink-0" />
                <span className="font-medium text-zinc-200 truncate">{selectedPdf.name}</span>
                <span className="text-[10px] text-zinc-400 shrink-0">
                  ({(selectedPdf.size / (1024 * 1024)).toFixed(1)} MB)
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedPdf(null);
                  if (pdfInputRef.current) pdfInputRef.current.value = '';
                }}
                disabled={isProcessing}
                className="p-1 text-zinc-400 hover:text-rose-400 transition"
                title="Rimuovi slide"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => !isProcessing && pdfInputRef.current?.click()}
              disabled={isProcessing}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg border border-dashed border-zinc-700/80 hover:border-purple-500/60 bg-zinc-900/40 hover:bg-zinc-900/80 text-xs text-zinc-400 hover:text-zinc-200 transition"
            >
              <UploadCloud className="w-3.5 h-3.5 text-purple-400" />
              <span>Allega PDF delle slide (opzionale - converte in .md e collega all&apos;audio)</span>
            </button>
          )}
        </div>

        {/* Metadata Inputs */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
              Corso Universitario
            </label>
            <input
              type="text"
              value={course}
              onChange={(e) => setCourse(e.target.value)}
              disabled={isProcessing}
              placeholder="es. Nome corso"
              className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
              Data della Lezione
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={isProcessing}
              className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
            Titolo / Argomento della Lezione
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={isProcessing}
            placeholder="es. Lezione 04: Trasformata di Fourier Discreta & Campionamento"
            className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5 flex items-center justify-between">
            <span>Modello AI Multimodale</span>
            <span className="text-[10px] text-purple-400 font-normal">Audio Nativo</span>
          </label>
          <select
            value={selectedModel}
            onChange={(e) => handleModelChange(e.target.value)}
            disabled={isProcessing}
            className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-purple-500 cursor-pointer"
          >
            {availableModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName} {m.isRecommended ? '★ (Consigliato)' : m.isPro ? '◆ (Pro Accademico)' : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Action Button & Processing indicator */}
        <div className="pt-3">
          {isProcessing ? (
            <div className="rounded-xl bg-purple-950/30 border border-purple-800/40 p-4 space-y-3">
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-purple-200">Elaborazione in corso...</p>
                  <p className="text-xs text-purple-300/80">{processingStage}</p>
                </div>
              </div>
              <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                <div className="bg-gradient-to-r from-purple-500 to-indigo-400 h-full w-full animate-pulse" />
              </div>
            </div>
          ) : (
            <button
              onClick={handleProcess}
              disabled={audioFiles.length === 0}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-900/30 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Sparkles className="w-4 h-4" />
              <span>
                {audioFiles.length <= 1
                  ? 'Avvia Analisi Accademica con Gemini'
                  : `Avvia Analisi Accademica Unificata (${audioFiles.length} parti)`}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
