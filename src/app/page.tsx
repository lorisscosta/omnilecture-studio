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
  Cloud,
  Check,
  Loader2,
  FileText,
} from 'lucide-react';
import { db, getAllLectures, deleteLectureById, saveLecture, getLectureById } from '@/lib/db';
import { Lecture } from '@/lib/types';
import {
  supabase,
  syncLectureToSupabase,
  fetchCloudLectures,
  deleteCloudLecture,
  isSupabaseConfigured,
} from '@/lib/supabase';
import { WaveSurferPlayer, WaveSurferPlayerHandle } from '@/components/audio/WaveSurferPlayer';
import { AudioUploader } from '@/components/audio/AudioUploader';
import { SettingsModal } from '@/components/settings/SettingsModal';
import { AuthModal } from '@/components/auth/AuthModal';
import { ObsidianExportButton } from '@/components/export/ObsidianExportButton';
import { StudyGuideTab } from '@/components/workspace/StudyGuideTab';
import { TranscriptTab } from '@/components/workspace/TranscriptTab';
import { GlossaryTab } from '@/components/workspace/GlossaryTab';
import { SlidesModal } from '@/components/workspace/SlidesModal';
import type { User } from '@supabase/supabase-js';

export default function HomePage() {
  const [selectedLectureId, setSelectedLectureId] = useState<string | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [activeTab, setActiveTab] = useState<'guide' | 'transcript' | 'glossary'>('guide');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isSlidesModalOpen, setIsSlidesModalOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncSuccessToast, setSyncSuccessToast] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);

  const waveSurferRef = useRef<WaveSurferPlayerHandle>(null);
  const hasInitializedRef = useRef(false);

  // Live query from IndexedDB
  const lectures = useLiveQuery(() => getAllLectures(), []) || [];
  const currentLecture = !isCreatingNew ? lectures.find((l) => l.id === selectedLectureId) : null;

  // Auto-select first lecture only once on initial app load if available and not explicitly creating new
  useEffect(() => {
    if (!hasInitializedRef.current && lectures.length > 0) {
      hasInitializedRef.current = true;
      if (!isCreatingNew && selectedLectureId === null) {
        setSelectedLectureId(lectures[0].id);
      }
    }
  }, [lectures, isCreatingNew, selectedLectureId]);

  // Supabase Auth Listener
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      setCurrentUser(session?.user ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUser(session?.user ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Pull cloud lectures on login and merge into local Dexie IndexedDB
  useEffect(() => {
    if (!currentUser) return;

    const pullFromCloud = async () => {
      try {
        const cloudLectures = await fetchCloudLectures(currentUser.id);
        for (const cloudLec of cloudLectures) {
          const localLec = await getLectureById(cloudLec.id);
          if (!localLec) {
            await saveLecture(cloudLec);
          } else {
            await db.lectures.update(cloudLec.id, {
              isCloudSynced: true,
              cloudSyncedAt: cloudLec.cloudSyncedAt,
            });
          }
        }
      } catch (err) {
        console.warn('Error pulling cloud lectures:', err);
      }
    };

    pullFromCloud();
  }, [currentUser]);

  // Handle seeking from transcript
  const handleSeekFromTranscript = (seconds: number) => {
    waveSurferRef.current?.seekTo(seconds);
  };

  // Sync current lecture to Supabase PostgreSQL (Text-Only)
  const handleSyncToCloud = async (lecture: Lecture) => {
    if (!currentUser) {
      setIsAuthModalOpen(true);
      return;
    }

    setIsSyncing(true);
    setSyncSuccessToast(null);

    try {
      const res = await syncLectureToSupabase(lecture, currentUser.id);
      if (!res.success) {
        alert('Errore sincronizzazione: ' + (res.error || 'Errore sconosciuto'));
        return;
      }

      const activeId = res.updatedId || lecture.id;
      if (res.updatedId && selectedLectureId === lecture.id) {
        setSelectedLectureId(res.updatedId);
      }

      await db.lectures.update(activeId, {
        isCloudSynced: true,
        cloudSyncedAt: new Date().toISOString(),
        userId: currentUser.id,
      });

      setSyncSuccessToast('Sincronizzato nel Cloud Supabase!');
      setTimeout(() => setSyncSuccessToast(null), 3000);
    } catch (err: any) {
      alert('Errore durante la sincronizzazione: ' + err.message);
    } finally {
      setIsSyncing(false);
    }
  };

  // Delete lecture locally and from cloud if synced
  const handleDeleteLecture = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Sei sicuro di voler eliminare questa lezione?')) {
      await deleteLectureById(id);
      if (currentUser) {
        await deleteCloudLecture(id);
      }
      if (selectedLectureId === id) {
        setSelectedLectureId(null);
      }
    }
  };

  // Demo Lecture Generator for immediate testing
  const loadDemoLecture = async () => {
    const demoId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : '00000000-0000-4000-8000-' + Date.now().toString(16).padStart(12, '0');
    const demoLecture: Lecture = {
      id: demoId,
      title: 'Lezione 04: Discrete Fourier Transform & Fast Convolution',
      course: 'Digital Signal Processing (DSP)',
      date: new Date().toISOString(),
      duration: 360,
      fileSize: 15 * 1024 * 1024,
      fileName: 'dsp_lecture_04_dft.mp3',
      slidesFileName: 'DSP_Lezione_04_Slides_DFT.pdf',
      hasSlides: true,
      slidesMarkdown: `# Slide Corso: Digital Signal Processing (DSP)
## Slide 1: Discrete Fourier Transform & Fast Convolution
- Docente: Prof. Miller
- Corso di Laurea Magistrale in Ingegneria
- Obiettivi: Definizione formale della DFT, proprietà di periodicità, convoluzione circolare vs lineare.

## Slide 2: Campionamento nel Dominio della Frequenza
- La DTFT opera su tempo discreto e frequenza continua $\\omega \\in [-\\pi, \\pi]$.
- La DFT campiona la DTFT in $N$ punti equispaziati sulla circonferenza unitaria:
  $$\\omega_k = \\frac{2\\pi k}{N}, \\quad k = 0, 1, \\dots, N-1$$

## Slide 3: Equazioni di Analisi e Sintesi DFT
- Equazione di Analisi (DFT diretta):
  $$X[k] = \\sum_{n=0}^{N-1} x[n] W_N^{kn}, \\quad k = 0, \\dots, N-1$$
  dove $W_N = e^{-j \\frac{2\\pi}{N}}$ rappresenta il fattore di rotazione (twiddle factor).
- Equazione di Sintesi (IDFT inversa):
  $$x[n] = \\frac{1}{N} \\sum_{k=0}^{N-1} X[k] W_N^{-kn}, \\quad n = 0, \\dots, N-1$$

## Slide 4: Teorema della Convoluzione Circolare
- Moltiplicazione spettrale: $Y[k] = X_1[k] \\cdot X_2[k]$
- Proprietà temporale: $y[n] = x_1[n] \\circledast_N x_2[n]$
- Attenzione: Non coincide con la convoluzione lineare se $N < L_1 + L_2 - 1$ a causa del time-domain aliasing.

## Slide 5: Filtraggio a Blocchi: Overlap-Add & Overlap-Save
- Permettono il filtraggio continuo di segnali lunghi tramite blocchi FFT veloci.
- [Descrizione Schema: Diagramma a blocchi con partizionamento del segnale $x[n]$, calcolo FFT, moltiplicazione spettrale con $H[k]$, e ricomposizione con overlap-add].`,
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
        study_guide_it: `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[italian]{babel}
\\usepackage{amsmath,amssymb,amsthm,mathtools}
\\usepackage{geometry}
\\geometry{a4paper, margin=2.5cm}
\\usepackage{hyperref}
\\usepackage{xcolor}
\\usepackage{microtype}

\\hypersetup{
    colorlinks=true,
    linkcolor=blue!70!black,
    citecolor=green!50!black,
    urlcolor=purple!70!black
}

\\newtheorem{theorem}{Teorema}[section]
\\newtheorem{definition}{Definizione}[section]
\\newtheorem{example}{Esempio}[section]

\\title{\\textbf{Lezione 04: Discrete Fourier Transform \\& Fast Convolution}\\\\ \\large \\textit{Corso di Digital Signal Processing (DSP)}}
\\author{OmniLecture Studio \\and Trascrizione Accademica Integrale}
\\date{\\today}

\\begin{document}
\\maketitle

\\begin{abstract}
Questo documento raccoglie la trascrizione e rielaborazione accademica integrale della lezione n. 04 di Digital Signal Processing. Viene affrontata la derivazione rigorosa della Trasformata di Fourier Discreta (DFT), la sua interpretazione geometrica sul cerchio unitario e l'equivalenza fondamentale tra moltiplicazione spettrale e convoluzione circolare nel tempo discreto.
\\end{abstract}

\\tableofcontents
\\vspace{1cm}
\\hrule
\\vspace{0.5cm}

\\section{Introduzione e Trascrizione del Parlato}
Buongiorno a tutti. Oggi esploreremo la struttura matematica della Trasformata di Fourier Discreta e della convoluzione circolare.
Ricordate che mentre la DTFT opera nel tempo discreto e nella frequenza continua, la DFT campiona il dominio della frequenza in $N$ punti equidistanti sulla circonferenza unitaria.

\\section{Definizione Matematica della Trasformata di Fourier Discreta}
\\begin{definition}[DFT e IDFT]
Sia $x[n]$ una sequenza a lunghezza finita di $N$ campioni ($n = 0, 1, \\dots, N-1$). La sua Trasformata di Fourier Discreta $X[k]$ è definita formalmente come:
\\begin{equation}
X[k] = \\sum_{n=0}^{N-1} x[n] W_N^{kn}, \\quad k = 0, 1, \\dots, N-1
\\end{equation}
dove il fattore di rotazione (twiddle factor) è dato da:
\\begin{equation}
W_N = e^{-j \\frac{2\\pi}{N}}
\\end{equation}
La trasformata inversa (IDFT) consente la perfetta ricostruzione del segnale temporale campionario:
\\begin{equation}
x[n] = \\frac{1}{N} \\sum_{k=0}^{N-1} X[k] W_N^{-kn}, \\quad n = 0, 1, \\dots, N-1
\\end{equation}
\\end{definition}

\\section{Teorema della Convoluzione Circolare}
Fate molta attenzione a quanto spiegato dal docente: la moltiplicazione tra due DFT nel dominio della frequenza \\textbf{NON} corrisponde alla convoluzione lineare, bensì alla convoluzione circolare a causa della ripetizione periodica implicita.

\\begin{theorem}[Moltiplicazione Spettrale]
Siano $x[n]$ e $h[n]$ due segnali di lunghezza $N$. Il prodotto punto a punto nel dominio trasformato:
\\begin{equation}
Y[k] = X[k] \\cdot H[k]
\\end{equation}
corrisponde nel dominio del tempo discreto all'operazione di convoluzione circolare:
\\begin{equation}
y[n] = x[n] \\circledast_N h[n] = \\sum_{m=0}^{N-1} x[m] h[((n - m))_N]
\\end{equation}
\\end{theorem}

\\begin{proof}
Calcoliamo l'antitrasformata del prodotto $Y[k]$:
\\begin{equation}
y[n] = \\frac{1}{N} \\sum_{k=0}^{N-1} \\left( \\sum_{m=0}^{N-1} x[m] W_N^{km} \\right) \\left( \\sum_{l=0}^{N-1} h[l] W_N^{kl} \\right) W_N^{-kn}
\\end{equation}
Scambiando l'ordine di sommatoria:
\\begin{equation}
y[n] = \\sum_{m=0}^{N-1} x[m] \\sum_{l=0}^{N-1} h[l] \\left[ \\frac{1}{N} \\sum_{k=0}^{N-1} W_N^{k(m+l-n)} \\right]
\\end{equation}
Utilizzando la proprietà di ortogonalità della base esponenziale:
\\begin{equation}
\\frac{1}{N} \\sum_{k=0}^{N-1} W_N^{k(m+l-n)} = \\sum_{r=-\\infty}^{+\\infty} \\delta[m+l-n - rN]
\\end{equation}
Otteniamo direttamente la formula della convoluzione circolare modulo $N$:
\\begin{equation}
y[n] = \\sum_{m=0}^{N-1} x[m] h[((n - m))_N]
\\end{equation}
\\end{proof}

\\section{Zero-Padding e Convoluzione Lineare Veloce}
Per calcolare una convoluzione lineare tramite Fast Fourier Transform (FFT) senza incorrere in aliasing temporale (time-domain aliasing), è condizione necessaria e sufficiente applicare lo zero-padding portando la lunghezza comune ad almeno:
\\begin{equation}
N \\ge N_x + N_h - 1
\\end{equation}

\\end{document}`,
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

      {/* Supabase Auth Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        currentUser={currentUser}
        onUserChange={setCurrentUser}
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
              setIsCreatingNew(true);
              setIsSidebarOpen(false);
            }}
            className={`w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-semibold shadow-md transition ${
              isCreatingNew || selectedLectureId === null
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
            const isSelected = !isCreatingNew && lec.id === selectedLectureId;
            return (
              <div
                key={lec.id}
                onClick={() => {
                  setSelectedLectureId(lec.id);
                  setIsCreatingNew(false);
                  setIsSidebarOpen(false);
                }}
                className={`group relative rounded-xl p-3 cursor-pointer transition border ${
                  isSelected
                    ? 'bg-purple-950/40 border-purple-500/60 shadow-md'
                    : 'bg-zinc-900/40 border-transparent hover:bg-zinc-900 hover:border-zinc-800'
                }`}
              >
                <div className="flex items-start justify-between gap-1 mb-1">
                  <div className="flex items-center gap-1.5 truncate max-w-[170px]">
                    <span className="text-[10px] font-bold text-purple-400 uppercase truncate">
                      {lec.course}
                    </span>
                    {lec.isCloudSynced && (
                      <span title="Sincronizzato su Supabase (Solo Testo)">
                        <Cloud className="w-3 h-3 text-emerald-400 shrink-0" />
                      </span>
                    )}
                  </div>
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
        <div className="p-3 border-t border-zinc-800/80 bg-zinc-950 space-y-1.5">
          <button
            onClick={() => setIsAuthModalOpen(true)}
            className="w-full flex items-center justify-between p-2 rounded-xl text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition"
          >
            <div className="flex items-center gap-2">
              <Cloud className="w-4 h-4 text-purple-400" />
              <span>{currentUser ? 'Account Cloud' : 'Accedi al Cloud'}</span>
            </div>
            <span className="text-[10px] text-zinc-500 font-mono">
              {currentUser ? currentUser.email?.split('@')[0] : 'Supabase'}
            </span>
          </button>

          <button
            onClick={() => setIsSettingsOpen(true)}
            className="w-full flex items-center justify-between p-2 rounded-xl text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition"
          >
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-purple-400" />
              <span>Impostazioni API</span>
            </div>
            <span className="text-[10px] text-zinc-500">Gemini</span>
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

            {currentLecture && !isCreatingNew ? (
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
            {/* Cloud Sync Status Toast */}
            {syncSuccessToast && (
              <span className="text-[11px] font-semibold text-emerald-300 bg-emerald-950/80 border border-emerald-800 px-2.5 py-1 rounded-lg animate-in fade-in">
                ✓ {syncSuccessToast}
              </span>
            )}

            {currentLecture && !isCreatingNew && (
              <button
                onClick={() => {
                  setSelectedLectureId(null);
                  setIsCreatingNew(true);
                }}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-700/80 transition"
                title="Nuova Registrazione"
              >
                <Plus className="w-3.5 h-3.5 text-purple-400" />
                <span>Nuova</span>
              </button>
            )}

            {/* Sync to Cloud Button (Text-Only to Supabase) */}
            {currentLecture && !isCreatingNew && currentLecture.data && (
              <button
                onClick={() => handleSyncToCloud(currentLecture)}
                disabled={isSyncing}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-md transition ${
                  currentLecture.isCloudSynced
                    ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800 hover:bg-emerald-900/80'
                    : 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-950/40'
                }`}
                title="Sincronizza testi, formule Overleaf e trascrizioni su Supabase (audio escluso)"
              >
                {isSyncing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : currentLecture.isCloudSynced ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Cloud className="w-3.5 h-3.5" />
                )}
                <span className="hidden sm:inline">
                  {isSyncing
                    ? 'Sincronizzazione...'
                    : currentLecture.isCloudSynced
                    ? 'Nel Cloud'
                    : 'Sync su Cloud'}
                </span>
              </button>
            )}

            {/* Slide (.pdf / .md) Management Button */}
            {currentLecture && !isCreatingNew && currentLecture.data && (
              <button
                onClick={() => setIsSlidesModalOpen(true)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-md transition ${
                  currentLecture.hasSlides
                    ? 'bg-purple-950/70 text-purple-200 border border-purple-800 hover:bg-purple-900/80'
                    : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700/80'
                }`}
                title="Gestisci o carica le slide PDF (converte in .md e collega all'audio)"
              >
                <FileText className="w-3.5 h-3.5 text-purple-400" />
                <span className="hidden sm:inline">
                  {currentLecture.hasSlides ? 'Slide (.md)' : 'Allega Slide'}
                </span>
                {currentLecture.hasSlides && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                )}
              </button>
            )}

            {currentLecture && !isCreatingNew && currentLecture.data && (
              <ObsidianExportButton lecture={currentLecture} />
            )}

            {/* Supabase Account Button */}
            <button
              onClick={() => setIsAuthModalOpen(true)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium border transition ${
                currentUser
                  ? 'bg-purple-950/40 border-purple-800 text-purple-200 hover:bg-purple-900/50'
                  : 'bg-zinc-900 border-zinc-700/80 text-zinc-300 hover:bg-zinc-800'
              }`}
              title={currentUser ? `Connesso: ${currentUser.email}` : 'Accedi a Supabase'}
            >
              <Cloud className="w-3.5 h-3.5 text-purple-400" />
              <span className="hidden md:inline">
                {currentUser ? currentUser.email?.split('@')[0] : 'Accedi'}
              </span>
            </button>

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
          {/* View 1: Audio Uploader (when no lecture selected or creating new) */}
          {!currentLecture || isCreatingNew ? (
            <div className="py-6">
              <AudioUploader
                onLectureCreated={(id) => {
                  setSelectedLectureId(id);
                  setIsCreatingNew(false);
                }}
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
                  'Gemini sta elaborando la registrazione, generando la trascrizione bilingue, calcolando le formule LaTeX e strutturando gli appunti.'}
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
                onClick={() => {
                  setSelectedLectureId(null);
                  setIsCreatingNew(true);
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition"
              >
                Torna al Caricamento
              </button>
            </div>
          ) : (
            /* View 4: Completed Lecture Workspace */
            <div className="max-w-6xl mx-auto space-y-6">
              {/* Audio WaveSurfer Bar or Cloud Sync Text-Only Banner */}
              {currentLecture.audioBlob ? (
                <div className="sticky top-0 z-30 pt-1 pb-3 backdrop-blur-md">
                  <WaveSurferPlayer
                    ref={waveSurferRef}
                    audioBlob={currentLecture.audioBlob}
                    onTimeUpdate={(t) => setCurrentTime(t)}
                    onDurationChange={(dur) => {
                      if ((!currentLecture.duration || currentLecture.duration === 0) && dur > 0) {
                        db.lectures.update(currentLecture.id, { duration: Math.round(dur) }).catch(console.error);
                      }
                    }}
                  />
                </div>
              ) : (
                <div className="sticky top-0 z-30 pt-1 pb-3 backdrop-blur-md">
                  <div className="flex items-center justify-between p-3.5 rounded-xl bg-zinc-900/90 border border-purple-900/50 text-xs text-zinc-300 shadow-md">
                    <div className="flex items-center gap-2.5">
                      <div className="p-1.5 rounded-lg bg-purple-950 text-purple-400 border border-purple-800/60">
                        <Cloud className="w-4 h-4" />
                      </div>
                      <div>
                        <span className="font-semibold text-zinc-200">Sincronizzazione Cloud Solo Testo:</span>
                        <span className="text-zinc-400 ml-1">
                          Il file audio originale risiede sul dispositivo di registrazione locale. Tutti i contenuti testuali, formule Overleaf LaTeX e trascrizioni sono sincronizzati e pronti per lo studio.
                        </span>
                      </div>
                    </div>
                    <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-purple-950 border border-purple-800 text-purple-300 shrink-0 ml-2">
                      Text-Only Sync
                    </span>
                  </div>
                </div>
              )}

              {/* Slide Integration Banner / Status */}
              {currentLecture.hasSlides ? (
                <div className="flex items-center justify-between p-3 rounded-xl bg-purple-950/30 border border-purple-800/50 text-xs text-purple-200 shadow-sm">
                  <div className="flex items-center gap-2.5 truncate">
                    <div className="p-1.5 rounded-lg bg-purple-900/60 border border-purple-700/80 text-purple-300">
                      <FileText className="w-3.5 h-3.5" />
                    </div>
                    <div className="truncate">
                      <span className="font-semibold text-zinc-100">Slide collegate:</span>{' '}
                      <span className="text-purple-300 font-mono truncate">{currentLecture.slidesFileName}</span>
                      <span className="text-zinc-400 hidden sm:inline ml-1.5">• Markdown integrato con la registrazione</span>
                    </div>
                  </div>
                  <button
                    onClick={() => setIsSlidesModalOpen(true)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-900/60 hover:bg-purple-800 border border-purple-700 text-purple-200 transition shrink-0 ml-2"
                  >
                    Vedi Markdown (.md)
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-xs text-zinc-400 hover:border-zinc-700 transition shadow-sm">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-400">
                      <FileText className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <span className="font-semibold text-zinc-200">Hai il PDF delle slide di questa lezione?</span>
                      <span className="text-zinc-400 hidden sm:inline ml-1">
                        Caricalo per convertirlo in Markdown (.md) e integrare formule e riferimenti puntuali [Slide X] nella Guida Overleaf LaTeX.
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => setIsSlidesModalOpen(true)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white shadow-md shadow-purple-950/40 transition shrink-0 ml-2"
                  >
                    + Allega Slide (PDF)
                  </button>
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
                  <span>Guida allo Studio (LaTeX Overleaf)</span>
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
                  <span>Glossario & Tutor AI</span>
                </button>
              </div>

              {/* Tab Contents */}
              <div className="pt-2">
                {activeTab === 'guide' && currentLecture.data && (
                  <StudyGuideTab
                    studyGuideIt={currentLecture.data.study_guide_it}
                    examQuestions={currentLecture.data.potential_exam_questions}
                    lectureTitle={currentLecture.title}
                    course={currentLecture.course}
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
                  <GlossaryTab
                    glossary={currentLecture.data.glossary}
                    lecture={currentLecture}
                    onOpenSettings={() => setIsSettingsOpen(true)}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Modals */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        currentUser={currentUser}
        onUserChange={(u) => setCurrentUser(u)}
      />

      {currentLecture && (
        <SlidesModal
          isOpen={isSlidesModalOpen}
          onClose={() => setIsSlidesModalOpen(false)}
          lecture={currentLecture}
          onSlidesUpdated={() => {}}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />
      )}
    </div>
  );
}
