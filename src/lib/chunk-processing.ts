import {
  AudioPart,
  GlossaryTerm,
  TranscriptSegment,
  ExamQuestion,
  LectureData,
  ChunkStatus,
  LectureProcessingChunk,
  SlideAlignment,
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

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  signal?: AbortSignal;
  isRetryable?: (err: unknown) => boolean;
}

/**
 * Checks whether an error is transient and safe to retry.
 * Non-retryable: 400 (Bad Request), 401 (Unauthorized), 403 (Forbidden), 404 (Not Found), 413 (Payload Too Large), 422.
 * Retryable: 408, 429 (Rate Limit), 500, 502, 503, 504, and network drops.
 */
export function isRetryableError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof Error && err.name === 'AbortError') return false;

  const anyErr = err as any;
  const status = anyErr.status || anyErr.statusCode || anyErr.response?.status;
  if (typeof status === 'number') {
    if ([400, 401, 403, 404, 413, 422].includes(status)) {
      return false;
    }
    if ([408, 429, 500, 502, 503, 504].includes(status)) {
      return true;
    }
  }

  const msg = (anyErr.message || String(err)).toLowerCase();
  if (
    msg.includes('400 bad request') ||
    msg.includes('invalid argument') ||
    msg.includes('api key not valid') ||
    msg.includes('permission denied') ||
    msg.includes('401 unauthorized') ||
    msg.includes('403 forbidden') ||
    msg.includes('404 not found') ||
    msg.includes('413 payload too large')
  ) {
    return false;
  }

  return true;
}

export function extractRetryAfterMs(err: unknown): number | null {
  if (!err) return null;
  const anyErr = err as any;
  const retryAfter = anyErr.headers?.get?.('retry-after') || anyErr.retryAfter;
  if (retryAfter) {
    const sec = Number(retryAfter);
    if (!Number.isNaN(sec) && sec > 0) {
      return sec * 1000;
    }
  }
  return null;
}

/**
 * Exponential backoff with random jitter for resilient network retries.
 * Respects Retry-After header and AbortSignal.
 */
export async function retryWithBackoff<T>(
  operation: (attempt: number) => Promise<T>,
  optionsOrMaxRetries: number | RetryOptions = 3,
  baseDelayMs = 1500
): Promise<T> {
  const options: RetryOptions =
    typeof optionsOrMaxRetries === 'number'
      ? { maxRetries: optionsOrMaxRetries, baseDelayMs }
      : optionsOrMaxRetries;

  const maxRetries = options.maxRetries ?? 3;
  const delayBase = options.baseDelayMs ?? 1500;
  const signal = options.signal;
  const checkRetryable = options.isRetryable || isRetryableError;

  let attempt = 0;
  while (true) {
    if (signal?.aborted) {
      throw new DOMException('Operation aborted', 'AbortError');
    }

    try {
      return await operation(attempt);
    } catch (err: unknown) {
      if (signal?.aborted) {
        throw new DOMException('Operation aborted', 'AbortError');
      }

      if (!checkRetryable(err)) {
        throw err;
      }

      attempt++;
      if (attempt > maxRetries) {
        throw err;
      }

      const explicitDelay = extractRetryAfterMs(err);
      const delay = explicitDelay ?? (delayBase * Math.pow(2, attempt - 1) + Math.random() * 500);
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(`Tentativo ${attempt}/${maxRetries} fallito (${errMsg}). Riprovo tra ${Math.round(delay)}ms...`);

      await new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
          return reject(new DOMException('Operation aborted', 'AbortError'));
        }
        const timer = setTimeout(resolve, delay);
        signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(new DOMException('Operation aborted', 'AbortError'));
          },
          { once: true }
        );
      });
    }
  }
}

/**
 * Merges transcript segments from multiple chunks, adjusting relative start/end
 * timestamps according to cumulative start offsets and chunk start offsets.
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
    const chunkBaseOffset = (chunk.cumulativePartOffset || 0) + (chunk.chunkStartSeconds || 0);
    for (const seg of chunk.segments) {
      // Calculate true continuous timestamp
      const adjustedStart = Math.round(chunkBaseOffset + seg.start);
      const adjustedEnd = Math.round(chunkBaseOffset + seg.end);

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
      .replace(/\s*\\ts\{\d+\}\{\d+\}/g, '')
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

% Macro citazione temporale (neutra: nessun riferimento temporale a destra)
\\providecommand{\\ts}[2]{}

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

/**
 * Consolidates slides alignment from multiple chunks or enrichment passes,
 * sorting by part and timestamp, and removing duplicate/malformed records.
 */
export function consolidateSlidesAlignment(
  alignmentLists: SlideAlignment[][]
): SlideAlignment[] {
  const all: SlideAlignment[] = [];
  const seenKey = new Set<string>();

  for (const list of alignmentLists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item.slide_number !== 'number') continue;
      const key = `${item.part ?? 0}_${item.slide_number}_${item.start_time_seconds ?? 'null'}`;
      if (!seenKey.has(key)) {
        seenKey.add(key);
        const isNotDiscussed = item.status === 'not_discussed';
        const startSec =
          item.start_time_seconds === null || (isNotDiscussed && item.start_time_seconds === undefined)
            ? null
            : typeof item.start_time_seconds === 'number'
            ? Math.max(0, item.start_time_seconds)
            : null;

        const endSec =
          item.end_time_seconds === null || (isNotDiscussed && item.end_time_seconds === undefined)
            ? null
            : typeof item.end_time_seconds === 'number'
            ? Math.max(startSec ?? 0, item.end_time_seconds)
            : null;

        all.push({
          slide_number: item.slide_number,
          title: item.title?.trim() || `Slide ${item.slide_number}`,
          part: typeof item.part === 'number' ? item.part : 0,
          start_time_seconds: startSec,
          end_time_seconds: endSec,
          summary: item.summary?.trim() || '',
          needs_review: item.needs_review,
          status: item.status,
        });
      }
    }
  }

  return all.sort((a, b) => {
    if (a.part !== b.part) return a.part - b.part;
    const aStart = a.start_time_seconds ?? Infinity;
    const bStart = b.start_time_seconds ?? Infinity;
    if (aStart !== bStart) return aStart - bStart;
    return a.slide_number - b.slide_number;
  });
}

