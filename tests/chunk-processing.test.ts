import { describe, it, expect, vi } from 'vitest';
import {
  createLectureChunksPlan,
  retryWithBackoff,
  mergeTranscriptSegments,
  consolidateGlossary,
  consolidateExamQuestions,
  consolidateStudyGuides,
  calculateOverallProgress,
} from '../src/lib/chunk-processing';
import { AudioPart, TranscriptSegment, GlossaryTerm, ExamQuestion, LectureProcessingChunk } from '../src/lib/types';

describe('chunk-processing: createLectureChunksPlan', () => {
  it('creates a single chunk plan for a short single audio file', () => {
    const parts: AudioPart[] = [
      { id: 'p1', fileName: 'audio.mp3', duration: 1200, fileSize: 1000, startOffset: 0 },
    ];
    const plan = createLectureChunksPlan('lec-1', parts, 3600);
    expect(plan.length).toBe(1);
    expect(plan[0].partIndex).toBe(0);
    expect(plan[0].startSeconds).toBe(0);
    expect(plan[0].endSeconds).toBe(1200);
    expect(plan[0].status).toBe('pending');
  });

  it('splits a long 2h30m single recording into multiple chunks', () => {
    // 9000 seconds = 2.5 hours, chunk size 3600s
    const parts: AudioPart[] = [
      { id: 'p1', fileName: 'long-audio.mp3', duration: 9000, fileSize: 5000, startOffset: 0 },
    ];
    const plan = createLectureChunksPlan('lec-long', parts, 3600);
    expect(plan.length).toBe(3);
    expect(plan[0].startSeconds).toBe(0);
    expect(plan[0].endSeconds).toBe(3600);
    expect(plan[1].startSeconds).toBe(3600);
    expect(plan[1].endSeconds).toBe(7200);
    expect(plan[2].startSeconds).toBe(7200);
    expect(plan[2].endSeconds).toBe(9000);
  });

  it('handles multi-part recordings accurately', () => {
    const parts: AudioPart[] = [
      { id: 'p1', fileName: 'part1.mp3', duration: 1800, fileSize: 1000, startOffset: 0 },
      { id: 'p2', fileName: 'part2.mp3', duration: 1800, fileSize: 1000, startOffset: 1800 },
      { id: 'p3', fileName: 'part3.mp3', duration: 1800, fileSize: 1000, startOffset: 3600 },
    ];
    const plan = createLectureChunksPlan('lec-multi', parts, 3600);
    expect(plan.length).toBe(3);
    expect(plan.map(p => p.partIndex)).toEqual([0, 1, 2]);
  });
});

describe('chunk-processing: retryWithBackoff', () => {
  it('succeeds immediately on first try', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await retryWithBackoff(fn, 3, 10);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds when transient error clears', async () => {
    let callCount = 0;
    const fn = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount < 3) {
        throw new Error('Rate limit or network hiccup');
      }
      return 'recovered';
    });

    const result = await retryWithBackoff(fn, 3, 10);
    expect(result).toBe('recovered');
    expect(callCount).toBe(3);
  });

  it('does NOT retry on non-retryable client errors (e.g. 401 Unauthorized or 400)', async () => {
    const fn = vi.fn().mockRejectedValue({ status: 401, message: 'API key not valid' });
    await expect(retryWithBackoff(fn, 3, 5)).rejects.toMatchObject({ status: 401 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('aborts immediately when AbortSignal is cancelled', async () => {
    const controller = new AbortController();
    const fn = vi.fn().mockImplementation(async () => {
      controller.abort();
      throw new Error('Transient 503 error');
    });

    await expect(
      retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 50, signal: controller.signal })
    ).rejects.toThrow('aborted');
  });

  it('throws final error after exhausting all retries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Fatal API crash'));
    await expect(retryWithBackoff(fn, 2, 5)).rejects.toThrow('Fatal API crash');
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });
});

describe('chunk-processing: mergeTranscriptSegments', () => {
  it('merges segments preserving sequential ordering, cumulativePartOffset and chunkStartSeconds', () => {
    const chunkData1 = {
      partIndex: 0,
      chunkStartSeconds: 0,
      cumulativePartOffset: 0,
      segments: [
        { start: 0, end: 15, text_en: 'Introduction', text_it: 'Introduzione', speaker: 'Docente' },
      ],
    };
    // Sliced chunk from Part 0 starting at second 2400
    const chunkData2 = {
      partIndex: 0,
      chunkStartSeconds: 2400,
      cumulativePartOffset: 0,
      segments: [
        { start: 10, end: 30, text_en: 'Part 1 slice 2', text_it: 'Seconda fetta parte 1', speaker: 'Docente' },
      ],
    };
    // Second audio file (Part 1) starting after 5000s
    const chunkData3 = {
      partIndex: 1,
      chunkStartSeconds: 0,
      cumulativePartOffset: 5000,
      segments: [
        { start: 5, end: 20, text_en: 'Part 2 intro', text_it: 'Intro parte 2', speaker: 'Docente' },
      ],
    };

    const merged = mergeTranscriptSegments([chunkData1, chunkData2, chunkData3]);
    expect(merged.length).toBe(3);
    expect(merged[0].start).toBe(0);
    // 0 cumulative + 2400 chunkStart + 10 = 2410
    expect(merged[1].start).toBe(2410);
    expect(merged[1].end).toBe(2430);
    // 5000 cumulative + 0 chunkStart + 5 = 5005
    expect(merged[2].start).toBe(5005);
    expect(merged[2].end).toBe(5020);
  });
});

describe('chunk-processing: consolidateGlossary', () => {
  it('deduplicates glossary terms and retains richer definitions', () => {
    const listA: GlossaryTerm[] = [
      {
        term_en: 'Eigenvector',
        translation_it: 'Autovettore',
        academic_definition: 'Vettore non nullo trasformato in multiplo di se stesso.',
      },
      {
        term_en: 'Diagonal Matrix',
        translation_it: 'Matrice Diagonale',
        academic_definition: 'Elementi non nulli solo sulla diagonale.',
      },
    ];
    const listB: GlossaryTerm[] = [
      {
        term_en: 'eigenvector',
        translation_it: 'Autovettore',
        academic_definition:
          'Dato un operatore lineare T, un vettore v non nullo tale che T(v) = lambda * v con lambda scalare detto autovalore.',
      },
      {
        term_en: 'Characteristic Polynomial',
        translation_it: 'Polinomio Caratteristico',
        academic_definition: 'det(A - lambda*I)',
      },
    ];

    const consolidated = consolidateGlossary([listA, listB]);
    expect(consolidated.length).toBe(3);
    const autovettore = consolidated.find(t => t.term_en.toLowerCase() === 'eigenvector');
    expect(autovettore).toBeDefined();
    // Keeps the richer/longer definition
    expect(autovettore?.academic_definition).toContain('lambda * v');
  });
});

describe('chunk-processing: consolidateExamQuestions', () => {
  it('consolidates and orders exam questions prioritizing high importance', () => {
    const qA: ExamQuestion[] = [
      {
        question: 'Enunciare il Teorema Spettrale',
        answer_latex: 'Ogni matrice simmetrica reale...',
        importance_level: 'Crucial',
      },
      {
        question: 'Cos\'è una matrice quadrata?',
        answer_latex: 'Una matrice con n righe e n colonne.',
        importance_level: 'Medium',
      },
    ];
    const qB: ExamQuestion[] = [
      {
        question: 'Dimostrare il Teorema di Cayley-Hamilton',
        answer_latex: 'Ogni matrice annulla il suo polinomio...',
        importance_level: 'High',
      },
      {
        question: 'Enunciare il Teorema Spettrale',
        answer_latex: 'Versione duplicata',
        importance_level: 'Crucial',
      },
    ];

    const consolidated = consolidateExamQuestions([qA, qB]);
    expect(consolidated.length).toBe(3);
    expect(consolidated[0].importance_level).toBe('Crucial');
    expect(consolidated[0].question).toContain('Teorema Spettrale');
  });
});

describe('chunk-processing: consolidateStudyGuides', () => {
  it('preserves LaTeX preamble and concatenates multiple guide bodies cleanly', () => {
    const guide1 = `\\documentclass{article}
\\begin{document}
\\section{Parte 1: Spazi Vettoriali}
Contenuto della prima parte. \\ts{1}{120}
\\end{document}`;

    const guide2 = `\\documentclass{article}
\\begin{document}
\\section{Parte 2: Applicazioni Lineari}
Contenuto della seconda parte. \\ts{2}{240}
\\end{document}`;

    const combined = consolidateStudyGuides([guide1, guide2], 'Lezione Vettori', 'Algebra Lineare');
    expect(combined).toContain('\\documentclass[11pt,a4paper]{article}');
    expect(combined).toContain('\\providecommand{\\ts}');
    expect(combined).toContain('\\section{Parte 1: Spazi Vettoriali}');
    expect(combined).toContain('\\section{Parte 2: Applicazioni Lineari}');
    expect(combined).toContain('\\end{document}');
    // Ensure document is not prematurely closed between sections
    const endDocCount = (combined.match(/\\end\{document\}/g) || []).length;
    expect(endDocCount).toBe(1);
  });
});

describe('chunk-processing: calculateOverallProgress', () => {
  it('computes accurate progress percentage from chunks state', () => {
    const chunks: LectureProcessingChunk[] = [
      { id: 'c1', lectureId: 'l1', index: 0, partIndex: 0, startSeconds: 0, endSeconds: 100, duration: 100, status: 'done', retryCount: 0, updatedAt: '' },
      { id: 'c2', lectureId: 'l1', index: 1, partIndex: 0, startSeconds: 100, endSeconds: 200, duration: 100, status: 'running', retryCount: 0, updatedAt: '' },
      { id: 'c3', lectureId: 'l1', index: 2, partIndex: 0, startSeconds: 200, endSeconds: 300, duration: 100, status: 'pending', retryCount: 0, updatedAt: '' },
      { id: 'c4', lectureId: 'l1', index: 3, partIndex: 0, startSeconds: 300, endSeconds: 400, duration: 100, status: 'pending', retryCount: 0, updatedAt: '' },
    ];
    // 1 completed out of 4 chunks = 25%
    const progress = calculateOverallProgress(chunks);
    expect(progress.percentage).toBe(25);
    expect(progress.stage).toContain('Elaborazione chunk 2 di 4');
  });

  it('returns 100% when all chunks are completed', () => {
    const chunks: LectureProcessingChunk[] = [
      { id: 'c1', lectureId: 'l1', index: 0, partIndex: 0, startSeconds: 0, endSeconds: 100, duration: 100, status: 'done', retryCount: 0, updatedAt: '' },
      { id: 'c2', lectureId: 'l1', index: 1, partIndex: 0, startSeconds: 100, endSeconds: 200, duration: 100, status: 'done', retryCount: 0, updatedAt: '' },
    ];
    const progress = calculateOverallProgress(chunks);
    expect(progress.percentage).toBe(100);
    expect(progress.stage).toContain('Consolidamento finale');
  });
});
