import { describe, it, expect } from 'vitest';
import {
  lintLatex,
  extractTimestampCitations,
  injectTimestampPreambleMacro,
} from '../src/lib/latex-linter';

describe('LaTeX Linter & Timestamp Macro Suite', () => {
  describe('extractTimestampCitations', () => {
    it('extracts multiple timestamp citations correctly', () => {
      const latex = `
        \\section{Introduzione}
        Come spiegato dal docente \\ts{0}{120}, consideriamo il segnale $x(t)$.
        Nella dimostrazione del teorema fondamentale \\ts{1}{450}:
        \\begin{equation}
          X(\\omega) = \\int_{-\\infty}^\\infty x(t) e^{-j\\omega t} dt
        \\end{equation}
      `;
      const citations = extractTimestampCitations(latex);
      expect(citations.length).toBe(2);
      expect(citations[0]).toEqual({
        raw: '\\ts{0}{120}',
        part: 0,
        seconds: 120,
        index: expect.any(Number),
      });
      expect(citations[1]).toEqual({
        raw: '\\ts{1}{450}',
        part: 1,
        seconds: 450,
        index: expect.any(Number),
      });
    });

    it('returns empty array when no citations are present', () => {
      expect(extractTimestampCitations('\\section{Test}')).toEqual([]);
      expect(extractTimestampCitations('')).toEqual([]);
    });
  });

  describe('injectTimestampPreambleMacro', () => {
    it('injects macro before \\begin{document} when present', () => {
      const code = `\\documentclass{article}\n\\begin{document}\nContenuto\n\\end{document}`;
      const result = injectTimestampPreambleMacro(code);
      expect(result).toContain('\\providecommand{\\ts}[2]');
      expect(result).toContain('\\begin{document}');
      expect(result.indexOf('\\providecommand{\\ts}')).toBeLessThan(result.indexOf('\\begin{document}'));
    });

    it('does not duplicate macro if already defined', () => {
      const code = `\\documentclass{article}\n\\providecommand{\\ts}[2]{}\n\\begin{document}\nContenuto\n\\end{document}`;
      const result = injectTimestampPreambleMacro(code);
      const matches = result.match(/\\providecommand\{\\ts\}/g);
      expect(matches?.length).toBe(1);
    });
  });

  describe('lintLatex', () => {
    it('passes for valid balanced LaTeX with math, environments, and braces', () => {
      const validLatex = `
        \\documentclass{article}
        \\usepackage{amsmath}
        \\begin{document}
        \\section{Teorema}
        Dato $x \\in \\mathbb{R}$ e la matrice $A$:
        \\begin{equation}
          A x = \\lambda x
        \\end{equation}
        \\begin{theorem}[Esistenza]
          Esiste almeno una soluzione.
        \\end{theorem}
        \\end{document}
      `;
      const result = lintLatex(validLatex);
      expect(result.isValid).toBe(true);
      expect(result.errorsCount).toBe(0);
      expect(result.warningsCount).toBe(0);
    });

    it('detects unclosed curly braces', () => {
      const brokenLatex = `
        \\section{Test
        Testo senza chiusura graffa.
      `;
      const result = lintLatex(brokenLatex);
      expect(result.isValid).toBe(false);
      expect(result.errorsCount).toBeGreaterThan(0);
      expect(result.issues.some((i) => i.rule === 'brackets' && i.message.includes("Parentesi graffa aperta '{' non chiusa"))).toBe(true);
    });

    it('detects unexpected closing braces', () => {
      const brokenLatex = `
        \\section{Test}}
      `;
      const result = lintLatex(brokenLatex);
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.rule === 'brackets' && i.message.includes("Parentesi graffa chiusa '}' senza corrispondente apertura"))).toBe(true);
    });

    it('detects unclosed LaTeX environments', () => {
      const brokenLatex = `
        \\begin{document}
        \\begin{equation}
          E = mc^2
        \\end{document}
      `;
      const result = lintLatex(brokenLatex);
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.rule === 'environments' && i.message.includes('Disallineamento ambienti'))).toBe(true);
    });

    it('warns about odd unescaped dollar signs on a single line', () => {
      const brokenMath = `
        La variabile $x è definita nel campo reale.
      `;
      const result = lintLatex(brokenMath);
      expect(result.warningsCount).toBeGreaterThan(0);
      expect(result.issues.some((i) => i.rule === 'math-delimiters')).toBe(true);
    });

    it('ignores braces and environments inside LaTeX comments', () => {
      const commentedLatex = `
        \\section{Titolo}
        % \\begin{broken} { { {
        % Questa riga ha parentesi sbilanciate $ ma è un commento
        Testo regolare $y = f(x)$.
      `;
      const result = lintLatex(commentedLatex);
      expect(result.isValid).toBe(true);
      expect(result.errorsCount).toBe(0);
      expect(result.warningsCount).toBe(0);
    });
  });
});
