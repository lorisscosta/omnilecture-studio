import { describe, it, expect } from 'vitest';
import { consolidateSlidesAlignment } from '../src/lib/chunk-processing';
import { SlideAlignment } from '../src/lib/types';

describe('slides-alignment: consolidateSlidesAlignment', () => {
  it('consolidates and orders slides chronologically across multiple parts', () => {
    const chunk1Slides: SlideAlignment[] = [
      {
        slide_number: 2,
        title: 'Campionamento Frequenziale',
        part: 0,
        start_time_seconds: 120,
        end_time_seconds: 300,
        summary: 'Discretizzazione della DTFT sulla circonferenza unitaria.',
      },
      {
        slide_number: 1,
        title: 'Introduzione al Corso',
        part: 0,
        start_time_seconds: 0,
        end_time_seconds: 120,
        summary: 'Obiettivi del modulo di elaborazione numerica dei segnali.',
      },
    ];

    const chunk2Slides: SlideAlignment[] = [
      {
        slide_number: 3,
        title: 'Convoluzione Circolare',
        part: 1,
        start_time_seconds: 0,
        end_time_seconds: 240,
        summary: 'Equivalenza spettrale e time-domain aliasing.',
      },
    ];

    const consolidated = consolidateSlidesAlignment([chunk1Slides, chunk2Slides]);

    expect(consolidated.length).toBe(3);
    // First should be part 0, slide 1 (time 0)
    expect(consolidated[0].slide_number).toBe(1);
    expect(consolidated[0].part).toBe(0);
    expect(consolidated[0].start_time_seconds).toBe(0);

    // Second should be part 0, slide 2 (time 120)
    expect(consolidated[1].slide_number).toBe(2);
    expect(consolidated[1].part).toBe(0);

    // Third should be part 1, slide 3
    expect(consolidated[2].slide_number).toBe(3);
    expect(consolidated[2].part).toBe(1);
  });

  it('deduplicates identical slides from overlapping chunk windows', () => {
    const listA: SlideAlignment[] = [
      {
        slide_number: 4,
        title: 'Teorema di Parseval',
        part: 0,
        start_time_seconds: 500,
        end_time_seconds: 700,
        summary: 'Conservazione dell\'energia nel dominio trasformato.',
      },
    ];

    const listB: SlideAlignment[] = [
      {
        slide_number: 4,
        title: 'Teorema di Parseval',
        part: 0,
        start_time_seconds: 500,
        end_time_seconds: 700,
        summary: 'Conservazione dell\'energia nel dominio trasformato.',
      },
    ];

    const consolidated = consolidateSlidesAlignment([listA, listB]);
    expect(consolidated.length).toBe(1);
    expect(consolidated[0].slide_number).toBe(4);
  });

  it('handles negative or invalid seconds defensively', () => {
    const malformed: SlideAlignment[] = [
      {
        slide_number: 5,
        title: 'Filtri IIR',
        part: 0,
        start_time_seconds: -30,
        end_time_seconds: -10,
        summary: 'Stabilità e posizionamento dei poli.',
      },
    ];

    const consolidated = consolidateSlidesAlignment([malformed]);
    expect(consolidated.length).toBe(1);
    expect(consolidated[0].start_time_seconds).toBe(0);
    expect(consolidated[0].end_time_seconds).toBe(0);
  });

  it('handles empty lists gracefully', () => {
    const consolidated = consolidateSlidesAlignment([]);
    expect(consolidated).toEqual([]);
  });
});

describe('slides-alignment: Active slide tracking logic', () => {
  const slides: SlideAlignment[] = [
    {
      slide_number: 1,
      title: 'Intro',
      part: 0,
      start_time_seconds: 0,
      end_time_seconds: 60,
      summary: 'Intro',
    },
    {
      slide_number: 2,
      title: 'Formule Fondamentali',
      part: 0,
      start_time_seconds: 60,
      end_time_seconds: 180,
      summary: 'Formule',
    },
    {
      slide_number: 3,
      title: 'Esercizio Pratico',
      part: 1,
      start_time_seconds: 0,
      end_time_seconds: 120,
      summary: 'Esercizio',
    },
  ];

  function findActiveSlide(
    list: SlideAlignment[],
    time: number,
    partIndex: number
  ): SlideAlignment | undefined {
    return list.find(
      (s) => s.part === partIndex && time >= s.start_time_seconds && time <= s.end_time_seconds
    );
  }

  it('correctly tracks active slide in part 0', () => {
    const activeAt30 = findActiveSlide(slides, 30, 0);
    expect(activeAt30?.slide_number).toBe(1);

    const activeAt90 = findActiveSlide(slides, 90, 0);
    expect(activeAt90?.slide_number).toBe(2);
  });

  it('correctly distinguishes slides across different audio parts', () => {
    const activePart1 = findActiveSlide(slides, 50, 1);
    expect(activePart1?.slide_number).toBe(3);

    const activePart0At50 = findActiveSlide(slides, 50, 0);
    expect(activePart0At50?.slide_number).toBe(1);
  });

  it('returns undefined when playback is outside any slide interval', () => {
    const activeAt999 = findActiveSlide(slides, 999, 0);
    expect(activeAt999).toBeUndefined();
  });
});
