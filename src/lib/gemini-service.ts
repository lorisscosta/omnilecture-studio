import { LectureData, AudioPart, LectureProcessingChunk, TranscriptSegment, GlossaryTerm, ExamQuestion, SlideAlignment } from './types';
import { fetchAvailableModels, getModelFallbackChain, normalizeModelName } from './gemini-config';
import {
  createLectureChunksPlan,
  retryWithBackoff,
  mergeTranscriptSegments,
  consolidateGlossary,
  consolidateExamQuestions,
  consolidateStudyGuides,
  calculateOverallProgress,
  consolidateSlidesAlignment,
} from './chunk-processing';
import {
  saveProcessingChunks,
  updateProcessingChunkStatus,
  getProcessingChunks,
} from './db';
import { injectTimestampPreambleMacro } from './latex-linter';
import { clampAndNormalizeSlideTimestamps, parseSlideHeadings } from './slides-sync';
import {
  validateLectureOutput,
  synchronizeLectureSlidesState,
  reconcileSlideCoverage,
  normalizeTechnicalTerminology,
} from './lecture-validator';

// Strict JSON Schema for Gemini
export const responseSchema = {
  type: 'OBJECT',
  properties: {
    glossary: {
      type: 'ARRAY',
      description: 'Technical and mathematical terms extracted from the lecture with Italian translation and academic definition',
      items: {
        type: 'OBJECT',
        properties: {
          term_en: { type: 'STRING', description: 'English term used in the lecture' },
          translation_it: { type: 'STRING', description: 'Italian standard academic translation' },
          academic_definition: { type: 'STRING', description: 'Clear, rigorous academic definition' },
        },
        required: ['term_en', 'translation_it', 'academic_definition'],
      },
    },
    timestamped_transcript: {
      type: 'ARRAY',
      description: 'Full timestamped transcript in English with Italian translation for each segment',
      items: {
        type: 'OBJECT',
        properties: {
          start: { type: 'NUMBER', description: 'Start time in seconds from beginning of audio' },
          end: { type: 'NUMBER', description: 'End time in seconds' },
          speaker: { type: 'STRING', description: 'Speaker label e.g. Professor or Student' },
          text_en: { type: 'STRING', description: 'Original verbatim or cleaned English spoken text' },
          text_it: { type: 'STRING', description: 'Accurate Italian translation' },
          partIndex: { type: 'INTEGER', description: '0-indexed audio part index (0 for Part 1, 1 for Part 2...)' },
        },
        required: ['start', 'end', 'speaker', 'text_en', 'text_it'],
      },
    },
    study_guide_it: {
      type: 'STRING',
      description: 'Documento completo LaTeX (.tex) pronto per essere incollato ed eseguito direttamente su Overleaf. Deve contenere la trascrizione integrale e trattazione accademica completa dell\'audio formattata in LaTeX standard (inclusi \\documentclass[11pt,a4paper]{article}, \\usepackage[utf8]{inputenc}, \\usepackage[italian]{babel}, \\usepackage{amsmath,amssymb,amsthm,geometry,hyperref}, \\geometry{margin=2.5cm}, \\title{...}, \\author{OmniLecture Studio}, \\date{\\today}, \\begin{document}, \\maketitle, sezioni con \\section e \\subsection, equazioni matematiche \\begin{equation} o \\[ ... \\], ambienti definition e theorem, e trattazione integrale discorsiva di tutto l\'audio senza sintesi eccessive e SENZA riferimenti o citazioni temporali, \\end{document}).',
    },
    potential_exam_questions: {
      type: 'ARRAY',
      description: 'Likely oral or written exam questions based on this lecture',
      items: {
        type: 'OBJECT',
        properties: {
          question: { type: 'STRING', description: 'The exam problem or question' },
          answer_latex: { type: 'STRING', description: 'Step-by-step rigorous solution with LaTeX formulas and explanations' },
          importance_level: { type: 'STRING', enum: ['Medium', 'High', 'Crucial'] },
        },
        required: ['question', 'answer_latex', 'importance_level'],
      },
    },
    slides_alignment: {
      type: 'ARRAY',
      description: 'Temporal and thematic alignment between the slides in the provided PDF (if any) and audio segments',
      items: {
        type: 'OBJECT',
        properties: {
          slide_number: { type: 'INTEGER', description: 'Page or slide number from 1 upwards' },
          title: { type: 'STRING', description: 'Slide title or main topic' },
          part: { type: 'INTEGER', description: 'Audio part index (0-indexed)' },
          start_time_seconds: { type: 'INTEGER', description: 'Estimated audio start time in seconds where this slide is discussed' },
          end_time_seconds: { type: 'INTEGER', description: 'Estimated audio end time in seconds where discussion of this slide concludes' },
          summary: { type: 'STRING', description: 'Summary of key concepts, formulas, and diagrams for this slide' },
        },
        required: ['slide_number', 'title', 'part', 'start_time_seconds', 'end_time_seconds', 'summary'],
      },
    },
  },
  required: [
    'glossary',
    'timestamped_transcript',
    'study_guide_it',
    'potential_exam_questions',
  ],
};

export function detectAudioMimeType(buffer: ArrayBuffer, fileName?: string, defaultType?: string): string {
  if (buffer.byteLength >= 12) {
    const bytes = new Uint8Array(buffer.slice(0, 12));
    // RIFF .... WAVE
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45) {
      return 'audio/wav';
    }
    // ID3 or MP3 sync word
    if ((bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) ||
        (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0)) {
      return 'audio/mp3';
    }
    // ftyp (M4A / MP4)
    if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
      return 'audio/m4a';
    }
    // OggS
    if (bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
      return 'audio/ogg';
    }
    // fLaC
    if (bytes[0] === 0x66 && bytes[1] === 0x4C && bytes[2] === 0x61 && bytes[3] === 0x43) {
      return 'audio/flac';
    }
  }

  // Fallback to file extension
  if (fileName) {
    const ext = fileName.toLowerCase().split('.').pop() || '';
    if (ext === 'wav') return 'audio/wav';
    if (ext === 'mp3') return 'audio/mp3';
    if (ext === 'm4a') return 'audio/m4a';
    if (ext === 'aac') return 'audio/aac';
    if (ext === 'ogg' || ext === 'oga') return 'audio/ogg';
    if (ext === 'flac') return 'audio/flac';
    if (ext === 'aiff' || ext === 'aif') return 'audio/aiff';
    if (ext === 'webm') return 'audio/webm';
  }

  // Fallback to defaultType if specified
  if (defaultType && defaultType !== 'application/octet-stream' && defaultType !== '') {
    const dt = defaultType.toLowerCase();
    if (dt.includes('wav')) return 'audio/wav';
    if (dt.includes('mp3') || dt.includes('mpeg')) return 'audio/mp3';
    if (dt.includes('m4a') || dt.includes('mp4')) return 'audio/m4a';
    if (dt.includes('aac')) return 'audio/aac';
    if (dt.includes('ogg')) return 'audio/ogg';
    if (dt.includes('flac')) return 'audio/flac';
    if (dt.includes('aiff')) return 'audio/aiff';
    if (dt.includes('webm')) return 'audio/webm';
    return defaultType;
  }

  return 'audio/wav';
}

/**
 * Measures the duration in seconds of an audio blob using an in-browser Audio element.
 */
export async function getAudioDuration(blob: Blob): Promise<number> {
  if (typeof window === 'undefined') return 0;
  return new Promise((resolve) => {
    try {
      const audio = document.createElement('audio');
      audio.preload = 'metadata';
      const url = URL.createObjectURL(blob);
      audio.src = url;
      audio.onloadedmetadata = () => {
        const d = audio.duration;
        URL.revokeObjectURL(url);
        resolve(isNaN(d) || !isFinite(d) ? 0 : d);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(0);
      };
    } catch {
      resolve(0);
    }
  });
}

export async function processAudioDirectly(
  audioInput: File | Blob | Array<File | Blob>,
  course: string,
  title: string,
  apiKey: string,
  onProgress?: (stage: string, percentage?: number) => void,
  userSelectedModel?: string,
  lectureId?: string,
  pdfFile?: File | Blob | null
): Promise<{
  success: boolean;
  data: LectureData;
  modelUsed: string;
  totalDuration: number;
  audioParts: AudioPart[];
  status?: 'completed' | 'completed_with_warnings' | 'error';
  processingWarnings?: string[];
}> {
  const rawFiles = Array.isArray(audioInput) ? audioInput : [audioInput];
  if (rawFiles.length === 0) {
    throw new Error('Nessun file audio selezionato per l\'elaborazione.');
  }

  const uploadedResourceNames: string[] = [];
  const uploadedFilesMeta: Array<{
    fileResourceName: string;
    fileUri: string;
    mimeType: string;
    fileName: string;
    size: number;
    duration: number;
    startOffset: number;
    blob: Blob;
  }> = [];

  try {
    let currentCumulativeOffset = 0;

    // Step 1: Upload all audio files to Google AI Studio Files API
    for (let i = 0; i < rawFiles.length; i++) {
      const currentFile = rawFiles[i];
      const partNumber = i + 1;
      const fileName = (currentFile as File).name || `audio_parte_${partNumber}.wav`;

      // Measure duration
      onProgress?.(
        rawFiles.length > 1
          ? `Analisi durata traccia ${partNumber} di ${rawFiles.length} (${fileName})...`
          : 'Analisi durata audio...'
      );
      const measuredDuration = await getAudioDuration(currentFile);
      const durationSeconds = measuredDuration > 0 ? measuredDuration : 0;

      const arrayBuffer = await currentFile.arrayBuffer();
      const mimeType = detectAudioMimeType(arrayBuffer, fileName, currentFile.type);

      onProgress?.(
        rawFiles.length > 1
          ? `Caricamento parte ${partNumber} di ${rawFiles.length} (${fileName}) su Google AI Studio...`
          : `Caricamento audio (${mimeType}) su Google AI Studio Files API...`
      );

      const boundary = '----OmniLectureBoundary' + Math.random().toString(36).substring(2);
      const metadataPart = JSON.stringify({
        file: {
          display_name: fileName,
          mimeType: mimeType,
        },
      });

      const prePart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataPart}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
      const postPart = `\r\n--${boundary}--`;

      const multipartBlob = new Blob([prePart, arrayBuffer, postPart], {
        type: `multipart/related; boundary=${boundary}`,
      });

      const uploadUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=multipart&key=${apiKey}`;
      const uploadResponse = await retryWithBackoff(async () => {
        const res = await fetch(uploadUrl, {
          method: 'POST',
          headers: {
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body: multipartBlob,
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          let parsedMsg = errText;
          try {
            const errObj = JSON.parse(errText);
            parsedMsg = errObj.error?.message || errText;
          } catch {}
          throw new Error(`Upload ${fileName} fallito (${res.status}): ${parsedMsg}`);
        }
        return res;
      }, 3, 1500);

      const uploadResult = await uploadResponse.json();
      const fileResourceName = uploadResult.file?.name;
      const fileUri = uploadResult.file?.uri;

      if (!fileResourceName || !fileUri) {
        throw new Error(`Metadati del file audio ${fileName} non validi da Google AI Studio.`);
      }

      uploadedResourceNames.push(fileResourceName);

      // Polling if file in PROCESSING
      let state = uploadResult.file?.state;
      let attempts = 0;
      while (state === 'PROCESSING' && attempts < 30) {
        onProgress?.(
          rawFiles.length > 1
            ? `Elaborazione server Google per parte ${partNumber}/${rawFiles.length}...`
            : 'Elaborazione audio sui server Google in corso...'
        );
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const checkResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/${fileResourceName}?key=${apiKey}`
        );
        if (checkResponse.ok) {
          const checkResult = await checkResponse.json();
          state = checkResult.state;
          if (state === 'FAILED') {
            throw new Error(`Elaborazione audio ${fileName} fallita sui server Google AI Studio.`);
          }
        }
        attempts++;
      }

      if (state && state !== 'ACTIVE') {
        throw new Error(`Timeout o stato non attivo per il file audio ${fileName} su Google AI Studio (${state}).`);
      }

      uploadedFilesMeta.push({
        fileResourceName,
        fileUri,
        mimeType,
        fileName,
        size: currentFile.size,
        duration: durationSeconds,
        startOffset: currentCumulativeOffset,
        blob: currentFile,
      });

      currentCumulativeOffset += durationSeconds;
    }

    const totalCalculatedDuration = Math.round(currentCumulativeOffset);

    // Build audioParts array for persistence and player
    const audioParts: AudioPart[] = uploadedFilesMeta.map((uf, idx) => ({
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `part-${idx + 1}-${Date.now()}`,
      fileName: uf.fileName,
      fileSize: uf.size,
      duration: Math.round(uf.duration),
      audioBlob: uf.blob,
      startOffset: Math.round(uf.startOffset),
    }));

    // Step 1b: Optional native PDF slides upload for multimodal alignment
    let uploadedPdfMeta: { fileResourceName: string; fileUri: string; fileName: string } | null = null;
    if (pdfFile) {
      const pdfName = (pdfFile as File).name || 'slides.pdf';
      const pdfMime = (pdfFile as File).type || 'application/pdf';
      onProgress?.(`Caricamento e analisi nativa slide PDF (${pdfName}) su Google AI Studio...`);

      const uploadPdfResponse = await retryWithBackoff(async () => {
        const metadata = {
          file: {
            display_name: pdfName,
          },
        };
        const boundary = '-------BOUNDARY' + Math.random().toString(36).substring(2);
        const metadataPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
        const fileHeaderPart = `--${boundary}\r\nContent-Type: ${pdfMime}\r\n\r\n`;
        const closingPart = `\r\n--${boundary}--`;

        const multipartBlob = new Blob([metadataPart, fileHeaderPart, pdfFile, closingPart]);
        const res = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`, {
          method: 'POST',
          headers: {
            'X-Goog-Upload-Protocol': 'multipart',
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body: multipartBlob,
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`Upload slide PDF ${pdfName} fallito: ${errText}`);
        }
        return res;
      }, 3, 1500);

      const pdfUploadResult = await uploadPdfResponse.json();
      if (pdfUploadResult.file?.name && pdfUploadResult.file?.uri) {
        uploadedResourceNames.push(pdfUploadResult.file.name);
        uploadedPdfMeta = {
          fileResourceName: pdfUploadResult.file.name,
          fileUri: pdfUploadResult.file.uri,
          fileName: pdfName,
        };

        // Poll PDF status until ACTIVE
        let pdfState = pdfUploadResult.file?.state;
        let pdfAttempts = 0;
        while (pdfState === 'PROCESSING' && pdfAttempts < 30) {
          onProgress?.(`Elaborazione slide PDF su Google AI Studio in corso...`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
          const checkPdfRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/${pdfUploadResult.file.name}?key=${apiKey}`
          );
          if (checkPdfRes.ok) {
            const checkData = await checkPdfRes.json();
            pdfState = checkData.state;
            if (pdfState === 'FAILED') {
              throw new Error(`Elaborazione del PDF ${pdfName} fallita sui server Google AI Studio.`);
            }
          }
          pdfAttempts++;
        }

        if (pdfState && pdfState !== 'ACTIVE') {
          throw new Error(`Stato del file PDF ${pdfName} non attivo su Google AI Studio (${pdfState}).`);
        }
      }
    }

    // Step 2: Discover available models
    onProgress?.('Rilevamento automatico dei modelli Gemini abilitati per la tua chiave...');
    const normalizedUserSelected = normalizeModelName(userSelectedModel);
    let modelsToTry: string[] = [];

    try {
      const availableModels = await fetchAvailableModels(apiKey);
      const availableIds = availableModels.map((m) => m.id);

      if (availableIds.includes(normalizedUserSelected)) {
        modelsToTry.push(normalizedUserSelected);
      }

      for (const m of availableModels) {
        if (!modelsToTry.includes(m.id)) {
          modelsToTry.push(m.id);
        }
      }
    } catch (err) {
      console.warn('Errore durante la chiamata ListModels:', err);
    }

    if (modelsToTry.length === 0) {
      modelsToTry = getModelFallbackChain(normalizedUserSelected);
    }

    const isMultiPart = uploadedFilesMeta.length > 1;

    // Step 2b: Pre-extract slide markdown from already-uploaded active PDF to avoid duplicate uploads
    let extractedPdfMarkdown = '';
    if (uploadedPdfMeta) {
      try {
        onProgress?.('Estrazione automatica testo e anteprima Markdown delle slide...', 30);
        extractedPdfMarkdown = await convertPdfUriToMarkdown(
          uploadedPdfMeta.fileUri,
          apiKey,
          (stg) => onProgress?.(stg),
          modelsToTry
        );
      } catch (pdfErr) {
        console.warn('Estrazione automatica markdown slide non riuscita (continuo con audio):', pdfErr);
      }
    }

    // Step 3: Define prompts
    const systemPrompt = `Sei un assistente accademico di altissimo livello per studenti magistrali di ingegneria.
REGOLA FONDAMENTALE DI FEDELTÀ ALL'AUDIO (STRICT GROUNDING):
Tutto ciò che generi deve basarsi RIGOROSAMENTE ed ESCLUSIVAMENTE sull'effettivo contenuto audio trascritto.
NON inventare MAI concetti, argomenti, teoremi o formule che non siano stati trattati o accennati dal docente/oratore nell'audio. Il titolo della lezione e il nome del corso servono solo come contesto terminologico, NON come pretesto per allucinare spiegazioni non presenti nella registrazione.
Il tuo compito è: prendere ciò che il docente ha realmente spiegato nella registrazione e strutturarlo accademicamente, migliorandone la chiarezza formale, la notazione LaTeX e l'esposizione.
${
  isMultiPart
    ? `\nISTRUZIONI SPECIFICHE PER LEZIONE IN PIÙ REGISTRAZIONI (${uploadedFilesMeta.length} PARTI ORDINATE):
La lezione è stata registrata a spezzoni. Ciascuna parte viene analizzata singolarmente:
1. "study_guide_it": Documento LaTeX (.tex) accademico completo senza citazioni o riferimenti temporali.
2. "timestamped_transcript": Trascrizione cronologica coerente della traccia corrente. Tutti i timestamp (start, end) DEVONO essere rigorosamente relativi all'inizio di questa traccia audio (da 0 alla durata del file). NON sommare offset cumulativi esterni.
3. "glossary": Glossario accademico dei termini spiegati in questa registrazione.
4. "potential_exam_questions": Domande d'esame complete sui concetti affrontati in questa traccia.`
    : ''
}

Struttura dei campi JSON richiesta:
1. "timestamped_transcript": Trascrizione cronologica fedele al 100% dell'audio suddivisa in segmenti temporali (start, end in secondi relativi all'audio fornito), con il testo parlato originale (text_en) e l'accurata traduzione/trascrizione italiana (text_it). Includi partIndex indicando l'indice (0-based) della registrazione di riferimento.
2. "glossary": Estrai SOLO i termini tecnici realmente pronunciati o spiegati nell'audio con traduzione e definizione accademica. Se nell'audio non sono stati pronunciati termini tecnici (es. registrazioni di prova, test microfono, audio non didattico), restituisci un array VUOTO [].
3. "study_guide_it": Trascrizione integrale e trattazione accademica completa dell'audio in formato codice LaTeX (.tex) completo e pronto da copiare direttamente su Overleaf. Deve iniziare con \\documentclass[11pt,a4paper]{article}, includere i pacchetti necessari (amsmath, amssymb, amsthm, geometry, hyperref, babel italiano), impostare \\title, \\author{OmniLecture Studio}, \\date, \\begin{document}, \\maketitle, e poi sviluppare con \\section, \\subsection, equazioni matematiche in ambiente equation o \\[ ... \\], e testo discorsivo TUTTO ciò che il docente ha spiegato nell'audio in modo rigoroso, terminando con \\end{document}. NON inserire citazioni o riferimenti temporali (NON inserire \\ts, timestamp o minuti nel documento LaTeX: deve essere una trattazione accademica formale e pulita pronta per la pubblicazione o studio). Se l'audio è solo un test breve (es. "prova prova"), il documento LaTeX spiegherà sinteticamente che si tratta di una registrazione di prova senza allucinare teoria fittizia.
4. "potential_exam_questions": Genera domande d'esame SOLTANTO sui concetti accademici effettivamente trattati nell'audio. Se l'audio non contiene concetti didattici esaminabili (es. prova vocale breve), restituisci un array VUOTO [].
5. "slides_alignment": Se sono allegate slide PDF, compila con MASSIMA PRECISIONE TEMPORALE l'intervallo [start_time_seconds, end_time_seconds] di ciascuna slide spiegata:
   - "slide_number": Numero della slide da 1 in avanti
   - "title": Titolo della slide
   - "part": Indice parte audio (0-based)
   - "start_time_seconds": Il secondo ESATTO in cui il docente passa alla spiegazione di questa slide (relativo alla traccia audio attuale, >= 0)
   - "end_time_seconds": Il secondo in cui termina la discussione della slide e si passa alla successiva (<= durata audio)
   - "summary": Sintesi dei punti salienti e formule della slide spiegati oralmente.
   REGOLA CRITICA: I timestamp di inizio e fine di ciascuna slide devono essere RIGOROSAMENTE compresi tra 0 e la durata reale dell'audio fornito.`;

    // Create and persist chunks in Dexie for traceability and resilience
    let chunksPlan: LectureProcessingChunk[] = [];
    if (lectureId) {
      const existingChunks = await getProcessingChunks(lectureId).catch(() => []);
      if (existingChunks && existingChunks.length > 0) {
        chunksPlan = existingChunks;
      } else {
        chunksPlan = createLectureChunksPlan(lectureId, audioParts);
        await saveProcessingChunks(chunksPlan).catch(console.warn);
      }
    }

    // Fast-path: Check if all chunks are already completed in Dexie
    if (chunksPlan.length > 0 && chunksPlan.every((c) => c.status === 'done' && c.data)) {
      onProgress?.('Recupero risultati completati dalla memoria locale...', 95);
      const chunkTranscripts = chunksPlan.map((c) => ({
        partIndex: c.partIndex,
        chunkStartSeconds: c.startSeconds || 0,
        cumulativePartOffset: audioParts[c.partIndex]?.startOffset || 0,
        segments: (c.data as LectureData)?.timestamped_transcript || [],
      }));
      const chunkGlossaries = chunksPlan.map((c) => (c.data as LectureData)?.glossary || []).filter((g) => g.length > 0);
      const chunkQuestions = chunksPlan.map((c) => (c.data as LectureData)?.potential_exam_questions || []).filter((q) => q.length > 0);
      const chunkGuides = chunksPlan.map((c) => (c.data as LectureData)?.study_guide_it || '').filter(Boolean);
      const chunkAlignments = chunksPlan.map((c) => (c.data as LectureData)?.slides_alignment || []).filter((a) => a.length > 0);

      const consolidatedTranscript = mergeTranscriptSegments(chunkTranscripts);
      const consolidatedGlossaryData = consolidateGlossary(chunkGlossaries);
      const consolidatedExamData = consolidateExamQuestions(chunkQuestions);
      const consolidatedGuide = consolidateStudyGuides(chunkGuides, title, course);
      const consolidatedSlides = clampAndNormalizeSlideTimestamps(
        consolidateSlidesAlignment(chunkAlignments),
        totalCalculatedDuration
      );

      return {
        success: true,
        data: {
          timestamped_transcript: consolidatedTranscript,
          glossary: consolidatedGlossaryData,
          potential_exam_questions: consolidatedExamData,
          study_guide_it: consolidatedGuide,
          slides_alignment: consolidatedSlides.length > 0 ? consolidatedSlides : undefined,
          has_slides: uploadedPdfMeta ? true : undefined,
          slides_filename: uploadedPdfMeta ? uploadedPdfMeta.fileName : undefined,
          slides_markdown: extractedPdfMarkdown || undefined,
        },
        modelUsed: 'cached',
        totalDuration: totalCalculatedDuration,
        audioParts,
      };
    }

    let parsedData: LectureData;
    let successfulModel = '';

    if (isMultiPart) {
      // Chunked multi-part processing: processes each track sequentially, saving state and consolidating
      const chunkTranscripts: Array<{
        partIndex: number;
        chunkStartSeconds: number;
        cumulativePartOffset: number;
        segments: TranscriptSegment[];
      }> = [];
      const chunkGlossaries: GlossaryTerm[][] = [];
      const chunkQuestions: ExamQuestion[][] = [];
      const chunkGuides: string[] = [];
      const chunkAlignments: SlideAlignment[][] = [];

      for (let partIdx = 0; partIdx < uploadedFilesMeta.length; partIdx++) {
        const uf = uploadedFilesMeta[partIdx];
        const partNumber = partIdx + 1;
        const matchingChunk = chunksPlan.find((c) => c.partIndex === partIdx);

        // Check if this chunk was already processed and persisted in Dexie
        if (matchingChunk && matchingChunk.status === 'done' && matchingChunk.data) {
          onProgress?.(`Parte ${partNumber} già elaborata, recupero dalla memoria locale...`, Math.round(20 + ((partIdx + 0.9) / uploadedFilesMeta.length) * 70));
          const partData = matchingChunk.data as LectureData;
          chunkTranscripts.push({
            partIndex: partIdx,
            chunkStartSeconds: matchingChunk.startSeconds || 0,
            cumulativePartOffset: uf.startOffset,
            segments: partData.timestamped_transcript || [],
          });
          if (partData.glossary) chunkGlossaries.push(partData.glossary);
          if (partData.potential_exam_questions) chunkQuestions.push(partData.potential_exam_questions);
          if (partData.study_guide_it) chunkGuides.push(partData.study_guide_it);
          if (partData.slides_alignment) chunkAlignments.push(partData.slides_alignment);
          continue;
        }

        if (matchingChunk) {
          await updateProcessingChunkStatus(matchingChunk.id, 'running').catch(console.warn);
        }

        const progressPct = Math.round(20 + ((partIdx + 0.1) / uploadedFilesMeta.length) * 70);
        onProgress?.(
          `Elaborazione audio parte ${partNumber} di ${uploadedFilesMeta.length} (${uf.fileName})...`,
          progressPct
        );

        const partDuration = Math.round(uf.duration);
        const partPromptText = `Trascrivi ed elabora questa registrazione audio (Parte ${partNumber} di ${uploadedFilesMeta.length}: "${uf.fileName}") per il corso di "${course}" (lezione: "${title}").
DURATA ESATTA DELLA TRACCIA: ${partDuration} secondi (~${Math.floor(partDuration / 60)}m ${partDuration % 60}s).
CANONICAL TIME CONTRACT: Tutti i timestamp (start, end in timestamped_transcript, start_time_seconds, end_time_seconds in slides_alignment) DEVONO ESSERE RIGOROSAMENTE RELATIVI A QUESTA TRACCIA E COMPRESI TRA 0 E ${partDuration} SECONDI. NESSUN TIMESTAMP PUÒ SUPERARE ${partDuration} SECONDI.${
          uploadedPdfMeta ? ' Correla inoltre le spiegazioni orali alle pagine del documento PDF allegato valorizzando slides_alignment per tutte le slide discusse (da 1 a N). Non omettere alcuna slide trattata.' : ''
        } Restituisci esclusivamente il JSON strutturato secondo lo schema specificato.`;

        const userParts: any[] = [
          {
            file_data: {
              mime_type: uf.mimeType,
              file_uri: uf.fileUri,
            },
          },
        ];

        if (uploadedPdfMeta) {
          userParts.push({
            file_data: {
              mime_type: 'application/pdf',
              file_uri: uploadedPdfMeta.fileUri,
            },
          });
        }

        userParts.push({ text: partPromptText });

        let partResponse: Response | null = null;
        const partErrorLogs: string[] = [];

        for (const model of modelsToTry) {
          onProgress?.(
            `Analisi parte ${partNumber}/${uploadedFilesMeta.length} con modello ${model}...`,
            progressPct
          );
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
          const payload = {
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [
              {
                role: 'user',
                parts: userParts,
              },
            ],
            generationConfig: {
              response_mime_type: 'application/json',
              response_schema: responseSchema,
              temperature: 0.2,
            },
          };

          try {
            const res = await retryWithBackoff(async () => {
              const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              });
              if (resp.status === 429 || resp.status === 503) {
                throw new Error(`Google API quota o sovraccarico temporaneo HTTP ${resp.status}`);
              }
              return resp;
            }, 2, 1500);

            if (res.ok) {
              partResponse = res;
              successfulModel = model;
              break;
            }

            const errorText = await res.text().catch(() => '');
            let errMsg = errorText;
            try {
              const errObj = JSON.parse(errorText);
              errMsg = errObj.error?.message || errorText;
            } catch {}

            partErrorLogs.push(`${model}: ${errMsg.slice(0, 100)}`);
            if (res.status === 401) break;
          } catch (fetchErr: unknown) {
            const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
            partErrorLogs.push(`${model}: ${msg}`);
          }
        }

        if (!partResponse || !partResponse.ok) {
          if (matchingChunk) {
            await updateProcessingChunkStatus(matchingChunk.id, 'error', partErrorLogs.join(' | ')).catch(console.warn);
          }
          throw new Error(`Errore elaborazione parte ${partNumber}: ${partErrorLogs.join(' | ')}`);
        }

        const partGenData = await partResponse.json();
        const candidateText = partGenData.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!candidateText) {
          throw new Error(`Risposta vuota per la parte ${partNumber}.`);
        }

        let cleanJson = candidateText.trim();
        if (cleanJson.startsWith('```json')) {
          cleanJson = cleanJson.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
        } else if (cleanJson.startsWith('```')) {
          cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
        }

        const partData: LectureData = JSON.parse(cleanJson);
        if (matchingChunk) {
          await updateProcessingChunkStatus(matchingChunk.id, 'done', undefined, partData).catch(console.warn);
        }

        chunkTranscripts.push({
          partIndex: partIdx,
          chunkStartSeconds: 0,
          cumulativePartOffset: uf.startOffset,
          segments: partData.timestamped_transcript || [],
        });
        if (partData.glossary) chunkGlossaries.push(partData.glossary);
        if (partData.potential_exam_questions) chunkQuestions.push(partData.potential_exam_questions);
        if (partData.study_guide_it) chunkGuides.push(partData.study_guide_it);
        if (partData.slides_alignment) chunkAlignments.push(partData.slides_alignment);
      }

      // Step 4: Consolidation Pass on Text & LaTeX
      onProgress?.('Consolidamento finale e verifica guide...', 95);
      const consolidatedTranscript = mergeTranscriptSegments(chunkTranscripts);
      const consolidatedGlossaryData = consolidateGlossary(chunkGlossaries);
      const consolidatedExamData = consolidateExamQuestions(chunkQuestions);
      const consolidatedGuide = consolidateStudyGuides(chunkGuides, title, course);
      const consolidatedSlides = clampAndNormalizeSlideTimestamps(
        consolidateSlidesAlignment(chunkAlignments),
        totalCalculatedDuration
      );

      parsedData = {
        timestamped_transcript: consolidatedTranscript,
        glossary: consolidatedGlossaryData,
        potential_exam_questions: consolidatedExamData,
        study_guide_it: consolidatedGuide,
        slides_alignment: consolidatedSlides.length > 0 ? consolidatedSlides : undefined,
        has_slides: uploadedPdfMeta ? true : undefined,
        slides_filename: uploadedPdfMeta ? uploadedPdfMeta.fileName : undefined,
        slides_markdown: extractedPdfMarkdown || undefined,
      };
      onProgress?.('Elaborazione completata con successo!', 100);
    } else {
      // Single Audio File Processing
      const uf = uploadedFilesMeta[0];
      const singleMatchingChunk = chunksPlan[0];

      if (singleMatchingChunk && singleMatchingChunk.status === 'done' && singleMatchingChunk.data) {
        onProgress?.('Risultati già elaborati in precedenza, recupero dalla memoria...', 95);
        parsedData = singleMatchingChunk.data as LectureData;
        if (extractedPdfMarkdown && !parsedData.slides_markdown) {
          parsedData.slides_markdown = extractedPdfMarkdown;
        }
      } else {
        if (singleMatchingChunk) {
          await updateProcessingChunkStatus(singleMatchingChunk.id, 'running').catch(console.warn);
        }

        onProgress?.('Trascrizione ed elaborazione accademica con Gemini...', 40);

      const fileDuration = Math.round(uf.duration);
      const promptText = `Trascrivi ed elabora questa registrazione audio del corso di "${course}" (titolo specificato: "${title}").
DURATA ESATTA AUDIO: ${fileDuration} secondi (~${Math.floor(fileDuration / 60)}m ${fileDuration % 60}s).
CANONICAL TIME CONTRACT: Tutti i timestamp di inizio e fine ("start", "end" in timestamped_transcript, "start_time_seconds", "end_time_seconds" in slides_alignment) DEVONO essere RIGOROSAMENTE compresi nell'intervallo [0, ${fileDuration}]. È severamente vietato produrre timestamp superiori a ${fileDuration} secondi.${
        uploadedPdfMeta ? ' Correla inoltre le spiegazioni orali alle pagine del documento PDF allegato valorizzando slides_alignment con la massima precisione cronologica (da 1 a N). Nel documento LaTeX, copri tutti gli argomenti principali presenti nelle slide e discussi nell\'audio.' : ''
      } Ricorda: basati rigorosamente su quanto ascoltato nell'audio. Restituisci esclusivamente il JSON strutturato secondo lo schema specificato.`;

      const singleUserParts: any[] = [
        {
          file_data: {
            mime_type: uf.mimeType,
            file_uri: uf.fileUri,
          },
        },
      ];

      if (uploadedPdfMeta) {
        singleUserParts.push({
          file_data: {
            mime_type: 'application/pdf',
            file_uri: uploadedPdfMeta.fileUri,
          },
        });
      }

      singleUserParts.push({ text: promptText });

      let generationResponse: Response | null = null;
      const errorLogs: string[] = [];

      for (const model of modelsToTry) {
        onProgress?.(`Analisi in corso con il modello: ${model}...`, 55);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const payload = {
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [
            {
              role: 'user',
              parts: singleUserParts,
            },
          ],
          generationConfig: {
            response_mime_type: 'application/json',
            response_schema: responseSchema,
            temperature: 0.2,
          },
        };

        try {
          const response = await retryWithBackoff(async () => {
            const resp = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            if (resp.status === 429 || resp.status === 503) {
              throw new Error(`Google API quota o sovraccarico temporaneo HTTP ${resp.status}`);
            }
            return resp;
          }, 2, 1500);

          if (response.ok) {
            generationResponse = response;
            successfulModel = model;
            break;
          }

          const errorText = await response.text().catch(() => '');
          let errMsg = errorText;
          try {
            const errObj = JSON.parse(errorText);
            errMsg = errObj.error?.message || errorText;
          } catch {}

          errorLogs.push(`${model}: ${errMsg.slice(0, 120)}`);
          if (response.status === 401) break;
        } catch (fetchErr: unknown) {
          const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
          errorLogs.push(`${model}: ${msg}`);
        }
      }

      if (!generationResponse || !generationResponse.ok) {
        if (singleMatchingChunk) {
          await updateProcessingChunkStatus(singleMatchingChunk.id, 'error', errorLogs.join(' | ')).catch(console.warn);
        }
        const summaryMsg = errorLogs.length > 0 ? errorLogs.join(' | ') : 'Nessuna risposta dai modelli.';
        throw new Error(`Errore generazione Gemini: ${summaryMsg}`);
      }

      onProgress?.('Formattazione e validazione LaTeX in corso...', 85);
      const genData = await generationResponse.json();
      const candidateText = genData.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!candidateText) {
        throw new Error('Risposta vuota da Gemini API.');
      }

      let cleanJson = candidateText.trim();
      if (cleanJson.startsWith('```json')) {
        cleanJson = cleanJson.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
      } else if (cleanJson.startsWith('```')) {
        cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
      }

      parsedData = JSON.parse(cleanJson);

      // Terminology normalization pass
      if (parsedData.timestamped_transcript) {
        parsedData.timestamped_transcript = parsedData.timestamped_transcript.map((seg) => ({
          ...seg,
          text_en: normalizeTechnicalTerminology(seg.text_en),
          text_it: normalizeTechnicalTerminology(seg.text_it),
        }));
      }

      if (parsedData.study_guide_it) {
        parsedData.study_guide_it = injectTimestampPreambleMacro(parsedData.study_guide_it);
      }
      if (Array.isArray(parsedData.slides_alignment)) {
        parsedData.slides_alignment = clampAndNormalizeSlideTimestamps(
          consolidateSlidesAlignment([parsedData.slides_alignment]),
          totalCalculatedDuration
        );
      }
      if (uploadedPdfMeta) {
        parsedData.has_slides = true;
        parsedData.slides_filename = uploadedPdfMeta.fileName;
      }
      if (extractedPdfMarkdown) {
        parsedData.slides_markdown = extractedPdfMarkdown;
      }

      // Reconcile slide coverage if markdown was parsed
      if (extractedPdfMarkdown && parsedData.slides_alignment) {
        const slideHeadings = parseSlideHeadings(extractedPdfMarkdown);
        if (slideHeadings.length > 0) {
          parsedData.slides_alignment = reconcileSlideCoverage(
            parsedData.slides_alignment,
            slideHeadings.length,
            slideHeadings,
            parsedData.timestamped_transcript || [],
            totalCalculatedDuration
          );
        }
      }

      if (singleMatchingChunk) {
        await updateProcessingChunkStatus(singleMatchingChunk.id, 'done', undefined, parsedData).catch(console.warn);
      }
      onProgress?.('Elaborazione completata con successo!', 100);
    }
  }

    // Run central validation layer
    const validation = validateLectureOutput(
      {
        duration: totalCalculatedDuration,
        audioParts,
        hasSlides: Boolean(uploadedPdfMeta),
        slidesFileName: uploadedPdfMeta?.fileName,
        slidesMarkdown: extractedPdfMarkdown || undefined,
        slidesAlignment: parsedData.slides_alignment,
        data: parsedData,
      },
      {
        totalDuration: totalCalculatedDuration,
        audioParts,
        slidesMarkdown: extractedPdfMarkdown || undefined,
      }
    );

    const warnings: string[] = [...validation.warnings];
    if (uploadedPdfMeta && !extractedPdfMarkdown) {
      warnings.push('Estrazione testo Markdown dalle slide non riuscita. Le slide sono visualizzabili in formato PDF.');
    }

    return {
      success: true,
      data: parsedData,
      modelUsed: successfulModel,
      totalDuration: totalCalculatedDuration,
      audioParts,
      status: validation.isValid ? (warnings.length > 0 ? 'completed_with_warnings' : 'completed') : 'completed_with_warnings',
      processingWarnings: warnings.length > 0 ? warnings : undefined,
    };
  } finally {
    // Step 5: Clean up all uploaded temp files on Google AI Studio
    for (const resName of uploadedResourceNames) {
      try {
        await fetch(`https://generativelanguage.googleapis.com/v1beta/${resName}?key=${apiKey}`, {
          method: 'DELETE',
        });
      } catch (e) {
        console.warn('Pulizia file temporaneo fallita:', e);
      }
    }
  }
}

/**
 * Uploads a slide PDF to Google AI Studio Files API and converts each slide
 * into a rich, structured Markdown (.md) document with LaTeX math and slide markers.
 */
export async function convertPdfToMarkdown(
  pdfFile: File | Blob,
  fileName: string,
  apiKey: string,
  onProgress?: (stage: string) => void
): Promise<string> {
  let fileResourceName: string | null = null;

  try {
    onProgress?.('Caricamento PDF slide su Google AI Studio Files API...');
    const arrayBuffer = await pdfFile.arrayBuffer();

    const boundary = '----OmniLectureSlideBoundary' + Math.random().toString(36).substring(2);
    const metadataPart = JSON.stringify({
      file: {
        display_name: fileName || 'lecture_slides.pdf',
        mimeType: 'application/pdf',
      },
    });

    const prePart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataPart}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`;
    const postPart = `\r\n--${boundary}--`;

    const multipartBlob = new Blob([prePart, arrayBuffer, postPart], {
      type: `multipart/related; boundary=${boundary}`,
    });

    const uploadUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=multipart&key=${apiKey}`;
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBlob,
    });

    if (!uploadResponse.ok) {
      const errText = await uploadResponse.text();
      let parsedMsg = errText;
      try {
        const errObj = JSON.parse(errText);
        parsedMsg = errObj.error?.message || errText;
      } catch {}
      throw new Error(`Upload PDF su Google AI Studio fallito (${uploadResponse.status}): ${parsedMsg}`);
    }

    const uploadResult = await uploadResponse.json();
    fileResourceName = uploadResult.file?.name;
    const fileUri = uploadResult.file?.uri;

    if (!fileResourceName || !fileUri) {
      throw new Error('Metadati PDF non validi restituiti da Google AI Studio.');
    }

    // Wait if state is PROCESSING
    let state = uploadResult.file?.state;
    let attempts = 0;
    while (state === 'PROCESSING' && attempts < 30) {
      onProgress?.('Elaborazione PDF su Google AI Studio in corso...');
      await new Promise((r) => setTimeout(r, 2000));
      attempts++;
      const checkRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${fileResourceName}?key=${apiKey}`
      );
      if (checkRes.ok) {
        const checkData = await checkRes.json();
        state = checkData.state;
      }
    }

    if (state && state !== 'ACTIVE') {
      throw new Error(`Stato del file PDF non attivo su Google AI Studio (${state}).`);
    }

    return await convertPdfUriToMarkdown(fileUri, apiKey, onProgress);
  } finally {
    if (fileResourceName) {
      try {
        await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileResourceName}?key=${apiKey}`, {
          method: 'DELETE',
        });
      } catch (e) {
        console.warn('Pulizia PDF temporaneo fallita:', e);
      }
    }
  }
}

/**
 * Converts an already-active Google AI Studio PDF fileUri into academic Markdown.
 * Reusable without re-uploading the PDF.
 */
export async function convertPdfUriToMarkdown(
  fileUri: string,
  apiKey: string,
  onProgress?: (stage: string) => void,
  preferredModels?: string[]
): Promise<string> {
  onProgress?.('Conversione slide PDF in Markdown (.md) tramite Gemini Multimodal OCR...');

  const systemPrompt = `Sei un convertitore accademico avanzato per documenti universitari STEM (Ingegneria, Matematica, Fisica).
Il tuo compito è convertire questo file PDF di slide della lezione in un documento Markdown (.md) dettagliato, rigoroso e strutturato.
Regole fondamentali:
1. Per ciascuna slide, crea un'intestazione di secondo livello: '## Slide [Numero]: [Titolo Slide]'.
2. Trascrivi fedelmente tutti i punti elenco, concetti chiave, teoremi e definizioni.
3. Formatta TUTTE le formule matematiche in notazione LaTeX rigorosa ($...$ per formule in linea, $$...$$ per equazioni su riga separata).
4. Se una slide presenta tabelle, convertile in tabelle Markdown.
5. Se una slide presenta grafici, schemi a blocchi o figure, descrivi in modo chiaro il loro contenuto tra parentesi quadre: [Descrizione Grafico/Schema: ...].
6. Restituisci SOLO ed esclusivamente il testo Markdown (.md), senza racchiuderlo in ulteriori blocchi di codice markdown tripli (\`\`\`markdown ... \`\`\`).`;

  const promptText = `Converti tutte le slide di questo documento PDF in Markdown accademico (.md) completo e ben strutturato per lo studio.`;

  const modelsToTry = preferredModels && preferredModels.length > 0 ? preferredModels : getModelFallbackChain();
  let generationResponse: Response | null = null;

  for (const model of modelsToTry) {
    onProgress?.(`Estrazione Markdown slide con ${model}...`);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const payload = {
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: 'user',
          parts: [
            {
              file_data: {
                mime_type: 'application/pdf',
                file_uri: fileUri,
              },
            },
            { text: promptText },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
      },
    };

    try {
      const resp = await retryWithBackoff(async () => {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (r.status === 429 || r.status === 503) {
          throw new Error(`Google API rate limit HTTP ${r.status}`);
        }
        return r;
      }, 2, 1500);

      if (resp.ok) {
        generationResponse = resp;
        break;
      }
      if (resp.status === 401) break;
    } catch {
      // Continue to next model
    }
  }

  if (!generationResponse || !generationResponse.ok) {
    const errText = generationResponse ? await generationResponse.text().catch(() => '') : '';
    throw new Error(`Conversione PDF fallita: ${errText}`);
  }

  const genData = await generationResponse.json();
  let candidateText = genData.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!candidateText) {
    throw new Error('Nessun testo Markdown generato dalle slide.');
  }

  candidateText = candidateText.trim();
  if (candidateText.startsWith('```markdown')) {
    candidateText = candidateText.replace(/^```markdown\s*/i, '').replace(/\s*```$/, '').trim();
  } else if (candidateText.startsWith('```md')) {
    candidateText = candidateText.replace(/^```md\s*/i, '').replace(/\s*```$/, '').trim();
  } else if (candidateText.startsWith('```')) {
    candidateText = candidateText.replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
  }

  return candidateText;
}

/**
 * Cross-references the spoken lecture with the extracted slide Markdown,
 * synthesizing an enriched Overleaf LaTeX study guide with slide references,
 * updated glossary, and integrated exam questions.
 */
export async function enrichLectureWithSlides(
  currentData: LectureData,
  slidesMarkdown: string,
  course: string,
  title: string,
  apiKey: string,
  onProgress?: (stage: string) => void
): Promise<LectureData> {
  onProgress?.('Integrazione e correlazione tra registrazione e slide...');

  const systemPrompt = `Sei un assistente accademico di massimo livello per corsi universitari magistrali STEM (Ingegneria e Scienze).
Ti vengono forniti:
1. La trascrizione della registrazione audio di una lezione del corso di "${course}" (titolo: "${title}").
2. Il documento Markdown (.md) estratto dalle SLIDE proiettate dal docente.

IL TUO OBIETTIVO:
Confronta e fondi la registrazione vocale con le slide proiettate, producendo un pacchetto didattico arricchito con riferimenti incrociati puntuali alle slide.

Regole fondamentali di integrazione:
1. "study_guide_it": Documento LaTeX (.tex) completo pronto da copiare ed eseguire direttamente su Overleaf.
   - Preambolo completo standard: \\documentclass[11pt,a4paper]{article}, \\usepackage[utf8]{inputenc}, \\usepackage[italian]{babel}, \\usepackage{amsmath,amssymb,amsthm,geometry,hyperref}, \\geometry{margin=2.5cm}, \\title{...}, \\author{OmniLecture Studio}, \\date{\\today}, \\begin{document}, \\maketitle.
   - Inserisci riferimenti espliciti alle slide nei titoli delle sottosezioni (es. \\subsection{Convoluzione Circolare [Rif. Slide 4]}) o nel testo discorsivo (es. \\textit{(Come illustrato nella Slide 6)}).
   - Includi le formule matematiche esatte ($...$ o \\[ ... \\]), equazioni numerate e schemi presenti sulle slide, collegandoli a ciò che il docente ha spiegato a voce.
   - Mantieni la trattazione integrale e rigorosa di tutto ciò che è stato spiegato a voce, senza omettere nulla.
   - Termina regolarmente con \\end{document}.
2. "glossary": Aggiorna ed estendi il glossario includendo sia i termini spiegati a voce sia le definizioni formali chiave presenti nelle slide.
3. "potential_exam_questions": Genera domande d'esame complete che integrano sia il ragionamento spiegato oralmente dal docente sia i punti formali ed esercizi presenti nelle slide.
4. "timestamped_transcript": Mantieni i segmenti cronologici dell'audio originale; arricchisci ove opportuno la traduzione/trascrizione italiana (text_it) con il marcatore della slide discussa in quel momento (es. "[Slide 3] ...").
5. "slides_alignment": Compila rigorosamente l'array correlando ciascuna slide al rispettivo intervallo temporale dell'audio [start_time_seconds, end_time_seconds], indicando numero slide, titolo, parte audio e breve riassunto concettuale.

Restituisci esclusivamente il JSON strutturato secondo lo schema specificato.`;

  const transcriptSummary = currentData.timestamped_transcript
    .map((s) => `[${s.start}s - ${s.end}s] ${s.speaker}: ${s.text_en} (IT: ${s.text_it})`)
    .join('\n');

  const promptText = `Ecco i dati della registrazione vocale e delle slide della lezione di "${course}" (titolo: "${title}"):

=== TRASCRIZIONE AUDIO ESISTENTE ===
${transcriptSummary}

=== TESTO MARKDOWN DELLE SLIDE DEL DOCENTE ===
${slidesMarkdown}

Confronta la registrazione vocale con le slide, unisci i contenuti e restituisci il JSON con la Guida Overleaf LaTeX completa arricchita con i riferimenti alle slide, l'allineamento cronologico 'slides_alignment', il glossario aggiornato e le domande d'esame.`;

  const modelsToTry = getModelFallbackChain();

  let generationResponse: Response | null = null;

  for (const model of modelsToTry) {
    onProgress?.(`Generazione guida integrata con ${model}...`);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const payload = {
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: promptText }],
        },
      ],
      generationConfig: {
        response_mime_type: 'application/json',
        response_schema: responseSchema,
        temperature: 0.2,
      },
    };

    generationResponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (generationResponse.ok) {
      break;
    }

    if (generationResponse.status === 401) {
      break;
    }

    if (generationResponse.status === 429 || generationResponse.status === 503) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  if (!generationResponse || !generationResponse.ok) {
    const errText = generationResponse ? await generationResponse.text() : 'Nessuna risposta da Gemini.';
    throw new Error(`Integrazione slide fallita: ${errText}`);
  }

  const genData = await generationResponse.json();
  let candidateText = genData.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!candidateText) {
    throw new Error('Risposta vuota da Gemini durante l\'integrazione delle slide.');
  }

  let cleanJson = candidateText.trim();
  if (cleanJson.startsWith('```json')) {
    cleanJson = cleanJson.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
  } else if (cleanJson.startsWith('```')) {
    cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
  }

  const enrichedData: LectureData = JSON.parse(cleanJson);
  enrichedData.slides_markdown = slidesMarkdown;
  enrichedData.has_slides = true;
  if (Array.isArray(enrichedData.slides_alignment)) {
    enrichedData.slides_alignment = consolidateSlidesAlignment([enrichedData.slides_alignment]);
  }

  return enrichedData;
}

/**
 * Accurately realigns each slide with the exact timestamps of the speech transcription.
 * Cross-references spoken keywords, formulas, and slide titles against the transcript.
 */
export async function realignSlidesWithGemini(
  transcript: TranscriptSegment[],
  slidesMarkdown: string,
  course: string,
  title: string,
  apiKey: string,
  onProgress?: (stage: string) => void,
  totalDuration?: number
): Promise<SlideAlignment[]> {
  onProgress?.('Analisi della trascrizione e sincronizzazione millimetrica delle slide...');

  const maxTranscriptEnd = transcript.reduce((max, s) => Math.max(max, s.end || 0), 0);
  const effectiveDuration = (totalDuration && totalDuration > 0) ? totalDuration : maxTranscriptEnd;
  const durMins = Math.floor(effectiveDuration / 60);
  const durSecs = Math.round(effectiveDuration % 60);
  const durFormatted = `${durMins}:${durSecs.toString().padStart(2, '0')}`;

  const realignSchema = {
    type: 'OBJECT',
    properties: {
      slides_alignment: {
        type: 'ARRAY',
        description: 'Chronological temporal alignment between slides and transcript timestamps',
        items: {
          type: 'OBJECT',
          properties: {
            slide_number: { type: 'INTEGER', description: 'Page or slide number from 1 upwards' },
            title: { type: 'STRING', description: 'Slide title or topic' },
            part: { type: 'INTEGER', description: 'Audio part index (0-indexed)' },
            start_time_seconds: { type: 'INTEGER', description: 'Exact audio second where this slide explanation begins' },
            end_time_seconds: { type: 'INTEGER', description: 'Exact audio second where this slide explanation concludes' },
            summary: { type: 'STRING', description: 'Key concepts and formulas explained in this slide' },
          },
          required: ['slide_number', 'title', 'part', 'start_time_seconds', 'end_time_seconds', 'summary'],
        },
      },
    },
    required: ['slides_alignment'],
  };

  const systemPrompt = `Sei un assistente accademico esperto nella sincronizzazione temporale multimediale.
Il tuo compito è determinare con MASSIMA PRECISIONE TEMPORALE l'intervallo [start_time_seconds, end_time_seconds] di ciascuna slide proiettata, confrontando il testo delle slide con la trascrizione temporizzata audio della lezione di "${course}" (titolo: "${title}").

REGOLE DI SINCRONIZZAZIONE MILLIMETRICA:
1. "start_time_seconds": Il secondo ESATTO in cui il docente passa alla slide (es. inizia a leggerne il titolo, ne commenta i primi punti elenco o formule). Corrisponde al tempo del segmento di trascrizione in cui inizia la spiegazione.
2. "end_time_seconds": Il secondo in cui termina la spiegazione di quella slide e il docente passa alla successiva.
3. Se il docente salta una slide o non ne parla, NON inventare tempi fittizi: escludila oppure assegna tempi congruenti.
4. I tempi devono essere strettamente cronologici e sequenziali per ogni parte: slide[k].start_time_seconds <= slide[k].end_time_seconds <= slide[k+1].start_time_seconds.
5. "part": Indice della registrazione audio (0-based) a cui appartiene il timestamp.
6. LIMITE ASSOLUTO DI DURATA AUDIO:
L'intera registrazione audio dura ESATTAMENTE ${durFormatted} (${Math.round(effectiveDuration)} secondi).
È TASSATIVAMENTE VIETATO generare 'start_time_seconds' o 'end_time_seconds' superiori a ${Math.round(effectiveDuration)}.
Tutti i timestamp devono essere rigorosamente compresi tra 0 e ${Math.round(effectiveDuration)} secondi.
L'ultima slide spiegata deve terminare al massimo a ${Math.round(effectiveDuration)} secondi. Non inventare mai timestamp oltre la fine dell'audio!

Restituisci esclusivamente il JSON conforme allo schema specificato.`;

  const transcriptLines = transcript
    .map((s) => `[P${s.partIndex ?? 0} ${s.start}s - ${s.end}s] ${s.text_en} (IT: ${s.text_it})`)
    .join('\n');

  const promptText = `Ecco la trascrizione audio temporizzata e il testo delle slide:

=== INFORMAZIONI AUDIO ===
Durata totale registrazione: ${durFormatted} (${Math.round(effectiveDuration)} secondi). Nessun timestamp può superare questo limite.

=== TRASCRIZIONE TEMPORIZZATA DELL'AUDIO ===
${transcriptLines}

=== TESTO DELLE SLIDE DEL DOCENTE ===
${slidesMarkdown}

Allinea con la massima precisione cronologica ogni slide al momento esatto in cui viene spiegata (entro e non oltre ${Math.round(effectiveDuration)}s).`;

  const modelsToTry = getModelFallbackChain();
  let generationResponse: Response | null = null;

  for (const model of modelsToTry) {
    onProgress?.(`Allineamento slide con ${model}...`);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const payload = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: promptText }] }],
      generationConfig: {
        response_mime_type: 'application/json',
        response_schema: realignSchema,
        temperature: 0.1,
      },
    };

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (resp.ok) {
        generationResponse = resp;
        break;
      }
    } catch (e) {
      console.warn(`Model ${model} failed in realign:`, e);
    }
  }

  if (!generationResponse || !generationResponse.ok) {
    const errText = generationResponse ? await generationResponse.text() : 'Nessuna risposta da Gemini.';
    throw new Error(`Riallineamento slide fallito: ${errText}`);
  }

  const genData = await generationResponse.json();
  const candidateText = genData.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!candidateText) {
    throw new Error('Risposta vuota da Gemini durante il riallineamento.');
  }

  let cleanJson = candidateText.trim();
  if (cleanJson.startsWith('```json')) {
    cleanJson = cleanJson.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
  } else if (cleanJson.startsWith('```')) {
    cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
  }

  const parsed = JSON.parse(cleanJson);
  const rawList: SlideAlignment[] = Array.isArray(parsed.slides_alignment)
    ? parsed.slides_alignment
    : [];
  const consolidated = consolidateSlidesAlignment([rawList]);
  return clampAndNormalizeSlideTimestamps(consolidated, effectiveDuration);
}
