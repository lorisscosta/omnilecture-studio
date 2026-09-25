import { LectureData } from './types';

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
        },
        required: ['start', 'end', 'speaker', 'text_en', 'text_it'],
      },
    },
    study_guide_it: {
      type: 'STRING',
      description: 'Deep, comprehensive Italian academic study notes. Must include native LaTeX equations ($...$ inline, $$...$$ block), step-by-step mathematical proofs, key theorems, intuition, and Obsidian callouts like > [!important] or > [!note].',
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
    mermaid_mindmap: {
      type: 'STRING',
      description: 'Valid Mermaid.js graph or flowchart syntax representing the lecture hierarchy and concept relationships (e.g. flowchart TD ...)',
    },
  },
  required: [
    'glossary',
    'timestamped_transcript',
    'study_guide_it',
    'potential_exam_questions',
    'mermaid_mindmap',
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

export async function processAudioDirectly(
  audioFile: File | Blob,
  course: string,
  title: string,
  apiKey: string,
  onProgress?: (stage: string) => void,
  userSelectedModel?: string
): Promise<{ success: boolean; data: LectureData; modelUsed: string }> {
  let fileResourceName: string | null = null;

  try {
    const arrayBuffer = await audioFile.arrayBuffer();
    const fileName = (audioFile as File).name || 'lecture_audio.wav';
    const mimeType = detectAudioMimeType(arrayBuffer, fileName, audioFile.type);

    // Step 1: Upload via single multipart/related request (CORS-compatible, no custom headers required)
    onProgress?.(`Caricamento audio (${mimeType}) su Google AI Studio Files API...`);
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
      throw new Error(`Caricamento su Google AI Studio fallito (${uploadResponse.status}): ${parsedMsg}`);
    }

    const uploadResult = await uploadResponse.json();
    fileResourceName = uploadResult.file?.name;
    const fileUri = uploadResult.file?.uri;

    if (!fileResourceName || !fileUri) {
      throw new Error('Metadati del file audio non validi da Google AI Studio.');
    }

    // Step 3: Polling if file in PROCESSING
    let state = uploadResult.file?.state;
    let attempts = 0;
    while (state === 'PROCESSING' && attempts < 30) {
      onProgress?.('Elaborazione audio sui server Google in corso...');
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const checkResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${fileResourceName}?key=${apiKey}`
      );
      if (checkResponse.ok) {
        const checkResult = await checkResponse.json();
        state = checkResult.state;
        if (state === 'FAILED') {
          throw new Error('Elaborazione audio fallita sui server Google AI Studio.');
        }
      }
      attempts++;
    }

    // Step 4: Discover available models for this API key via ListModels
    onProgress?.('Rilevamento automatico dei modelli Gemini abilitati per la tua chiave...');
    let modelsToTry: string[] = [];

    // If user explicitly chose a model, try that first!
    if (userSelectedModel && !userSelectedModel.includes('tts') && !userSelectedModel.includes('live')) {
      modelsToTry.push(userSelectedModel);
    }

    try {
      const listResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      if (listResponse.ok) {
        const listData = await listResponse.json();
        const available: string[] = (listData.models || [])
          .filter((m: any) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
          .map((m: any) => m.name.replace(/^models\//, ''))
          // Strict filter: Exclude TTS, embedding, imagen, aqa, live
          .filter((name: string) => 
            !name.includes('tts') && 
            !name.includes('embedding') && 
            !name.includes('imagen') && 
            !name.includes('aqa') &&
            !name.includes('live')
          );

        const preferredOrder = [
          'gemini-1.5-flash-latest',
          'gemini-1.5-flash-002',
          'gemini-1.5-flash',
          'gemini-3.8-flash',
          'gemini-3.6-flash',
          'gemini-1.5-pro-latest',
          'gemini-1.5-pro-002',
          'gemini-1.5-pro',
        ];

        for (const p of preferredOrder) {
          if (available.includes(p) && !modelsToTry.includes(p)) {
            modelsToTry.push(p);
          }
        }

        // Add any remaining multimodal models
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
        'gemini-1.5-flash-latest',
        'gemini-1.5-flash-002',
        'gemini-1.5-flash',
        'gemini-3.8-flash',
        'gemini-3.6-flash',
        'gemini-1.5-pro-latest',
        'gemini-1.5-pro-002',
        'gemini-1.5-pro',
      ];
    }

    const systemPrompt = `Sei un assistente accademico di altissimo livello per studenti magistrali di ingegneria.
REGOLA FONDAMENTALE DI FEDELTÀ ALL'AUDIO (STRICT GROUNDING):
Tutto ciò che generi deve basarsi RIGOROSAMENTE ed ESCLUSIVAMENTE sull'effettivo contenuto audio trascritto.
NON inventare MAI concetti, argomenti, teoremi o formule che non siano stati trattati o accennati dal docente/oratore nell'audio. Il titolo della lezione e il nome del corso servono solo come contesto terminologico, NON come pretesto per allucinare spiegazioni non presenti nella registrazione.
Il tuo compito è: prendere ciò che il docente ha realmente spiegato nella registrazione e strutturarlo accademicamente, migliorandone la chiarezza formale, la notazione LaTeX e l'esposizione.

Struttura dei campi JSON richiesta:
1. "timestamped_transcript": Trascrizione cronologica fedele al 100% dell'audio suddivisa in segmenti temporali (start, end in secondi), con il testo parlato originale (text_en) e l'accurata traduzione/trascrizione italiana (text_it). Se l'audio è in italiano, text_it conterrà la trascrizione esatta e text_en la traduzione inglese.
2. "glossary": Estrai SOLO i termini tecnici realmente pronunciati o spiegati nell'audio con traduzione e definizione accademica. Se nell'audio non sono stati pronunciati termini tecnici (es. registrazioni di prova, test microfono, audio non didattico), restituisci un array VUOTO [].
3. "study_guide_it": Guida allo studio in ITALIANO basata UNICAMENTE sui temi spiegati nella registrazione. Riorganizza e approfondisci con formule matematiche LaTeX native ($...$ e $$...$$) e callout Obsidian ciò che è stato spiegato. Se la registrazione è solo un breve test vocale (es. "prova prova") o non contiene contenuti didattici, spiega sinteticamente che si tratta di una registrazione di test/prova e non aggiungere materiale teorico fittizio.
4. "potential_exam_questions": Genera domande d'esame SOLTANTO sui concetti accademici effettivamente trattati nell'audio. Se l'audio non contiene concetti didattici esaminabili (es. prova vocale breve), restituisci un array VUOTO [].
5. "mermaid_mindmap": Schema visivo Mermaid.js che riassume esclusivamente la gerarchia dei concetti realmente esposti nell'audio (es. "flowchart TD\\n  A[Test Registrazione] --> B[Verifica Audio]").`;

    const promptText = `Trascrivi ed elabora questa registrazione audio del corso di "${course}" (titolo specificato: "${title}"). Ricorda: basati rigorosamente su quanto ascoltato nell'audio. Restituisci esclusivamente il JSON strutturato secondo lo schema specificato.`;

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
            parts: [
              {
                file_data: {
                  mime_type: mimeType,
                  file_uri: fileUri,
                },
              },
              { text: promptText },
            ],
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

        // If 401 (Invalid API key), stop immediately
        if (response.status === 401) {
          generationResponse = response;
          break;
        }

        // If high demand spike (503 / 429), wait 1.5s and continue to next model
        if (response.status === 429 || response.status === 503) {
          onProgress?.(`Il modello ${model} è temporaneamente saturo, provo il modello successivo...`);
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }

        // Continue trying next available model in all other cases (404, 400, 500, etc.)
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

    // Step 5: Clean up temp file
    if (fileResourceName) {
      try {
        await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileResourceName}?key=${apiKey}`, {
          method: 'DELETE',
        });
        fileResourceName = null;
      } catch (e) {
        console.warn('Pulizia file temporaneo fallita:', e);
      }
    }

    return {
      success: true,
      data: parsedData,
      modelUsed: successfulModel,
    };
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
