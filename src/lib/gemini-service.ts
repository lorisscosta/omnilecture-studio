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

export async function processAudioDirectly(
  audioFile: File | Blob,
  course: string,
  title: string,
  apiKey: string,
  onProgress?: (stage: string) => void
): Promise<{ success: boolean; data: LectureData; modelUsed: string }> {
  let fileResourceName: string | null = null;

  try {
    const arrayBuffer = await audioFile.arrayBuffer();
    const mimeType = audioFile.type || 'audio/mp3';
    const fileName = (audioFile as File).name || 'lecture_audio.mp3';

    // Step 1: Initialize Resumable Upload directly with Google AI Studio
    onProgress?.('Caricamento audio diretto su Google AI Studio Files API...');
    const initUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`;
    const initHeaders: Record<string, string> = {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': arrayBuffer.byteLength.toString(),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    };

    const initResponse = await fetch(initUrl, {
      method: 'POST',
      headers: initHeaders,
      body: JSON.stringify({
        file: {
          display_name: fileName,
        },
      }),
    });

    if (!initResponse.ok) {
      const errText = await initResponse.text();
      let parsedMsg = errText;
      try {
        const errObj = JSON.parse(errText);
        parsedMsg = errObj.error?.message || errText;
      } catch {}
      throw new Error(`Inizializzazione upload su Google AI Studio fallita (${initResponse.status}): ${parsedMsg}`);
    }

    const uploadUrl = initResponse.headers.get('x-goog-upload-url') || initResponse.headers.get('X-Goog-Upload-URL');
    if (!uploadUrl) {
      throw new Error('Google AI Studio non ha restituito l\'URL di caricamento.');
    }

    // Step 2: Upload Audio Buffer directly
    onProgress?.('Trasferimento audio in corso verso Google AI Studio...');
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Length': arrayBuffer.byteLength.toString(),
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize',
      },
      body: arrayBuffer,
    });

    if (!uploadResponse.ok) {
      const errText = await uploadResponse.text();
      throw new Error(`Caricamento buffer audio fallito (${uploadResponse.status}): ${errText}`);
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

    // Step 4: Run Gemini 2.5 Flash
    onProgress?.('Analisi multimodale con Gemini 2.5 Flash in corso (formule LaTeX, trascrizione, appunti)...');

    const systemPrompt = `Sei un assistente accademico di altissimo livello per studenti magistrali di ingegneria (es. Elaborazione Numerica dei Segnali, Controlli Automatici, Telecomunicazioni, Robotica, Elettronica).
La lezione audio caricata è tenuta in lingua INGLESE.
Devi analizzare in profondità l'audio ed estrarre:
1. "glossary": Glossario completo di tutti i termini tecnici specialistici con traduzione italiana ufficiale e definizione accademica rigorosa.
2. "timestamped_transcript": Trascrizione cronologica completa suddivisa in segmenti temporali (start, end in secondi), con il testo originale in inglese (text_en) e l'accurata traduzione italiana a fronte (text_it).
3. "study_guide_it": Guida allo studio accademica approfondita e formale in ITALIANO. Strutturata con titoli, paragrafi, formule matematiche LaTeX native (usa $...$ per formule inline e $$...$$ per blocchi), passaggi di dimostrazioni matematiche, teoremi, e callout in stile Obsidian (es. > [!note], > [!important], > [!tip]).
4. "potential_exam_questions": Almeno 3-5 domande d'esame (scritto/orale) realistiche ed esigenti basate sui concetti chiave spiegati, con le relative soluzioni dettagliate in LaTeX (answer_latex) e livello di importanza ('Medium', 'High', 'Crucial').
5. "mermaid_mindmap": Schema visivo concettuale della lezione scritto in pura sintassi Mermaid.js (es. flowchart TD ...). Assicurati che sia sintatticamente valido senza caratteri vietati nei nodi.`;

    const promptText = `Analizza questa lezione del corso di "${course}" intitolata "${title}". Restituisci esclusivamente il JSON strutturato secondo lo schema specificato.`;

    const modelsToTry = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    let generationResponse: Response | null = null;
    let successfulModel = '';

    for (const model of modelsToTry) {
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

      generationResponse = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (generationResponse.ok) {
        successfulModel = model;
        break;
      }

      if (generationResponse.status === 404) {
        console.warn(`Modello ${model} non trovato (404), provo il modello successivo...`);
        continue;
      } else {
        break;
      }
    }

    if (!generationResponse || !generationResponse.ok) {
      const errorText = generationResponse ? await generationResponse.text() : 'Nessuna risposta ricevuta.';
      let parsed = errorText;
      try {
        const errObj = JSON.parse(errorText);
        parsed = errObj.error?.message || errorText;
      } catch {}
      throw new Error(`Errore API Gemini (${generationResponse?.status || 500}): ${parsed}`);
    }

    const genData = await generationResponse.json();
    const candidateText = genData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!candidateText) {
      throw new Error('Risposta vuota da Gemini API.');
    }

    const parsedData: LectureData = JSON.parse(candidateText);

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
