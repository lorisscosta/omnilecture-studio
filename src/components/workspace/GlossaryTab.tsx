'use client';

import React, { useState } from 'react';
import { GlossaryTerm } from '@/lib/types';
import { Search, BookOpen, Copy, Check } from 'lucide-react';

interface GlossaryTabProps {
  glossary: GlossaryTerm[];
}

export const GlossaryTab: React.FC<GlossaryTabProps> = ({ glossary }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedTerm, setCopiedTerm] = useState<string | null>(null);

  const handleCopy = (term: string, textToCopy: string) => {
    navigator.clipboard.writeText(textToCopy);
    setCopiedTerm(term);
    setTimeout(() => setCopiedTerm(null), 2000);
  };

  const filteredGlossary = glossary.filter((item) => {
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    return (
      item.term_en.toLowerCase().includes(q) ||
      item.translation_it.toLowerCase().includes(q) ||
      item.academic_definition.toLowerCase().includes(q)
    );
  });

  return (
    <div className="max-w-4xl mx-auto space-y-4 py-2">
      {/* Header and Search */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-zinc-900 border border-obsidian-border rounded-xl p-4 shadow-md">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-purple-400" />
          <h2 className="text-base font-bold text-zinc-100">
            Glossario Tecnico Accademico (EN ➔ IT)
          </h2>
          <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full font-mono">
            {glossary.length} termini
          </span>
        </div>

        <div className="relative min-w-[260px]">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Cerca termine o definizione..."
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-700 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-purple-500"
          />
        </div>
      </div>

      {/* Glossary Cards / Table */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredGlossary.length === 0 ? (
          <div className="col-span-2 text-center py-12 text-zinc-500 text-sm">
            Nessun termine trovato.
          </div>
        ) : (
          filteredGlossary.map((item, idx) => (
            <div
              key={idx}
              className="rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-4 shadow-md hover:border-zinc-700 transition flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="flex-1">
                    <span className="text-xs font-semibold text-purple-400 uppercase tracking-wider">
                      Termine Inglese
                    </span>
                    <h3 className="text-base font-bold text-zinc-100">{item.term_en}</h3>
                  </div>

                  <button
                    onClick={() => handleCopy(item.term_en, `${item.term_en} (${item.translation_it}): ${item.academic_definition}`)}
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition"
                    title="Copia termine e definizione"
                  >
                    {copiedTerm === item.term_en ? (
                      <Check className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>

                <div className="mb-3">
                  <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">
                    Traduzione Italiana
                  </span>
                  <p className="text-sm font-semibold text-indigo-200">{item.translation_it}</p>
                </div>

                <div className="pt-2 border-t border-zinc-800/60">
                  <p className="text-xs text-zinc-300 leading-relaxed">
                    {item.academic_definition}
                  </p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
