import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { checkWavHeader, shouldOptimizeAudio, parseWavHeader } from '../src/lib/audio-compressor';
import {
  getSlideTimes,
  findActiveSlideIndex,
  clampAndNormalizeSlideTimestamps,
  adjustSlideTimestamps,
} from '../src/lib/slides-sync';
import {
  createLectureChunksPlan,
  mergeTranscriptSegments,
  consolidateSlidesAlignment,
} from '../src/lib/chunk-processing';
import { AudioPart, SlideAlignment } from '../src/lib/types';

describe('Regression & End-to-End Real Files Test Suite', () => {
  const audioFilePath = path.join(process.cwd(), '20261001112643.wav');
  const pdfFilePath = path.join(process.cwd(), 'Lesson4_Theory_Slides.pdf');

  it('verifies real audio file exists and matches target specs (16kHz mono PCM16, ~19m18s, ~35MB)', async () => {
    expect(fs.existsSync(audioFilePath)).toBe(true);
    const stat = fs.statSync(audioFilePath);
    expect(stat.size).toBeGreaterThan(30 * 1024 * 1024); // ~35.3 MB

    const fd = fs.openSync(audioFilePath, 'r');
    const headerBuffer = Buffer.alloc(128);
    fs.readSync(fd, headerBuffer, 0, 128, 0);
    fs.closeSync(fd);

    const header = parseWavHeader(headerBuffer.buffer.slice(headerBuffer.byteOffset, headerBuffer.byteOffset + headerBuffer.byteLength));
    expect(header.isWav).toBe(true);
    expect(header.audioFormat).toBe(1); // PCM
    expect(header.numChannels).toBe(1); // Mono
    expect(header.sampleRate).toBe(16000); // 16kHz
    expect(header.bitsPerSample).toBe(16); // 16-bit

    // Calculated duration in seconds
    const dataSize = stat.size - 44;
    const durationSec = dataSize / (header.byteRate || 32000);
    expect(durationSec).toBeCloseTo(1157.78, 1); // ~19 minutes 17.8 seconds
  });

  it('bypasses downsampling / optimization for 20261001112643.wav because it is already 16kHz mono PCM16', async () => {
    const fileBuffer = fs.readFileSync(audioFilePath);
    const audioBlob = new Blob([fileBuffer], { type: 'audio/wav' });
    const file = new File([audioBlob], '20261001112643.wav', { type: 'audio/wav' });

    const needsOptimization = await shouldOptimizeAudio(file);
    // MUST be false to prevent unnecessary CPU overhead and memory spikes!
    expect(needsOptimization).toBe(false);
  });

  it('verifies real PDF file exists and matches target specs (~12 slides)', () => {
    expect(fs.existsSync(pdfFilePath)).toBe(true);
    const stat = fs.statSync(pdfFilePath);
    expect(stat.size).toBeGreaterThan(100 * 1024);

    const buffer = fs.readFileSync(pdfFilePath);
    const pdfHeader = buffer.subarray(0, 5).toString('ascii');
    expect(pdfHeader).toBe('%PDF-');
  });

  it('creates single chunk plan for 1157.78s audio (under 40 min threshold)', () => {
    const audioParts: AudioPart[] = [
      {
        id: 'part-1',
        fileName: '20261001112643.wav',
        duration: 1158,
        fileSize: 37049004,
        startOffset: 0,
      },
    ];

    const plan = createLectureChunksPlan('lecture-python-builtins', audioParts, 2400);
    expect(plan.length).toBe(1);
    expect(plan[0].partIndex).toBe(0);
    expect(plan[0].startSeconds).toBe(0);
    expect(plan[0].endSeconds).toBe(1158);
  });

  it('ensures slide alignment uses canonical relative timestamps and correctly derives continuous offsets', () => {
    const audioParts: AudioPart[] = [
      { id: 'p0', fileName: '20261001112643.wav', duration: 1158, fileSize: 35000000, startOffset: 0 },
      { id: 'p1', fileName: 'part2.wav', duration: 600, fileSize: 18000000, startOffset: 1158 },
    ];

    const slides: SlideAlignment[] = [
      { slide_number: 1, title: 'Python Built-ins', part: 0, start_time_seconds: 0, end_time_seconds: 120, summary: '' },
      { slide_number: 2, title: 'Math Module', part: 0, start_time_seconds: 120, end_time_seconds: 350, summary: '' },
      { slide_number: 3, title: 'Random Module', part: 1, start_time_seconds: 10, end_time_seconds: 200, summary: '' },
    ];

    // Part 0 Slide 1
    const s1Times = getSlideTimes(slides[0], audioParts);
    expect(s1Times.relativeStart).toBe(0);
    expect(s1Times.continuousStart).toBe(0);

    // Part 0 Slide 2
    const s2Times = getSlideTimes(slides[1], audioParts);
    expect(s2Times.relativeStart).toBe(120);
    expect(s2Times.continuousStart).toBe(120);

    // Part 1 Slide 3 (strictly relative 10s, continuous 1158 + 10 = 1168s)
    const s3Times = getSlideTimes(slides[2], audioParts);
    expect(s3Times.relativeStart).toBe(10);
    expect(s3Times.continuousStart).toBe(1168);
    expect(s3Times.continuousEnd).toBe(1358);
  });

  it('flags real outlier timestamps beyond audio duration without arbitrary mathematical scaling', () => {
    const audioDuration = 1158; // 19m18s
    const rawSlides: SlideAlignment[] = [
      { slide_number: 1, title: 'Intro', part: 0, start_time_seconds: 0, end_time_seconds: 120, summary: '' },
      { slide_number: 2, title: 'Built-ins', part: 0, start_time_seconds: 120, end_time_seconds: 300, summary: '' },
      { slide_number: 11, title: 'Composition', part: 0, start_time_seconds: 1000, end_time_seconds: 1150, summary: '' },
      // Outlier: Gemini hallucinated 1860s (31 minutes) on an 1158s (19m18s) recording
      { slide_number: 12, title: 'Summary', part: 0, start_time_seconds: 1150, end_time_seconds: 1860, summary: '' },
    ];

    const normalized = clampAndNormalizeSlideTimestamps(rawSlides, audioDuration);
    expect(normalized.length).toBe(4);
    // Slide 12 should be flagged for review honestly, NOT artificially scaled
    expect(normalized[3].needs_review).toBe(true);
    expect(normalized[3].status).toBe('needs_review');
    // Original timestamp is kept transparently
    expect(normalized[3].end_time_seconds).toBe(1860);
  });

  it('adjusts adjacent slides deterministically without overlap', () => {
    const slides: SlideAlignment[] = [
      { slide_number: 1, title: 'S1', part: 0, start_time_seconds: 0, end_time_seconds: 100, summary: '' },
      { slide_number: 2, title: 'S2', part: 0, start_time_seconds: 100, end_time_seconds: 200, summary: '' },
      { slide_number: 3, title: 'S3', part: 0, start_time_seconds: 200, end_time_seconds: 300, summary: '' },
    ];

    const adjusted = adjustSlideTimestamps(slides, 2, 80, 250);
    expect(adjusted[0].end_time_seconds).toBe(80); // Previous slide clamped backward to 80 to prevent overlap
    expect(adjusted[1].start_time_seconds).toBe(80);
    expect(adjusted[1].end_time_seconds).toBe(250);
    expect(adjusted[2].start_time_seconds).toBe(250); // Next slide pushed forward to 250 to prevent overlap
  });
});
