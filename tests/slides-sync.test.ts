import { describe, it, expect } from 'vitest';
import {
  getSlideTimes,
  findActiveSlideIndex,
  adjustSlideTimestamps,
  parseSlideHeadings,
  clampAndNormalizeSlideTimestamps,
} from '../src/lib/slides-sync';
import { SlideAlignment, AudioPart } from '../src/lib/types';

describe('slides-sync: getSlideTimes (Canonical Relative Contract)', () => {
  const audioParts: AudioPart[] = [
    { id: 'p0', fileName: 'part0.wav', fileSize: 100, duration: 600, startOffset: 0 },
    { id: 'p1', fileName: 'part1.wav', fileSize: 100, duration: 600, startOffset: 600 },
    { id: 'p2', fileName: 'part2.wav', fileSize: 100, duration: 600, startOffset: 1200 },
  ];

  it('correctly maps part 0 relative timestamps to continuous time', () => {
    const slide: SlideAlignment = {
      slide_number: 1,
      title: 'Intro',
      part: 0,
      start_time_seconds: 15,
      end_time_seconds: 120,
      summary: 'Part 0 intro',
    };

    const res = getSlideTimes(slide, audioParts);
    expect(res.relativeStart).toBe(15);
    expect(res.relativeEnd).toBe(120);
    expect(res.continuousStart).toBe(15);
    expect(res.continuousEnd).toBe(120);
  });

  it('correctly maps part 1 relative timestamps to continuous time', () => {
    const slide: SlideAlignment = {
      slide_number: 5,
      title: 'Part 1 Topic',
      part: 1,
      start_time_seconds: 50,
      end_time_seconds: 200,
      summary: 'Part 1 topic',
    };

    const res = getSlideTimes(slide, audioParts);
    expect(res.relativeStart).toBe(50);
    expect(res.relativeEnd).toBe(200);
    expect(res.continuousStart).toBe(650); // 600 + 50
    expect(res.continuousEnd).toBe(800);   // 600 + 200
  });

  it('correctly maps part 2 relative timestamps to continuous time', () => {
    const slide: SlideAlignment = {
      slide_number: 10,
      title: 'Part 2 Conclusion',
      part: 2,
      start_time_seconds: 30,
      end_time_seconds: 150,
      summary: 'Part 2 conclusion',
    };

    const res = getSlideTimes(slide, audioParts);
    expect(res.relativeStart).toBe(30);
    expect(res.relativeEnd).toBe(150);
    expect(res.continuousStart).toBe(1230); // 1200 + 30
    expect(res.continuousEnd).toBe(1350);   // 1200 + 150
  });

  it('never subtracts part offset when relative timestamp is greater than part offset', () => {
    // Crucial bug prevention: Part 1 startOffset is 600s, but slide in part 1 is at relative 750s
    // Old heuristic (rawStart >= partOffset) erroneously subtracted 600s, making it 150s.
    // Under the canonical contract, 750s relative remains 750s relative, continuous = 1350s.
    const slide: SlideAlignment = {
      slide_number: 7,
      title: 'Long Part 1 Topic',
      part: 1,
      start_time_seconds: 750,
      end_time_seconds: 900,
      summary: 'Long topic',
    };

    const res = getSlideTimes(slide, audioParts);
    expect(res.relativeStart).toBe(750);
    expect(res.relativeEnd).toBe(900);
    expect(res.continuousStart).toBe(1350); // 600 + 750
    expect(res.continuousEnd).toBe(1500);   // 600 + 900
  });
});

describe('slides-sync: findActiveSlideIndex with Explicit Overlap Handling', () => {
  it('activates the subsequent slide as soon as it begins, even if the previous slide has an erroneous long end_time', () => {
    const slides: SlideAlignment[] = [
      // Slide 1 has an erroneous end_time of 1000s
      { slide_number: 1, title: 'Slide 1 (Erroneous End)', part: 0, start_time_seconds: 0, end_time_seconds: 1000, summary: '' },
      // Slide 2 actually begins at 60s
      { slide_number: 2, title: 'Slide 2', part: 0, start_time_seconds: 60, end_time_seconds: 180, summary: '' },
      // Slide 3 begins at 180s
      { slide_number: 3, title: 'Slide 3', part: 0, start_time_seconds: 180, end_time_seconds: 300, summary: '' },
    ];

    // At 30s: Slide 1 is active
    expect(findActiveSlideIndex(slides, 30, 0)).toBe(0);

    // At 60s: Slide 2 begins, so Slide 2 MUST be active (Slide 1 must not hide Slide 2!)
    expect(findActiveSlideIndex(slides, 60, 0)).toBe(1);

    // At 100s: Slide 2 is active
    expect(findActiveSlideIndex(slides, 100, 0)).toBe(1);

    // At 180s: Slide 3 begins, so Slide 3 is active
    expect(findActiveSlideIndex(slides, 180, 0)).toBe(2);
  });

  it('bridges pause gaps between slides gracefully until the next slide begins', () => {
    const slides: SlideAlignment[] = [
      { slide_number: 1, title: 'Slide 1', part: 0, start_time_seconds: 0, end_time_seconds: 60, summary: '' },
      // Gap between 60s and 90s (pause in lecture)
      { slide_number: 2, title: 'Slide 2', part: 0, start_time_seconds: 90, end_time_seconds: 180, summary: '' },
    ];

    // In the gap at 75s: Slide 1 remains active
    expect(findActiveSlideIndex(slides, 75, 0)).toBe(0);

    // At 90s: Slide 2 starts
    expect(findActiveSlideIndex(slides, 90, 0)).toBe(1);
  });
});

describe('slides-sync: adjustSlideTimestamps (3 Consecutive Slides Non-Overlap Policy)', () => {
  it('adjusts adjacent slides deterministically to prevent overlaps and preserve chronological order', () => {
    const slides: SlideAlignment[] = [
      { slide_number: 1, title: 'Slide 1', part: 0, start_time_seconds: 0, end_time_seconds: 100, summary: '' },
      { slide_number: 2, title: 'Slide 2', part: 0, start_time_seconds: 100, end_time_seconds: 200, summary: '' },
      { slide_number: 3, title: 'Slide 3', part: 0, start_time_seconds: 200, end_time_seconds: 300, summary: '' },
    ];

    // Case A: Move Slide 2 start earlier (from 100s to 80s)
    // Slide 1 end must be clamped to 80s to prevent overlap!
    const adjustedA = adjustSlideTimestamps(slides, 2, 80, 200);
    expect(adjustedA[0].end_time_seconds).toBe(80);
    expect(adjustedA[1].start_time_seconds).toBe(80);
    expect(adjustedA[1].end_time_seconds).toBe(200);
    expect(adjustedA[2].start_time_seconds).toBe(200);

    // Case B: Extend Slide 2 end later (from 200s to 250s)
    // Slide 3 start must be pushed forward to 250s to prevent overlap!
    const adjustedB = adjustSlideTimestamps(slides, 2, 100, 250);
    expect(adjustedB[1].end_time_seconds).toBe(250);
    expect(adjustedB[2].start_time_seconds).toBe(250);
    // Slide 3 duration should be preserved or >= start
    expect(adjustedB[2].end_time_seconds).toBeGreaterThanOrEqual(250);
  });
});

describe('slides-sync: clampAndNormalizeSlideTimestamps (Honest Outlier Detection vs Scaling)', () => {
  it('does NOT arbitrarily rescale outliers (e.g. 1860s on an 1158s audio), but flags them as needs_review', () => {
    const audioDuration = 1158; // 19m18s
    const slidesWithOutlier: SlideAlignment[] = [
      { slide_number: 1, title: 'Slide 1', part: 0, start_time_seconds: 0, end_time_seconds: 120, summary: '' },
      { slide_number: 2, title: 'Slide 2', part: 0, start_time_seconds: 120, end_time_seconds: 500, summary: '' },
      { slide_number: 3, title: 'Outlier Slide', part: 0, start_time_seconds: 1600, end_time_seconds: 1860, summary: '' },
    ];

    const normalized = clampAndNormalizeSlideTimestamps(slidesWithOutlier, audioDuration);

    // Slide 1 and 2 are within duration -> valid
    expect(normalized[0].needs_review).toBe(false);
    expect(normalized[0].status).toBe('valid');
    expect(normalized[1].needs_review).toBe(false);

    // Slide 3 is an outlier (1860s > 1158s) -> MUST NOT be transformed via mathematical scaling
    // It must retain its timestamps and be marked as needs_review!
    expect(normalized[2].needs_review).toBe(true);
    expect(normalized[2].status).toBe('needs_review');
    expect(normalized[2].end_time_seconds).toBe(1860); // NOT scaled down to 1158s!
  });

  it('clamps minor numerical jitter within 5s tolerance to audio duration cleanly', () => {
    const audioDuration = 1158;
    const slidesWithMinorJitter: SlideAlignment[] = [
      { slide_number: 1, title: 'Last Slide', part: 0, start_time_seconds: 1100, end_time_seconds: 1161, summary: '' }, // +3s jitter
    ];

    const normalized = clampAndNormalizeSlideTimestamps(slidesWithMinorJitter, audioDuration);
    expect(normalized[0].needs_review).toBe(false);
    expect(normalized[0].status).toBe('valid');
    expect(normalized[0].end_time_seconds).toBe(1158);
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
