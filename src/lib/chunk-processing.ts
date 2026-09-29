import {
  AudioPart,
  GlossaryTerm,
  TranscriptSegment,
  ExamQuestion,
  LectureData,
  ChunkStatus,
  LectureProcessingChunk,
} from './types';
import { injectTimestampPreambleMacro } from './latex-linter';

/**
 * Creates a granular chunk execution plan for long lectures (2+ hours).
 * Divides audio parts into manageable segments (default 30-40 minutes)
 * to avoid browser memory spikes and Gemini output token truncation.
 */
export function createLectureChunksPlan(
  lectureId: string,
  audioParts: AudioPart[],
  maxChunkDurationSec = 2400 // 40 minutes per logical chunk
): LectureProcessingChunk[] {
  const chunks: LectureProcessingChunk[] = [];
  let globalChunkIndex = 0;

  for (let partIdx = 0; partIdx < audioParts.length; partIdx++) {
    const part = audioParts[partIdx];
    const duration = Math.max(1, part.duration || 60);

    if (duration <= maxChunkDurationSec) {
      chunks.push({
        id: `${lectureId}_chunk_${globalChunkIndex}`,
        lectureId,
        index: globalChunkIndex,
        partIndex: partIdx,
        startSeconds: 0,
        endSeconds: duration,
        duration,
        status: 'pending',
        retryCount: 0,
        updatedAt: new Date().toISOString(),
      });
      globalChunkIndex++;
    } else {
      // Subdivide long single part into slices
      let offset = 0;
      while (offset < duration) {
        const sliceDuration = Math.min(maxChunkDurationSec, duration - offset);
        chunks.push({
          id: `${lectureId}_chunk_${globalChunkIndex}`,
          lectureId,
          index: globalChunkIndex,
          partIndex: partIdx,
          startSeconds: offset,
          endSeconds: offset + sliceDuration,
          duration: sliceDuration,
          status: 'pending',
          retryCount: 0,
          updatedAt: new Date().toISOString(),
        });
        globalChunkIndex++;
        offset += sliceDuration;
      }
    }
  }

  return chunks;
}

/**
 * Exponential backoff with random jitter for resilient network retries.
 */
export async function retryWithBackoff<T>(
  operation: (attempt: number) => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 1500
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation(attempt);
    } catch (err: unknown) {
      attempt++;
      if (attempt > maxRetries) {
        throw err;
      }

      // Exponential backoff: base * 2^(attempt-1) + jitter (0-500ms)
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 500;
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(`Tentativo ${attempt}/${maxRetries} fallito (${errMsg}). Riprovo tra ${Math.round(delay)}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Merges transcript segments from multiple chunks, adjusting relative start/end
 * timestamps according to cumulative start offsets.
 */
export function mergeTranscriptSegments(
  chunksData: Array<{
    partIndex: number;
    chunkStartSeconds: number;
    cumulativePartOffset: number;
    segments: TranscriptSegment[];
  }>
): TranscriptSegment[] {
  const merged: TranscriptSegment[] = [];

  for (const chunk of chunksData) {
    for (const seg of chunk.segments) {
      // Calculate true continuous timestamp
      const adjustedStart = Math.round(chunk.cumulativePartOffset + seg.start);
      const adjustedEnd = Math.round(chunk.cumulativePartOffset + seg.end);

      merged.push({
        start: adjustedStart,
        end: adjustedEnd,
        speaker: seg.speaker || 'Docente',
        text_en: seg.text_en || '',
        text_it: seg.text_it || '',
        partIndex: chunk.partIndex,
      });
    }
  }

  return merged.sort((a, b) => a.start - b.start);
}

/**
 * Consolidates glossaries from all chunks, deduplicating by normalized English term
 * and selecting the most comprehensive academic definition.
 */
export function consolidateGlossary(glossaries: GlossaryTerm[][]): GlossaryTerm[] {
  const termMap = new Map<string, GlossaryTerm>();

  for (const list of glossaries) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || !item.term_en) continue;
      const key = item.term_en.trim().toLowerCase();

      if (!termMap.has(key)) {
        termMap.set(key, {
          term_en: item.term_en.trim(),
          translation_it: item.translation_it?.trim() || item.term_en.trim(),
          academic_definition: item.academic_definition?.trim() || '',
        });
      } else {
        const existing = termMap.get(key)!;
        // Keep definition with greater detail
        if ((item.academic_definition?.length || 0) > existing.academic_definition.length) {
          termMap.set(key, {
            term_en: existing.term_en,
            translation_it: item.translation_it?.trim() || existing.translation_it,
            academic_definition: item.academic_definition?.trim() || existing.academic_definition,
          });
        }
      }
    }
  }

  return Array.from(termMap.values());
}

/**
 * Consolidates exam questions from multiple chunks, removing exact duplicate questions
 * and prioritizing Crucial and High importance items.
 */
export function consolidateExamQuestions(questionLists: ExamQuestion[][]): ExamQuestion[] {
  const questionMap = new Map<string, ExamQuestion>();

  for (const list of questionLists) {
    if (!Array.isArray(list)) continue;
    for (const q of list) {
      if (!q || !q.question) continue;
      const key = q.question.trim().toLowerCase();

      if (!questionMap.has(key)) {
        questionMap.set(key, {
          question: q.question.trim(),
          answer_latex: q.answer_latex?.trim() || '',
          importance_level: q.importance_level || 'Medium',
        });
      }
    }
  }

  const result = Array.from(questionMap.values());
  const priorityScore: Record<string, number> = { Crucial: 3, High: 2, Medium: 1 };
  return result.sort((a, b) => (priorityScore[b.importance_level] || 0) - (priorityScore[a.importance_level] || 0));
}

/**
 * Consolidates multiple LaTeX study guides into a single coherent Overleaf document.
 * Strips duplicate preambles and merges body sections under sequential parts.
 */
export function consolidateStudyGuides(
  guides: string[],
  title: string,
  course: string
): string {
  const validGuides = guides.filter((g) => g && g.trim().length > 0);
  if (validGuides.length === 0) return '';
  if (validGuides.length === 1) return injectTimestampPreambleMacro(validGuides[0]);

  const docTitle = (title || 'Lezione Magistrale').replace(/[_#%$&]/g, '\\$&');
  const docCourse = (course || 'Ingegneria / STEM').replace(/[_#%$&]/g, '\\$&');

  // Extract body content from each guide
  const extractedBodies: string[] = [];

  validGuides.forEach((g, idx) => {
    let body = g;
    const startIdx = body.indexOf('\\begin{document}');
    if (startIdx !== -1) {
      body = body.slice(startIdx + '\\begin{document}'.length);
    }
    const endIdx = body.indexOf('\\end{document}');
    if (endIdx !== -1) {
      body = body.slice(0, endIdx);
    }

    body = body
      .replace(/\\maketitle/g, '')
      .replace(/\\tableofcontents/g, '')
      .replace(/\\vspace\{[^}]+\}/g, '')
      .replace(/\\hrule/g, '')
      .trim();

    if (body) {
      extractedBodies.push(`% =========================================\n% Sezione di Trattazione: Modulo ${idx + 1}\n% =========================================\n\n${body}`);
    }
  });

  const combinedBody = extractedBodies.join('\n\n\\vspace{0.8cm}\n\\hrule\n\\vspace{0.8cm}\n\n');

  const unifiedLatex = `\\documentclass[11pt,a4paper]{article}
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

% Macro citazione temporale (sicura per Overleaf / pdflatex)
\\providecommand{\\ts}[2]{\\ifmmode\\text{\\scriptsize\\texttt{[P#1:#2s]}}\\else\\marginpar{\\scriptsize\\texttt{P#1:#2s}}\\fi}

\\newtheorem{theorem}{Teorema}[section]
\\newtheorem{definition}{Definizione}[section]
\\newtheorem{lemma}{Lemma}[section]
\\newtheorem{corollary}{Corollario}[section]

\\title{\\textbf{${docTitle}}\\\\ \\large \\textit{Corso di ${docCourse}}}
\\author{OmniLecture Studio \\and Trascrizione Accademica Integrale}
\\date{\\today}

\\begin{document}
\\maketitle
\\tableofcontents
\\vspace{1cm}
\\hrule
\\vspace{0.5cm}

${combinedBody}

\\end{document}
`;

  return injectTimestampPreambleMacro(unifiedLatex);
}

/**
 * Calculates current progress percentage and human-readable stage from chunks.
 */
export function calculateOverallProgress(
  chunks: LectureProcessingChunk[]
): { percentage: number; stage: string } {
  if (chunks.length === 0) {
    return { percentage: 0, stage: 'Preparazione elaborazione...' };
  }

  const completed = chunks.filter((c) => c.status === 'done').length;
  const running = chunks.filter((c) => c.status === 'running').length;
  const failed = chunks.filter((c) => c.status === 'error').length;

  const percentage = Math.round((completed / chunks.length) * 100);

  let stage = `Elaborazione chunk ${completed + (running > 0 ? 1 : 0)} di ${chunks.length} (${percentage}%)`;
  if (completed === chunks.length) {
    stage = 'Consolidamento finale e verifica guide completata.';
  } else if (failed > 0 && running === 0) {
    stage = `${failed} chunk in errore. Tentativo di ripristino...`;
  }

  return { percentage, stage };
}
