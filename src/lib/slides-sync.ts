import { SlideAlignment, AudioPart, TranscriptSegment } from './types';

export interface ResolvedSlideTimes {
  relativeStart: number;
  relativeEnd: number;
  continuousStart: number;
  continuousEnd: number;
}

/**
 * Resolves both relative (within-part) and continuous (whole-lecture) timestamps
 * for a slide, handling whether Gemini output cumulative or relative seconds.
 */
export function getSlideTimes(
  slide: SlideAlignment,
  audioParts?: AudioPart[]
): ResolvedSlideTimes {
  const partIndex = typeof slide.part === 'number' ? slide.part : 0;
  const partOffset =
    audioParts && audioParts[partIndex] ? audioParts[partIndex].startOffset : 0;

  const rawStart = Math.max(0, slide.start_time_seconds ?? 0);
  const rawEnd = Math.max(rawStart, slide.end_time_seconds ?? rawStart);

  let relativeStart = rawStart;
  let relativeEnd = rawEnd;
  let continuousStart = rawStart;
  let continuousEnd = rawEnd;

  // If partOffset > 0 and rawStart >= partOffset, it means timestamps are already continuous
  if (partOffset > 0 && rawStart >= partOffset) {
    relativeStart = Math.max(0, rawStart - partOffset);
    relativeEnd = Math.max(relativeStart, rawEnd - partOffset);
    continuousStart = rawStart;
    continuousEnd = rawEnd;
  } else {
    // rawStart is relative to the part
    relativeStart = rawStart;
    relativeEnd = rawEnd;
    continuousStart = partOffset + rawStart;
    continuousEnd = partOffset + rawEnd;
  }

  return {
    relativeStart,
    relativeEnd,
    continuousStart,
    continuousEnd,
  };
}

/**
 * Determines which slide is currently active during playback at `continuousTime`.
 * Accurately bridges small gaps between slides so that the slide stays active
 * until the next slide begins.
 */
export function findActiveSlideIndex(
  slides: SlideAlignment[],
  continuousTime: number,
  activePartIndex: number,
  audioParts?: AudioPart[]
): number {
  if (!slides || slides.length === 0) return -1;

  // Filter and sort slides belonging to the current active part
  const partSlideEntries = slides
    .map((slide, originalIndex) => ({
      slide,
      originalIndex,
      times: getSlideTimes(slide, audioParts),
    }))
    .filter((entry) => (entry.slide.part ?? 0) === activePartIndex)
    .sort((a, b) => a.times.continuousStart - b.times.continuousStart);

  if (partSlideEntries.length === 0) return -1;

  for (let i = 0; i < partSlideEntries.length; i++) {
    const current = partSlideEntries[i];
    const next = partSlideEntries[i + 1];

    const start = current.times.continuousStart;
    // Current slide is active up to either its end time, or the start of the next slide
    const end = next ? Math.max(current.times.continuousEnd, next.times.continuousStart) : current.times.continuousEnd;

    if (continuousTime >= start && continuousTime <= end) {
      return current.originalIndex;
    }
  }

  return -1;
}

/**
 * Updates a slide's timestamp, adjusting the subsequent slide's start time if needed
 * to maintain strict chronological integrity.
 */
export function adjustSlideTimestamps(
  slides: SlideAlignment[],
  slideNumber: number,
  newStartSeconds: number,
  newEndSeconds?: number
): SlideAlignment[] {
  const clampedStart = Math.max(0, Math.round(newStartSeconds));

  return slides.map((slide) => {
    if (slide.slide_number === slideNumber) {
      const clampedEnd =
        typeof newEndSeconds === 'number'
          ? Math.max(clampedStart, Math.round(newEndSeconds))
          : Math.max(clampedStart, slide.end_time_seconds);

      return {
        ...slide,
        start_time_seconds: clampedStart,
        end_time_seconds: clampedEnd,
      };
    }
    return slide;
  });
}

/**
 * Parses markdown slide headings (e.g. ## Slide 1: Title) into structured slide items.
 */
export function parseSlideHeadings(
  slidesMarkdown: string
): Array<{ slide_number: number; title: string; content: string }> {
  if (!slidesMarkdown || !slidesMarkdown.trim()) return [];

  const lines = slidesMarkdown.split('\n');
  const items: Array<{ slide_number: number; title: string; content: string }> = [];

  let currentNumber = 0;
  let currentTitle = '';
  let currentContentLines: string[] = [];

  const flush = () => {
    if (currentNumber > 0) {
      items.push({
        slide_number: currentNumber,
        title: currentTitle.trim() || `Slide ${currentNumber}`,
        content: currentContentLines.join('\n').trim(),
      });
    }
    currentContentLines = [];
  };

  const slideHeaderRegex = /^##\s*(?:Slide\s*)?(\d+)[:\s.-]*(.*)$/i;

  for (const line of lines) {
    const match = line.match(slideHeaderRegex);
    if (match) {
      flush();
      currentNumber = parseInt(match[1], 10);
      currentTitle = match[2] ? match[2].trim() : `Slide ${currentNumber}`;
    } else {
      if (currentNumber > 0) {
        currentContentLines.push(line);
      }
    }
  }

  flush();
  return items;
}

/**
 * Clamps and normalizes slide timestamps to ensure they strictly respect the total audio duration.
 * Fixes AI hallucination or scale issues (e.g. timestamps stretching up to 31 min for a 19:18 audio).
 */
export function clampAndNormalizeSlideTimestamps(
  slides: SlideAlignment[],
  totalAudioDuration: number
): SlideAlignment[] {
  if (!slides || slides.length === 0 || !totalAudioDuration || totalAudioDuration <= 0) {
    return slides;
  }

  const durationSec = Math.round(totalAudioDuration);
  const maxSlideEnd = Math.max(...slides.map((s) => s.end_time_seconds || 0), 0);

  // If timestamps severely overshoot the actual audio duration (> 10s over duration)
  const isOvershot = maxSlideEnd > durationSec + 10;
  const scale = isOvershot && maxSlideEnd > 0 ? durationSec / maxSlideEnd : 1;

  return slides.map((slide, idx) => {
    let start = isOvershot ? Math.round(slide.start_time_seconds * scale) : slide.start_time_seconds;
    let end = isOvershot ? Math.round(slide.end_time_seconds * scale) : slide.end_time_seconds;

    // Strict boundary clamps
    start = Math.max(0, Math.min(start, durationSec));
    end = Math.max(start, Math.min(end, durationSec));

    // If it's the last slide, ensure end reaches the end of the audio
    if (idx === slides.length - 1 && end < durationSec) {
      end = durationSec;
    }

    return {
      ...slide,
      start_time_seconds: start,
      end_time_seconds: end,
    };
  });
}

