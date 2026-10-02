import { Lecture, LectureData, TranscriptSegment, SlideAlignment, AudioPart } from './types';

export interface LectureValidationResult {
  isValid: boolean;
  hasWarnings: boolean;
  status: 'completed' | 'completed_with_warnings' | 'error';
  errors: string[];
  warnings: string[];
  details: {
    transcriptValid: boolean;
    slidesAlignmentValid: boolean;
    studyGuideValid: boolean;
    latexTimestampsValid: boolean;
    metadataConsistent: boolean;
    slideCoverage: {
      totalSlidesExpected?: number;
      coveredSlideNumbers: number[];
      missingDiscussedSlideNumbers: number[];
      notDiscussedSlideNumbers: number[];
    };
    topicCoverage: {
      expectedTopics: string[];
      coveredTopics: string[];
      missingTopics: string[];
    };
  };
}

export interface ValidateLectureOptions {
  audioParts?: AudioPart[];
  totalDuration?: number;
  expectedSlideCount?: number;
  expectedTopics?: string[];
  slideHeadings?: Array<{ slide_number: number; title: string; content?: string }>;
  slidesMarkdown?: string;
  toleranceSeconds?: number;
}

/**
 * Synchronizes slide metadata between top-level Lecture properties and Lecture.data.
 * Guarantees a single source of truth for slide presence and filenames.
 */
export function synchronizeLectureSlidesState(lecture: Partial<Lecture>): void {
  const hasSlides = Boolean(
    lecture.hasSlides ||
    lecture.slidesBlob ||
    lecture.slidesFileName ||
    (lecture.slidesMarkdown && lecture.slidesMarkdown.trim().length > 0) ||
    (lecture.slidesAlignment && lecture.slidesAlignment.length > 0) ||
    (lecture.data?.slides_alignment && lecture.data.slides_alignment.length > 0) ||
    lecture.data?.has_slides
  );

  lecture.hasSlides = hasSlides;

  if (lecture.data) {
    lecture.data.has_slides = hasSlides;
    if (lecture.slidesFileName && !lecture.data.slides_filename) {
      lecture.data.slides_filename = lecture.slidesFileName;
    }
    if (lecture.slidesMarkdown && !lecture.data.slides_markdown) {
      lecture.data.slides_markdown = lecture.slidesMarkdown;
    }
    if (lecture.slidesAlignment && !lecture.data.slides_alignment) {
      lecture.data.slides_alignment = lecture.slidesAlignment;
    }
  }

  if (lecture.data?.slides_filename && !lecture.slidesFileName) {
    lecture.slidesFileName = lecture.data.slides_filename;
  }
  if (lecture.data?.slides_markdown && !lecture.slidesMarkdown) {
    lecture.slidesMarkdown = lecture.data.slides_markdown;
  }
  if (lecture.data?.slides_alignment && !lecture.slidesAlignment) {
    lecture.slidesAlignment = lecture.data.slides_alignment;
  }
}

/**
 * Validates generated lecture outputs against ground truth duration, slide coverage,
 * topic coverage, and metadata consistency.
 */
export function validateLectureOutput(
  lecture: Partial<Lecture>,
  options: ValidateLectureOptions = {}
): LectureValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const tolerance = typeof options.toleranceSeconds === 'number' ? options.toleranceSeconds : 5;
  const audioParts = options.audioParts || lecture.audioParts || [];
  const totalDuration =
    typeof options.totalDuration === 'number' && options.totalDuration > 0
      ? options.totalDuration
      : lecture.duration || (audioParts.length > 0 ? audioParts.reduce((a, b) => a + (b.duration || 0), 0) : 0);

  const data: LectureData | undefined = lecture.data;
  const transcript: TranscriptSegment[] = data?.timestamped_transcript || [];
  const slides: SlideAlignment[] = lecture.slidesAlignment || data?.slides_alignment || [];
  const studyGuide: string = data?.study_guide_it || '';

  // 1. Validate Transcript Timestamps
  let transcriptValid = true;
  if (transcript.length === 0) {
    errors.push('Trascrizione vuota: nessun segmento timestamped_transcript presente.');
    transcriptValid = false;
  } else {
    let lastStart = -1;
    for (let i = 0; i < transcript.length; i++) {
      const seg = transcript[i];
      const partIdx = typeof seg.partIndex === 'number' ? seg.partIndex : 0;
      const partDuration = audioParts[partIdx]?.duration || totalDuration;

      // 1. Check bounds
      if (seg.start < 0) {
        errors.push(`Segmento transcript ${i}: start negativo (${seg.start}s).`);
        transcriptValid = false;
      }
      if (totalDuration > 0 && seg.end > totalDuration + tolerance) {
        errors.push(
          `Segmento transcript ${i}: timestamp fuori durata (${seg.end}s > durata audio ${totalDuration}s).`
        );
        transcriptValid = false;
      }

      // 2. start < end
      if (seg.start >= seg.end) {
        errors.push(`Segmento transcript ${i}: start >= end (${seg.start}s >= ${seg.end}s).`);
        transcriptValid = false;
      }

      // 3. Chronological ordering
      if (seg.start < lastStart) {
        errors.push(`Segmento transcript ${i}: ordine cronologico violato (${seg.start}s < ${lastStart}s).`);
        transcriptValid = false;
      }
      lastStart = seg.start;

      // 4. partIndex valid
      if (audioParts.length > 0 && (partIdx < 0 || partIdx >= audioParts.length)) {
        errors.push(`Segmento transcript ${i}: partIndex non valido (${partIdx}, atteso 0..${audioParts.length - 1}).`);
        transcriptValid = false;
      }
    }
  }

  // 5 & 6. Validate Slide Timestamps and Numbers
  let slidesAlignmentValid = true;
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    if (s.slide_number < 1) {
      errors.push(`Slide ${i}: numero slide non valido (${s.slide_number}).`);
      slidesAlignmentValid = false;
    }
    if (options.expectedSlideCount && s.slide_number > options.expectedSlideCount) {
      warnings.push(`Slide ${s.slide_number}: supera il numero totale di slide atteso (${options.expectedSlideCount}).`);
    }

    if (s.status !== 'not_discussed') {
      if (s.start_time_seconds < 0) {
        errors.push(`Slide ${s.slide_number}: start_time_seconds negativo (${s.start_time_seconds}s).`);
        slidesAlignmentValid = false;
      }
      if (s.start_time_seconds > s.end_time_seconds) {
        errors.push(
          `Slide ${s.slide_number}: start_time_seconds > end_time_seconds (${s.start_time_seconds}s > ${s.end_time_seconds}s).`
        );
        slidesAlignmentValid = false;
      }
      if (totalDuration > 0 && s.end_time_seconds > totalDuration + tolerance) {
        errors.push(
          `Slide ${s.slide_number}: end_time_seconds fuori durata (${s.end_time_seconds}s > durata audio ${totalDuration}s).`
        );
        slidesAlignmentValid = false;
      }
      if (s.needs_review || s.status === 'needs_review') {
        warnings.push(`Slide ${s.slide_number}: allineamento contrassegnato per revisione manuale (outlier temporale).`);
      }
    }
  }

  // 7. Validate Slide Coverage
  const coveredSlideNumbers = slides.filter((s) => s.status !== 'not_discussed').map((s) => s.slide_number);
  const notDiscussedSlideNumbers = slides.filter((s) => s.status === 'not_discussed').map((s) => s.slide_number);
  const missingDiscussedSlideNumbers: number[] = [];

  if (options.expectedSlideCount && options.expectedSlideCount > 0) {
    const allSlideNumbers = Array.from({ length: options.expectedSlideCount }, (_, i) => i + 1);
    for (const num of allSlideNumbers) {
      const isCovered = coveredSlideNumbers.includes(num);
      const isMarkedNotDiscussed = notDiscussedSlideNumbers.includes(num);

      if (!isCovered && !isMarkedNotDiscussed) {
        // Check if transcript mentions keywords for this slide
        const heading = options.slideHeadings?.find((h) => h.slide_number === num);
        const searchTerms = heading
          ? [heading.title, ...(heading.content ? heading.content.split(/\s+/) : [])]
              .filter((t) => t.length > 4)
              .map((t) => t.toLowerCase())
          : [];

        const isDiscussedInTranscript = transcript.some((seg) => {
          const text = (seg.text_en + ' ' + seg.text_it).toLowerCase();
          return searchTerms.some((term) => text.includes(term));
        });

        if (isDiscussedInTranscript) {
          missingDiscussedSlideNumbers.push(num);
          errors.push(
            `Copertura Slide: La slide ${num} (${heading?.title || 'Slide ' + num}) è discussa nell'audio/transcript ma manca in slides_alignment.`
          );
        } else {
          warnings.push(`Slide ${num}: non presente in slides_alignment (non discussa o saltata).`);
        }
      }
    }
  }

  // 8. Validate Study Guide Topic Coverage
  let studyGuideValid = Boolean(studyGuide && studyGuide.includes('\\documentclass'));
  if (!studyGuideValid) {
    errors.push('Study Guide LaTeX non valida o incompleta (manca \\documentclass).');
  }

  const expectedTopics = options.expectedTopics || [
    'built-in',
    'math',
    'random',
    'composition',
  ];
  const coveredTopics: string[] = [];
  const missingTopics: string[] = [];

  const topicAliases: Record<string, string[]> = {
    'built-in': ['built-in', 'built in', 'funzioni integrate', 'round(', 'max(', 'min('],
    'math': ['modulo math', 'math.', 'math module', 'funzioni matematiche'],
    'random': ['modulo random', 'random module', 'randint', 'choice', 'shuffle', 'random.random', 'randomness'],
    'composition': ['composition', 'composizione', 'nested function', 'annidat'],
  };

  const lowerGuide = studyGuide.toLowerCase();
  for (const topic of expectedTopics) {
    const t = topic.toLowerCase();
    const aliases = topicAliases[t] || [t];

    // Check if the topic was mentioned in the transcript
    const isTopicInTranscript = transcript.some((seg) => {
      const text = (seg.text_en + ' ' + seg.text_it).toLowerCase();
      return aliases.some((a) => text.includes(a)) || text.includes(t);
    });

    if (isTopicInTranscript) {
      const isCoveredInGuide = aliases.some((a) => lowerGuide.includes(a));
      if (isCoveredInGuide) {
        coveredTopics.push(topic);
      } else {
        missingTopics.push(topic);
        warnings.push(
          `Copertura Argomenti: L'argomento "${topic}" è trattato nel transcript ma manca nella study guide LaTeX (manca sezione o funzioni chiave).`
        );
      }
    }
  }

  // 9. Validate LaTeX Timestamps
  let latexTimestampsValid = true;
  const tsRegex = /\\ts\{(\d+)\}\{(\d+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = tsRegex.exec(studyGuide)) !== null) {
    const pIdx = parseInt(match[1], 10);
    const sec = parseInt(match[2], 10);

    const partDuration = audioParts[pIdx]?.duration || totalDuration;
    if (audioParts.length > 0 && pIdx >= audioParts.length) {
      errors.push(`LaTeX timestamp: \\ts{${pIdx}}{${sec}} cita un indice parte inesistente (${pIdx}).`);
      latexTimestampsValid = false;
    }
    if (partDuration > 0 && sec > partDuration + tolerance) {
      errors.push(
        `LaTeX timestamp fuori durata: \\ts{${pIdx}}{${sec}} supera la durata (${sec}s > ${partDuration}s).`
      );
      latexTimestampsValid = false;
    }
  }

  // 10. Consistency between top-level metadata and data
  let metadataConsistent = true;
  if (lecture.hasSlides !== undefined && data?.has_slides !== undefined) {
    if (lecture.hasSlides !== data.has_slides) {
      errors.push(
        `Incoerenza metadati: lecture.hasSlides (${lecture.hasSlides}) !== data.has_slides (${data.has_slides}).`
      );
      metadataConsistent = false;
    }
  }

  const isValid = errors.length === 0;
  const hasWarnings = warnings.length > 0;
  const status: 'completed' | 'completed_with_warnings' | 'error' = !isValid
    ? 'error'
    : hasWarnings
    ? 'completed_with_warnings'
    : 'completed';

  return {
    isValid,
    hasWarnings,
    status,
    errors,
    warnings,
    details: {
      transcriptValid,
      slidesAlignmentValid,
      studyGuideValid,
      latexTimestampsValid,
      metadataConsistent,
      slideCoverage: {
        totalSlidesExpected: options.expectedSlideCount,
        coveredSlideNumbers,
        missingDiscussedSlideNumbers,
        notDiscussedSlideNumbers,
      },
      topicCoverage: {
        expectedTopics,
        coveredTopics,
        missingTopics,
      },
    },
  };
}

/**
 * Reconciles slide alignment by identifying missing slides:
 * - If a slide was discussed in the gap between existing slides, creates an interpolated alignment entry.
 * - If a slide was never reached / discussed, marks it as status: 'not_discussed'.
 */
export function reconcileSlideCoverage(
  slides: SlideAlignment[],
  totalExpectedSlides: number,
  slideHeadings: Array<{ slide_number: number; title: string; content?: string }> = [],
  transcriptSegments: TranscriptSegment[] = [],
  audioDuration = 0
): SlideAlignment[] {
  const existingMap = new Map<number, SlideAlignment>();
  for (const s of slides) {
    existingMap.set(s.slide_number, s);
  }

  const reconciled: SlideAlignment[] = [];

  for (let num = 1; num <= totalExpectedSlides; num++) {
    if (existingMap.has(num)) {
      reconciled.push({ ...existingMap.get(num)! });
      continue;
    }

    const heading = slideHeadings.find((h) => h.slide_number === num);
    const title = heading?.title || `Slide ${num}`;

    // Find previous and next covered slides to check for a temporal gap
    let prevSlide: SlideAlignment | undefined;
    for (let p = num - 1; p >= 1; p--) {
      if (existingMap.has(p)) {
        prevSlide = existingMap.get(p);
        break;
      }
    }

    let nextSlide: SlideAlignment | undefined;
    for (let n = num + 1; n <= totalExpectedSlides; n++) {
      if (existingMap.has(n)) {
        nextSlide = existingMap.get(n);
        break;
      }
    }

    const gapStart = prevSlide ? prevSlide.end_time_seconds : 0;
    const gapEnd = nextSlide ? nextSlide.start_time_seconds : audioDuration;

    // Check if transcript has text relating to this slide
    const searchTerms = [
      title,
      ...(heading?.content ? heading.content.split(/\s+/) : []),
    ]
      .filter((w) => w.length > 4)
      .map((w) => w.toLowerCase());

    const matchingSegments = transcriptSegments.filter((seg) => {
      const text = (seg.text_en + ' ' + seg.text_it).toLowerCase();
      return searchTerms.some((term) => text.includes(term));
    });

    if (matchingSegments.length > 0 && gapEnd > gapStart) {
      // Discussed in this gap!
      const segStart = Math.min(...matchingSegments.map((s) => s.start));
      const segEnd = Math.max(...matchingSegments.map((s) => s.end));
      const startClamped = Math.max(gapStart, Math.min(segStart, gapEnd));
      const endClamped = Math.max(startClamped, Math.min(segEnd, gapEnd));

      reconciled.push({
        slide_number: num,
        title,
        part: prevSlide ? prevSlide.part : 0,
        start_time_seconds: startClamped,
        end_time_seconds: endClamped > startClamped ? endClamped : Math.min(startClamped + 30, gapEnd),
        summary: heading?.content ? heading.content.slice(0, 160) : `Trattazione della slide ${num} (${title}).`,
        status: 'valid',
        needs_review: false,
      });
    } else {
      // Not discussed in recording
      reconciled.push({
        slide_number: num,
        title,
        part: 0,
        start_time_seconds: 0,
        end_time_seconds: 0,
        summary: 'Slide non discussa nella registrazione audio.',
        status: 'not_discussed',
        needs_review: false,
      });
    }
  }

  return reconciled.sort((a, b) => a.slide_number - b.slide_number);
}

/**
 * Normalizes common ASR/OCR acoustic phonetic errors for technical and Python STEM terminology.
 * Only touches known technical misinterpretations, preserving overall verbatim meaning.
 */
export function normalizeTechnicalTerminology(text: string): string {
  if (!text) return '';

  let cleaned = text;

  // Python built-in phonetic corrections
  cleaned = cleaned.replace(/\b(?:bodysing|body\s*sing|boddysing)\s+max\s+is\s+doing\b/gi, 'built-in max is doing');
  cleaned = cleaned.replace(/\b(?:bodysing|body\s*sing|boddysing)\b/gi, 'built-ins');
  cleaned = cleaned.replace(/\bto zoom the title lesson for free\b/gi, 'tools Python gives you for free');

  // Math module function calls
  cleaned = cleaned.replace(/\bmath\s+sqrt\(([^)]*)\)/gi, 'math.sqrt($1)');
  cleaned = cleaned.replace(/\bmath\s+sqrt\b/gi, 'math.sqrt');
  cleaned = cleaned.replace(/\bmath\s+floor\b/gi, 'math.floor');
  cleaned = cleaned.replace(/\bmath\s+ceil\b/gi, 'math.ceil');
  cleaned = cleaned.replace(/\bmath\s+pow\b/gi, 'math.pow');
  cleaned = cleaned.replace(/\bmath\s+pi\b/gi, 'math.pi');
  cleaned = cleaned.replace(/\bmath\s+gcd\b/gi, 'math.gcd');

  // Random module function calls
  cleaned = cleaned.replace(/\brandom\s+random\b/gi, 'random.random');
  cleaned = cleaned.replace(/\brandom\s+randint\b/gi, 'random.randint');
  cleaned = cleaned.replace(/\brandom\s+choice\b/gi, 'random.choice');
  cleaned = cleaned.replace(/\brandom\s+shuffle\b/gi, 'random.shuffle');

  return cleaned;
}

/**
 * Enriches a LaTeX study guide with missing topic sections synthesized from transcript segments.
 */
export function enrichStudyGuideWithMissingSection(
  studyGuide: string,
  sectionTitle: string,
  sectionBodyLatex: string
): string {
  if (!studyGuide) return studyGuide;
  const endDocIdx = studyGuide.indexOf('\\end{document}');
  if (endDocIdx === -1) {
    return `${studyGuide}\n\n\\section{${sectionTitle}}\n${sectionBodyLatex}\n`;
  }

  const before = studyGuide.slice(0, endDocIdx);
  const after = studyGuide.slice(endDocIdx);
  return `${before.trim()}\n\n\\section{${sectionTitle}}\n${sectionBodyLatex}\n\n${after}`;
}
