import { NextRequest, NextResponse } from 'next/server';
import { detectAudioMimeType } from '@/lib/gemini-service';

export const maxDuration = 300; // 5 minutes for processing long audio files
export const dynamic = 'force-dynamic';

// Strict JSON Schema for Gemini
const responseSchema = {
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

async function uploadToGeminiFilesAPI(
  audioBuffer: ArrayBuffer,
  mimeType: string,
  fileName: string,
  apiKey: string
): Promise<{ fileUri: string; fileResourceName: string }> {
  // Step 1: Initialize Resumable Upload
  const initUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`;
  const initHeaders = {
    'X-Goog-Upload-Protocol': 'resumable',
    'X-Goog-Upload-Command': 'start',
    'X-Goog-Upload-Header-Content-Length': audioBuffer.byteLength.toString(),
    'X-Goog-Upload-Header-Content-Type': mimeType,
    'Content-Type': 'application/json',
  };

  const initResponse = await fetch(initUrl, {
    method: 'POST',
    headers: initHeaders,
    body: JSON.stringify({
      file: {
        display_name: fileName,
        mimeType: mimeType,
      },
    }),
  });

  if (!initResponse.ok) {
    const errText = await initResponse.text();
    throw new Error(`Google AI Studio Files API upload init failed (${initResponse.status}): ${errText}`);
  }

  const uploadUrl = initResponse.headers.get('x-goog-upload-url') || initResponse.headers.get('X-Goog-Upload-URL');
  if (!uploadUrl) {
    throw new Error('Google AI Studio Files API did not return an upload URL header.');
  }

  // Step 2: Upload Audio Buffer
  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': audioBuffer.byteLength.toString(),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: audioBuffer,
  });

  if (!uploadResponse.ok) {
    const errText = await uploadResponse.text();
    throw new Error(`Google AI Studio Files API upload binary failed (${uploadResponse.status}): ${errText}`);
  }

  const uploadResult = await uploadResponse.json();
  const fileResourceName = uploadResult.file?.name; // e.g. "files/abc123xyz"
  const fileUri = uploadResult.file?.uri;

  if (!fileResourceName || !fileUri) {
    throw new Error('Google AI Studio Files API response missing file metadata.');
  }

  // Step 3: Wait for file processing if needed
  let state = uploadResult.file?.state;
  let attempts = 0;
  while (state === 'PROCESSING' && attempts < 30) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const checkResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileResourceName}?key=${apiKey}`
    );
    if (checkResponse.ok) {
      const checkResult = await checkResponse.json();
      state = checkResult.state;
      if (state === 'FAILED') {
        throw new Error('Google AI Studio audio processing failed on server.');
      }
    }
    attempts++;
  }

  return { fileUri, fileResourceName };
}

async function deleteGeminiFile(fileResourceName: string, apiKey: string): Promise<void> {
  try {
    await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileResourceName}?key=${apiKey}`, {
      method: 'DELETE',
    });
  } catch (err) {
    console.warn(`Failed to cleanup temp file ${fileResourceName}:`, err);
  }
}

export async function POST(req: NextRequest) {
  let uploadedFileResource: string | null = null;
  let apiKey = req.headers.get('x-gemini-api-key') || '';

  try {
    const formData = await req.formData();
    const audioFile = formData.get('audio') as File | null;
    const course = (formData.get('course') as string) || 'Ingegneria / STEM';
    const title = (formData.get('title') as string) || 'Lezione Magistrale';

    if (!apiKey) {
      apiKey = (formData.get('apiKey') as string) || '';
    }

    if (!apiKey) {
      return NextResponse.json(
        { error: 'Chiave API Google AI Studio non fornita. Inseriscila nelle impostazioni.' },
        { status: 400 }
      );
    }

    if (!audioFile) {
      return NextResponse.json(
        { error: 'Nessun file audio ricevuto.' },
        { status: 400 }
      );
    }

    const arrayBuffer = await audioFile.arrayBuffer();
    const fileName = audioFile.name || 'lecture_audio.wav';
    const mimeType = detectAudioMimeType(arrayBuffer, fileName, audioFile.type);

    // Step 1: Upload to Google AI Studio Files API
    const { fileUri, fileResourceName } = await uploadToGeminiFilesAPI(
      arrayBuffer,
      mimeType,
      fileName,
      apiKey
    );
    uploadedFileResource = fileResourceName;

    // Step 2: System prompt and query
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

    const modelsToTry = [
      'gemini-3.8-flash',
      'gemini-3.6-flash',
      'gemini-1.5-flash-latest',
      'gemini-1.5-flash-002',
      'gemini-1.5-flash-001',
      'gemini-1.5-flash',
      'gemini-1.5-pro-latest',
      'gemini-1.5-pro-002',
      'gemini-1.5-pro',
    ];
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

      if (generationResponse.status === 401) {
        break;
      }

      if (generationResponse.status === 429 || generationResponse.status === 503) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }

      continue;
    }

    if (!generationResponse || !generationResponse.ok) {
      const errorText = generationResponse ? await generationResponse.text() : 'Nessuna risposta ricevuta.';
      throw new Error(`Errore API Gemini (${generationResponse?.status || 500}): ${errorText}`);
    }

    const genData = await generationResponse.json();
    const candidateText = genData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!candidateText) {
      throw new Error('Risposta vuota da Gemini API.');
    }

    const parsedData = JSON.parse(candidateText);

    // Step 4: Cleanup Google AI Studio temp file
    if (uploadedFileResource) {
      await deleteGeminiFile(uploadedFileResource, apiKey);
      uploadedFileResource = null;
    }

    return NextResponse.json({
      success: true,
      modelUsed: successfulModel,
      data: parsedData,
    });
  } catch (error: any) {
    console.error('Error in /api/gemini/process-audio:', error);

    // Ensure temp file cleanup even on failure
    if (uploadedFileResource && apiKey) {
      await deleteGeminiFile(uploadedFileResource, apiKey);
    }

    return NextResponse.json(
      {
        error: error.message || 'Si è verificato un errore durante l\'elaborazione dell\'audio.',
      },
      { status: 500 }
    );
  }
}
