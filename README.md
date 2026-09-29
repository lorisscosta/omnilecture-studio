<div align="center">

# 🎓 OmniLecture Studio

**Academic-Grade STEM Audio Lecture Studio powered by Google Gemini Multimodal AI & Local-First Cloud Sync**

Trasforma registrazioni audio universitarie in guide allo studio complete per Overleaf in LaTeX, trascrizioni bilingui continue, domande d'esame e chat tutor accademica con supporto per slide PDF e registrazioni multi-spezzone.

[![Live App](https://img.shields.io/badge/Live%20Production-recapp--rho.vercel.app-blue?style=for-the-badge&logo=vercel)](https://recapp-rho.vercel.app)
[![Next.js 15](https://img.shields.io/badge/Next.js-15.5-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19.0-61DAFB?style=for-the-badge&logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-38B2AC?style=for-the-badge&logo=tailwind-css)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase-Database%20%26%20Auth-3ECF8E?style=for-the-badge&logo=supabase)](https://supabase.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

[🌐 Applicazione Live](https://recapp-rho.vercel.app) • [✨ Funzionalità](#-funzionalità-principali) • [🎙️ Registrazioni Multiple](#-supporto-registrazioni-multiple) • [☁️ Configurazione Supabase](#-configurazione-supabase-cloud-sync) • [🔑 Chiave Google Gemini](#-configurazione-chiave-google-gemini) • [▲ Deploy Vercel](#-deploy-su-vercel) • [📱 Uso Mobile & Registratori OTG](#-registratori-hardware--smartphone)

</div>

---

## 📖 Panoramica del Progetto

**OmniLecture Studio** è una Progressive Web App (PWA) progettata specificamente per studenti universitari e ricercatori in ambito STEM (Ingegneria, Fisica, Matematica, Informatica).

I software di trascrizione tradizionali falliscono quando si tratta di lezioni universitarie da due ore, terminologia scientifica densa, dimostrazioni analitiche e formule matematiche complesse. OmniLecture Studio risolve questo problema grazie all'elaborazione multimodale nativa con **Google Gemini (1.5 Flash / 2.0 Flash / 1.5 Pro)** unita a un'architettura **Local-First con Cloud Sync Solo Testo**:

```mermaid
flowchart TD
    subgraph INPUT["1. Acquisizione & Input"]
        A["🎙️ Registrazioni Audio\n(Parte 1, Parte 2... con pausa)"]
        B["📄 Slide PDF (Opzionale)\n(Lucidi del docente)"]
    end

    subgraph CLIENT["2. Pipeline Multimodale Client-Side"]
        A --> C["⚡ Upload Diretto Google AI Studio\n(Bypassa il limite di 4.5MB di Vercel)"]
        B --> D["📑 Conversione Slide in Markdown (.md)"]
    end

    subgraph AI["3. Intelligenza Artificiale Gemini"]
        C & D --> E["🤖 Google Gemini Multimodal\n(1.5 Flash / 2.0 Flash / 1.5 Pro)"]
        E --> F["Strict Grounding (Fedeltà 100% all'audio)"]
    end

    subgraph OUTPUT["4. Risultati di Studio Accademici"]
        F --> G["📐 Guida Overleaf LaTeX (.tex)\n(Pronta da incollare con formule e dimostrazioni)"]
        F --> H["📜 Trascrizione Bilingue Continua\n(Con tempi continui e indicazione delle parti)"]
        F --> I["📚 Glossario Tecnico & Tutor AI\n(Domande interattive sui concetti)"]
        F --> J["🎯 Domande Tipiche d'Esame\n(Q&A con soluzione passo-passo)"]
    end

    subgraph STORAGE["5. Architettura Ibrida"]
        G & H & I & J --> K["💾 IndexedDB Locale (Dexie.js)\n(Audio originale + cache offline)"]
        G & H & I & J --> L["☁️ Supabase PostgreSQL Cloud Sync\n(Solo testo/formule: zero spreco storage audio)"]
    end
```

---

## ✨ Funzionalità Principali

### 📐 1. Documento LaTeX (.tex) per Overleaf, Anteprima KaTeX & Linter
- Genera un **documento accademico LaTeX completo** pronto per essere copiato e compilato con un solo click su [Overleaf](https://www.overleaf.com/).
- Include il preambolo accademico standard (`\documentclass{article}`, `\usepackage{amsmath,amssymb,amsthm,geometry,hyperref}`, `babel` italiano, impostazioni margini).
- Include la macro compatibile Overleaf `\newcommand{\ts}[2]{\marginpar{\scriptsize\texttt{[P#1 #2s]}}}` per annotare i timestamp audio a margine.
- **Anteprima KaTeX Interattiva**: visualizzazione immediata delle formule matematiche con supporto "click-to-seek" che porta il player audio esattamente al timestamp della spiegazione.
- **Linter Sintattico LaTeX Integrato**: pannello diagnostico che analizza in tempo reale il codice `.tex` evidenziando ambienti non chiusi (`\begin{...}` senza `\end{...}`) o parentesi sbilanciate prima dell'esportazione.
- Pulsanti rapidi **"Copia per Overleaf"** e download del file sorgente `.tex`.

### 🎙️ 2. Registrazioni Multiple & Chunking Robusto per Lezioni Lunghe (>2h)
- Consente di caricare **più registrazioni audio sequenziali** della stessa lezione (es. prima e dopo la pausa).
- **Riordinamento visivo** con pulsanti [▲ Sposta Su] e [▼ Sposta Giù] per garantire la cronologia corretta.
- **Elaborazione a Blocchi (Chunking)**: per lezioni universitarie oltre le 2 ore, l'audio viene suddiviso ed elaborato con retry automatico a backoff esponenziale (con jitter) in caso di transient rate-limit.
- **Player WaveSurfer con Playlist Automatica**: al termine di una parte avanza automaticamente alla traccia successiva; cliccando sui timestamp della trascrizione salta direttamente alla parte e al secondo corretti.

### 📜 3. Doppia Modalità Trascrizione (Continua & Segmentata)
- **Modalità Continua**: lettura fluida dell'intera lezione come un testo unico e continuo privo di interruzioni temporali, ideale per lo studio e la stampa.
- **Modalità Segmentata**: blocchi temporizzati sincronizzati con il player audio, speaker e indicatore della parte audio (P1, P2...).
- Filtri lingua istantanei: **Bilingue (Originale + Traduzione Italiana)**, **Solo Italiano**, **Solo Originale**.
- Ricerca istantanea nel testo con evidenziazione.

### 📚 4. Glossario Tecnico & Tutor AI della Lezione
- Estrazione automatica dei termini matematici e tecnici citati nella lezione con traduzione accademica e definizione rigorosa.
- **Tutor AI interattivo**: chat contestuale basata rigorosamente sulla trascrizione della lezione per chiarire dubbi, verificare dimostrazioni e generare domande tipiche d'esame con soluzioni passo-passo.

### 📑 5. Timeline Multimodale Slide PDF & Gestione Markdown (.md)
- Tab dedicato **Slide & Timeline** con allineamento temporale sincronizzato tra slide del docente e registrazione audio.
- Conversione automatica delle slide in formato Markdown accademico (`.md`) per consultare rapidamente formule, elenchi e diagrammi.
- Ricerca interna per argomento e salto audio immediato al momento in cui il docente ha discusso ogni specifica slide.

### 📱 6. Interfaccia Ergonomica & Responsive (PC & Mobile PWA)
- **Architettura a 4 Tab Focalizzati**: Guida LaTeX, Trascrizione, Glossario & Tutor AI, Slide & Timeline.
- **Protezione Anti-Overflow KaTeX**: formule matematiche e matrici complesse scorrono dolcemente in orizzontale (`-webkit-overflow-scrolling: touch`) senza deformare la schermata mobile.
- Nessuna ridondanza nei controlli: ogni pulsante ha una funzione univoca e ben definita.

---

## ☁️ Configurazione Supabase (Cloud Sync Solo Testo)

OmniLecture Studio adotta un'architettura **Text-Only Cloud Sync**:
> **Perché non carichiamo l'audio nel cloud?**  
> I file audio delle lezioni possono pesare centinaia di megabyte. Conservando l'audio in locale (IndexedDB del browser) e sincronizzando su Supabase **esclusivamente i testi, le formule LaTeX, i glossari e le trascrizioni**, l'applicazione rispetta i limiti del piano gratuito di Supabase (50MB di upload e 1GB di database) a tempo indeterminato e a costo zero.

### 1. Crea un progetto su Supabase
1. Vai su [supabase.com](https://supabase.com/) e accedi (o registrati gratuitamente).
2. Clicca su **"New Project"** e inserisci nome del progetto e password del database.
3. Attendi il completamento del provisioning (circa 1-2 minuti).

### 2. Esegui lo Schema SQL nel SQL Editor
Apri la sezione **SQL Editor** nella dashboard di Supabase e incolla questo script per creare la tabella e le regole di sicurezza (RLS):

```sql
-- 1. Crea la tabella per memorizzare i testi delle lezioni
CREATE TABLE IF NOT EXISTS public.lectures (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    title TEXT NOT NULL,
    course TEXT NOT NULL,
    date TEXT NOT NULL,
    audio_filename TEXT NOT NULL,
    duration INTEGER DEFAULT 0,
    glossary JSONB DEFAULT '[]'::jsonb,
    timestamped_transcript JSONB DEFAULT '[]'::jsonb,
    study_guide_it TEXT DEFAULT '',
    potential_exam_questions JSONB DEFAULT '[]'::jsonb,
    mermaid_mindmap TEXT DEFAULT '',
    slides_filename TEXT,
    slides_markdown TEXT,
    slides_alignment JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Abilita la Row Level Security (RLS) per proteggere i dati
ALTER TABLE public.lectures ENABLE ROW LEVEL SECURITY;

-- 3. Policy: ogni utente può visualizzare solo le proprie lezioni
CREATE POLICY "Users can select own lectures" 
ON public.lectures FOR SELECT 
USING (auth.uid() = user_id);

-- 4. Policy: ogni utente può inserire/aggiornare le proprie lezioni
CREATE POLICY "Users can insert own lectures" 
ON public.lectures FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own lectures" 
ON public.lectures FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own lectures" 
ON public.lectures FOR DELETE 
USING (auth.uid() = user_id);
```

### 3. Recupera le credenziali API di Supabase
1. Nella dashboard di Supabase, vai su **Project Settings** (icona ingranaggio) $\to$ **API**.
2. Copia:
   - **Project URL** (es. `https://xyzcompany.supabase.co`)
   - **Project API Keys** $\to$ chiave pubblica **`anon` / `public`**

---

## 🔑 Configurazione Chiave Google Gemini

L'applicazione utilizza le API multimodali di Google per analizzare direttamente i file audio.

1. Vai su [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Accedi con il tuo account Google e clicca su **"Create API Key"** (gratuita).
3. Copia la chiave generata (inizia con `AIzaSy...`).

### Dove inserire la chiave nell'applicazione:
- **Metodo Diretto BYOK (Consigliato):** Apri OmniLecture Studio nel browser, clicca sull'icona delle **Impostazioni** (⚙️) e incolla la tua chiave. Verrà salvata in modo sicuro nel `localStorage` del tuo browser.
- **Rilevamento Dinamico Modelli & Fallback Automatico:** Una volta inserita la chiave, l'app interroga Google AI Studio per identificare i modelli attivi associati alla tua chiave (es. `gemini-2.5-flash`, `gemini-2.0-flash`, `gemini-1.5-pro`). Se un modello incontra un rate limit temporaneo (429 o saturazione della quota), il sistema esegue tentativi con backoff esponenziale e fallback intelligente.
- **Variabile d'Ambiente (Opzionale come fallback):** Puoi anche impostarla nel file `.env.local` come `GEMINI_API_KEY=tua_chiave`.

---

## ▲ Deploy su Vercel

Il progetto è pre-configurato per il deployment istantaneo su [Vercel](https://vercel.com/):

### 1. Collega il repository a Vercel
1. Esegui il fork o push del progetto sul tuo account GitHub.
2. Vai su [vercel.com](https://vercel.com/) e clicca su **"Add New..."** $\to$ **"Project"**.
3. Importa il repository `omnilecture-studio`.

### 2. Imposta le Variabili d'Ambiente su Vercel
Nella schermata di configurazione del progetto su Vercel, espandi la sezione **Environment Variables** e aggiungi:

| Nome Variabile | Descrizione | Esempio |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL del tuo progetto Supabase | `https://ffjvkuawnwelvoctjgkl.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chiave anon pubblica di Supabase | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |
| `GEMINI_API_KEY` | *(Opzionale)* Fallback per proxy server | `AIzaSy...` |

### 3. Clicca su "Deploy"
Vercel compilerà ed eseguirà il deploy globale in circa 1 minuto.  
Ad ogni successivo `git push origin main`, Vercel aggiornerà automaticamente la versione in produzione.

---

## 🎙️ Registratori Hardware & Smartphone

OmniLecture Studio supporta l'acquisizione audio da qualsiasi registratore digitale (**FoCase Rec**, **Sony ICD**, **Philips VoiceTracer**, **Olympus**) e da smartphone:

1. **Collegamento Diretto USB-C / OTG:**
   - Collega il registratore vocale al PC, tablet o smartphone tramite cavetto USB-C o adattatore OTG.
   - Il registratore viene montato come memoria di massa USB.
   - Clicca su **"Nuova Registrazione"** e seleziona i file `.wav` o `.mp3` direttamente dalla memoria del registratore.
2. **Smartphone / App Companion (es. FoCase Rec):**
   - Sincronizza l'audio tramite Bluetooth sull'app dello smartphone.
   - Condividi o salva il file audio nella memoria del telefono e selezionalo dal browser mobile.

---

## 💻 Installazione Locale & Sviluppo

Se desideri eseguire il progetto in locale sul tuo computer:

```bash
# 1. Clona il repository
git clone https://github.com/lorisscosta/omnilecture-studio.git
cd omnilecture-studio

# 2. Installa le dipendenze
npm install

# 3. Crea il file .env.local
cp .env.example .env.local # oppure crea .env.local con le variabili indicate sopra

# 4. Avvia il server di sviluppo
npm run dev
```

Apri [http://localhost:3000](http://localhost:3000) nel tuo browser.

Per verificare la suite di test e la build di produzione in locale:
```bash
npm run test     # Esegue 43 test unitari con Vitest
npm run build    # Verifica il build di produzione Next.js 15
npm run start    # Avvia la build in locale
```

---

## 🛠️ Stack Tecnologico

| Componente | Tecnologia |
| :--- | :--- |
| **Framework** | [Next.js 15](https://nextjs.org/) (App Router, Server Actions) |
| **Frontend** | [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Tailwind CSS](https://tailwindcss.com/) |
| **AI Multimodale** | [Google Gemini 1.5 Flash](https://ai.google.dev/) (Predefinito), Gemini 2.0 Flash, Gemini 1.5 Pro |
| **Formule Matematiche** | [KaTeX](https://katex.org/) (Rendering LaTeX interattivo ad alta velocità con audio seek) |
| **Audio Waveform** | [WaveSurfer.js 7](https://wavesurfer.xyz/) & HTML5 Web Audio API |
| **Database Locale** | [Dexie.js](https://dexie.com/) (IndexedDB client-side offline-first v2) |
| **Cloud Sync & Auth** | [Supabase](https://supabase.com/) (PostgreSQL & Row Level Security) |
| **Testing** | [Vitest](https://vitest.dev/) (Suite di test unitari automatizzati) |
| **Hosting & Edge** | [Vercel](https://vercel.com/) |

---

## 📄 Licenza

Rilasciato sotto licenza MIT. Consulta il file `LICENSE` per maggiori informazioni.

<div align="center">
Sviluppato con ❤️ per studenti universitari e ricercatori STEM.
</div>
