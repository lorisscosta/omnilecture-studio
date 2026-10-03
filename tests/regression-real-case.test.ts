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
import { clampAndNormalizeSlideTimestamps, getSlideTimes, findActiveSlideIndex, resolveSeekTarget } from '../src/lib/slides-sync';
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
  } else {
    // Resilient fallback fixture reflecting the uncorrected real case
    rawLecture = {
      id: '0a04452c-e7ca-499c-b129-188f4338332d',
      title: '20261001112643',
      course: 'python',
      date: '2026-10-01',
      duration: 1158,
      fileSize: 37049004,
      fileName: '20261001112643_optimized.wav',
      slidesFileName: 'Lesson4_Theory_Slides.pdf',
      hasSlides: true,
      status: 'completed',
      chatMessages: [],
      createdAt: '2026-10-01T10:31:35.174Z',
      updatedAt: '2026-10-01T12:48:33.011Z',
      processingPercentage: 100,
      slidesMarkdown: '',
      slidesAlignment: [
        { slide_number: 1, title: 'Lesson 4: Functions I — Using Built-ins & Modules', part: 0, start_time_seconds: 0, end_time_seconds: 6, summary: '' },
        { slide_number: 2, title: "What we'll cover in 30 minutes", part: 0, start_time_seconds: 6, end_time_seconds: 38, summary: '' },
        { slide_number: 4, title: 'A function is a mini-machine', part: 0, start_time_seconds: 130, end_time_seconds: 194, summary: '' },
        { slide_number: 5, title: 'A few more built-ins worth knowing', part: 0, start_time_seconds: 266, end_time_seconds: 387, summary: '' },
        { slide_number: 6, title: 'A module is a file full of ready-made functions', part: 0, start_time_seconds: 390, end_time_seconds: 445, summary: '' },
        { slide_number: 7, title: 'Three ways to import', part: 0, start_time_seconds: 446, end_time_seconds: 592, summary: '' },
        { slide_number: 8, title: "A few math functions you'll use often", part: 0, start_time_seconds: 626, end_time_seconds: 876, summary: '' },
        { slide_number: 9, title: 'Randomness, on demand', part: 0, start_time_seconds: 882, end_time_seconds: 1009, summary: '' },
        { slide_number: 10, title: "Feed one function's output into another", part: 0, start_time_seconds: 1009, end_time_seconds: 1158, summary: '' },
      ],
      data: {
        has_slides: false,
        slides_filename: 'Lesson4_Theory_Slides.pdf',
        glossary: [
          { term_en: 'function', translation_it: 'funzione', academic_definition: 'A mini-machine.' },
          { term_en: 'module', translation_it: 'modulo', academic_definition: 'A file containing functions.' },
          { term_en: 'import', translation_it: 'importazione', academic_definition: 'A statement.' },
          { term_en: 'function composition', translation_it: 'composizione di funzioni', academic_definition: 'Chaining functions.' },
        ],
        timestamped_transcript: [
          { start: 0, end: 6, speaker: 'Professor', text_en: 'Welcome to lesson four on built-in functions and modules.', text_it: 'Benvenuti alla lezione quattro.' },
          { start: 6, end: 38, speaker: 'Professor', text_en: 'Quick recap covering strings, indexing, slicing, input, f-strings and syntax errors.', text_it: 'Breve riepilogo con stringhe, indicizzazione, slicing ed errori.' },
          { start: 38, end: 1158, speaker: 'Professor', text_en: 'Now we discuss built-in functions and math modules and function composition.', text_it: 'Ora discutiamo di funzioni built-in, moduli matematici e composizione di funzioni.' },
          { start: 1158, end: 1878, speaker: 'Professor', text_en: 'Invalid tail section beyond real audio duration.', text_it: 'Coda oltre la durata effettiva.' },
        ],
        study_guide_it: '\\documentclass{article}\n\\begin{document}\n\\section{Funzioni Built-in e Moduli}\nSpiegazione dettagliata.\n\\section{Composizione di Funzioni}\nTimestamp errato \\ts{0}{1698}.\n\\end{document}',
        potential_exam_questions: [],
      },
    };
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
    let file: File;
    if (fs.existsSync(audioFilePath)) {
      const buffer = fs.readFileSync(audioFilePath);
      const audioBlob = new Blob([buffer], { type: 'audio/wav' });
      file = new File([audioBlob], '20261001112643.wav', { type: 'audio/wav' });
    } else {
      // Create a valid 16kHz mono 16-bit PCM WAV in memory
      const sampleRate = 16000;
      const numChannels = 1;
      const bitsPerSample = 16;
      const blockAlign = (numChannels * bitsPerSample) / 8;
      const byteRate = sampleRate * blockAlign;
      const durationSec = 1158;
      const dataSize = Math.floor(durationSec * byteRate);
      const headerBuffer = new ArrayBuffer(44);
      const view = new DataView(headerBuffer);
      view.setUint8(0, 0x52); view.setUint8(1, 0x49); view.setUint8(2, 0x46); view.setUint8(3, 0x46); // RIFF
      view.setUint32(4, 36 + dataSize, true);
      view.setUint8(8, 0x57); view.setUint8(9, 0x41); view.setUint8(10, 0x56); view.setUint8(11, 0x45); // WAVE
      view.setUint8(12, 0x66); view.setUint8(13, 0x6d); view.setUint8(14, 0x74); view.setUint8(15, 0x20); // fmt 
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true); // PCM
      view.setUint16(22, numChannels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, byteRate, true);
      view.setUint16(32, blockAlign, true);
      view.setUint16(34, bitsPerSample, true);
      view.setUint8(36, 0x64); view.setUint8(37, 0x61); view.setUint8(38, 0x74); view.setUint8(39, 0x61); // data
      view.setUint32(40, dataSize, true);
      const blob = new Blob([headerBuffer], { type: 'audio/wav' });
      file = new File([blob], '20261001112643.wav', { type: 'audio/wav' });
      Object.defineProperty(file, 'size', { value: 44 + dataSize, configurable: true });
    }

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

  // =========================================================================
  // MULTI-PART AUDIO SEEKING REGRESSION: SEGMENT AT 20:09 DOES NOT JUMP TO 27:xx
  // =========================================================================
  it('correctly resolves seek for segment at 20:09 in multi-part lecture without jumping to 27:xx', () => {
    // Real lecture from omnilecture-debug.json: 20261002093842
    const multiParts: AudioPart[] = [
      {
        id: 'part-0',
        fileName: '20261002093842.wav',
        fileSize: 13721644,
        duration: 429, // 0:00 - 7:09
        startOffset: 0,
      },
      {
        id: 'part-1',
        fileName: '20261002100233_optimized.wav',
        fileSize: 72582444,
        duration: 2268, // 7:09 - 44:57 (offset: 429)
        startOffset: 429,
      },
      {
        id: 'part-2',
        fileName: '20261002110910_optimized.wav',
        fileSize: 64818604,
        duration: 2026, // 44:57 - 1:18:43 (offset: 2697)
        startOffset: 2697,
      },
    ];

    const totalDuration = 4723; // 429 + 2268 + 2026

    // Segment 23: start = 1209s (20m09s), partIndex = 1
    const segmentStartSeconds = 1209; // 20:09

    // 1. Seeking with continuous timestamp (as passed by TranscriptTab when clicking the 20:09 pill)
    const continuousSeek = resolveSeekTarget(segmentStartSeconds, undefined, multiParts, totalDuration);

    expect(continuousSeek.targetPartIndex).toBe(1);
    // Part 1 offset is 429. 1209 - 429 = 780s into Part 1
    expect(continuousSeek.relativeSeconds).toBe(780);
    expect(continuousSeek.continuousSeconds).toBe(1209);
    // CRITICAL: Must NOT be 1638 (which was 429 + 1209 = 27m18s)
    expect(continuousSeek.continuousSeconds).not.toBe(1638);

    // 2. Seeking defensively even if a caller passes (1209, 1) where seconds is continuous
    // If seconds is 780 relative, continuous is 1209
    const relativeSeek = resolveSeekTarget(780, 1, multiParts, totalDuration);
    expect(relativeSeek.targetPartIndex).toBe(1);
    expect(relativeSeek.relativeSeconds).toBe(780);
    expect(relativeSeek.continuousSeconds).toBe(1209);

    // 3. Seeking across boundary into Part 0 (e.g. at 2:30 = 150s)
    const part0Seek = resolveSeekTarget(150, undefined, multiParts, totalDuration);
    expect(part0Seek.targetPartIndex).toBe(0);
    expect(part0Seek.relativeSeconds).toBe(150);
    expect(part0Seek.continuousSeconds).toBe(150);

    // 4. Seeking across boundary into Part 2 (e.g. at 50:00 = 3000s)
    const part2Seek = resolveSeekTarget(3000, undefined, multiParts, totalDuration);
    expect(part2Seek.targetPartIndex).toBe(2);
    // Part 2 offset is 2697. 3000 - 2697 = 303s into Part 2
    expect(part2Seek.relativeSeconds).toBe(303);
    expect(part2Seek.continuousSeconds).toBe(3000);
  });
});

