'use client';

import React from 'react';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer';
import { Clock, BookOpen } from 'lucide-react';

interface LatexPreviewProps {
  latexContent: string;
  onSeek?: (seconds: number, partIndex?: number) => void;
}

function formatSecondsToTimestamp(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Parses LaTeX content, converts standard LaTeX structures into markdown/HTML
 * compatible with KaTeX, and makes \\ts{part}{seconds} interactive.
 */
export const LatexPreview: React.FC<LatexPreviewProps> = ({ latexContent, onSeek }) => {
  if (!latexContent || !latexContent.trim()) {
    return (
      <div className="p-8 text-center text-zinc-500 italic">
        Nessun contenuto LaTeX disponibile per l&apos;anteprima.
      </div>
    );
  }

  // 1. Extract body between \begin{document} and \end{document}
  let body = latexContent;
  const docStart = body.indexOf('\\begin{document}');
  if (docStart !== -1) {
    body = body.slice(docStart + '\\begin{document}'.length);
  }
  const docEnd = body.indexOf('\\end{document}');
  if (docEnd !== -1) {
    body = body.slice(0, docEnd);
  }

  // Strip preamble commands that might appear in body
  body = body
    .replace(/\\maketitle/g, '')
    .replace(/\\tableofcontents/g, '')
    .replace(/\\vspace\{[^}]+\}/g, '')
    .replace(/\\hrule/g, '---')
    .replace(/\\noindent/g, '')
    .trim();

  // 2. Convert LaTeX environments to KaTeX-ready Markdown blocks
  // Equations
  body = body.replace(/\\begin\{equation\*?\}([\s\S]*?)\\end\{equation\*?\}/g, (_m, eq) => `\n\n$$\n${eq.trim()}\n$$\n\n`);
  body = body.replace(/\\\[([\s\S]*?)\\\]/g, (_m, eq) => `\n\n$$\n${eq.trim()}\n$$\n\n`);
  body = body.replace(/\\begin\{align\*?\}([\s\S]*?)\\end\{align\*?\}/g, (_m, eq) => `\n\n$$\\begin{aligned}\n${eq.trim()}\n\\end{aligned}$$\n\n`);

  // Theorems and Definitions
  body = body.replace(/\\begin\{theorem\}(\[[^\]]*\])?([\s\S]*?)\\end\{theorem\}/g, (_m, opt, content) => {
    const title = opt ? opt.slice(1, -1) : 'Teorema';
    return `\n\n> [!important] **${title}**\n> ${content.trim().replace(/\n/g, '\n> ')}\n\n`;
  });

  body = body.replace(/\\begin\{definition\}(\[[^\]]*\])?([\s\S]*?)\\end\{definition\}/g, (_m, opt, content) => {
    const title = opt ? opt.slice(1, -1) : 'Definizione';
    return `\n\n> [!note] **${title}**\n> ${content.trim().replace(/\n/g, '\n> ')}\n\n`;
  });

  body = body.replace(/\\begin\{lemma\}(\[[^\]]*\])?([\s\S]*?)\\end\{lemma\}/g, (_m, opt, content) => {
    const title = opt ? opt.slice(1, -1) : 'Lemma';
    return `\n\n> [!tip] **${title}**\n> ${content.trim().replace(/\n/g, '\n> ')}\n\n`;
  });

  body = body.replace(/\\begin\{proof\}([\s\S]*?)\\end\{proof\}/g, (_m, content) => {
    return `\n\n*Dimostrazione.* ${content.trim()} $\\blacksquare$\n\n`;
  });

  // Sections
  body = body.replace(/\\section\*?\{([^}]+)\}/g, '\n\n## $1\n\n');
  body = body.replace(/\\subsection\*?\{([^}]+)\}/g, '\n\n### $1\n\n');
  body = body.replace(/\\subsubsection\*?\{([^}]+)\}/g, '\n\n#### $1\n\n');

  // Text formatting
  body = body.replace(/\\textbf\{([^}]+)\}/g, '**$1**');
  body = body.replace(/\\textit\{([^}]+)\}/g, '*$1*');
  body = body.replace(/\\texttt\{([^}]+)\}/g, '`$1`');

  // Lists
  body = body.replace(/\\begin\{itemize\}/g, '\n');
  body = body.replace(/\\end\{itemize\}/g, '\n');
  body = body.replace(/\\begin\{enumerate\}/g, '\n');
  body = body.replace(/\\end\{enumerate\}/g, '\n');
  body = body.replace(/\\item\s+/g, '- ');

  // Interactive Timestamp Citations: \ts{part}{seconds}
  // We split text and inject clickable React buttons
  const segments: React.ReactNode[] = [];
  const tsRegex = /\\ts\{(\d+)\}\{(\d+)\}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tsRegex.exec(body)) !== null) {
    const textBefore = body.slice(lastIndex, match.index);
    if (textBefore) {
      segments.push(
        <MarkdownRenderer key={`md-${lastIndex}`} content={textBefore} />
      );
    }

    const part = parseInt(match[1], 10);
    const seconds = parseInt(match[2], 10);
    const formatted = formatSecondsToTimestamp(seconds);

    segments.push(
      <button
        key={`ts-${match.index}`}
        type="button"
        onClick={() => onSeek?.(seconds, part)}
        title={`Salta alla registrazione: Parte ${part + 1}, minuto ${formatted}`}
        className="inline-flex items-center gap-1 mx-1.5 px-2 py-0.5 rounded-md bg-purple-950/70 border border-purple-700/60 hover:border-purple-500 hover:bg-purple-900/90 text-[11px] font-mono font-medium text-purple-300 hover:text-white transition shadow-sm cursor-pointer select-none group align-middle"
      >
        <Clock className="w-3 h-3 text-purple-400 group-hover:scale-110 transition-transform" />
        <span>P{part + 1}:{formatted}</span>
      </button>
    );

    lastIndex = match.index + match[0].length;
  }

  const remainingText = body.slice(lastIndex);
  if (remainingText) {
    segments.push(
      <MarkdownRenderer key={`md-${lastIndex}`} content={remainingText} />
    );
  }

  return (
    <div className="space-y-4 text-zinc-200 leading-relaxed font-sans">
      <div className="flex items-center gap-2 p-2.5 rounded-lg bg-purple-950/30 border border-purple-800/40 text-xs text-purple-300">
        <BookOpen className="w-4 h-4 text-purple-400 shrink-0" />
        <span>
          Anteprima accademica con formule matematiche KaTeX. Clicca sui badge temporali per riprodurre l&apos;audio corrispondente.
        </span>
      </div>
      <div className="prose prose-invert max-w-none space-y-4">
        {segments}
      </div>
    </div>
  );
};
