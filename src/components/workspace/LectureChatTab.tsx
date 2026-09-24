'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles, Loader2, RefreshCw } from 'lucide-react';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer';
import { ChatMessage, Lecture } from '@/lib/types';
import { appendChatMessage } from '@/lib/db';

interface LectureChatTabProps {
  lecture: Lecture;
  onOpenSettings: () => void;
}

export const LectureChatTab: React.FC<LectureChatTabProps> = ({ lecture, onOpenSettings }) => {
  const [messages, setMessages] = useState<ChatMessage[]>(lecture.chatMessages || []);
  const [inputQuestion, setInputQuestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Sync messages if lecture changes
  useEffect(() => {
    setMessages(lecture.chatMessages || []);
  }, [lecture.id, lecture.chatMessages]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const quickPrompts = [
    'Spiegami il teorema e la dimostrazione principale della lezione.',
    'Quali sono le domande orali più probabili per questo argomento?',
    'Forniscimi un riassunto sintetico delle formule matematiche chiave.',
  ];

  const handleSend = async (questionText?: string) => {
    const textToSend = questionText || inputQuestion;
    if (!textToSend.trim() || isLoading) return;

    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) {
      onOpenSettings();
      setErrorMsg('Chiave API Google AI Studio necessaria per chattare con la lezione.');
      return;
    }

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
          messages: newMessages.slice(-6), // Send last few messages for continuity
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

  return (
    <div className="max-w-4xl mx-auto flex flex-col h-[700px] bg-zinc-900 border border-obsidian-border rounded-2xl shadow-xl overflow-hidden my-2">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/90">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-purple-950 text-purple-400 border border-purple-800/60">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-zinc-100">
              Tutor Intelligente sulla Lezione (RAG)
            </h2>
            <p className="text-xs text-zinc-400">
              Risponde esclusivamente sul materiale, formule e dimostrazioni di questa registrazione
            </p>
          </div>
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-4 py-8">
            <div className="p-4 rounded-2xl bg-zinc-950 border border-zinc-800 text-purple-400 shadow-inner">
              <Bot className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-zinc-200">
                Chiedi chiarimenti sulla lezione
              </h3>
              <p className="text-xs text-zinc-400 mt-1">
                Il tutor risponde in italiano con formule LaTeX matematiche verificate sui contenuti della lezione.
              </p>
            </div>

            {/* Quick Prompt Pills */}
            <div className="w-full space-y-2 pt-2">
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
                <div className="w-8 h-8 rounded-full bg-purple-900/60 border border-purple-700/50 flex items-center justify-center shrink-0 text-purple-300 mt-1">
                  <Bot className="w-4 h-4" />
                </div>
              )}

              <div
                className={`max-w-[85%] rounded-2xl p-4 text-sm shadow-md ${
                  msg.role === 'user'
                    ? 'bg-purple-600 text-white rounded-tr-none'
                    : 'bg-zinc-950 border border-zinc-800 text-zinc-200 rounded-tl-none'
                }`}
              >
                {msg.role === 'assistant' ? (
                  <MarkdownRenderer content={msg.content} />
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
              </div>

              {msg.role === 'user' && (
                <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0 text-zinc-300 mt-1">
                  <User className="w-4 h-4" />
                </div>
              )}
            </div>
          ))
        )}

        {isLoading && (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-purple-900/60 border border-purple-700/50 flex items-center justify-center shrink-0 text-purple-300">
              <Bot className="w-4 h-4" />
            </div>
            <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 text-xs text-purple-300 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
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

      {/* Input Area */}
      <div className="p-4 border-t border-zinc-800 bg-zinc-900">
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
            placeholder="Fai una domanda accademica sulla lezione..."
            className="flex-1 rounded-xl bg-zinc-950 border border-zinc-700 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!inputQuestion.trim() || isLoading}
            className="p-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-900/30 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
