'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  BookOpen,
  Headphones,
  Settings,
  Plus,
  Trash2,
  Calendar,
  Clock,
  Layers,
  Sparkles,
  Menu,
  X,
  FileAudio,
  AlertCircle,
  HelpCircle,
  FileQuestion,
  Network,
  MessageSquare,
  Bookmark,
} from 'lucide-react';
import { db, getAllLectures, deleteLectureById, saveLecture } from '@/lib/db';
import { Lecture } from '@/lib/types';
import { WaveSurferPlayer, WaveSurferPlayerHandle } from '@/components/audio/WaveSurferPlayer';
import { AudioUploader } from '@/components/audio/AudioUploader';
import { SettingsModal } from '@/components/settings/SettingsModal';
import { ObsidianExportButton } from '@/components/export/ObsidianExportButton';
import { StudyGuideTab } from '@/components/workspace/StudyGuideTab';
import { TranscriptTab } from '@/components/workspace/TranscriptTab';
import { GlossaryTab } from '@/components/workspace/GlossaryTab';
import { MindmapTab } from '@/components/workspace/MindmapTab';
import { LectureChatTab } from '@/components/workspace/LectureChatTab';

export default function HomePage() {
  const [selectedLectureId, setSelectedLectureId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'guide' | 'transcript' | 'glossary' | 'mindmap' | 'chat'>('guide');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const waveSurferRef = useRef<WaveSurferPlayerHandle>(null);

  // Live query from IndexedDB
  const lectures = useLiveQuery(() => getAllLectures(), []) || [];
  const currentLecture = lectures.find((l) => l.id === selectedLectureId);

  // If no lecture selected, select first available on load
  useEffect(() => {
    if (!selectedLectureId && lectures.length > 0) {
      setSelectedLectureId(lectures[0].id);
    }
  }, [lectures, selectedLectureId]);

  // Handle seeking from transcript
  const handleSeekFromTranscript = (seconds: number) => {
    waveSurferRef.current?.seekTo(seconds);
  };

  // Delete lecture
  const handleDeleteLecture = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Sei sicuro di voler eliminare questa lezione?')) {
      await deleteLectureById(id);
      if (selectedLectureId === id) {
        setSelectedLectureId(null);
      }
    }
  };

  // Demo Lecture Generator for immediate testing
  const loadDemoLecture = async () => {
    const demoId = 'demo_dsp_' + Date.now();
    const demoLecture: Lecture = {
      id: demoId,
      title: 'Lezione 04: Discrete Fourier Transform & Fast Convolution',
      course: 'Digital Signal Processing (DSP)',
      date: new Date().toISOString(),
      duration: 360,
      fileSize: 15 * 1024 * 1024,
      fileName: 'dsp_lecture_04_dft.mp3',
      status: 'completed',
      chatMessages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      data: {
        glossary: [
          {
            term_en: 'Discrete Fourier Transform (DFT)',
            translation_it: 'Trasformata di Fourier Discreta',
            academic_definition: 'Trasformazione che mappa una sequenza finita di $N$ campioni discreti in altrettanti coefficienti nel dominio delle frequenze discrete.',
          },
          {
            term_en: 'Circular Convolution',
            translation_it: 'Convoluzione Circolare',
            academic_definition: 'Operazione di convoluzione periodica derivante dalla moltiplicazione puntuale delle rispettive DFT di due sequenze.',
          },
          {
            term_en: 'Zero Padding',
            translation_it: 'Riempimento con Zeri (Zero-Padding)',
            academic_definition: 'Tecnica di aggiunta di campioni nulli in coda al segnale per aumentare la densità di campionamento spettrale ed evitare aliasing temporale.',
          },
          {
            term_en: 'Overlap-Add Method',
            translation_it: 'Metodo Overlap-Add (Sovrapposizione e Somma)',
            academic_definition: 'Algoritmo a blocchi per implementare il filtraggio FIR continuo usando la FFT dividendo il segnale in segmenti non sovrapposti.',
          },
        ],
        timestamped_transcript: [
          {
            start: 0,
            end: 18,
            speaker: 'Prof. Miller',
            text_en: 'Good morning everyone. Today we are exploring the mathematical mechanics of the Discrete Fourier Transform and circular convolution.',
            text_it: 'Buongiorno a tutti. Oggi esploreremo la struttura matematica della Trasformata di Fourier Discreta e della convoluzione circolare.',
          },
          {
            start: 19,
            end: 45,
            speaker: 'Prof. Miller',
            text_en: 'Remember that while DTFT operates on discrete time and continuous frequency, the DFT samples the frequency domain at N equidistant points on the unit circle.',
            text_it: 'Ricordate che mentre la DTFT opera nel tempo discreto e nella frequenza continua, la DFT campiona il dominio della frequenza in N punti equidistanti sulla circonferenza unitaria.',
          },
          {
            start: 46,
            end: 78,
            speaker: 'Prof. Miller',
            text_en: 'The analysis equation is given by X[k] equals sum from n equals 0 to N minus 1 of x[n] times exponential of minus j 2 pi k n over N.',
            text_it: 'L\'equazione di analisi è data da $X[k] = \\sum_{n=0}^{N-1} x[n] e^{-j \\frac{2\\pi}{N} kn}$, con $k = 0, \\dots, N-1$.',
          },
          {
            start: 79,
            end: 120,
            speaker: 'Prof. Miller',
            text_en: 'Be extremely careful: multiplying two DFTs in the frequency domain does NOT correspond to linear convolution, but rather to circular convolution due to implicit periodic repetition.',
            text_it: 'Fate molta attenzione: la moltiplicazione tra due DFT nel dominio della frequenza NON corrisponde alla convoluzione lineare, bensì alla convoluzione circolare a causa della ripetizione periodica implicita.',
          },
        ],
        study_guide_it: `# Guida Accademica: Trasformata di Fourier Discreta (DFT)

> [!important] Concetto Chiave per l'Esame
> La moltiplicazione puntuale di due DFT nel dominio delle frequenze campionate:
> $$Y[k] = X[k] \\cdot H[k]$$
> corrisponde nel dominio temporale alla **convoluzione circolare** $y[n] = x[n] \\circledast_N h[n]$, e non alla convoluzione lineare standard. Per calcolare una convoluzione lineare tramite FFT è obbligatorio applicare lo **zero-padding** ad almeno $L = N_1 + N_2 - 1$ campioni.

## 1. Definizione Matematica e Matrice di Trasformazione

Sia $x[n]$ una sequenza a lunghezza finita di $N$ campioni ($n = 0, 1, \\dots, N-1$). La sua DFT $X[k]$ è definita formalmente come:

$$X[k] = \\sum_{n=0}^{N-1} x[n] W_N^{kn}, \\quad k = 0, 1, \\dots, N-1$$

dove il fattore di rotazione (twiddle factor) è:
$$W_N = e^{-j\\frac{2\\pi}{N}}$$

La trasformata inversa (IDFT) consente la perfetta ricostruzione del segnale temporale:
$$x[n] = \\frac{1}{N} \\sum_{k=0}^{N-1} X[k] W_N^{-kn}, \\quad n = 0, 1, \\dots, N-1$$

## 2. Dimostrazione: Equivalenza tra Moltiplicazione in Frequenza e Convoluzione Circolare

Dimostriamo perché l'antitrasformata del prodotto $Y[k] = X[k] H[k]$ produce la convoluzione circolare:

$$y[n] = \\frac{1}{N} \\sum_{k=0}^{N-1} \\left( \\sum_{m=0}^{N-1} x[m] W_N^{km} \\right) \\left( \\sum_{l=0}^{N-1} h[l] W_N^{kl} \\right) W_N^{-kn}$$

Scambiando l'ordine di sommatoria:
$$y[n] = \\sum_{m=0}^{N-1} x[m] \\sum_{l=0}^{N-1} h[l] \\left[ \\frac{1}{N} \\sum_{k=0}^{N-1} W_N^{k(m+l-n)} \\right]$$

Utilizzando la proprietà di ortogonalità degli esponenziali complessi:
$$\\frac{1}{N} \\sum_{k=0}^{N-1} W_N^{k(m+l-n)} = \\sum_{r=-\\infty}^{+\\infty} \\delta[m+l-n - rN]$$

Otteniamo direttamente la formula della convoluzione circolare:
$$y[n] = \\sum_{m=0}^{N-1} x[m] h[((n - m))_N]$$

> [!tip] Regola Pratica per gli Esercizi
> Per evitare l'aliasing nel tempo (time-domain aliasing), assicurarsi che la dimensione $N$ della DFT soddisfi:
> $$N \\ge N_x + N_h - 1$$`,
        potential_exam_questions: [
          {
            question: 'Dimostrare la condizione minima di zero-padding necessaria per implementare un filtro FIR di lunghezza M su un segnale di lunghezza L tramite FFT.',
            answer_latex: `Per evitare aliasing temporale dovuto alla periodicità implicita della DFT, la lunghezza della trasformata $N$ deve essere maggiore o uguale alla lunghezza naturale della convoluzione lineare:
$$N \\ge L + M - 1$$
Se $N < L + M - 1$, i campioni finali della risposta all'impulso si sovrappongono ciclicamente ai campioni iniziali del segnale secondo la relazione:
$$y_{circ}[n] = \\sum_{r=-\\infty}^{\\infty} y_{lin}[n + rN]$$`,
            importance_level: 'Crucial',
          },
          {
            question: 'Confrontare la complessità computazionale del filtraggio diretto rispetto al filtraggio tramite Fast Fourier Transform (FFT).',
            answer_latex: `La convoluzione diretta nel dominio del tempo richiede:
$$\\mathcal{O}(L \\cdot M)$$
operazioni di moltiplicazione complessa. Utilizzando l'algoritmo FFT di Cooley-Tukey radice-2 con $N = L + M - 1$, la complessità si riduce a:
$$\\mathcal{O}(N \\log_2 N)$$
Per $M > 64$, il metodo FFT offre un incremento di efficienza di svariati ordini di grandezza.`,
            importance_level: 'High',
          },
        ],
        mermaid_mindmap: `flowchart TD
    A["Discrete Fourier Transform (DFT)"] --> B["Campionamento Spettrale"]
    A --> C["Convoluzione Circolare"]
    A --> D["Algoritmi Fast Fourier Transform (FFT)"]
    
    B --> B1["Campionamento su N punti della DTFT"]
    B --> B2["Fattori di rotazione W_N"]
    
    C --> C1["Problema dell'Aliasing Temporale"]
    C --> C2["Soluzione: Zero-Padding L >= N1 + N2 - 1"]
    C --> C3["Metodi a Blocchi: Overlap-Add & Overlap-Save"]
    
    D --> D1["Cooley-Tukey Radix-2 O(N log N)"]
    D --> D2["Decimazione nel Tempo e in Frequenza"]`,
      },
    };

    await saveLecture(demoLecture);
    setSelectedLectureId(demoId);
  };

  return (
    <div className="flex h-screen bg-[#141416] text-zinc-100 overflow-hidden font-sans">
      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      {/* Sidebar - Desktop & Mobile */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 bg-zinc-950 border-r border-obsidian-border flex flex-col transition-transform duration-200 md:static md:translate-x-0 ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Header */}
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-purple-600 shadow-md shadow-purple-900/40">
              <Headphones className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-zinc-100">
                OmniLecture Studio
              </h1>
              <p className="text-[10px] text-purple-400 font-semibold tracking-wider uppercase">
                Academic Hub • Master STEM
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsSidebarOpen(false)}
            className="md:hidden p-1 text-zinc-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Buttons */}
        <div className="p-3 space-y-2 border-b border-zinc-800/80">
          <button
            onClick={() => {
              setSelectedLectureId(null);
              setIsSidebarOpen(false);
            }}
            className={`w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-semibold shadow-md transition ${
              selectedLectureId === null
                ? 'bg-purple-600 text-white shadow-purple-900/30'
                : 'bg-zinc-900 text-zinc-200 hover:bg-zinc-800 border border-zinc-800'
            }`}
          >
            <Plus className="w-4 h-4" />
            <span>Nuova Registrazione</span>
          </button>

          {lectures.length === 0 && (
            <button
              onClick={loadDemoLecture}
              className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-[11px] font-medium bg-zinc-900/80 hover:bg-zinc-800 border border-purple-900/40 text-purple-300 transition"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Carica Lezione Demo (DSP)</span>
            </button>
          )}
        </div>

        {/* Lecture List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            Archivio Lezioni ({lectures.length})
          </div>

          {lectures.map((lec) => {
            const isSelected = lec.id === selectedLectureId;
            return (
              <div
                key={lec.id}
                onClick={() => {
                  setSelectedLectureId(lec.id);
                  setIsSidebarOpen(false);
                }}
                className={`group relative rounded-xl p-3 cursor-pointer transition border ${
                  isSelected
                    ? 'bg-purple-950/40 border-purple-500/60 shadow-md'
                    : 'bg-zinc-900/40 border-transparent hover:bg-zinc-900 hover:border-zinc-800'
                }`}
              >
                <div className="flex items-start justify-between gap-1 mb-1">
                  <span className="text-[10px] font-bold text-purple-400 truncate max-w-[170px] uppercase">
                    {lec.course}
                  </span>
                  <button
                    onClick={(e) => handleDeleteLecture(lec.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-rose-400 transition"
                    title="Elimina lezione"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <h4 className="text-xs font-semibold text-zinc-100 line-clamp-1 mb-1">
                  {lec.title}
                </h4>

                <div className="flex items-center gap-2 text-[10px] text-zinc-400">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {lec.date ? new Date(lec.date).toLocaleDateString() : 'N/D'}
                  </span>
                  {lec.status === 'processing' && (
                    <span className="text-amber-400 font-semibold animate-pulse">
                      • In analisi...
                    </span>
                  )}
                  {lec.status === 'error' && (
                    <span className="text-rose-400 font-semibold">• Errore</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Sidebar Footer */}
        <div className="p-3 border-t border-zinc-800/80 bg-zinc-950">
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="w-full flex items-center justify-between p-2 rounded-xl text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition"
          >
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-purple-400" />
              <span>Impostazioni API</span>
            </div>
            <span className="text-[10px] text-zinc-500">Gemini 2.5</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#141416] overflow-hidden">
        {/* Top Navbar */}
        <header className="h-14 border-b border-obsidian-border bg-zinc-950/80 backdrop-blur-md px-4 flex items-center justify-between z-20 shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="md:hidden p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
            >
              <Menu className="w-5 h-5" />
            </button>

            {currentLecture ? (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-purple-950 border border-purple-800 text-purple-300">
                  {currentLecture.course}
                </span>
                <h2 className="text-sm font-bold text-zinc-100 truncate max-w-md hidden sm:block">
                  {currentLecture.title}
                </h2>
              </div>
            ) : (
              <span className="text-sm font-semibold text-zinc-300">
                Nuova Registrazione Audio
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {currentLecture && currentLecture.data && (
              <ObsidianExportButton lecture={currentLecture} />
            )}

            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 rounded-xl text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition"
              title="Configurazione API Key"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Dynamic Content View */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {/* View 1: Audio Uploader (when no lecture selected) */}
          {!currentLecture ? (
            <div className="py-6">
              <AudioUploader
                onLectureCreated={(id) => setSelectedLectureId(id)}
                onOpenSettings={() => setIsSettingsOpen(true)}
              />
            </div>
          ) : currentLecture.status === 'processing' ? (
            /* View 2: Processing State */
            <div className="max-w-md mx-auto my-16 text-center space-y-4 p-8 rounded-2xl bg-zinc-900 border border-obsidian-border">
              <div className="p-4 rounded-full bg-purple-950/80 border border-purple-800/60 text-purple-400 w-16 h-16 mx-auto flex items-center justify-center animate-pulse">
                <Sparkles className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-zinc-100">
                Analisi Multimodale in Corso
              </h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                {currentLecture.processingProgress ||
                  'Gemini 2.5 Flash sta elaborando la registrazione, generando la trascrizione bilingue, calcolando le formule LaTeX e strutturando gli appunti.'}
              </p>
              <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                <div className="bg-gradient-to-r from-purple-500 to-indigo-500 h-full w-full animate-pulse" />
              </div>
            </div>
          ) : currentLecture.status === 'error' ? (
            /* View 3: Error State */
            <div className="max-w-md mx-auto my-16 text-center space-y-4 p-8 rounded-2xl bg-zinc-900 border border-rose-900/50">
              <div className="p-4 rounded-full bg-rose-950 border border-rose-800 text-rose-400 w-16 h-16 mx-auto flex items-center justify-center">
                <AlertCircle className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-rose-200">
                Elaborazione non riuscita
              </h3>
              <p className="text-xs text-rose-300/80 leading-relaxed">
                {currentLecture.errorMessage || 'Si è verificato un errore durante la chiamata alle API.'}
              </p>
              <button
                onClick={() => setSelectedLectureId(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition"
              >
                Torna al Caricamento
              </button>
            </div>
          ) : (
            /* View 4: Completed Lecture Workspace */
            <div className="max-w-6xl mx-auto space-y-6">
              {/* Audio WaveSurfer Bar (Always Present) */}
              {currentLecture.audioBlob && (
                <div className="sticky top-0 z-30 pt-1 pb-3 backdrop-blur-md">
                  <WaveSurferPlayer
                    ref={waveSurferRef}
                    audioBlob={currentLecture.audioBlob}
                    onTimeUpdate={(t) => setCurrentTime(t)}
                  />
                </div>
              )}

              {/* Workspace Navigation Tabs */}
              <div className="flex items-center gap-1.5 border-b border-zinc-800 pb-2 overflow-x-auto">
                <button
                  onClick={() => setActiveTab('guide')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition shrink-0 ${
                    activeTab === 'guide'
                      ? 'bg-purple-600 text-white shadow-md'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                  }`}
                >
                  <BookOpen className="w-4 h-4" />
                  <span>Guida allo Studio (IT & Math)</span>
                </button>

                <button
                  onClick={() => setActiveTab('transcript')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition shrink-0 ${
                    activeTab === 'transcript'
                      ? 'bg-purple-600 text-white shadow-md'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                  }`}
                >
                  <Headphones className="w-4 h-4" />
                  <span>Trascrizione Bilingue</span>
                </button>

                <button
                  onClick={() => setActiveTab('glossary')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition shrink-0 ${
                    activeTab === 'glossary'
                      ? 'bg-purple-600 text-white shadow-md'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                  }`}
                >
                  <Bookmark className="w-4 h-4" />
                  <span>Glossario Tecnico (EN-IT)</span>
                </button>

                <button
                  onClick={() => setActiveTab('mindmap')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition shrink-0 ${
                    activeTab === 'mindmap'
                      ? 'bg-purple-600 text-white shadow-md'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                  }`}
                >
                  <Network className="w-4 h-4" />
                  <span>Mappa Concettuale</span>
                </button>

                <button
                  onClick={() => setActiveTab('chat')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition shrink-0 ${
                    activeTab === 'chat'
                      ? 'bg-purple-600 text-white shadow-md'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                  }`}
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>Chat con la Lezione (RAG)</span>
                </button>
              </div>

              {/* Tab Contents */}
              <div className="pt-2">
                {activeTab === 'guide' && currentLecture.data && (
                  <StudyGuideTab
                    studyGuideIt={currentLecture.data.study_guide_it}
                    examQuestions={currentLecture.data.potential_exam_questions}
                  />
                )}

                {activeTab === 'transcript' && currentLecture.data && (
                  <TranscriptTab
                    segments={currentLecture.data.timestamped_transcript}
                    currentTime={currentTime}
                    onSeek={handleSeekFromTranscript}
                  />
                )}

                {activeTab === 'glossary' && currentLecture.data && (
                  <GlossaryTab glossary={currentLecture.data.glossary} />
                )}

                {activeTab === 'mindmap' && currentLecture.data && (
                  <MindmapTab mindmapCode={currentLecture.data.mermaid_mindmap} />
                )}

                {activeTab === 'chat' && (
                  <LectureChatTab
                    lecture={currentLecture}
                    onOpenSettings={() => setIsSettingsOpen(true)}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
