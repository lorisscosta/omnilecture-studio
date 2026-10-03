/**
 * LaTeX Syntax & Bracket Balance Linter
 * Performs client-side structural validation on LaTeX documents:
 * - Curly braces {} and bracket [] balancing
 * - LaTeX environment matching (\begin{env} vs \end{env})
 * - Math delimiter parity ($...$ and $$...$$)
 * - Timestamp citation extraction (\ts{part}{seconds})
 */

export interface LatexLintIssue {
  line: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  rule: 'brackets' | 'environments' | 'math-delimiters' | 'structure';
}

export interface LatexLintResult {
  isValid: boolean;
  errorsCount: number;
  warningsCount: number;
  issues: LatexLintIssue[];
}

export interface TimestampCitation {
  raw: string;
  part: number;
  seconds: number;
  index: number;
}

/**
 * Extracts all \ts{part}{seconds} citations from LaTeX content.
 */
export function extractTimestampCitations(latexContent: string): TimestampCitation[] {
  if (!latexContent) return [];

  const regex = /\\ts\{(\d+)\}\{(\d+)\}/g;
  const citations: TimestampCitation[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(latexContent)) !== null) {
    citations.push({
      raw: match[0],
      part: parseInt(match[1], 10),
      seconds: parseInt(match[2], 10),
      index: match.index,
    });
  }

  return citations;
}

/**
 * Ensures standard compile-safe timestamp macro is defined in the preamble.
 */
export function injectTimestampPreambleMacro(latexCode: string): string {
  if (!latexCode) return '';

  // Remove or neutralize any existing \marginpar in \ts definition so time references are not placed on the right
  let cleaned = latexCode.replace(
    /\\(providecommand|newcommand)\{\\ts\}\[2\]\{[\s\S]*?\\marginpar[\s\S]*?\}/g,
    '\\providecommand{\\ts}[2]{}'
  );

  const macroDefinition = `\\providecommand{\\ts}[2]{}`;

  if (cleaned.includes('\\providecommand{\\ts}') || cleaned.includes('\\newcommand{\\ts}')) {
    return cleaned;
  }

  if (cleaned.includes('\\begin{document}')) {
    return cleaned.replace(
      '\\begin{document}',
      `% Macro citazione temporale (neutra: nessun riferimento temporale a destra)\n${macroDefinition}\n\n\\begin{document}`
    );
  }

  return `${macroDefinition}\n\n${cleaned}`;
}

/**
 * Comprehensive syntax and structural linter for LaTeX documents.
 */
export function lintLatex(latexCode: string): LatexLintResult {
  const issues: LatexLintIssue[] = [];
  if (!latexCode || !latexCode.trim()) {
    return { isValid: true, errorsCount: 0, warningsCount: 0, issues: [] };
  }

  const lines = latexCode.split('\n');

  // 1. Bracket & Brace Tracking
  const braceStack: Array<{ char: string; line: number; col: number }> = [];
  const bracketStack: Array<{ char: string; line: number; col: number }> = [];

  // 2. Environment Tracking
  interface EnvEntry {
    name: string;
    line: number;
  }
  const envStack: EnvEntry[] = [];

  // Ignore commented parts (% ...)
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const lineNumber = lineIdx + 1;
    const rawLine = lines[lineIdx];

    // Strip comments not escaped by backslash
    let inEscape = false;
    let commentIdx = -1;
    for (let c = 0; c < rawLine.length; c++) {
      if (rawLine[c] === '\\') {
        inEscape = !inEscape;
      } else {
        if (rawLine[c] === '%' && !inEscape) {
          commentIdx = c;
          break;
        }
        inEscape = false;
      }
    }

    const lineText = commentIdx !== -1 ? rawLine.slice(0, commentIdx) : rawLine;

    // Check Environments: \begin{env} and \end{env}
    const beginRegex = /\\begin\{([a-zA-Z*0-9]+)\}/g;
    let bMatch: RegExpExecArray | null;
    while ((bMatch = beginRegex.exec(lineText)) !== null) {
      envStack.push({ name: bMatch[1], line: lineNumber });
    }

    const endRegex = /\\end\{([a-zA-Z*0-9]+)\}/g;
    let eMatch: RegExpExecArray | null;
    while ((eMatch = endRegex.exec(lineText)) !== null) {
      const closedEnv = eMatch[1];
      if (envStack.length === 0) {
        issues.push({
          line: lineNumber,
          severity: 'error',
          rule: 'environments',
          message: `Chiusura ambiente imprevista: \\end{${closedEnv}} senza corrispondente \\begin.`,
        });
      } else {
        const topEnv = envStack.pop()!;
        if (topEnv.name !== closedEnv) {
          issues.push({
            line: lineNumber,
            severity: 'error',
            rule: 'environments',
            message: `Disallineamento ambienti: aperto \\begin{${topEnv.name}} (riga ${topEnv.line}), ma chiuso con \\end{${closedEnv}}.`,
          });
        }
      }
    }

    // Check Single Line Math Delimiters ($...$)
    // Count unescaped dollar signs
    let unescapedDollarCount = 0;
    for (let i = 0; i < lineText.length; i++) {
      if (lineText[i] === '$') {
        // check if escaped
        let backslashCount = 0;
        let k = i - 1;
        while (k >= 0 && lineText[k] === '\\') {
          backslashCount++;
          k--;
        }
        if (backslashCount % 2 === 0) {
          unescapedDollarCount++;
        }
      }
    }

    // Single line math parity warning if odd number of $ on a single line (and not part of block $$)
    const isDoubleDollarLine = lineText.includes('$$');
    if (!isDoubleDollarLine && unescapedDollarCount % 2 !== 0) {
      issues.push({
        line: lineNumber,
        severity: 'warning',
        rule: 'math-delimiters',
        message: `Numero dispari di delimitatori matematici '$' (${unescapedDollarCount}) sulla riga.`,
      });
    }

    // Check Brackets & Braces
    for (let col = 0; col < lineText.length; col++) {
      const char = lineText[col];
      const prevChar = col > 0 ? lineText[col - 1] : '';

      // Skip escaped braces \{ or \}
      if (prevChar === '\\') continue;

      if (char === '{') {
        braceStack.push({ char, line: lineNumber, col: col + 1 });
      } else if (char === '}') {
        if (braceStack.length === 0) {
          issues.push({
            line: lineNumber,
            severity: 'error',
            rule: 'brackets',
            message: `Parentesi graffa chiusa '}' senza corrispondente apertura a riga ${lineNumber}.`,
          });
        } else {
          braceStack.pop();
        }
      } else if (char === '[') {
        bracketStack.push({ char, line: lineNumber, col: col + 1 });
      } else if (char === ']') {
        if (bracketStack.length === 0) {
          issues.push({
            line: lineNumber,
            severity: 'warning',
            rule: 'brackets',
            message: `Parentesi quadra chiusa ']' senza corrispondente apertura a riga ${lineNumber}.`,
          });
        } else {
          bracketStack.pop();
        }
      }
    }
  }

  // Report remaining unclosed braces
  for (const unclosed of braceStack) {
    issues.push({
      line: unclosed.line,
      severity: 'error',
      rule: 'brackets',
      message: `Parentesi graffa aperta '{' non chiusa (riga ${unclosed.line}, colonna ${unclosed.col}).`,
    });
  }

  // Report remaining unclosed brackets
  for (const unclosed of bracketStack) {
    issues.push({
      line: unclosed.line,
      severity: 'warning',
      rule: 'brackets',
      message: `Parentesi quadra aperta '[' non chiusa (riga ${unclosed.line}, colonna ${unclosed.col}).`,
    });
  }

  // Report unclosed environments
  for (const unclosedEnv of envStack) {
    issues.push({
      line: unclosedEnv.line,
      severity: 'error',
      rule: 'environments',
      message: `Ambiente \\begin{${unclosedEnv.name}} aperto a riga ${unclosedEnv.line} non chiuso prima della fine del file.`,
    });
  }

  const errorsCount = issues.filter((i) => i.severity === 'error').length;
  const warningsCount = issues.filter((i) => i.severity === 'warning').length;

  return {
    isValid: errorsCount === 0,
    errorsCount,
    warningsCount,
    issues: issues.sort((a, b) => a.line - b.line),
  };
}
