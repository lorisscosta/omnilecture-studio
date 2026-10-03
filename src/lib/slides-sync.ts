import { SlideAlignment, AudioPart } from './types';

export interface ResolvedSlideTimes {
  relativeStart: number;
  relativeEnd: number;
  continuousStart: number;
  continuousEnd: number;
}

/**
 * Resolves both relative (within-part) and continuous (whole-lecture) timestamps
 * for a slide.
 * CANONICAL CONTRACT: All slide timestamps stored internally are STRICTLY relative
 * to the audio part (partIndex). Continuous timestamps are derived deterministically:
 * continuousStart = partOffset + relativeStart
 * continuousEnd   = partOffset + relativeEnd
 */
export function getSlideTimes(
  slide: SlideAlignment,
  audioParts?: AudioPart[]
): ResolvedSlideTimes {
  const partIndex = typeof slide.part === 'number' ? slide.part : 0;
  const partOffset =
    audioParts && audioParts[partIndex] ? audioParts[partIndex].startOffset : 0;

  const relativeStart = Math.max(0, slide.start_time_seconds ?? 0);
  const relativeEnd = Math.max(relativeStart, slide.end_time_seconds ?? relativeStart);

  const continuousStart = partOffset + relativeStart;
  const continuousEnd = partOffset + relativeEnd;

  return {
    relativeStart,
    relativeEnd,
    continuousStart,
    continuousEnd,
  };
}

/**
 * Determines which slide is currently active during playback at `continuousTime`.
 * EXPLICIT OVERLAP POLICY:
 * When slides overlap in time, the most recently started slide takes precedence
 * (i.e. the subsequent slide becomes active as soon as its start time is reached,
 * preventing an erroneous end_time on a previous slide from hiding the next slide).
 * Also bridges minor pause gaps between slides until the next slide begins.
 */
export function findActiveSlideIndex(
  slides: SlideAlignment[],
  continuousTime: number,
  activePartIndex: number,
  audioParts?: AudioPart[]
): number {
  if (!slides || slides.length === 0) return -1;

  // Map each slide of the active part with its resolved times and original index
  const partSlideEntries = slides
    .map((slide, originalIndex) => ({
      slide,
      originalIndex,
      times: getSlideTimes(slide, audioParts),
    }))
    .filter((entry) => (entry.slide.part ?? 0) === activePartIndex)
    .sort((a, b) => a.times.continuousStart - b.times.continuousStart);

  if (partSlideEntries.length === 0) return -1;

  // 1. Direct match: filter all slides that have started and not finished
  const activeCandidates = partSlideEntries.filter(
    (entry) => continuousTime >= entry.times.continuousStart && continuousTime <= entry.times.continuousEnd
  );

  if (activeCandidates.length > 0) {
    // If multiple slides overlap, pick the one with the latest start time (most recent)
    activeCandidates.sort((a, b) => b.times.continuousStart - a.times.continuousStart);
    return activeCandidates[0].originalIndex;
  }

  // 2. Gap bridging: if continuousTime is in a gap between slides, keep the previous slide
  // active until the next slide's start time is reached
  for (let i = 0; i < partSlideEntries.length; i++) {
    const current = partSlideEntries[i];
    const next = partSlideEntries[i + 1];

    const start = current.times.continuousStart;
    const bridgeEnd = next ? next.times.continuousStart : current.times.continuousEnd;

    if (continuousTime >= start && continuousTime < bridgeEnd) {
      return current.originalIndex;
    }
  }

  return -1;
}

/**
 * Updates a slide's timestamp and deterministically adjusts adjacent slides
 * in the same part to prevent overlap, out-of-order slides, and end < start.
 */
export function adjustSlideTimestamps(
  slides: SlideAlignment[],
  slideNumber: number,
  newStartSeconds: number,
  newEndSeconds?: number
): SlideAlignment[] {
  const targetIndex = slides.findIndex((s) => s.slide_number === slideNumber);
  if (targetIndex === -1) return [...slides];

  const targetPart = slides[targetIndex].part ?? 0;
  const clampedStart = Math.max(0, Math.round(newStartSeconds));
  const clampedEnd =
    typeof newEndSeconds === 'number'
      ? Math.max(clampedStart, Math.round(newEndSeconds))
      : Math.max(clampedStart, slides[targetIndex].end_time_seconds);

  // Deep clone slides
  const result: SlideAlignment[] = slides.map((s) => ({ ...s }));
  result[targetIndex].start_time_seconds = clampedStart;
  result[targetIndex].end_time_seconds = clampedEnd;

  // Get all slide indices in the same part, ordered by slide_number
  const samePartIndices = result
    .map((s, idx) => ({ s, idx }))
    .filter((item) => (item.s.part ?? 0) === targetPart)
    .sort((a, b) => a.s.slide_number - b.s.slide_number)
    .map((item) => item.idx);

  const posInPart = samePartIndices.indexOf(targetIndex);

  // 1. Backward pass: prevent previous slides from overlapping the target's new start
  for (let i = posInPart - 1; i >= 0; i--) {
    const prevIdx = samePartIndices[i];
    const nextIdx = samePartIndices[i + 1];
    if (result[prevIdx].end_time_seconds > result[nextIdx].start_time_seconds) {
      result[prevIdx].end_time_seconds = result[nextIdx].start_time_seconds;
      if (result[prevIdx].start_time_seconds > result[prevIdx].end_time_seconds) {
        result[prevIdx].start_time_seconds = result[prevIdx].end_time_seconds;
      }
    }
  }

  // 2. Forward pass: prevent subsequent slides from starting before target's new end
  for (let i = posInPart + 1; i < samePartIndices.length; i++) {
    const prevIdx = samePartIndices[i - 1];
    const currIdx = samePartIndices[i];
    if (result[currIdx].start_time_seconds < result[prevIdx].end_time_seconds) {
      const duration = Math.max(0, result[currIdx].end_time_seconds - result[currIdx].start_time_seconds);
      result[currIdx].start_time_seconds = result[prevIdx].end_time_seconds;
      result[currIdx].end_time_seconds = result[currIdx].start_time_seconds + duration;
    }
  }

  return result;
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
 * Validates and normalizes slide timestamps against the measured audio duration.
 *
 * POLICY:
 * - Small numerical errors within tolerance (<= 5s beyond duration) are clamped.
 * - Outliers exceeding the duration (> 5s beyond duration) or malformed intervals (start > end)
 *   are marked as `needs_review: true` and `status: 'needs_review'`.
 * - NO arbitrary mathematical scaling (e.g. compressing 1860s to 1158s) is performed,
 *   preserving truthfulness and allowing AI errors to be detected explicitly.
 */
export function clampAndNormalizeSlideTimestamps(
  slides: SlideAlignment[],
  totalAudioDuration: number,
  toleranceSeconds = 5
): SlideAlignment[] {
  if (!slides || slides.length === 0) return [];
  if (!totalAudioDuration || totalAudioDuration <= 0) {
    return slides.map((s) => ({ ...s, status: 'valid' as const }));
  }

  const durationSec = Math.round(totalAudioDuration);

  return slides.map((slide) => {
    if (slide.status === 'not_discussed') {
      return { ...slide };
    }

    const rawStart = slide.start_time_seconds ?? 0;
    const rawEnd = slide.end_time_seconds ?? rawStart;

    // Check for severe outliers or invalid ordering
    const isOutOfRange = rawStart > durationSec + toleranceSeconds || rawEnd > durationSec + toleranceSeconds;
    const isInvalidOrder = rawStart > rawEnd;

    if (isOutOfRange || isInvalidOrder) {
      return {
        ...slide,
        needs_review: true,
        status: 'needs_review' as const,
      };
    }

    // Minor numerical clamping within tolerance
    const clampedStart = Math.max(0, Math.min(rawStart, durationSec));
    const clampedEnd = Math.max(clampedStart, Math.min(rawEnd, durationSec));

    return {
      ...slide,
      start_time_seconds: clampedStart,
      end_time_seconds: clampedEnd,
      needs_review: false,
      status: 'valid' as const,
    };
  });
}

export interface ResolvedSeekTarget {
  targetPartIndex: number;
  relativeSeconds: number;
  continuousSeconds: number;
}

/**
 * Resolves a seek request to the correct audio part and relative timestamp.
 * If partIndex is omitted, `seconds` is treated as canonical continuous lecture time,
 * automatically mapping to the correct audio part and computing the relative offset.
 * If partIndex is provided, `seconds` is treated as relative to that part, with
 * defensive safeguarding against values exceeding the part duration.
 */
export function resolveSeekTarget(
  seconds: number,
  partIndex?: number,
  audioParts?: AudioPart[],
  totalDuration?: number
): ResolvedSeekTarget {
  if (!audioParts || audioParts.length <= 1) {
    const singleDur = totalDuration || (audioParts?.[0]?.duration ?? 0);
    const clamped = Math.max(0, singleDur > 0 ? Math.min(seconds, singleDur) : seconds);
    return {
      targetPartIndex: 0,
      relativeSeconds: clamped,
      continuousSeconds: clamped,
    };
  }

  // If partIndex is explicitly provided and valid
  if (typeof partIndex === 'number' && audioParts[partIndex]) {
    const targetPart = audioParts[partIndex];
    const partOffset = targetPart.startOffset || 0;
    const partDuration = targetPart.duration || 0;

    let relativeSec = seconds;
    // If seconds exceeds the part duration, it CANNOT be a relative time inside this part.
    // In that case, check if it was passed as continuous time and normalize by startOffset.
    if (partDuration > 0 && seconds > partDuration) {
      if (partOffset > 0 && seconds >= partOffset) {
        relativeSec = Math.max(0, seconds - partOffset);
      } else {
        relativeSec = Math.min(seconds, partDuration);
      }
    }
    if (partDuration > 0) {
      relativeSec = Math.max(0, Math.min(relativeSec, partDuration));
    }

    return {
      targetPartIndex: partIndex,
      relativeSeconds: relativeSec,
      continuousSeconds: partOffset + relativeSec,
    };
  }

  // Multi-part continuous seek: find which part contains continuous `seconds`
  const totDur = totalDuration || audioParts.reduce((acc, p) => acc + (p.duration || 0), 0);
  let targetIdx = audioParts.findIndex(
    (p) => seconds >= p.startOffset && seconds < p.startOffset + p.duration
  );
  if (targetIdx === -1) {
    targetIdx = seconds >= totDur ? audioParts.length - 1 : 0;
  }

  const targetPart = audioParts[targetIdx];
  const partOffset = targetPart?.startOffset || 0;
  const partDuration = targetPart?.duration || 0;
  let relativeSec = Math.max(0, seconds - partOffset);
  if (partDuration > 0) {
    relativeSec = Math.min(relativeSec, partDuration);
  }

  return {
    targetPartIndex: targetIdx,
    relativeSeconds: relativeSec,
    continuousSeconds: partOffset + relativeSec,
  };
}

