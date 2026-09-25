'use client';

import React, { useState, useRef } from 'react';
import { UploadCloud, FileAudio, AlertTriangle, Loader2, Sparkles, CheckCircle2 } from 'lucide-react';
import { saveLecture, updateLectureStatus, updateLectureData } from '@/lib/db';
import { Lecture } from '@/lib/types';
import { processAudioDirectly } from '@/lib/gemini-service';

interface AudioUploaderProps {
  onLectureCreated: (lectureId: string) => void;
  onOpenSettings: () => void;
}

const MAX_FILE_SIZE_BYTES = 250 * 1024 * 1024; // 250 MB

export const AudioUploader: React.FC<AudioUploaderProps> = ({ onLectureCreated, onOpenSettings }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [course, setCourse] = useState('Elaborazione Numerica dei Segnali');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedModel, setSelectedModel] = useState('gemini-1.5-flash-latest');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStage, setProcessingStage] = useState('');
  const [sizeWarning, setSizeWarning] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSizeWarning(null);
    setErrorMessage(null);

    // 250MB check
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setSizeWarning(
        'File too large. Please ensure your dictaphone is set to MP3 128kbps/192kbps for optimal API processing.'
      );
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setSelectedFile(file);

    // Auto-fill title if empty
    if (!title) {
      const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
      setTitle(nameWithoutExt);
    }
  };

  const handleProcess = async () => {
    if (!selectedFile) {
      setErrorMessage('Seleziona prima un file audio.');
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
    setProcessingStage('Salvataggio audio locale nel database IndexedDB...');

    const lectureId = 'lec_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

    try {
      // 1. Save initially in Dexie.js
      const newLecture: Lecture = {
        id: lectureId,
        title: title.trim() || 'Lezione Senza Titolo',
        course: course.trim() || 'Ingegneria',
        date: date || new Date().toISOString(),
        duration: 0,
        fileSize: selectedFile.size,
        fileName: selectedFile.name,
        audioBlob: selectedFile,
        status: 'processing',
        processingProgress: 'Inizializzazione elaborazione...',
        chatMessages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await saveLecture(newLecture);
      onLectureCreated(lectureId);

      // 2. Perform direct multimodal processing with Google AI Studio
      // (This bypasses Vercel 4.5MB serverless body limit and 10s execution timeout)
      let lectureData: any = null;

      try {
        const result = await processAudioDirectly(
          selectedFile,
          course,
          title,
          apiKey,
          (stage) => {
            setProcessingStage(stage);
            updateLectureStatus(lectureId, 'processing', undefined, stage).catch(console.error);
          },
          selectedModel
        );
        lectureData = result.data;
      } catch (directErr: any) {
        console.error('Direct upload failed:', directErr);
        
        // If file is smaller than 4MB, try server proxy fallback
        if (selectedFile.size < 4 * 1024 * 1024) {
          try {
            setProcessingStage('Tentativo tramite proxy server...');
            const formData = new FormData();
            formData.append('audio', selectedFile);
            formData.append('course', course);
            formData.append('title', title);

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

      setProcessingStage('Salvataggio dei risultati e generazione appunti...');

      // 3. Update Lecture in Dexie.js
      await updateLectureData(lectureId, lectureData);

      setIsProcessing(false);
      setProcessingStage('');
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      console.error('Error during audio processing:', err);
      setIsProcessing(false);
      setProcessingStage('');
      setErrorMessage(err.message || 'Errore imprevisto durante l\'elaborazione.');
      await updateLectureStatus(lectureId, 'error', err.message || 'Errore imprevisto.');
    }
  };

  return (
    <div className="bg-zinc-900 border border-obsidian-border rounded-2xl p-6 shadow-xl text-zinc-100 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-zinc-800">
        <div className="p-3 bg-purple-950/60 border border-purple-800/50 rounded-xl text-purple-400">
          <UploadCloud className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-zinc-100">Nuova Registrazione / Lezione</h2>
          <p className="text-xs text-zinc-400">
            Carica la registrazione audio da registratore vocale OTG, Bluetooth o file locale
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
        {/* File Input Box */}
        <div
          onClick={() => !isProcessing && fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition flex flex-col items-center justify-center ${
            selectedFile
              ? 'border-purple-500/70 bg-purple-950/10'
              : 'border-zinc-700 hover:border-purple-500/50 hover:bg-zinc-800/50'
          } ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            onChange={handleFileChange}
            disabled={isProcessing}
            className="hidden"
          />

          {selectedFile ? (
            <div className="flex items-center gap-3">
              <FileAudio className="w-8 h-8 text-purple-400" />
              <div className="text-left">
                <p className="font-medium text-sm text-zinc-100 truncate max-w-sm">
                  {selectedFile.name}
                </p>
                <p className="text-xs text-zinc-400">
                  {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB • {selectedFile.type || 'audio'}
                </p>
              </div>
            </div>
          ) : (
            <>
              <UploadCloud className="w-10 h-10 text-zinc-400 mb-2" />
              <p className="text-sm font-medium text-zinc-200">
                Clicca per selezionare il file audio (MP3, WAV, M4A)
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                Supporta registratori vocali OTG, cartelle download o file locali (max 250MB)
              </p>
            </>
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
              placeholder="es. Elaborazione Numerica dei Segnali"
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
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={isProcessing}
            className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-purple-500 cursor-pointer"
          >
            <option value="gemini-1.5-flash-latest">Gemini 1.5 Flash Latest (Consigliato - Immediato & Server Stabili)</option>
            <option value="gemini-1.5-flash-002">Gemini 1.5 Flash 002 (Alta velocità)</option>
            <option value="gemini-3.8-flash">Gemini 3.8 Flash (Nuovissimo - Soggetto a code di picco)</option>
            <option value="gemini-1.5-pro-latest">Gemini 1.5 Pro (Massima precisione accademica & formule)</option>
            <option value="gemini-3.6-flash">Gemini 3.6 Flash</option>
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
              disabled={!selectedFile}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-900/30 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Sparkles className="w-4 h-4" />
              Avvia Analisi Accademica con Gemini
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
