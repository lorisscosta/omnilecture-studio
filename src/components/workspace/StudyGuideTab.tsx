'use client';

import React, { useState } from 'react';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer';
import { ExamQuestion } from '@/lib/types';
import { HelpCircle, ChevronDown, ChevronUp, AlertCircle, CheckCircle2 } from 'lucide-react';

interface StudyGuideTabProps {
  studyGuideIt: string;
  examQuestions: ExamQuestion[];
}

export const StudyGuideTab: React.FC<StudyGuideTabProps> = ({ studyGuideIt, examQuestions }) => {
  const [expandedQuestions, setExpandedQuestions] = useState<Record<number, boolean>>({});

  const toggleQuestion = (index: number) => {
    setExpandedQuestions((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  return (
    <div className="space-y-8 max-w-4xl mx-auto py-2">
      {/* Italian Academic Study Guide */}
      <div className="bg-zinc-900/90 border border-obsidian-border rounded-2xl p-6 md:p-8 shadow-xl">
        <div className="flex items-center gap-2 mb-6 pb-4 border-b border-zinc-800">
          <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
            <span>📖</span> Guida allo Studio e Appunti Accademici
          </h2>
          <span className="text-xs bg-purple-950 text-purple-300 border border-purple-800/60 px-2.5 py-0.5 rounded-full font-medium ml-auto">
            Italiano (LaTeX Native)
          </span>
        </div>

        {studyGuideIt ? (
          <MarkdownRenderer content={studyGuideIt} />
        ) : (
          <p className="text-zinc-500 italic text-sm">Nessuna guida generata per questa lezione.</p>
        )}
      </div>

      {/* Potential Exam Questions Section */}
      {examQuestions && examQuestions.length > 0 && (
        <div className="bg-zinc-900/90 border border-obsidian-border rounded-2xl p-6 md:p-8 shadow-xl">
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
