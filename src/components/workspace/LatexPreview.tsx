'use client';

import React, { useState, useEffect, useRef } from 'react';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer';
import { Clock, BookOpen, Layers } from 'lucide-react';

interface LatexPreviewProps {
  latexContent: string;
  onSeek?: (seconds: number, partIndex?: number) => void;
}

function formatSecondsToTimestamp(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

interface LazyLatexSectionProps {
  children: React.ReactNode;
  initialVisible?: boolean;
}

const LazyLatexSection: React.FC<LazyLatexSectionProps> = ({ children, initialVisible = false }) => {
  const [isVisible, setIsVisible] = useState(initialVisible);
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isVisible) return;
    const el = sectionRef.current;
    if (!el) return;

    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '600px 0px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [isVisible]);

  return (
    <div ref={sectionRef} className="latex-section-block min-h-[30px]">
      {isVisible ? children : <div className="h-16 animate-pulse bg-zinc-900/30 rounded-xl my-3" />}
    </div>
  );
};

interface LatexToken {
  id: string;
  type: 'md' | 'ts';
  content?: string;
  part?: number;
  seconds?: number;
  formatted?: string;
}

function parseLatexTokens(rawLatex: string): LatexToken[][] {
  // 1. Extract body between \begin{document} and \end{document}
  let body = rawLatex;
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
    .replace(/\s*\\ts\{\d+\}\{\d+\}/g, '')
    .trim();

  // 2. Convert LaTeX environments to KaTeX-ready Markdown blocks
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
  const tokens: LatexToken[] = [];
  const tsRegex = /\\ts\{(\d+)\}\{(\d+)\}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tsRegex.exec(body)) !== null) {
    const textBefore = body.slice(lastIndex, match.index);
    if (textBefore) {
      tokens.push({
        id: `md-${lastIndex}`,
        type: 'md',
        content: textBefore,
      });
    }

    const part = parseInt(match[1], 10);
    const seconds = parseInt(match[2], 10);
    const formatted = formatSecondsToTimestamp(seconds);

    tokens.push({
      id: `ts-${match.index}`,
      type: 'ts',
      part,
      seconds,
      formatted,
    });

    lastIndex = match.index + match[0].length;
  }

  const remainingText = body.slice(lastIndex);
  if (remainingText) {
    tokens.push({
      id: `md-${lastIndex}`,
      type: 'md',
      content: remainingText,
    });
  }

  // Chunk tokens into groups of 6 for lazy progressive KaTeX rendering
  const CHUNK_SIZE = 6;
  const chunked: LatexToken[][] = [];
  for (let i = 0; i < tokens.length; i += CHUNK_SIZE) {
    chunked.push(tokens.slice(i, i + CHUNK_SIZE));
  }

  return chunked;
}

/**
 * Parses LaTeX content, converts standard LaTeX structures into markdown/HTML
 * compatible with KaTeX, and makes \\ts{part}{seconds} interactive.
 */
export const LatexPreview: React.FC<LatexPreviewProps> = React.memo(({ latexContent, onSeek }) => {
  const tokenChunks = React.useMemo(() => {
    if (!latexContent || !latexContent.trim()) return [];
    return parseLatexTokens(latexContent);
  }, [latexContent]);

  if (!latexContent || !latexContent.trim() || tokenChunks.length === 0) {
    return (
      <div className="p-8 text-center text-zinc-500 italic">
        Nessun contenuto LaTeX disponibile per l&apos;anteprima.
      </div>
    );
  }

  return (
    <div className="space-y-4 text-zinc-200 leading-relaxed font-sans">
      <div className="flex items-center gap-2 p-2.5 rounded-lg bg-purple-950/30 border border-purple-800/40 text-xs text-purple-300">
        <BookOpen className="w-4 h-4 text-purple-400 shrink-0" />
        <span>
          Anteprima accademica con formule matematiche KaTeX e rendering progressivo.
        </span>
      </div>
      <div className="prose prose-invert max-w-none space-y-4">
        {tokenChunks.map((chunk, idx) => (
          <LazyLatexSection key={`lazy-chunk-${idx}`} initialVisible={idx < 2}>
            {chunk.map((tok) => {
              if (tok.type === 'md' && tok.content) {
                return <MarkdownRenderer key={tok.id} content={tok.content} />;
              }
              if (tok.type === 'ts') {
                return (
                  <button
                    key={tok.id}
                    type="button"
                    onClick={() => onSeek?.(tok.seconds ?? 0, tok.part ?? 0)}
                    title={`Salta alla registrazione: Parte ${(tok.part ?? 0) + 1}, minuto ${tok.formatted}`}
                    className="inline-flex items-center gap-1 mx-1.5 px-2 py-0.5 rounded-md bg-purple-950/70 border border-purple-700/60 hover:border-purple-500 hover:bg-purple-900/90 text-[11px] font-mono font-medium text-purple-300 hover:text-white transition shadow-sm cursor-pointer select-none group align-middle"
                  >
                    <Clock className="w-3 h-3 text-purple-400 group-hover:scale-110 transition-transform" />
                    <span>P{(tok.part ?? 0) + 1}:{tok.formatted}</span>
                  </button>
                );
              }
              return null;
            })}
          </LazyLatexSection>
        ))}
      </div>
    </div>
  );
});

LatexPreview.displayName = 'LatexPreview';
