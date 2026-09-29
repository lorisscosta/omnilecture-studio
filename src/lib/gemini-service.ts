import { LectureData, AudioPart } from './types';

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
      description: 'Documento completo LaTeX (.tex) pronto per essere incollato ed eseguito direttamente su Overleaf. Deve contenere la trascrizione integrale e trattazione accademica completa dell\'audio formattata in LaTeX standard (inclusi \\documentclass[11pt,a4paper]{article}, \\usepackage[utf8]{inputenc}, \\usepackage[italian]{babel}, \\usepackage{amsmath,amssymb,amsthm,geometry,hyperref}, \\geometry{margin=2.5cm}, \\title{...}, \\author{OmniLecture Studio}, \\date{\\today}, \\begin{document}, \\maketitle, sezioni con \\section e \\subsection, equazioni matematiche \\begin{equation} o \\[ ... \\], ambienti definition e theorem, e trattazione integrale discorsiva di tutto l\'audio senza sintesi eccessive, \\end{document}).',
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
  onProgress?: (stage: string) => void,
  userSelectedModel?: string
): Promise<{
  success: boolean;
  data: LectureData;
  modelUsed: string;
  totalDuration: number;
  audioParts: AudioPart[];
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
        throw new Error(
          `Caricamento ${fileName} su Google AI Studio fallito (${uploadResponse.status}): ${parsedMsg}`
        );
      }

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

    // Step 2: Discover available models
    onProgress?.('Rilevamento automatico dei modelli Gemini abilitati per la tua chiave...');
    let modelsToTry: string[] = [];

    // Map legacy or fictitious model names to modern official models
    let normalizedUserSelectedModel = userSelectedModel;
    if (normalizedUserSelectedModel === 'gemini-3.8-flash' || normalizedUserSelectedModel === 'gemini-3.6-flash') {
      normalizedUserSelectedModel = 'gemini-2.0-flash';
    }

    if (normalizedUserSelectedModel && !normalizedUserSelectedModel.includes('tts') && !normalizedUserSelectedModel.includes('live')) {
      modelsToTry.push(normalizedUserSelectedModel);
    }

    try {
      const listResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      if (listResponse.ok) {
        const listData = await listResponse.json();
        const available: string[] = (listData.models || [])
          .filter((m: any) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
          .map((m: any) => m.name.replace(/^models\//, ''))
          .filter((name: string) =>
            !name.includes('tts') &&
            !name.includes('embedding') &&
            !name.includes('imagen') &&
            !name.includes('aqa') &&
            !name.includes('live')
          );

        const preferredOrder = [
          'gemini-2.0-flash',
          'gemini-1.5-flash-latest',
          'gemini-1.5-flash-002',
          'gemini-1.5-flash',
          'gemini-2.0-flash-exp',
          'gemini-1.5-pro-latest',
          'gemini-1.5-pro-002',
          'gemini-1.5-pro',
        ];

        for (const p of preferredOrder) {
          if (available.includes(p) && !modelsToTry.includes(p)) {
            modelsToTry.push(p);
          }
        }

        for (const a of available) {
          if (!modelsToTry.includes(a) && (a.includes('flash') || a.includes('pro') || a.includes('gemini'))) {
            modelsToTry.push(a);
          }
        }
      }
    } catch (err) {
      console.warn('Errore durante la chiamata ListModels:', err);
    }

    if (modelsToTry.length === 0) {
      modelsToTry = [
        'gemini-2.0-flash',
        'gemini-1.5-flash-latest',
        'gemini-1.5-flash-002',
        'gemini-1.5-flash',
        'gemini-2.0-flash-exp',
        'gemini-1.5-pro-latest',
        'gemini-1.5-pro-002',
        'gemini-1.5-pro',
      ];
    }

    const isMultiPart = uploadedFilesMeta.length > 1;

    // Step 3: Define prompts
    const systemPrompt = `Sei un assistente accademico di altissimo livello per studenti magistrali di ingegneria.
REGOLA FONDAMENTALE DI FEDELTÀ ALL'AUDIO (STRICT GROUNDING):
Tutto ciò che generi deve basarsi RIGOROSAMENTE ed ESCLUSIVAMENTE sull'effettivo contenuto audio trascritto.
NON inventare MAI concetti, argomenti, teoremi o formule che non siano stati trattati o accennati dal docente/oratore nell'audio. Il titolo della lezione e il nome del corso servono solo come contesto terminologico, NON come pretesto per allucinare spiegazioni non presenti nella registrazione.
Il tuo compito è: prendere ciò che il docente ha realmente spiegato nella registrazione e strutturarlo accademicamente, migliorandone la chiarezza formale, la notazione LaTeX e l'esposizione.
${
  isMultiPart
    ? `\nISTRUZIONI SPECIFICHE PER LEZIONE IN PIÙ REGISTRAZIONI (${uploadedFilesMeta.length} PARTI ORDINATE):
La lezione è stata registrata a spezzoni (ad esempio fermando il registratore prima della pausa e riaccendendolo alla ripresa).
Devi trattare le registrazioni come UN'UNICA LEZIONE ORGANICA CONTINUA:
1. "study_guide_it": UN UNICO documento LaTeX completo per Overleaf (.tex) che sviluppa TUTTA la lezione in modo coeso dall'inizio della Parte 1 fino alla fine della Parte ${uploadedFilesMeta.length}, unificando la spiegazione senza cesure artificiali.
2. "timestamped_transcript": Trascrizione cronologica coerente e ordinata di tutte le parti. Per ogni segmento temporale, calcola il tempo continuo complessivo in secondi cumulativi sommando l'offset della parte a cui appartiene, e valorizza partIndex (da 0 a ${uploadedFilesMeta.length - 1}).
3. "glossary": Glossario accademico unificato di tutti i termini spiegati nell'intero arco delle registrazioni.
4. "potential_exam_questions": Domande d'esame complete che coprono l'intero programma affrontato in tutte le parti.`
    : ''
}

Struttura dei campi JSON richiesta:
1. "timestamped_transcript": Trascrizione cronologica fedele al 100% dell'audio suddivisa in segmenti temporali (start, end in secondi), con il testo parlato originale (text_en) e l'accurata traduzione/trascrizione italiana (text_it). Se l'audio è in italiano, text_it conterrà la trascrizione esatta e text_en la traduzione inglese. Includi partIndex indicando l'indice (0-based) della registrazione di riferimento.
2. "glossary": Estrai SOLO i termini tecnici realmente pronunciati o spiegati nell'audio con traduzione e definizione accademica. Se nell'audio non sono stati pronunciati termini tecnici (es. registrazioni di prova, test microfono, audio non didattico), restituisci un array VUOTO [].
3. "study_guide_it": Trascrizione integrale e trattazione accademica completa dell'audio in formato codice LaTeX (.tex) completo e pronto da copiare direttamente su Overleaf. Deve iniziare con \\documentclass[11pt,a4paper]{article}, includere i pacchetti necessari (amsmath, amssymb, amsthm, geometry, hyperref, babel italiano), impostare \\title, \\author{OmniLecture Studio}, \\date, \\begin{document}, \\maketitle, e poi sviluppare con \\section, \\subsection, equazioni matematiche in ambiente equation o \\[ ... \\], e testo discorsivo TUTTO ciò che il docente ha spiegato nell'audio in modo rigoroso, terminando con \\end{document}. Se l'audio è solo un test breve (es. "prova prova"), il documento LaTeX spiegherà sinteticamente che si tratta di una registrazione di prova senza allucinare teoria fittizia.
4. "potential_exam_questions": Genera domande d'esame SOLTANTO sui concetti accademici effettivamente trattati nell'audio. Se l'audio non contiene concetti didattici esaminabili (es. prova vocale breve), restituisci un array VUOTO [].`;

    // Construct content parts
    const contentParts: any[] = [];

    if (isMultiPart) {
      let overviewText = `Questa lezione del corso "${course}" (titolo: "${title}") è composta da ${uploadedFilesMeta.length} registrazioni audio continue effettuate in sequenza:\n`;
      uploadedFilesMeta.forEach((uf, idx) => {
        overviewText += `- Parte ${idx + 1}: ${uf.fileName} (offset: ${Math.round(uf.startOffset)}s, durata: ~${Math.round(uf.duration)}s)\n`;
      });
      overviewText += `\nGenera un UNICO output completo con Guida Overleaf LaTeX unificata, Glossario unificato, Domande d'esame e Trascrizione continua.`;
      contentParts.push({ text: overviewText });

      for (let i = 0; i < uploadedFilesMeta.length; i++) {
        const uf = uploadedFilesMeta[i];
        contentParts.push({
          text: `=== REGISTRAZIONE PARTE ${i + 1} DI ${uploadedFilesMeta.length}: "${uf.fileName}" (Inizio al secondo continuo ${Math.round(uf.startOffset)}) ===`,
        });
        contentParts.push({
          file_data: {
            mime_type: uf.mimeType,
            file_uri: uf.fileUri,
          },
        });
        contentParts.push({
          text: `=== FINE REGISTRAZIONE PARTE ${i + 1} ===`,
        });
      }

      contentParts.push({
        text: `Procedi ora con l'elaborazione unificata completa secondo lo schema JSON indicato.`,
      });
    } else {
      contentParts.push({
        file_data: {
          mime_type: uploadedFilesMeta[0].mimeType,
          file_uri: uploadedFilesMeta[0].fileUri,
        },
      });
      contentParts.push({
        text: `Trascrivi ed elabora questa registrazione audio del corso di "${course}" (titolo specificato: "${title}"). Ricorda: basati rigorosamente su quanto ascoltato nell'audio. Restituisci esclusivamente il JSON strutturato secondo lo schema specificato.`,
      });
    }

    let generationResponse: Response | null = null;
    let successfulModel = '';
    const errorLogs: string[] = [];

    for (const model of modelsToTry) {
      onProgress?.(`Analisi in corso con il modello: ${model}...`);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const payload = {
        system_instruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: 'user',
            parts: contentParts,
          },
        ],
        generationConfig: {
          response_mime_type: 'application/json',
          response_schema: responseSchema,
          temperature: 0.2,
        },
      };

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

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
        console.warn(`Modello ${model} ha restituito ${response.status}: ${errMsg}`);

        if (response.status === 401) {
          generationResponse = response;
          break;
        }

        if (response.status === 429 || response.status === 503) {
          onProgress?.(`Il modello ${model} è temporaneamente saturo, provo il modello successivo...`);
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }

        continue;
      } catch (fetchErr: any) {
        errorLogs.push(`${model}: ${fetchErr.message}`);
        continue;
      }
    }

    if (!generationResponse || !generationResponse.ok) {
      const summaryMsg = errorLogs.length > 0 ? errorLogs.join(' | ') : 'Nessuna risposta dai modelli.';
      throw new Error(`Errore generazione Gemini: ${summaryMsg}`);
    }

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

    const parsedData: LectureData = JSON.parse(cleanJson);

    // Defensive Timestamp Normalization for Multi-Part
    if (isMultiPart && Array.isArray(parsedData.timestamped_transcript)) {
      parsedData.timestamped_transcript = parsedData.timestamped_transcript.map((seg, idx) => {
        let pIdx = typeof seg.partIndex === 'number' && seg.partIndex >= 0 && seg.partIndex < audioParts.length
          ? seg.partIndex
          : 0;

        // Check if start is relative to that part rather than cumulative
        const partOffset = audioParts[pIdx]?.startOffset || 0;
        let s = seg.start;
        let e = seg.end;

        if (partOffset > 0 && s < partOffset) {
          s += partOffset;
          e += partOffset;
        }

        return {
          ...seg,
          start: Math.round(s * 10) / 10,
          end: Math.round(Math.max(e, s + 1) * 10) / 10,
          partIndex: pIdx,
        };
      });
    }

    return {
      success: true,
      data: parsedData,
      modelUsed: successfulModel,
      totalDuration: totalCalculatedDuration,
      audioParts,
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

    const modelsToTry = [
      'gemini-2.0-flash',
      'gemini-1.5-flash-latest',
      'gemini-1.5-flash-002',
      'gemini-1.5-flash',
      'gemini-2.0-flash-exp',
      'gemini-1.5-pro-latest',
      'gemini-1.5-pro-002',
      'gemini-1.5-pro',
    ];

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
      throw new Error(`Conversione PDF fallita: ${errText}`);
    }

    const genData = await generationResponse.json();
    let candidateText = genData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!candidateText) {
      throw new Error('Nessun testo Markdown generato dalle slide.');
    }

    // Clean any leading ```markdown fences if Gemini wrapped it
    candidateText = candidateText.trim();
    if (candidateText.startsWith('```markdown')) {
      candidateText = candidateText.replace(/^```markdown\s*/i, '').replace(/\s*```$/, '').trim();
    } else if (candidateText.startsWith('```md')) {
      candidateText = candidateText.replace(/^```md\s*/i, '').replace(/\s*```$/, '').trim();
    } else if (candidateText.startsWith('```')) {
      candidateText = candidateText.replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
    }

    // Cleanup temp file
    if (fileResourceName) {
      try {
        await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileResourceName}?key=${apiKey}`, {
          method: 'DELETE',
        });
        fileResourceName = null;
      } catch (e) {
        console.warn('Pulizia PDF temporaneo fallita:', e);
      }
    }

    return candidateText;
  } catch (err: any) {
    if (fileResourceName && apiKey) {
      try {
        await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileResourceName}?key=${apiKey}`, {
          method: 'DELETE',
        });
      } catch {}
    }
    throw err;
  }
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

Restituisci esclusivamente il JSON strutturato secondo lo schema specificato.`;

  const transcriptSummary = currentData.timestamped_transcript
    .map((s) => `[${s.start}s - ${s.end}s] ${s.speaker}: ${s.text_en} (IT: ${s.text_it})`)
    .join('\n');

  const promptText = `Ecco i dati della registrazione vocale e delle slide della lezione di "${course}" (titolo: "${title}"):

=== TRASCRIZIONE AUDIO ESISTENTE ===
${transcriptSummary}

=== TESTO MARKDOWN DELLE SLIDE DEL DOCENTE ===
${slidesMarkdown}

Confronta la registrazione vocale con le slide, unisci i contenuti e restituisci il JSON con la Guida Overleaf LaTeX completa arricchita con i riferimenti alle slide, il glossario aggiornato e le domande d'esame.`;

  const modelsToTry = [
    'gemini-2.0-flash',
    'gemini-1.5-flash-latest',
    'gemini-1.5-flash-002',
    'gemini-1.5-flash',
    'gemini-2.0-flash-exp',
    'gemini-1.5-pro-latest',
    'gemini-1.5-pro-002',
    'gemini-1.5-pro',
  ];

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

  return enrichedData;
}
