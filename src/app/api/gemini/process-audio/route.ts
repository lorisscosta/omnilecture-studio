import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 300; // 5 minutes for processing long audio files
export const dynamic = 'force-dynamic';

// Strict JSON Schema for Gemini 2.5 Flash
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
    'X-Goog-Upload-Header-Content-Type': mimeType || 'audio/mp3',
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
    const mimeType = audioFile.type || 'audio/mp3';
    const fileName = audioFile.name || 'lecture_audio.mp3';

    // Step 1: Upload to Google AI Studio Files API
    const { fileUri, fileResourceName } = await uploadToGeminiFilesAPI(
      arrayBuffer,
      mimeType,
      fileName,
      apiKey
    );
    uploadedFileResource = fileResourceName;

    // Step 2: System prompt and query
    const systemPrompt = `Sei un assistente accademico di altissimo livello per studenti magistrali di ingegneria (es. Elaborazione Numerica dei Segnali, Controlli Automatici, Telecomunicazioni, Robotica, Elettronica).
La lezione audio caricata è tenuta in lingua INGLESE.
Devi analizzare in profondità l'audio ed estrarre:
1. "glossary": Glossario completo di tutti i termini tecnici specialistici con traduzione italiana ufficiale e definizione accademica rigorosa.
2. "timestamped_transcript": Trascrizione cronologica completa suddivisa in segmenti temporali (start, end in secondi), con il testo originale in inglese (text_en) e l'accurata traduzione italiana a fronte (text_it).
3. "study_guide_it": Guida allo studio accademica approfondita e formale in ITALIANO. Strutturata con titoli, paragrafi, formule matematiche LaTeX native (usa $...$ per formule inline e $$...$$ per blocchi), passaggi di dimostrazioni matematiche, teoremi, e callout in stile Obsidian (es. > [!note], > [!important], > [!tip]).
4. "potential_exam_questions": Almeno 3-5 domande d'esame (scritto/orale) realistiche ed esigenti basate sui concetti chiave spiegati, con le relative soluzioni dettagliate in LaTeX (answer_latex) e livello di importanza ('Medium', 'High', 'Crucial').
5. "mermaid_mindmap": Schema visivo concettuale della lezione scritto in pura sintassi Mermaid.js (es. flowchart TD ...). Assicurati che sia sintatticamente valido senza caratteri vietati nei nodi.`;

    const promptText = `Analizza questa lezione del corso di "${course}" intitolata "${title}". Restituisci esclusivamente il JSON strutturato secondo lo schema specificato.`;

    const modelsToTry = [
      'gemini-2.0-flash',
      'gemini-2.0-flash-exp',
      'gemini-1.5-flash',
      'gemini-1.5-flash-latest',
      'gemini-1.5-flash-002',
      'gemini-1.5-flash-001',
      'gemini-1.5-pro',
      'gemini-1.5-pro-latest',
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

      // If model not found (404) or modality unsupported (400), try next model
      if (generationResponse.status === 404 || generationResponse.status === 400) {
        console.warn(`Model ${model} returned ${generationResponse.status}, trying next available model...`);
        continue;
      } else {
        break;
      }
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
