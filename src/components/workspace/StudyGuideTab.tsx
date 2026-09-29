'use client';

import React, { useState } from 'react';
import { LatexPreview } from './LatexPreview';
import { lintLatex, injectTimestampPreambleMacro, LatexLintResult } from '@/lib/latex-linter';
import { ExamQuestion } from '@/lib/types';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer';
import {
  HelpCircle,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Copy,
  Check,
  Download,
  FileCode,
  Eye,
  AlertTriangle,
  CheckCircle,
  AlertCircle,
  Info,
  ShieldCheck,
} from 'lucide-react';

interface StudyGuideTabProps {
  studyGuideIt: string;
  examQuestions: ExamQuestion[];
  lectureTitle?: string;
  course?: string;
  onSeek?: (seconds: number, partIndex?: number) => void;
}

// Helper to convert or ensure full Overleaf-ready LaTeX document
function formatToOverleafLatex(content: string, title?: string, course?: string): string {
  if (!content) return '';
  let cleaned = content.trim();

  // Strip markdown code fences if wrapped in ```latex or ```
  if (cleaned.startsWith('```latex')) {
    cleaned = cleaned.replace(/^```latex\s*/i, '').replace(/\s*```$/, '').trim();
  } else if (cleaned.startsWith('```tex')) {
    cleaned = cleaned.replace(/^```tex\s*/i, '').replace(/\s*```$/, '').trim();
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
  }

  // If already contains documentclass, inject timestamp macro if missing and return
  if (cleaned.includes('\\documentclass')) {
    return injectTimestampPreambleMacro(cleaned);
  }

  // Otherwise convert Markdown notes to valid LaTeX article
  const docTitle = (title || 'Lezione Magistrale').replace(/[_#%$&]/g, '\\$&');
  const docCourse = (course || 'Ingegneria / STEM').replace(/[_#%$&]/g, '\\$&');

  // Convert markdown headings to LaTeX sections
  const latexBody = cleaned
    .replace(/^#\s+(.+)$/gm, '\\section{$1}')
    .replace(/^##\s+(.+)$/gm, '\\subsection{$1}')
    .replace(/^###\s+(.+)$/gm, '\\subsubsection{$1}')
    .replace(/\*\*(.+?)\*\*/g, '\\textbf{$1}')
    .replace(/\*(.+?)\*/g, '\\textit{$1}')
    .replace(/^>\s*\[!important\]\s*(.+)$/gm, '\\begin{quote}\n\\textbf{Nota Fondamentale:}\\\\ $1')
    .replace(/^>\s*\[!tip\]\s*(.+)$/gm, '\\begin{quote}\n\\textbf{Suggerimento:}\\\\ $1')
    .replace(/^>\s*\[!note\]\s*(.+)$/gm, '\\begin{quote}\n\\textbf{Nota:}\\\\ $1')
    .replace(/^>\s*(.+)$/gm, '$1\n\\end{quote}');

  const fullDoc = `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[italian]{babel}
\\usepackage{amsmath,amssymb,amsthm,mathtools}
\\usepackage{geometry}
\\geometry{a4paper, margin=2.5cm}
\\usepackage{hyperref}
\\usepackage{xcolor}
\\usepackage{microtype}

\\hypersetup{
    colorlinks=true,
    linkcolor=blue!70!black,
    citecolor=green!50!black,
    urlcolor=purple!70!black
}

% Macro citazione temporale (sicura per Overleaf / pdflatex)
\\providecommand{\\ts}[2]{\\ifmmode\\text{\\scriptsize\\texttt{[P#1:#2s]}}\\else\\marginpar{\\scriptsize\\texttt{P#1:#2s}}\\fi}

\\newtheorem{theorem}{Teorema}[section]
\\newtheorem{definition}{Definizione}[section]
\\newtheorem{lemma}{Lemma}[section]
\\newtheorem{corollary}{Corollario}[section]

\\title{\\textbf{${docTitle}}\\\\ \\large \\textit{Corso di ${docCourse}}}
\\author{OmniLecture Studio \\and Trascrizione Accademica}
\\date{\\today}

\\begin{document}
\\maketitle
\\tableofcontents
\\vspace{1cm}
\\hrule
\\vspace{0.5cm}

${latexBody}

\\end{document}
`;

  return fullDoc;
}

export const StudyGuideTab: React.FC<StudyGuideTabProps> = ({
  studyGuideIt,
  examQuestions,
  lectureTitle,
  course,
  onSeek,
}) => {
  const [expandedQuestions, setExpandedQuestions] = useState<Record<number, boolean>>({});
  const [viewMode, setViewMode] = useState<'latex' | 'preview'>('preview');
  const [isCopied, setIsCopied] = useState(false);
  const [showLintDrawer, setShowLintDrawer] = useState(false);

  const overleafLatex = formatToOverleafLatex(studyGuideIt, lectureTitle, course);
  const lintResult: LatexLintResult = lintLatex(overleafLatex);

  const toggleQuestion = (index: number) => {
    setExpandedQuestions((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  const handleCopyLatex = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(overleafLatex);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = overleafLatex;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2500);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  const handleDownloadTex = () => {
    const safeTitle = (lectureTitle || 'lezione')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_');
    const fileName = `${safeTitle}_overleaf.tex`;
    const blob = new Blob([overleafLatex], { type: 'application/x-tex;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 sm:space-y-8 max-w-5xl mx-auto py-1 sm:py-2">
      {/* Overleaf LaTeX Header & Studio Guide */}
      <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-3.5 sm:p-5 md:p-7 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-5 pb-3 sm:pb-4 border-b border-zinc-800">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg sm:text-xl">📄</span>
              <h2 className="text-base sm:text-lg md:text-xl font-bold text-zinc-100">
                Trascrizione Integrale & Guida LaTeX per Overleaf
              </h2>
            </div>
            <p className="text-xs text-zinc-400">
              Documento <code className="text-purple-300 font-mono">.tex</code> compilabile in Overleaf con formule, citazioni temporali <code className="text-purple-300 font-mono">\ts&#123;p&#125;&#123;s&#125;</code> e notazione matematica.
            </p>
          </div>

          {/* Action Buttons: Copy & Download */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Linter Status Indicator */}
            <button
              type="button"
              onClick={() => setShowLintDrawer(!showLintDrawer)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
                lintResult.errorsCount > 0
                  ? 'bg-rose-950/60 border-rose-800 text-rose-300 hover:bg-rose-900/60'
                  : lintResult.warningsCount > 0
                  ? 'bg-amber-950/60 border-amber-800 text-amber-300 hover:bg-amber-900/60'
                  : 'bg-emerald-950/60 border-emerald-800 text-emerald-300 hover:bg-emerald-900/60'
              }`}
              title="Verifica bilanciamento ambienti e parentesi LaTeX"
            >
              {lintResult.errorsCount > 0 ? (
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
              ) : lintResult.warningsCount > 0 ? (
                <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
              ) : (
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
              )}
              <span>
                {lintResult.errorsCount > 0
                  ? `${lintResult.errorsCount} Errori LaTeX`
                  : lintResult.warningsCount > 0
                  ? `${lintResult.warningsCount} Avvisi Sintassi`
                  : 'LaTeX Valido'}
              </span>
            </button>

            <button
              onClick={handleCopyLatex}
              className={`flex items-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl text-xs font-semibold shadow-md transition ${
                isCopied
                  ? 'bg-emerald-600 text-white shadow-emerald-900/30'
                  : 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-900/30'
              }`}
              title="Copia l'intero documento LaTeX per Overleaf"
            >
              {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{isCopied ? 'Copiato!' : 'Copia per Overleaf'}</span>
            </button>

            <button
              onClick={handleDownloadTex}
              className="flex items-center gap-1.5 px-3 py-1.5 sm:px-3 sm:py-2 rounded-xl text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition"
              title="Scarica il file sorgente .tex pronto all'uso"
            >
              <Download className="w-3.5 h-3.5 text-purple-400" />
              <span>Scarica .tex</span>
            </button>
          </div>
        </div>

        {/* Linter Diagnostic Drawer */}
        {showLintDrawer && (
          <div className="mb-4 p-4 rounded-xl bg-zinc-950 border border-zinc-800 text-xs space-y-2 animate-in fade-in duration-150">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-850">
              <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-purple-400" />
                Diagnostica Sintattica LaTeX
              </span>
              <button
                type="button"
                onClick={() => setShowLintDrawer(false)}
                className="text-zinc-500 hover:text-zinc-300"
              >
                ✕
              </button>
            </div>
            {lintResult.issues.length === 0 ? (
              <p className="text-emerald-400 py-1 flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4" />
                Tutte le parentesi, ambienti e delimitatori matematici sono perfettamente bilanciati!
              </p>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {lintResult.issues.map((issue, idx) => (
                  <div
                    key={idx}
                    className={`flex items-start gap-2 p-2 rounded-lg border ${
                      issue.severity === 'error'
                        ? 'bg-rose-950/30 border-rose-900/50 text-rose-300'
                        : 'bg-amber-950/30 border-amber-900/50 text-amber-300'
                    }`}
                  >
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 shrink-0">
                      Riga {issue.line}
                    </span>
                    <span className="flex-1">{issue.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* View Toggle Bar */}
        <div className="flex items-center justify-between gap-2 mb-3 sm:mb-4 bg-zinc-950 p-1 sm:p-1.5 rounded-xl border border-zinc-800/80">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setViewMode('preview')}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                viewMode === 'preview'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span><span className="hidden sm:inline">Anteprima </span>KaTeX Interattiva</span>
            </button>
            <button
              onClick={() => setViewMode('latex')}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                viewMode === 'latex'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span><span className="hidden sm:inline">Sorgente </span>LaTeX (.tex)</span>
            </button>
          </div>

          <span className="text-[11px] font-mono text-zinc-500 hidden sm:inline-block pr-2">
            {overleafLatex.split('\n').length} righe LaTeX
          </span>
        </div>

        {/* Body Content */}
        {viewMode === 'latex' ? (
          <div className="relative rounded-xl border border-zinc-800 bg-[#0d0d10] p-3 sm:p-4 overflow-hidden">
            <pre className="text-[11px] sm:text-xs font-mono text-emerald-300/90 whitespace-pre-wrap break-words leading-relaxed max-h-[600px] overflow-y-auto selection:bg-purple-800 selection:text-white">
              {overleafLatex || '% Nessun codice LaTeX disponibile per questa lezione.'}
            </pre>
          </div>
        ) : (
          <div className="p-3.5 sm:p-5 rounded-xl border border-zinc-800 bg-zinc-950/60 max-h-[750px] overflow-y-auto">
            <LatexPreview latexContent={overleafLatex} onSeek={onSeek} />
          </div>
        )}
      </div>

      {/* Potential Exam Questions Section */}
      {examQuestions && examQuestions.length > 0 && (
        <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 sm:p-6 md:p-8 shadow-xl">
          <div className="flex items-center justify-between mb-6 pb-4 border-b border-zinc-800">
            <div className="flex items-center gap-2">
              <span className="text-xl">🎯</span>
              <h3 className="text-xl font-bold text-zinc-100">Domande Tipiche d&apos;Esame</h3>
            </div>
            <span className="text-xs text-zinc-400">
              {examQuestions.length} quesiti con passaggi matematici
            </span>
          </div>

          <div className="space-y-4">
            {examQuestions.map((q, idx) => {
              const isOpen = !!expandedQuestions[idx];
              const badgeColor =
                q.importance_level === 'Crucial'
                  ? 'bg-rose-950 text-rose-300 border-rose-800'
                  : q.importance_level === 'High'
                  ? 'bg-amber-950 text-amber-300 border-amber-800'
                  : 'bg-emerald-950 text-emerald-300 border-emerald-800';

              return (
                <div
                  key={idx}
                  className="rounded-xl border border-zinc-800 bg-zinc-950/70 overflow-hidden transition"
                >
                  <button
                    onClick={() => toggleQuestion(idx)}
                    className="w-full flex items-center justify-between p-4 text-left hover:bg-zinc-900/50 transition gap-4"
                  >
                    <div className="flex items-start gap-3">
                      <HelpCircle className="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-semibold text-zinc-400">
                            Quesito #{idx + 1}
                          </span>
                          <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${badgeColor}`}>
                            {q.importance_level}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-zinc-200">{q.question}</p>
                      </div>
                    </div>
                    <div className="text-zinc-400 shrink-0">
                      {isOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="p-4 pt-2 border-t border-zinc-800/80 bg-zinc-900/40 animate-in fade-in duration-150">
                      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-purple-300 uppercase tracking-wide">
                        <CheckCircle2 className="w-3.5 h-3.5 text-purple-400" />
                        <span>Soluzione e Dimostrazione Accademica</span>
                      </div>
                      <div className="text-sm">
                        <MarkdownRenderer content={q.answer_latex} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
