'use client';

import React, { useState, useRef, useEffect } from 'react';
import { GlossaryTerm, Lecture, ChatMessage } from '@/lib/types';
import {
  Search,
  BookOpen,
  Copy,
  Check,
  MessageSquare,
  Sparkles,
  Send,
  Bot,
  User,
  Loader2,
  HelpCircle,
  ExternalLink,
} from 'lucide-react';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer';
import { appendChatMessage } from '@/lib/db';

interface GlossaryTabProps {
  glossary: GlossaryTerm[];
  lecture?: Lecture;
  onOpenSettings?: () => void;
}

export const GlossaryTab: React.FC<GlossaryTabProps> = ({
  glossary,
  lecture,
  onOpenSettings,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'glossary' | 'chat'>('glossary');
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedTerm, setCopiedTerm] = useState<string | null>(null);

  // Chat State
  const [messages, setMessages] = useState<ChatMessage[]>(lecture?.chatMessages || []);
  const [inputQuestion, setInputQuestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Sync messages if lecture changes
  useEffect(() => {
    if (lecture?.chatMessages) {
      setMessages(lecture.chatMessages);
    }
  }, [lecture?.id, lecture?.chatMessages]);

  useEffect(() => {
    if (activeSubTab === 'chat') {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading, activeSubTab]);

  const handleCopy = async (term: string, textToCopy: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = textToCopy;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedTerm(term);
      setTimeout(() => setCopiedTerm(null), 2000);
    } catch (err) {
      console.error('Failed to copy glossary term:', err);
    }
  };

  const handleAskAboutTerm = (term: GlossaryTerm) => {
    setActiveSubTab('chat');
    const prompt = `Spiegami in dettaglio il termine accademico "${term.term_en}" (${term.translation_it}) nel contesto di questa lezione e fornisci le relative equazioni matematiche.`;
    handleSend(prompt);
  };

  const quickPrompts = [
    'Spiegami il teorema e la dimostrazione principale trattata nella lezione.',
    'Quali sono i termini tecnici più importanti per l\'esame orale?',
    'Forniscimi un riassunto formale delle equazioni matematiche chiave.',
  ];

  const handleSend = async (questionText?: string) => {
    const textToSend = questionText || inputQuestion;
    if (!textToSend.trim() || isLoading) return;

    const apiKey = typeof window !== 'undefined' ? localStorage.getItem('gemini_api_key') : null;
    if (!apiKey) {
      onOpenSettings?.();
      setErrorMsg('Chiave API Google AI Studio necessaria per chattare con la lezione.');
      return;
    }

    if (!lecture) return;

    setErrorMsg(null);
    setInputQuestion('');

    const userMessage: ChatMessage = {
      id: 'msg_' + Date.now(),
      role: 'user',
      content: textToSend.trim(),
      timestamp: new Date().toISOString(),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    await appendChatMessage(lecture.id, userMessage);

    setIsLoading(true);

    try {
      const response = await fetch('/api/gemini/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-gemini-api-key': apiKey,
        },
        body: JSON.stringify({
          lectureTitle: lecture.title,
          course: lecture.course,
          studyGuide: lecture.data?.study_guide_it || '',
          glossary: lecture.data?.glossary || [],
          messages: messages.slice(-6),
          question: textToSend.trim(),
        }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({ error: 'Errore API.' }));
        throw new Error(errJson.error || `Errore del server (${response.status})`);
      }

      const resData = await response.json();
      const assistantMessage: ChatMessage = {
        id: 'msg_' + (Date.now() + 1),
        role: 'assistant',
        content: resData.answer,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
      await appendChatMessage(lecture.id, assistantMessage);
    } catch (err: any) {
      console.error('Chat request failed:', err);
      setErrorMsg(err.message || 'Impossibile completare la risposta.');
    } finally {
      setIsLoading(false);
    }
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
      {/* Top Unified Switcher: Glossario Termini vs Chat con la Lezione */}
      <div className="flex items-center justify-between gap-3 bg-zinc-900 border border-obsidian-border rounded-xl p-2.5 shadow-md">
        <div className="flex items-center gap-1.5 bg-zinc-950 p-1 rounded-lg border border-zinc-800">
          <button
            onClick={() => setActiveSubTab('glossary')}
            className={`flex items-center gap-2 px-3.5 py-1.5 text-xs rounded-lg font-semibold transition ${
              activeSubTab === 'glossary'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Glossario Termini ({glossary.length})</span>
          </button>

          <button
            onClick={() => setActiveSubTab('chat')}
            className={`flex items-center gap-2 px-3.5 py-1.5 text-xs rounded-lg font-semibold transition ${
              activeSubTab === 'chat'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5 text-purple-300" />
            <span>Chat con la Lezione {messages.length > 0 && `(${messages.length})`}</span>
          </button>
        </div>

        {activeSubTab === 'glossary' && (
          <div className="relative min-w-[220px]">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Cerca termine o formula..."
              className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-700 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-purple-500"
            />
          </div>
        )}
      </div>

      {/* Sub-View 1: Glossario Cards */}
      {activeSubTab === 'glossary' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredGlossary.length === 0 ? (
              <div className="col-span-2 text-center py-12 text-zinc-500 text-sm bg-zinc-900/60 rounded-xl border border-zinc-800">
                Nessun termine accademico trovato.
              </div>
            ) : (
              filteredGlossary.map((item, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-zinc-800/80 bg-zinc-900/70 p-4 shadow-md hover:border-zinc-700 transition flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="flex-1">
                        <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider">
                          Termine Originale / Inglese
                        </span>
                        <h3 className="text-base font-bold text-zinc-100">{item.term_en}</h3>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleAskAboutTerm(item)}
                          className="p-1.5 rounded-lg text-purple-300 hover:text-white hover:bg-purple-950/80 border border-purple-900/40 transition"
                          title="Chiedi spiegazioni al Tutor AI su questo termine"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() =>
                            handleCopy(
                              item.term_en,
                              `${item.term_en} (${item.translation_it}): ${item.academic_definition}`
                            )
                          }
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition"
                          title="Copia termine e definizione"
                        >
                          {copiedTerm === item.term_en ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="mb-2.5">
                      <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">
                        Traduzione Accademica Italiana
                      </span>
                      <p className="text-sm font-semibold text-indigo-200">{item.translation_it}</p>
                    </div>

                    <div className="pt-2 border-t border-zinc-800/60">
                      <p className="text-xs text-zinc-300 leading-relaxed font-sans">
                        {item.academic_definition}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 pt-2 flex justify-end">
                    <button
                      onClick={() => handleAskAboutTerm(item)}
                      className="text-[11px] font-medium text-purple-400 hover:text-purple-300 flex items-center gap-1 transition"
                    >
                      <span>Approfondisci nella Chat</span>
                      <span>→</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Sub-View 2: Chat con la Lezione (Integrata nel Glossario) */}
      {activeSubTab === 'chat' && (
        <div className="flex flex-col h-[75vh] min-h-[450px] max-h-[700px] bg-zinc-900 border border-obsidian-border rounded-2xl shadow-xl overflow-hidden">
          {/* Chat Sub-Header */}
          <div className="flex items-center justify-between px-3.5 sm:px-5 py-2.5 sm:py-3 border-b border-zinc-800 bg-zinc-900/90">
            <div className="flex items-center gap-2 sm:gap-2.5">
              <div className="p-1.5 rounded-lg bg-purple-950 text-purple-400 border border-purple-800/60">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs sm:text-sm font-bold text-zinc-100">
                  Tutor AI • Chat Lezione
                </h3>
                <p className="text-[10px] sm:text-[11px] text-zinc-400 line-clamp-1">
                  Risponde rigorosamente sui contenuti e sulle formule di questa registrazione
                </p>
              </div>
            </div>

            <button
              onClick={() => setActiveSubTab('glossary')}
              className="text-xs text-purple-400 hover:text-purple-300 font-medium shrink-0 ml-2"
            >
              ← Termini
            </button>
          </div>

          {/* Messages Scroll Area */}
          <div className="flex-1 overflow-y-auto p-3.5 sm:p-5 space-y-3 sm:space-y-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-4 py-8">
                <div className="p-3.5 rounded-2xl bg-zinc-950 border border-zinc-800 text-purple-400 shadow-inner">
                  <Bot className="w-7 h-7" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-zinc-200">
                    Fai qualsiasi domanda sulla lezione
                  </h4>
                  <p className="text-xs text-zinc-400 mt-1">
                    Il tutor analizzerà la trascrizione, la guida LaTeX e i termini del glossario per fornirti una risposta rigorosa.
                  </p>
                </div>

                {/* Quick Prompts */}
                <div className="w-full space-y-1.5 pt-2">
                  {quickPrompts.map((prompt, i) => (
                    <button
                      key={i}
                      onClick={() => handleSend(prompt)}
                      className="w-full text-left p-2.5 rounded-xl bg-zinc-950/80 hover:bg-purple-950/40 border border-zinc-800 hover:border-purple-800/60 text-xs text-zinc-300 transition"
                    >
                      💡 {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.role === 'assistant' && (
                    <div className="w-7 h-7 rounded-full bg-purple-900/60 border border-purple-700/50 flex items-center justify-center shrink-0 text-purple-300 mt-1">
                      <Bot className="w-3.5 h-3.5" />
                    </div>
                  )}

                  <div
                    className={`max-w-[85%] rounded-2xl p-3.5 text-sm shadow-md ${
                      msg.role === 'user'
                        ? 'bg-purple-600 text-white rounded-tr-none text-xs md:text-sm'
                        : 'bg-zinc-950 border border-zinc-800 text-zinc-200 rounded-tl-none text-xs md:text-sm'
                    }`}
                  >
                    {msg.role === 'assistant' ? (
                      <MarkdownRenderer content={msg.content} />
                    ) : (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    )}
                  </div>

                  {msg.role === 'user' && (
                    <div className="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0 text-zinc-300 mt-1">
                      <User className="w-3.5 h-3.5" />
                    </div>
                  )}
                </div>
              ))
            )}

            {isLoading && (
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-purple-900/60 border border-purple-700/50 flex items-center justify-center shrink-0 text-purple-300">
                  <Bot className="w-3.5 h-3.5" />
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-3 text-xs text-purple-300 flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" />
                  <span>Analisi degli appunti e calcolo risposta...</span>
                </div>
              </div>
            )}

            {errorMsg && (
              <div className="p-3 bg-rose-950/40 border border-rose-800/60 text-rose-300 rounded-xl text-xs">
                {errorMsg}
              </div>
            )}

            <div ref={chatBottomRef} />
          </div>

          {/* Chat Input Area */}
          <div className="p-3.5 border-t border-zinc-800 bg-zinc-900">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={inputQuestion}
                onChange={(e) => setInputQuestion(e.target.value)}
                disabled={isLoading}
                placeholder="Fai una domanda sulla lezione o su un termine..."
                className="flex-1 rounded-xl bg-zinc-950 border border-zinc-700 px-3.5 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!inputQuestion.trim() || isLoading}
                className="p-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-900/30 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
