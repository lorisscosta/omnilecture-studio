import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  validateLectureOutput,
  synchronizeLectureSlidesState,
  reconcileSlideCoverage,
  normalizeTechnicalTerminology,
  enrichStudyGuideWithMissingSection,
} from '../src/lib/lecture-validator';
import { clampAndNormalizeSlideTimestamps, getSlideTimes, findActiveSlideIndex } from '../src/lib/slides-sync';
import { mergeTranscriptSegments } from '../src/lib/chunk-processing';
import { optimizeAudioFile, checkWavHeader } from '../src/lib/audio-compressor';
import { AudioPart, Lecture, SlideAlignment, TranscriptSegment } from '../src/lib/types';

describe('OmniLecture Studio — Real Case Regression & Audit Suite', () => {
  const debugJsonPath = path.join(process.cwd(), 'omnilecture-debug.json');
  const audioFilePath = path.join(process.cwd(), '20261001112643.wav');

  let rawDebugJson: any = null;
  let rawLecture: Lecture = null as any;

  if (fs.existsSync(debugJsonPath)) {
    rawDebugJson = JSON.parse(fs.readFileSync(debugJsonPath, 'utf8'));
    rawLecture = rawDebugJson.lectures[0];
  }

  // =========================================================================
  // BUG REALE #1, #3, #4, #5, #8: REPRODUCE FAILURES ON UNCORRECTED REAL JSON
  // =========================================================================
  it('detects all known failure modes on the uncorrected omnilecture-debug.json', () => {
    expect(rawLecture).not.toBeNull();
    const actualAudioDuration = 1158; // 19m18s

    const validation = validateLectureOutput(rawLecture, {
      totalDuration: actualAudioDuration,
      expectedSlideCount: 12,
      expectedTopics: ['built-in', 'math', 'random', 'composition'],
      slideHeadings: [
        { slide_number: 1, title: 'Functions I — Using Built-ins & Modules' },
        { slide_number: 2, title: "What we'll cover in 30 minutes" },
        { slide_number: 3, title: 'Quick Recap', content: 'Strings, indexing, slicing, input, f-strings, errors' },
        { slide_number: 4, title: 'A function is a mini-machine' },
        { slide_number: 5, title: 'A few more built-ins worth knowing' },
        { slide_number: 6, title: 'A module is a file full of ready-made functions' },
        { slide_number: 7, title: 'Three ways to import' },
        { slide_number: 8, title: "A few math functions you'll use often" },
        { slide_number: 9, title: 'Randomness, on demand' },
        { slide_number: 10, title: "Feed one function's output into another" },
        { slide_number: 11, title: 'Why Bother' },
        { slide_number: 12, title: 'Next: Hands-on Lab' },
      ],
    });

    // 1. Transcript ending at 1878s while audio is 1158s must be caught as invalid
    expect(validation.details.transcriptValid).toBe(false);
    expect(validation.errors.some((e) => e.includes('timestamp fuori durata'))).toBe(true);

    // 2. Slide 3 missing must be detected because transcript discusses strings, indexing, slicing
    expect(validation.details.slideCoverage.missingDiscussedSlideNumbers).toContain(3);

    // 3. Study guide missing random module section must be detected
    expect(validation.details.topicCoverage.missingTopics).toContain('random');

    // 4. hasSlides inconsistency must be caught (top-level true vs data.has_slides false)
    expect(validation.details.metadataConsistent).toBe(false);
    expect(validation.errors.some((e) => e.includes('Incoerenza metadati'))).toBe(true);

    // 5. LaTeX timestamp \ts{0}{1698} > audio duration (1158s) must be caught
    expect(validation.details.latexTimestampsValid).toBe(false);
    expect(validation.errors.some((e) => e.includes('LaTeX timestamp fuori durata'))).toBe(true);

    // Overall status must be error on raw uncorrected JSON
    expect(validation.isValid).toBe(false);
    expect(validation.status).toBe('error');
  });

  // =========================================================================
  // BUG REALE #2: NO HIDDEN SCALING OF SLIDES
  // =========================================================================
  it('does NOT arbitrarily scale slide timestamps down and flags outliers transparently', () => {
    const rawSlides: SlideAlignment[] = [
      { slide_number: 8, title: 'Math', part: 0, start_time_seconds: 626, end_time_seconds: 876, summary: '' },
      { slide_number: 9, title: 'Random', part: 0, start_time_seconds: 1431, end_time_seconds: 1580, summary: '' },
      { slide_number: 10, title: 'Composition', part: 0, start_time_seconds: 1637, end_time_seconds: 1878, summary: '' },
    ];

    const normalized = clampAndNormalizeSlideTimestamps(rawSlides, 1158);

    // Outliers beyond 1158s (1431s and 1637s) must NOT be multiplied by 0.616 (1158/1878)
    expect(normalized[1].start_time_seconds).toBe(1431); // Preserves honest timestamp
    expect(normalized[1].needs_review).toBe(true);
    expect(normalized[1].status).toBe('needs_review');

    expect(normalized[2].end_time_seconds).toBe(1878); // Preserves honest timestamp
    expect(normalized[2].needs_review).toBe(true);
    expect(normalized[2].status).toBe('needs_review');
  });

  // =========================================================================
  // BUG REALE #4: SLIDE 3 MISSING — COVERAGE RECONCILIATION
  // =========================================================================
  it('reconciles missing Slide 3 into the [38, 130] temporal gap and marks unreached slides as not_discussed', () => {
    const slideHeadings = [
      { slide_number: 1, title: 'Functions I' },
      { slide_number: 2, title: "What we'll cover in 30 minutes" },
      { slide_number: 3, title: 'Quick Recap', content: 'Strings, indexing, slicing, input, f-strings, errors' },
      { slide_number: 4, title: 'A function is a mini-machine' },
      { slide_number: 5, title: 'Built-ins' },
      { slide_number: 6, title: 'Modules' },
      { slide_number: 7, title: 'Three ways to import' },
      { slide_number: 8, title: 'Math module' },
      { slide_number: 9, title: 'Randomness' },
      { slide_number: 10, title: 'Composition' },
      { slide_number: 11, title: 'Why Bother' },
      { slide_number: 12, title: 'Lab' },
    ];

    const rawSlides = rawLecture.slidesAlignment || [];
    const transcript = rawLecture.data?.timestamped_transcript || [];

    const reconciled = reconcileSlideCoverage(rawSlides, 12, slideHeadings, transcript, 1158);

    expect(reconciled.length).toBe(12);

    // Slide 3 was missing between Slide 2 (end: 38) and Slide 4 (start: 130)
    const slide3 = reconciled.find((s) => s.slide_number === 3);
    expect(slide3).toBeDefined();
    expect(slide3!.title).toBe('Quick Recap');
    expect(slide3!.start_time_seconds).toBeGreaterThanOrEqual(38);
    expect(slide3!.end_time_seconds).toBeLessThanOrEqual(130);
    expect(slide3!.status).toBe('valid');

    // Slide 11 and 12 were not reached in the audio
    const slide11 = reconciled.find((s) => s.slide_number === 11);
    expect(slide11).toBeDefined();
    expect(slide11!.status).toBe('not_discussed');

    const slide12 = reconciled.find((s) => s.slide_number === 12);
    expect(slide12).toBeDefined();
    expect(slide12!.status).toBe('not_discussed');
  });

  // =========================================================================
  // BUG REALE #5: STUDY GUIDE MISSING RANDOM MODULE SECTION
  // =========================================================================
  it('enriches study guide LaTeX when a core topic like random module is missing', () => {
    const originalGuide = rawLecture.data?.study_guide_it || '';
    expect(originalGuide.includes('\\section{Il Modulo Random}')).toBe(false);

    const randomSection = `Il modulo \\texttt{random} della libreria standard permette di generare numeri pseudocasuali e simulare eventi stocastici:
\\begin{itemize}
    \\item \\texttt{random.random()}: restituisce un float compreso nell'intervallo $[0.0, 1.0)$.
    \\item \\texttt{random.randint(a, b)}: genera un intero casuale compreso tra $a$ e $b$ inclusi.
    \\item \\texttt{random.choice(seq)}: seleziona casualmente un elemento da una sequenza (lista o stringa).
    \\item \\texttt{random.shuffle(list)}: mescola gli elementi di una lista sul posto.
\\end{itemize}`;

    const enriched = enrichStudyGuideWithMissingSection(originalGuide, 'Il Modulo Random e Simulazioni', randomSection);

    expect(enriched.includes('\\section{Il Modulo Random e Simulazioni}')).toBe(true);
    expect(enriched.includes('\\texttt{random.randint(a, b)}')).toBe(true);
    // Verifies valid document structure ending
    expect(enriched.endsWith('\\end{document}')).toBe(true);
  });

  // =========================================================================
  // BUG REALE #6: TECHNICAL TERMINOLOGY NORMALIZATION
  // =========================================================================
  it('normalizes common technical ASR phonetic distortions for Python STEM terms', () => {
    const rawSpoken1 = 'And Bodysing max is doing what you expect';
    const cleaned1 = normalizeTechnicalTerminology(rawSpoken1);
    expect(cleaned1).toBe('And built-in max is doing what you expect');

    const rawSpoken2 = 'Ready-to-use tools to zoom the title lesson for free';
    const cleaned2 = normalizeTechnicalTerminology(rawSpoken2);
    expect(cleaned2).toBe('Ready-to-use tools tools Python gives you for free');

    const rawSpoken3 = 'We compute math sqrt(50) and then random randint(1, 6) with random shuffle';
    const cleaned3 = normalizeTechnicalTerminology(rawSpoken3);
    expect(cleaned3).toBe('We compute math.sqrt(50) and then random.randint(1, 6) with random.shuffle');
  });

  // =========================================================================
  // BUG REALE #7: AUDIO OPTIMIZATION BYPASS FOR 16kHz MONO PCM16
  // =========================================================================
  it('bypasses optimizeAudioFile conversion for already-compliant 16kHz mono PCM16 WAV', async () => {
    expect(fs.existsSync(audioFilePath)).toBe(true);
    const buffer = fs.readFileSync(audioFilePath);
    const audioBlob = new Blob([buffer], { type: 'audio/wav' });
    const file = new File([audioBlob], '20261001112643.wav', { type: 'audio/wav' });

    const header = await checkWavHeader(file);
    expect(header.isWav).toBe(true);
    expect(header.sampleRate).toBe(16000);
    expect(header.numChannels).toBe(1);
    expect(header.bitsPerSample).toBe(16);

    const result = await optimizeAudioFile(file, 16000);
    // Must return the exact same file without re-encoding to _optimized.wav
    expect(result.file.name).toBe('20261001112643.wav');
    expect(result.ratio).toBe(1);
    expect(result.durationSeconds).toBeCloseTo(1158, 0);
  });

  // =========================================================================
  // BUG REALE #8: METADATA CONSISTENCY SYNCHRONIZATION
  // =========================================================================
  it('synchronizes lecture.hasSlides and lecture.data.has_slides perfectly', () => {
    const inconsistentLecture: Partial<Lecture> = {
      hasSlides: true,
      slidesFileName: 'Lesson4_Theory_Slides.pdf',
      data: {
        glossary: [],
        timestamped_transcript: [],
        study_guide_it: '',
        potential_exam_questions: [],
        has_slides: false, // Inconsistent!
      },
    };

    synchronizeLectureSlidesState(inconsistentLecture);
    expect(inconsistentLecture.hasSlides).toBe(true);
    expect(inconsistentLecture.data!.has_slides).toBe(true);
    expect(inconsistentLecture.data!.slides_filename).toBe('Lesson4_Theory_Slides.pdf');
  });

  // =========================================================================
  // BUG REALE #11 & #12: CANONICAL RELATIVE TIMESTAMPS & CROSS-PART SEEK
  // =========================================================================
  it('enforces canonical relative timestamps contract across 3 audio parts and handles seek', () => {
    const audioParts: AudioPart[] = [
      { id: 'p0', fileName: 'part1.wav', duration: 600, fileSize: 19200000, startOffset: 0 },
      { id: 'p1', fileName: 'part2.wav', duration: 600, fileSize: 19200000, startOffset: 600 },
      { id: 'p2', fileName: 'part3.wav', duration: 600, fileSize: 19200000, startOffset: 1200 },
    ];

    const chunkTranscripts = [
      {
        partIndex: 0,
        chunkStartSeconds: 0,
        cumulativePartOffset: 0,
        segments: [{ start: 10, end: 50, speaker: 'Prof', text_en: 'Intro', text_it: 'Intro' }],
      },
      {
        partIndex: 1,
        chunkStartSeconds: 0,
        cumulativePartOffset: 600,
        // Relative start=120, end=150 (Part 2 offset is 600)
        segments: [{ start: 120, end: 150, speaker: 'Prof', text_en: 'Middle', text_it: 'Metà' }],
      },
      {
        partIndex: 2,
        chunkStartSeconds: 0,
        cumulativePartOffset: 1200,
        // Relative start=10, end=40 (Part 3 offset is 1200)
        segments: [{ start: 10, end: 40, speaker: 'Prof', text_en: 'Conclusion', text_it: 'Fine' }],
      },
    ];

    const merged = mergeTranscriptSegments(chunkTranscripts);
    expect(merged.length).toBe(3);

    // Part 0: continuous [10, 50]
    expect(merged[0].start).toBe(10);
    expect(merged[0].end).toBe(50);

    // Part 1: continuous 600 + 120 = 720, 600 + 150 = 750
    expect(merged[1].start).toBe(720);
    expect(merged[1].end).toBe(750);

    // Part 2: continuous 1200 + 10 = 1210, 1200 + 40 = 1240
    expect(merged[2].start).toBe(1210);
    expect(merged[2].end).toBe(1240);

    // Test slide times resolution
    const slideInPart1: SlideAlignment = {
      slide_number: 5,
      title: 'Topic Part 2',
      part: 1,
      start_time_seconds: 120,
      end_time_seconds: 150,
      summary: '',
    };
    const resolvedTimes = getSlideTimes(slideInPart1, audioParts);
    expect(resolvedTimes.relativeStart).toBe(120);
    expect(resolvedTimes.continuousStart).toBe(720);
    expect(resolvedTimes.continuousEnd).toBe(750);

    // Active slide at continuous second 730
    const activeIdx = findActiveSlideIndex([slideInPart1], 730, 1, audioParts);
    expect(activeIdx).toBe(0);
  });
});
