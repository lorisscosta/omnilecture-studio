import { describe, it, expect } from 'vitest';
import {
  getSlideTimes,
  findActiveSlideIndex,
  adjustSlideTimestamps,
  parseSlideHeadings,
  clampAndNormalizeSlideTimestamps,
} from '../src/lib/slides-sync';
import { SlideAlignment, AudioPart } from '../src/lib/types';

describe('slides-sync: getSlideTimes', () => {
  it('correctly handles relative timestamps for part 0', () => {
    const slide: SlideAlignment = {
      slide_number: 1,
      title: 'Intro',
      part: 0,
      start_time_seconds: 10,
      end_time_seconds: 120,
      summary: 'Intro',
    };

    const res = getSlideTimes(slide);
    expect(res.relativeStart).toBe(10);
    expect(res.relativeEnd).toBe(120);
    expect(res.continuousStart).toBe(10);
    expect(res.continuousEnd).toBe(120);
  });

  it('correctly resolves relative timestamps when audioParts have offsets', () => {
    const audioParts: AudioPart[] = [
      { id: '1', fileName: 'p1.mp3', fileSize: 100, duration: 1800, startOffset: 0 },
      { id: '2', fileName: 'p2.mp3', fileSize: 100, duration: 1800, startOffset: 1800 },
    ];

    const slideInPart1: SlideAlignment = {
      slide_number: 5,
      title: 'Part 2 Topic',
      part: 1,
      start_time_seconds: 60, // relative 1 min into part 1
      end_time_seconds: 240,
      summary: 'Topic',
    };

    const res = getSlideTimes(slideInPart1, audioParts);
    expect(res.relativeStart).toBe(60);
    expect(res.relativeEnd).toBe(240);
    expect(res.continuousStart).toBe(1860); // 1800 + 60
    expect(res.continuousEnd).toBe(2040); // 1800 + 240
  });

  it('correctly converts already cumulative timestamps back to relative', () => {
    const audioParts: AudioPart[] = [
      { id: '1', fileName: 'p1.mp3', fileSize: 100, duration: 1800, startOffset: 0 },
      { id: '2', fileName: 'p2.mp3', fileSize: 100, duration: 1800, startOffset: 1800 },
    ];

    const slideCumulative: SlideAlignment = {
      slide_number: 5,
      title: 'Part 2 Topic',
      part: 1,
      start_time_seconds: 2000, // cumulative (200s into part 2)
      end_time_seconds: 2200,
      summary: 'Topic',
    };

    const res = getSlideTimes(slideCumulative, audioParts);
    expect(res.relativeStart).toBe(200);
    expect(res.relativeEnd).toBe(400);
    expect(res.continuousStart).toBe(2000);
    expect(res.continuousEnd).toBe(2200);
  });
});

describe('slides-sync: findActiveSlideIndex', () => {
  const slides: SlideAlignment[] = [
    { slide_number: 1, title: 'Slide 1', part: 0, start_time_seconds: 0, end_time_seconds: 60, summary: '' },
    { slide_number: 2, title: 'Slide 2', part: 0, start_time_seconds: 80, end_time_seconds: 200, summary: '' },
    { slide_number: 3, title: 'Slide 3', part: 1, start_time_seconds: 0, end_time_seconds: 120, summary: '' },
  ];

  it('identifies active slide during its timeframe', () => {
    expect(findActiveSlideIndex(slides, 30, 0)).toBe(0);
    expect(findActiveSlideIndex(slides, 100, 0)).toBe(1);
  });

  it('bridges small gap between slides gracefully to keep current slide active', () => {
    // Gap between 60s and 80s: Slide 1 stays active until Slide 2 starts at 80s
    expect(findActiveSlideIndex(slides, 70, 0)).toBe(0);
  });

  it('correctly filters by part index', () => {
    expect(findActiveSlideIndex(slides, 50, 1)).toBe(2);
  });
});

describe('slides-sync: adjustSlideTimestamps', () => {
  it('updates start and end time of a specific slide', () => {
    const slides: SlideAlignment[] = [
      { slide_number: 1, title: 'Slide 1', part: 0, start_time_seconds: 0, end_time_seconds: 60, summary: '' },
      { slide_number: 2, title: 'Slide 2', part: 0, start_time_seconds: 60, end_time_seconds: 120, summary: '' },
    ];

    const updated = adjustSlideTimestamps(slides, 2, 90, 150);
    expect(updated[1].start_time_seconds).toBe(90);
    expect(updated[1].end_time_seconds).toBe(150);
    expect(updated[0].start_time_seconds).toBe(0);
  });
});

describe('slides-sync: parseSlideHeadings', () => {
  it('parses markdown slide headers into slide items', () => {
    const md = `# Title
## Slide 1: Introduction
- Bullet point 1
- Bullet point 2

## Slide 2: Convolution Formula
- Equation: $y[n] = x[n] * h[n]$
`;

    const parsed = parseSlideHeadings(md);
    expect(parsed.length).toBe(2);
    expect(parsed[0].slide_number).toBe(1);
    expect(parsed[0].title).toBe('Introduction');
    expect(parsed[1].slide_number).toBe(2);
    expect(parsed[1].title).toBe('Convolution Formula');
  });
});

describe('slides-sync: clampAndNormalizeSlideTimestamps', () => {
  it('rescales hallucinated timestamps that exceed actual audio duration (e.g. 31m on a 19:18 audio)', () => {
    // Audio duration: 19:18 = 1158s
    const totalAudioDuration = 1158;
    // Slide timestamps hallucinated up to 31:00 = 1860s
    const hallucinatedSlides: SlideAlignment[] = [
      { slide_number: 1, title: 'Intro', part: 0, start_time_seconds: 0, end_time_seconds: 300, summary: '' },
      { slide_number: 2, title: 'Mid', part: 0, start_time_seconds: 300, end_time_seconds: 1200, summary: '' },
      { slide_number: 3, title: 'Penultimate', part: 0, start_time_seconds: 1200, end_time_seconds: 1600, summary: '' },
      { slide_number: 4, title: 'Final', part: 0, start_time_seconds: 1600, end_time_seconds: 1860, summary: '' }, // 31 min
    ];

    const normalized = clampAndNormalizeSlideTimestamps(hallucinatedSlides, totalAudioDuration);

    expect(normalized.length).toBe(4);
    // Max timestamp must strictly NOT exceed 1158s
    const maxEnd = Math.max(...normalized.map((s) => s.end_time_seconds));
    expect(maxEnd).toBe(1158);
    // First slide starts at 0
    expect(normalized[0].start_time_seconds).toBe(0);
    // Slide 4 ends at 1158s (19:18)
    expect(normalized[3].end_time_seconds).toBe(1158);
    // All slides must be chronological
    for (let i = 0; i < normalized.length; i++) {
      expect(normalized[i].start_time_seconds).toBeLessThanOrEqual(normalized[i].end_time_seconds);
      expect(normalized[i].end_time_seconds).toBeLessThanOrEqual(totalAudioDuration);
    }
  });

  it('keeps normal timestamps intact if within audio duration', () => {
    const normalSlides: SlideAlignment[] = [
      { slide_number: 1, title: 'Intro', part: 0, start_time_seconds: 0, end_time_seconds: 100, summary: '' },
      { slide_number: 2, title: 'End', part: 0, start_time_seconds: 100, end_time_seconds: 200, summary: '' },
    ];
    const normalized = clampAndNormalizeSlideTimestamps(normalSlides, 200);
    expect(normalized[0].start_time_seconds).toBe(0);
    expect(normalized[0].end_time_seconds).toBe(100);
    expect(normalized[1].end_time_seconds).toBe(200);
  });
});

