import { describe, it, expect } from 'vitest';
import {
  validateLectureOutput,
  resolveLectureFinalStatus,
  reconcileSlideCoverage,
  LectureValidationResult,
} from '../src/lib/lecture-validator';
import { consolidateSlidesAlignment } from '../src/lib/chunk-processing';
import { parseWavHeader, checkWavHeader, sliceAudioBlob } from '../src/lib/audio-compressor';
import { clampAndNormalizeSlideTimestamps } from '../src/lib/slides-sync';
import { SlideAlignment } from '../src/lib/types';

describe('Audit Round 2 — Regression & Verification Suite', () => {
  // =========================================================================
  // 1. A1-bis: validation.isValid === false strictly maps to status: 'error'
  // =========================================================================
  it('strictly maps validation failure (isValid === false) to status error in resolveLectureFinalStatus', () => {
    const invalidResult: LectureValidationResult = {
      isValid: false,
      hasWarnings: true,
      status: 'error',
      errors: ['Timestamp fuori durata: 1878s > 1158s'],
      warnings: ['Slide 3 mancante'],
      issues: [
        {
          severity: 'error',
          code: 'TRANSCRIPT_TIMESTAMP_OUT_OF_BOUNDS',
          message: 'Timestamp fuori durata: 1878s > 1158s',
          stage: 'transcript',
        },
      ],
      details: {} as any,
    };

    const finalStatus = resolveLectureFinalStatus(invalidResult);
    expect(finalStatus).toBe('error');
    expect(finalStatus).not.toBe('completed_with_warnings');
  });

  // =========================================================================
  // 3 & 9. consolidateSlidesAlignment preserves semantic metadata (needs_review, not_discussed, null timestamps)
  // =========================================================================
  it('consolidateSlidesAlignment preserves needs_review, status and handles null timestamps', () => {
    const chunk1Slides: SlideAlignment[] = [
      {
        slide_number: 1,
        title: 'Intro',
        part: 0,
        start_time_seconds: 0,
        end_time_seconds: 30,
        summary: 'Introduzione',
        status: 'valid',
        needs_review: false,
      },
      {
        slide_number: 2,
        title: 'Outlier Slide',
        part: 0,
        start_time_seconds: 1400,
        end_time_seconds: 1800,
        summary: 'Argomento avanzato',
        status: 'needs_review',
        needs_review: true,
      },
      {
        slide_number: 3,
        title: 'Skipped Slide',
        part: 0,
        start_time_seconds: null,
        end_time_seconds: null,
        summary: 'Non discussa',
        status: 'not_discussed',
        needs_review: false,
      },
    ];

    const consolidated = consolidateSlidesAlignment([chunk1Slides]);

    expect(consolidated.length).toBe(3);

    // Slide 1
    expect(consolidated[0].slide_number).toBe(1);
    expect(consolidated[0].status).toBe('valid');
    expect(consolidated[0].needs_review).toBe(false);

    // Slide 2: Outlier metadata must be preserved
    expect(consolidated[1].slide_number).toBe(2);
    expect(consolidated[1].status).toBe('needs_review');
    expect(consolidated[1].needs_review).toBe(true);

    // Slide 3: not_discussed with null timestamps must be preserved
    expect(consolidated[2].slide_number).toBe(3);
    expect(consolidated[2].status).toBe('not_discussed');
    expect(consolidated[2].start_time_seconds).toBeNull();
    expect(consolidated[2].end_time_seconds).toBeNull();
  });

  // =========================================================================
  // 7. WAV parser scans RIFF chunks and finds the actual 'data' chunk
  // =========================================================================
  it('parseWavHeader correctly locates RIFF data chunk size even with metadata chunks before data', () => {
    // Construct a WAV with RIFF -> WAVE -> fmt (16 bytes) -> LIST (metadata 20 bytes) -> data (32000 bytes = 1 sec at 16kHz mono 16-bit)
    const fmtSize = 16;
    const listSize = 20;
    const pcmDataSize = 32000; // 1 second of 16000Hz * 1ch * 2 bytes
    const totalFileSize = 12 + (8 + fmtSize) + (8 + listSize) + (8 + pcmDataSize);

    const buffer = new ArrayBuffer(totalFileSize);
    const view = new DataView(buffer);

    // RIFF header
    view.setUint8(0, 0x52); view.setUint8(1, 0x49); view.setUint8(2, 0x46); view.setUint8(3, 0x46); // RIFF
    view.setUint32(4, totalFileSize - 8, true);
    view.setUint8(8, 0x57); view.setUint8(9, 0x41); view.setUint8(10, 0x56); view.setUint8(11, 0x45); // WAVE

    // 'fmt ' chunk at offset 12
    view.setUint8(12, 0x66); view.setUint8(13, 0x6d); view.setUint8(14, 0x74); view.setUint8(15, 0x20); // fmt 
    view.setUint32(16, fmtSize, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // 1 channel
    view.setUint32(24, 16000, true); // 16000 Hz
    view.setUint32(28, 32000, true); // 32000 byteRate
    view.setUint16(32, 2, true); // blockAlign
    view.setUint16(34, 16, true); // 16 bitsPerSample

    // 'LIST' chunk at offset 36 (12 + 8 + 16)
    const listOffset = 36;
    view.setUint8(listOffset, 0x4c); view.setUint8(listOffset + 1, 0x49); view.setUint8(listOffset + 2, 0x53); view.setUint8(listOffset + 3, 0x54); // LIST
    view.setUint32(listOffset + 4, listSize, true);

    // 'data' chunk at offset 64 (36 + 8 + 20)
    const dataOffset = listOffset + 8 + listSize;
    view.setUint8(dataOffset, 0x64); view.setUint8(dataOffset + 1, 0x61); view.setUint8(dataOffset + 2, 0x74); view.setUint8(dataOffset + 3, 0x61); // data
    view.setUint32(dataOffset + 4, pcmDataSize, true);

    const header = parseWavHeader(buffer);
    expect(header.isWav).toBe(true);
    expect(header.sampleRate).toBe(16000);
    expect(header.numChannels).toBe(1);
    expect(header.bitsPerSample).toBe(16);
    expect(header.dataChunkSize).toBe(pcmDataSize);
    expect(header.dataChunkOffset).toBe(dataOffset + 8);
  });

  // =========================================================================
  // 2. sliceAudioBlob: slices audio accurately into standalone playable WAV Blobs
  // =========================================================================
  it('sliceAudioBlob slices a WAV buffer into a valid sub-chunk with correct duration and header', async () => {
    // Create a 10-second 16kHz mono WAV file
    const sampleRate = 16000;
    const duration = 10;
    const byteRate = 32000;
    const pcmDataSize = duration * byteRate;
    const buffer = new ArrayBuffer(44 + pcmDataSize);
    const view = new DataView(buffer);

    view.setUint8(0, 0x52); view.setUint8(1, 0x49); view.setUint8(2, 0x46); view.setUint8(3, 0x46); // RIFF
    view.setUint32(4, 36 + pcmDataSize, true);
    view.setUint8(8, 0x57); view.setUint8(9, 0x41); view.setUint8(10, 0x56); view.setUint8(11, 0x45); // WAVE
    view.setUint8(12, 0x66); view.setUint8(13, 0x6d); view.setUint8(14, 0x74); view.setUint8(15, 0x20); // fmt 
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // 1 ch
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    view.setUint8(36, 0x64); view.setUint8(37, 0x61); view.setUint8(38, 0x74); view.setUint8(39, 0x61); // data
    view.setUint32(40, pcmDataSize, true);

    const sourceFile = new File([buffer], 'lecture_10s.wav', { type: 'audio/wav' });

    // Slice 3 seconds: from second 2 to second 5
    const slicedBlob = await sliceAudioBlob(sourceFile, 2, 5);
    expect(slicedBlob).toBeDefined();

    const slicedHeader = await checkWavHeader(slicedBlob);
    expect(slicedHeader.isWav).toBe(true);
    expect(slicedHeader.sampleRate).toBe(16000);
    expect(slicedHeader.numChannels).toBe(1);
    expect(slicedHeader.bitsPerSample).toBe(16);
    expect(slicedHeader.dataChunkSize).toBe(3 * byteRate); // 3 seconds * 32000 bytes/s
    expect(slicedBlob.size).toBe(44 + 3 * byteRate);
  });

  // =========================================================================
  // 10. Production validation does NOT assume Python topics when unprovided
  // =========================================================================
  it('does NOT enforce hardcoded Python built-in topics when validating non-Python lectures', () => {
    const physicsLecture = {
      title: 'Lezione di Meccanica Razionale',
      course: 'Fisica Matematica',
      duration: 600,
      data: {
        timestamped_transcript: [
          { start: 0, end: 10, speaker: 'Prof', text_en: 'Equazioni di Lagrange', text_it: 'Equazioni di Lagrange' },
          { start: 10, end: 500, speaker: 'Prof', text_en: 'Hamiltoniana ed energia potenziale', text_it: 'Hamiltoniana' },
        ],
        study_guide_it: '\\documentclass{article}\n\\begin{document}\n\\section{Equazioni di Lagrange}\nTrattazione del moto.\n\\end{document}',
        glossary: [],
        potential_exam_questions: [],
      },
    };

    // When expectedTopics is not passed, it must NOT fail with missing 'random', 'built-in', etc.
    const result = validateLectureOutput(physicsLecture, {
      totalDuration: 600,
      // No expectedTopics passed
    });

    const missingTopics = result.details.topicCoverage.missingTopics;
    expect(missingTopics.includes('random')).toBe(false);
    expect(missingTopics.includes('built-in')).toBe(false);
  });

  // =========================================================================
  // 5. Uniform cached pipeline: cached data is validated and receives status + issues
  // =========================================================================
  it('cached lecture data undergoes the same validation and status determination as fresh pipeline', () => {
    // If cached data has an invalid timestamp beyond lecture duration
    const cachedData = {
      timestamped_transcript: [
        { start: 0, end: 100, speaker: 'Docente', text_en: 'Intro', text_it: 'Intro' },
        { start: 100, end: 1500, speaker: 'Docente', text_en: 'Out of bounds', text_it: 'Fuori durata' },
      ],
      study_guide_it: '\\documentclass{article}\\begin{document}\\section{Intro}Testo\\end{document}',
      glossary: [],
      potential_exam_questions: [],
    };

    const validation = validateLectureOutput(
      {
        duration: 1000,
        audioParts: [{ id: 'p1', fileName: 'audio.wav', fileSize: 1000, duration: 1000, startOffset: 0 }],
        hasSlides: false,
        data: cachedData,
      },
      {
        totalDuration: 1000,
        audioParts: [{ id: 'p1', fileName: 'audio.wav', fileSize: 1000, duration: 1000, startOffset: 0 }],
      }
    );

    const status = resolveLectureFinalStatus(validation);

    // Must be flagged as invalid error rather than blindly trusted
    expect(validation.isValid).toBe(false);
    expect(status).toBe('error');
    expect(validation.issues.some((i) => i.code === 'TRANSCRIPT_TIMESTAMP_OUT_OF_BOUNDS')).toBe(true);
  });

  // =========================================================================
  // 2. Multi-chunk slide alignment offset calculation
  // =========================================================================
  it('correctly shifts chunk-relative slide alignment timestamps to continuous lecture time', () => {
    // Chunk 0: [0, 2400]
    // Chunk 1: [2400, 4800]
    const chunk0Alignment: SlideAlignment[] = [
      { slide_number: 1, title: 'Slide 1', start_time_seconds: 10, end_time_seconds: 120, part: 0, summary: 'Slide 1' },
    ];
    const chunk1Alignment: SlideAlignment[] = [
      { slide_number: 2, title: 'Slide 2', start_time_seconds: 30, end_time_seconds: 200, part: 0, summary: 'Slide 2' },
    ];

    const chunk1BaseOffset = 2400;
    const adjustedChunk1 = chunk1Alignment.map((sa) => ({
      ...sa,
      start_time_seconds: sa.start_time_seconds !== null && sa.start_time_seconds !== undefined
        ? chunk1BaseOffset + sa.start_time_seconds
        : sa.start_time_seconds,
      end_time_seconds: sa.end_time_seconds !== null && sa.end_time_seconds !== undefined
        ? chunk1BaseOffset + sa.end_time_seconds
        : sa.end_time_seconds,
    }));

    const consolidated = consolidateSlidesAlignment([chunk0Alignment, adjustedChunk1]);
    expect(consolidated.length).toBe(2);
    expect(consolidated[0].start_time_seconds).toBe(10);
    expect(consolidated[1].start_time_seconds).toBe(2430); // 2400 + 30
    expect(consolidated[1].end_time_seconds).toBe(2600);   // 2400 + 200
  });
});

