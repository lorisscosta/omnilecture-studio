# Piano di Aggiornamento Architetturale: OmniLecture Studio (Fasi 1-4)

## 1. Mappatura Moduli Esistenti

OmniLecture Studio adotta un'architettura **local-first** altamente reattiva, progettata per lezioni universitarie STEM con supporto per registrazioni multi-spezzone e slide PDF.

### 1.1 Chiamate e Pipeline Gemini
- **`src/lib/gemini-service.ts`**:
  - **BYOK (Bring Your Own Key)**: Chiamate client-side dirette alle API di Google Generative Language (`https://generativelanguage.googleapis.com/v1beta`).
  - **Upload Audio**: Caricamento diretto tramite Google AI Studio Files API (`/upload/v1beta/files`) con chunking HTTP o upload diretto per bypassare il limite di 4.5MB del serverless di Vercel.
  - **Modelli**: Selezione modelli in fallback (es. `gemini-2.0-flash`, `gemini-1.5-flash-latest`, con necessità di sanitizzazione da alias obsoleti).
  - **Generazione Output**:
    - Trascrizione con timestamp e speaker diarization (`generateTranscript`).
    - Guida di studio LaTeX ottimizzata per Overleaf (`generateStudyGuideLaTeX`).
    - Glossario tecnico con definizioni formali (`generateGlossary`).
    - Domande d'esame e quiz concettuali (`generateExamQuestions`).
  - **Chat Tutor**: Interazione contestuale basata sulla trascrizione della lezione (`chatWithTutor`).
- **`src/app/api/gemini/process-audio/route.ts` & `src/app/api/gemini/chat/route.ts`**:
  - Proxy backend su Next.js API Routes per utenti privi di BYOK (chiave server `GEMINI_API_KEY`).
  - Attualmente privi di autenticazione Supabase JWT e privi di rate limiting atomico per lambdas serverless.

### 1.2 Pipeline Dati e Storage
- **Dexie.js (IndexedDB Client-side) (`src/lib/db.ts`)**:
  - Tabella `recordings`: Metadati lezione, titolo, corso, data, stato processing, link PDF opzionale.
  - Tabella `audios`: File audio binari (`Blob` / `ArrayBuffer`), durata, spezzoni (parts). **I file audio restano esclusivamente in IndexedDB**.
  - Tabella `transcripts`: Testo trascrizione, segmenti timestampati, guida LaTeX, glossario, domande d'esame.
  - Tabella `chatMessages`: Storico conversazioni col tutor AI per singola lezione.
  - Tabella `settings`: Preferenze utente, BYOK Gemini API key, modello preferito.
- **Supabase (PostgreSQL + RLS + Auth) (`src/lib/supabase.ts`)**:
  - Sincronizzazione remota selettiva: **SOLO** metadati, testi, LaTeX, glossario, quiz e chat.
  - Nessun blob audio inviato a Supabase.
  - RLS configurata per isolamento multi-tenant basato su `auth.uid() = user_id`.

---

## 2. Piani Dettagliati per Fase

### Fase 1: Robustezza (Robustness & Security)
1. **Configurazione Modelli Gemini Dinamica & Centralizzata (`src/lib/gemini-config.ts`)**:
   - Chiamata a `ListModels` API (`GET /v1beta/models?key=...`) per scoprire dinamicamente i modelli supportati.
   - Filtro di capacità: selezione esclusiva di modelli con `supportedGenerationMethods` contenente `generateContent`.
   - Priorità fallback predefinita: `gemini-2.0-flash` -> `gemini-1.5-flash` -> fallback statico sicuro.
   - Gestione chiara di deprecazioni e visualizzazione trasparente nel `SettingsModal`.
2. **Setup Ambiente (`.env.example`)**:
   - File template con commenti esaustivi in italiano (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `GEMINI_API_KEY`).
   - Verifica stringente di `.gitignore` per evitare leak di chiavi.
3. **Autenticazione e Rate Limiting Atomico nel Proxy Serverless**:
   - Verifica del token Supabase JWT (`Authorization: Bearer <token>`) nelle route `/api/gemini/*` tramite `@supabase/supabase-js`.
   - *Scelta Architetturale*: Poiché Vercel Serverless esegue funzioni effimere e stateless, una `Map` in-memory non è efficace. Per evitare costi o credenziali esterne aggiuntive (come Redis Upstash), implementiamo una tabella Supabase dedicata `public.gemini_proxy_rate_limits` con una funzione PL/pgSQL atomica `check_and_increment_rate_limit(p_user_id, p_hourly_limit, p_daily_limit)` in migrazione SQL idempotente.
   - Risposta standard HTTP `429 Too Many Requests` con header `Retry-After`.
4. **Tooling & Test**:
   - Configurazione Vitest per test unitari su logica di selezione modelli e rate limiting.
   - Script `typecheck`, `lint`, `test` in `package.json`.

### Fase 2: Qualità dell'Output (Output Quality)
1. **Citazioni Timestampate nella Guida LaTeX per Overleaf**:
   - Inclusione della macro LaTeX nel preambolo:
     ```latex
     % Definizione macro citazione temporale (sicura per Overleaf)
     \providecommand{\ts}[2]{\marginpar{\scriptsize\texttt{P#1:#2s}}}
     ```
     La macro produce una nota a margine o un indicatore non invasivo senza rompere la compilazione pdflatex/xelatex.
   - Istruzione del prompt Gemini affinché inietti `\ts{parte}{secondi}` nei punti chiave del testo e delle dimostrazioni.
2. **Player WaveSurfer Interattivo e Citazioni Clickable**:
   - Event bus / callback client-side: click su citazioni temporali nell'interfaccia dell'app posiziona automaticamente il playback su `part` e `seconds`.
3. **KaTeX In-App Preview & Linter Sintattico**:
   - Rendering in-app del contenuto LaTeX estraendo il corpo `\begin{document}...\end{document}` con KaTeX.
   - Linter sintattico client-side lightweight: verifica bilanciamento parentesi `{}` e `[]`, chiusura degli ambienti `\begin{env}...\end{env}`, rilevamento di `$` non bilanciati e comandi sconosciuti con segnalazione del numero di riga.

### Fase 3: Lezioni Lunghe (Long Lectures & Resiliency)
1. **Gestione Audio >2 Ore e Memory Pressure**:
   - Evitare decodifica Float32 in Web Audio API nel browser per evitare crash OOM su mobile.
   - Upload dell'intero file audio tramite Google AI Studio Files API con URI persistente.
2. **Architettura a Chunk e Macchina a Stati in Dexie**:
   - Tracciamento stato chunk in Dexie: `pending | running | done | error`.
   - Esecuzione sequenziale su spezzoni logici temporali (es. offset di 30-45 minuti) con prompt orientati al contesto continuo.
   - Retry automatico con exponential backoff + jitter per contrastare errori transitori (503 / 429).
3. **Passata di Consolidamento Finale**:
   - Unificazione dei testi intermedi in un unico documento coerente, eliminando ripetizioni e allineando la numerazione delle formule.
   - Visualizzazione progressiva dello stato di elaborazione con barra di completamento.

### Fase 4: Allineamento Slide Nativo (Slides Alignment)
1. **Invio PDF Nativo a Gemini**:
   - Sostituzione della conversione preliminare in Markdown con l'invio diretto del file PDF (`application/pdf`) a Google AI Studio Files API.
   - Analisi multimodale sincronizzata (Audio + PDF visivo nativo).
2. **Schema `slides_alignment`**:
   - Output strutturato JSON generato da Gemini:
     ```json
     [
       {
         "slide_number": 1,
         "title": "Introduzione al Calcolo delle Variazioni",
         "part": 1,
         "start_time_seconds": 120,
         "end_time_seconds": 450,
         "summary": "Presentazione del funzionale d'azione e formulazione del problema."
       }
     ]
     ```
   - Aggiornamento schema Dexie e migrazione SQL Supabase `20260929_slides_alignment.sql` per memorizzare `slides_alignment` (JSONB) in `transcripts`.
3. **Interfaccia Utente Interattiva**:
   - Lista/indice visivo delle slide sincronizzato: click su una slide sposta l'audio player al timestamp corrispondente e viceversa.

---

## 3. Rischi Identificati e Scelte Architetturali

| Rischio | Mitigazione |
| :--- | :--- |
| **OOM Browser su file audio lunghi** | Nessun `decodeAudioData` su file interi. Upload a Google Files API via stream/blob nativo e slicing logico via prompt temporizzati. |
| **Limiti Vercel Serverless (4.5MB Body / 60s Timeout)** | Per BYOK: chiamate dirette dal browser a Google AI Studio (zero limiti Vercel). Per proxy: streaming/upload multipart o redirect verso storage temporaneo autorizzato. |
| **Disallineamento Rate Limit su Lambdas** | Utilizzo di PostgreSQL su Supabase con funzione atomica `check_and_increment_rate_limit`, garantendo coerenza concorrente senza servizi terzi. |
| **Incompatibilità LaTeX su Overleaf** | Preamble standardizzato con `\providecommand` difensivo; KaTeX in-app tollerante a costrutti non visualizzabili via regex santizer. |
| **Rottura Dati Esistenti** | Migrazioni Supabase e Dexie puramente additive (campi opzionali / nullable), garantendo retrocompatibilità totale con le registrazioni passate. |

---

## 4. Definizione di Fatto (Definition of Done)
Ogni fase si considera conclusa quando:
1. `npm run typecheck` (`tsc --noEmit`) passa senza errori.
2. `npm run lint` passa senza errori o warning critici.
3. `npm run build` compila con successo per Vercel.
4. I test unitari (Vitest) dedicati alla fase hanno esito positivo.
5. È stato creato un commit Git atomico per la fase.
