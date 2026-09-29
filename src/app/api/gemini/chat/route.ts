import { NextRequest, NextResponse } from 'next/server';
import { authenticateAndRateLimit, createRateLimitResponse } from '@/lib/server-rate-limiter';
import { getModelFallbackChain } from '@/lib/gemini-config';

export const dynamic = 'force-dynamic';

interface ContentTurn {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

export async function POST(req: NextRequest) {
  try {
    // Check authentication & atomic rate limits
    const rateLimitCheck = await authenticateAndRateLimit(req);
    if (!rateLimitCheck.allowed) {
      return createRateLimitResponse(rateLimitCheck);
    }

    let apiKey = req.headers.get('x-gemini-api-key') || '';
    const body = await req.json();
    const { lectureTitle, course, studyGuide, glossary, messages, question, model: requestedModel } = body;

    if (!apiKey) {
      apiKey = body.apiKey || '';
    }
    // Fallback to server key if BYOK not provided and user is authenticated
    if (!apiKey) {
      apiKey = process.env.GEMINI_API_KEY || '';
    }

    if (!apiKey) {
      return NextResponse.json(
        { error: 'Chiave API Google AI Studio mancante.' },
        { status: 400 }
      );
    }

    if (!question || !question.trim()) {
      return NextResponse.json(
        { error: 'La domanda non può essere vuota.' },
        { status: 400 }
      );
    }

    const systemPrompt = `Sei un tutor universitario esperto per studenti magistrali di ingegneria.
Il tuo compito è rispondere a domande e chiarire dubbi degli studenti STRETTAMENTE basandoti sul contenuto di questa lezione:
Corso: ${course || 'Ingegneria'}
Titolo: ${lectureTitle || 'Lezione'}

Contesto della Lezione (Guida allo Studio & Note):
"""
${studyGuide ? studyGuide.slice(0, 15000) : 'Nessuna guida specifica fornita.'}
"""

Glossario della Lezione:
"""
${glossary ? JSON.stringify(glossary).slice(0, 3000) : 'Nessun glossario.'}
"""

Linee guida per la risposta:
- Fornisci risposte accademiche, rigorose e chiare in lingua ITALIANA.
- Utilizza la sintassi LaTeX standard ($...$ per formule inline e $$...$$ per blocchi isolati) per ogni termine matematico, equazione o dimostrazione.
- Se la domanda non è coperta dal materiale della lezione, rispondi usando le tue conoscenze scientifiche indicando però con trasparenza che si tratta di un approfondimento non esplicitamente menzionato nella registrazione.`;

    // Format chat history for Gemini API (ensuring strict alternating turns and no duplicate user turns)
    const formattedContents: ContentTurn[] = [];

    if (Array.isArray(messages)) {
      for (const msg of messages) {
        if (!msg || !msg.content) continue;
        const role: 'user' | 'model' = msg.role === 'assistant' ? 'model' : 'user';
        
        // Merge consecutive turns with the same role to satisfy Gemini's strict alternation
        if (formattedContents.length > 0 && formattedContents[formattedContents.length - 1].role === role) {
          formattedContents[formattedContents.length - 1].parts[0].text += '\n\n' + msg.content;
        } else {
          formattedContents.push({
            role,
            parts: [{ text: msg.content }],
          });
        }
      }
    }

    // Add current question if not already the last user turn
    const lastItem = formattedContents[formattedContents.length - 1];
    if (lastItem && lastItem.role === 'user') {
      if (lastItem.parts[0].text !== question) {
        lastItem.parts[0].text += '\n\n' + question;
      }
    } else {
      formattedContents.push({
        role: 'user',
        parts: [{ text: question }],
      });
    }

    const modelsToTry = getModelFallbackChain(requestedModel);
    let chatResponse: Response | null = null;

    for (const model of modelsToTry) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      chatResponse = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: systemPrompt }],
          },
          contents: formattedContents,
          generationConfig: {
            temperature: 0.3,
          },
        }),
      });

      if (chatResponse.ok) {
        break;
      }
      if (chatResponse.status === 401) {
        break;
      }
      if (chatResponse.status === 429 || chatResponse.status === 503) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      continue;
    }

    if (!chatResponse || !chatResponse.ok) {
      const errText = chatResponse ? await chatResponse.text() : 'Nessuna risposta.';
      throw new Error(`Errore API Gemini (${chatResponse?.status || 500}): ${errText}`);
    }

    const data = await chatResponse.json();
    const answer = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Nessuna risposta generata.';

    return NextResponse.json({
      success: true,
      answer,
    });
  } catch (error: any) {
    console.error('Error in /api/gemini/chat:', error);
    return NextResponse.json(
      { error: error.message || 'Errore durante la generazione della risposta.' },
      { status: 500 }
    );
  }
}
