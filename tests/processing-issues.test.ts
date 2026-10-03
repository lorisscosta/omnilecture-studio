import { describe, it, expect } from 'vitest';
import { validateLectureOutput } from '../src/lib/lecture-validator';
import { Lecture, ProcessingIssue } from '../src/lib/types';

describe('Phase A1 — Processing Issues & Severity Preservation', () => {
  const uncorrectedLecture: Partial<Lecture> = {
    duration: 1158,
    hasSlides: true,
    slidesFileName: 'Lesson4_Theory_Slides.pdf',
    slidesAlignment: [
      { slide_number: 1, title: 'Functions I', part: 0, start_time_seconds: 0, end_time_seconds: 6, summary: '' },
      { slide_number: 2, title: "What we'll cover", part: 0, start_time_seconds: 6, end_time_seconds: 38, summary: '' },
      // Slide 3 missing
      { slide_number: 4, title: 'A function is a mini-machine', part: 0, start_time_seconds: 130, end_time_seconds: 194, summary: '' },
      { slide_number: 5, title: 'Built-ins', part: 0, start_time_seconds: 266, end_time_seconds: 387, summary: '' },
      { slide_number: 6, title: 'Modules', part: 0, start_time_seconds: 390, end_time_seconds: 445, summary: '' },
      { slide_number: 7, title: 'Three ways to import', part: 0, start_time_seconds: 446, end_time_seconds: 592, summary: '' },
      { slide_number: 8, title: 'Math functions', part: 0, start_time_seconds: 626, end_time_seconds: 876, summary: '' },
      { slide_number: 9, title: 'Randomness', part: 0, start_time_seconds: 882, end_time_seconds: 1009, summary: '' },
      { slide_number: 10, title: 'Composition', part: 0, start_time_seconds: 1009, end_time_seconds: 1158, summary: '' },
    ],
    data: {
      has_slides: false, // Inconsistency
      slides_filename: 'Lesson4_Theory_Slides.pdf',
      glossary: [
        { term_en: 'function', translation_it: 'funzione', academic_definition: 'A mini-machine.' },
      ],
      timestamped_transcript: [
        { start: 0, end: 6, speaker: 'Professor', text_en: 'Intro', text_it: 'Intro' },
        { start: 6, end: 38, speaker: 'Professor', text_en: 'Quick recap strings, indexing, slicing, input, errors', text_it: 'Recap' },
        { start: 38, end: 1158, speaker: 'Professor', text_en: 'Functions, modules and math', text_it: 'Funzioni' },
        { start: 1158, end: 1878, speaker: 'Professor', text_en: 'Tail exceeding actual duration', text_it: 'Coda fuori durata' },
      ],
      study_guide_it: '\\documentclass{article}\n\\begin{document}\n\\section{Funzioni}\nTimestamp errato \\ts{0}{1698}.\n\\end{document}',
      potential_exam_questions: [],
    },
  };

  it('produces structured ProcessingIssue objects with severity, code, message and stage', () => {
    const result = validateLectureOutput(uncorrectedLecture, {
      totalDuration: 1158,
      expectedSlideCount: 12,
      expectedTopics: ['built-in', 'math', 'random', 'composition'],
      slideHeadings: [
        { slide_number: 1, title: 'Functions I' },
        { slide_number: 2, title: "What we'll cover" },
        { slide_number: 3, title: 'Quick Recap', content: 'Strings, indexing, slicing, input, errors' },
        { slide_number: 4, title: 'A function is a mini-machine' },
      ],
    });

    // 1. result.issues must exist and be an array of ProcessingIssue
    expect(result.issues).toBeDefined();
    expect(Array.isArray(result.issues)).toBe(true);
    expect(result.issues.length).toBeGreaterThan(0);

    // 2. Must distinguish between error and warning severity without losing errors
    const errorIssues = result.issues.filter((i) => i.severity === 'error');
    const warningIssues = result.issues.filter((i) => i.severity === 'warning');

    expect(errorIssues.length).toBeGreaterThanOrEqual(4); // Transcript duration, slide 3 missing, LaTeX timestamp, metadata
    expect(warningIssues.length).toBeGreaterThanOrEqual(1); // Topic random missing or slide count

    // 3. Stage categorization must correctly assign categories
    const transcriptIssues = result.issues.filter((i) => i.stage === 'transcript');
    const slideIssues = result.issues.filter((i) => i.stage === 'slides');
    const latexIssues = result.issues.filter((i) => i.stage === 'latex');
    const storageIssues = result.issues.filter((i) => i.stage === 'storage');

    expect(transcriptIssues.some((i) => i.code === 'TRANSCRIPT_TIMESTAMP_OUT_OF_BOUNDS')).toBe(true);
    expect(slideIssues.some((i) => i.code === 'SLIDE_MISSING_DISCUSSED')).toBe(true);
    expect(latexIssues.some((i) => i.code === 'LATEX_TIMESTAMP_OUT_OF_BOUNDS')).toBe(true);
    expect(storageIssues.some((i) => i.code === 'METADATA_INCONSISTENCY')).toBe(true);

    // 4. Codes must be non-empty strings and messages must describe the issue
    for (const issue of result.issues) {
      expect(['error', 'warning', 'info']).toContain(issue.severity);
      expect(['audio', 'transcript', 'slides', 'latex', 'storage', 'sync']).toContain(issue.stage);
      expect(issue.code.length).toBeGreaterThan(0);
      expect(issue.message.length).toBeGreaterThan(0);
    }
  });
});
