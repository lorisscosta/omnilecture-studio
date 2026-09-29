'use client';

import React, { useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import {
  X,
  Mail,
  Lock,
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Cloud,
  LogOut,
  UserCheck,
} from 'lucide-react';
import type { User } from '@supabase/supabase-js';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User | null;
  onUserChange: (user: User | null) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onUserChange,
}) => {
  const [mode, setMode] = useState<'login' | 'signup' | 'magic-link'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) {
      setErrorMessage('Client Supabase non configurato. Verifica le variabili d\'ambiente.');
      return;
    }

    if (!email.trim()) {
      setErrorMessage('Inserisci la tua email.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      if (mode === 'magic-link') {
        const { error } = await supabase.auth.signInWithOtp({
          email: email.trim(),
          options: {
            emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
          },
        });
        if (error) throw error;
        setSuccessMessage('Ti abbiamo inviato un Magic Link via email. Clicca sul link per accedere!');
      } else if (mode === 'signup') {
        if (!password || password.length < 6) {
          throw new Error('La password deve contenere almeno 6 caratteri.');
        }
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password: password,
        });
        if (error) throw error;
        if (data.session) {
          onUserChange(data.user);
          setSuccessMessage('Account creato con successo!');
          setTimeout(() => onClose(), 1200);
        } else {
          setSuccessMessage('Registrazione completata! Controlla la tua email per confermare l\'account.');
        }
      } else {
        // Login with password
        if (!password) {
          throw new Error('Inserisci la password.');
        }
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: password,
        });
        if (error) throw error;
        onUserChange(data.user);
        setSuccessMessage('Accesso eseguito con successo!');
        setTimeout(() => onClose(), 1000);
      }
    } catch (err: any) {
      console.error('Supabase Auth error:', err);
      setErrorMessage(err.message || 'Errore durante l\'autenticazione.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    if (!supabase) return;
    setIsLoading(true);
    try {
      await supabase.auth.signOut();
      onUserChange(null);
      setSuccessMessage('Disconnessione effettuata.');
      setTimeout(() => onClose(), 1000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Errore durante il logout.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-zinc-950 border border-obsidian-border rounded-2xl shadow-2xl overflow-hidden p-6">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2.5 rounded-xl bg-purple-950 border border-purple-800/60 text-purple-400 shadow-md">
            <Cloud className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-zinc-100">
              Supabase Text-Only Cloud Sync
            </h3>
            <p className="text-xs text-zinc-400">
              Accedi per sincronizzare guide Overleaf, LaTeX e trascrizioni
            </p>
          </div>
        </div>

        {/* Logged in state view */}
        {currentUser ? (
          <div className="space-y-5">
            <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
                <UserCheck className="w-4 h-4" />
                <span>Account Attivo</span>
              </div>
              <p className="text-sm font-mono text-zinc-200 truncate">
                {currentUser.email}
              </p>
              <p className="text-[11px] text-zinc-500 font-mono">
                UID: {currentUser.id.slice(0, 12)}...
              </p>
            </div>

            <div className="p-3 rounded-xl bg-purple-950/30 border border-purple-900/40 text-[11px] text-purple-300 leading-relaxed">
              💡 <strong>Architettura Text-Only</strong>: I file audio (.wav/.mp3) rimangono rigorosamente sul dispositivo locale per azzerare costi di storage, mentre tutti gli appunti e le trascrizioni sono sincronizzati e accessibili ovunque.
            </div>

            <button
              onClick={handleLogout}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-semibold bg-zinc-900 hover:bg-rose-950/50 hover:text-rose-300 hover:border-rose-900/60 border border-zinc-800 text-zinc-300 transition"
            >
              <LogOut className="w-4 h-4" />
              <span>Disconnetti Account</span>
            </button>
          </div>
        ) : (
          /* Not logged in form */
          <div className="space-y-4">
            {/* Mode Switcher */}
            <div className="flex rounded-xl bg-zinc-900 p-1 border border-zinc-800">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setErrorMessage(null);
                  setSuccessMessage(null);
                }}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition ${
                  mode === 'login' ? 'bg-purple-600 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Accedi
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('signup');
                  setErrorMessage(null);
                  setSuccessMessage(null);
                }}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition ${
                  mode === 'signup' ? 'bg-purple-600 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Registrati
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('magic-link');
                  setErrorMessage(null);
                  setSuccessMessage(null);
                }}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition ${
                  mode === 'magic-link' ? 'bg-purple-600 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Magic Link
              </button>
            </div>

            <form onSubmit={handleAuth} className="space-y-3.5 pt-1">
              <div>
                <label className="block text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">
                  Email
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-zinc-500 absolute left-3 top-3" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="studente@universita.it"
                    className="w-full pl-9 pr-3 py-2 rounded-xl bg-zinc-900 border border-zinc-700 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>

              {mode !== 'magic-link' && (
                <div>
                  <label className="block text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">
                    Password {mode === 'signup' && '(min. 6 caratteri)'}
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-zinc-500 absolute left-3 top-3" />
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-9 pr-3 py-2 rounded-xl bg-zinc-900 border border-zinc-700 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                    />
                  </div>
                </div>
              )}

              {/* Status messages */}
              {errorMessage && (
                <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-900/60 text-xs text-rose-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {successMessage && (
                <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-900/60 text-xs text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                  <span>{successMessage}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-950/50 transition disabled:opacity-50"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Elaborazione...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>
                      {mode === 'signup'
                        ? 'Crea Account Studente'
                        : mode === 'magic-link'
                        ? 'Invia Magic Link'
                        : 'Accedi al Cloud'}
                    </span>
                  </>
                )}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
