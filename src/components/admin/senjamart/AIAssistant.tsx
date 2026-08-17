'use client';

import { useRef, useState } from 'react';
import { MdAddComment } from 'react-icons/md';

interface ToolActivity {
  tool: string;
  type: string;
  status: 'ok' | 'error';
  summary: string;
}

interface ConfirmationRequest {
  token: string;
  action: string;
  target: string;
  summary: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolActivity?: ToolActivity[];
}

interface ApiResponse {
  reply?: string;
  error?: string;
  toolActivity?: ToolActivity[];
  confirmation?: ConfirmationRequest | null;
}

const SUGGESTIONS = [
  'Berapa omzet hari ini?',
  'Produk paling laku minggu ini apa?',
  'Produk mana yang stoknya hampir habis?',
  'Berapa order yang belum dibayar?',
  'Buat ringkasan kondisi bisnis.',
  'Kenapa penjualan turun?',
];

export default function AIAssistant() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [pending, setPending] = useState<ConfirmationRequest | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Epoch guard: incremented on "Chat Baru" so any in-flight request started
  // before the reset is discarded (no stale response lands in the new chat).
  const epochRef = useRef(0);

  // API-facing conversation (user/assistant only) — server filters anyway.
  const toApiMessages = (): { role: 'user' | 'assistant'; content: string }[] =>
    messages.map((m) => ({ role: m.role, content: m.content }));

  const scrollToBottom = () => {
    window.setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, 50);
  };

  /** Send the current conversation (plus an optional confirmation token) to the API. */
  const post = async (confirmation?: { token: string }) => {
    const epoch = epochRef.current;
    setLoading(true);
    setFatalError(null);
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: toApiMessages(),
          ...(confirmation ? { confirmation } : {}),
        }),
      });
      const data = (await res.json().catch(() => null)) as ApiResponse | null;

      // Conversation was reset while this request was in flight — discard.
      if (epochRef.current !== epoch) return;

      if (!data) {
        setFatalError('Server tidak merespons. Silakan coba lagi.');
        return;
      }
      if (data.error) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: data.error as string },
        ]);
        return;
      }

      const reply = data.reply ?? 'Tidak ada jawaban.';
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: reply, toolActivity: data.toolActivity ?? [] },
      ]);

      if (data.confirmation) {
        setPending(data.confirmation);
      }
    } catch {
      if (epochRef.current !== epoch) return;
      setFatalError('Terjadi kesalahan jaringan. Silakan coba lagi.');
    } finally {
      // Only the request from the current conversation may touch loading state,
      // otherwise a stale request could hide the loading indicator of a new one.
      if (epochRef.current === epoch) {
        setLoading(false);
        scrollToBottom();
      }
    }
  };

  /**
   * "Chat Baru" — reset the conversation. Clears client message history,
   * the pending confirmation, and any error/input state, and bumps the epoch
   * so in-flight responses from the old conversation are discarded. The
   * server is stateless (context comes from the messages we send), so the
   * next request is a brand-new conversation. ai_audit_log / Supabase data
   * are never touched.
   */
  const resetConversation = () => {
    epochRef.current += 1; // invalidate any in-flight request
    setMessages([]);
    setInput('');
    setFatalError(null);
    setPending(null);
    setLoading(false);
  };

  const send = async (confirmation?: { token: string }) => {
    const userText = confirmation ? '' : input.trim();
    if (!confirmation && !userText) return;

    if (!confirmation) {
      setMessages((prev) => [...prev, { role: 'user', content: userText }]);
      setInput('');
    }
    await post(confirmation);
  };

  /** Send a suggestion chip instantly (user bubble + assistant reply). */
  const sendSuggestion = async (text: string) => {
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    await post();
  };

  const confirmAction = async () => {
    if (!pending) return;
    setPending(null);
    await send({ token: pending.token });
  };

  const inputClass =
    'w-full resize-none rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-navy-700 outline-none transition-all placeholder:text-gray-400 focus:border-brand-500 dark:border-navy-600 dark:bg-navy-800 dark:text-white dark:placeholder:text-gray-500';

  return (
    <div className="flex flex-col">
      {/* Header — "Chat Baru" resets this conversation only (never deletes
          ai_audit_log or any business data). */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🤖</span>
          <span className="text-sm font-bold text-navy-700 dark:text-white">
            Percakapan
          </span>
        </div>
        <button
          type="button"
          onClick={resetConversation}
          title="Mulai percakapan baru (riwayat chat ini dihapus, data bisnis tetap aman)"
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-500 transition-colors hover:border-brand-500 hover:text-brand-500 dark:border-navy-600 dark:text-gray-300 dark:hover:text-brand-400"
        >
          <MdAddComment className="h-3.5 w-3.5" />
          Chat Baru
        </button>
      </div>

      {/* Fatal error banner */}
      {fatalError && (
        <div className="mb-4 flex items-center justify-between rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-600 dark:bg-red-500/10">
          <span>{fatalError}</span>
          <button
            type="button"
            onClick={() => setFatalError(null)}
            className="ml-3 text-red-400 hover:text-red-600"
          >
            ✕
          </button>
        </div>
      )}

      {/* Chat area */}
      <div
        ref={scrollRef}
        className="max-h-[60vh] min-h-[320px] flex-1 space-y-4 overflow-y-auto rounded-2xl border border-gray-200 bg-white p-5 dark:border-navy-600 dark:bg-navy-800"
      >
        {messages.length === 0 && !loading ? (
          <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-6 text-center">
            <div>
              <span className="text-5xl">🤖</span>
              <h3 className="mt-3 text-lg font-bold text-navy-700 dark:text-white">
                AI Business Assistant SenjaMart
              </h3>
              <p className="mx-auto mt-1 max-w-md text-sm text-gray-500 dark:text-gray-400">
                Tanya tentang omzet, pesanan, produk, stok, atau pelanggan — semua jawaban
                dihitung dari data aktual Supabase. Perubahan data selalu butuh konfirmasi.
              </p>
            </div>
            <div className="flex max-w-md flex-wrap items-center justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void sendSuggestion(s)}
                  className="rounded-full border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 transition-colors hover:border-brand-500 hover:text-brand-500 dark:border-navy-600 dark:text-gray-300"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    m.role === 'user'
                      ? 'rounded-br-sm bg-brand-500 text-white'
                      : 'rounded-bl-sm bg-gray-100 text-navy-700 dark:bg-navy-700 dark:text-gray-100'
                  }`}
                >
                  {/* Tool activity chips */}
                  {m.role === 'assistant' && m.toolActivity && m.toolActivity.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {m.toolActivity.map((t, j) => (
                        <span
                          key={`${i}-${j}`}
                          title={t.tool}
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            t.status === 'ok'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
                              : 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400'
                          }`}
                        >
                          {t.status === 'ok' ? '✓' : '✕'} {t.summary}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="whitespace-pre-wrap">{m.content}</div>
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-gray-100 px-4 py-3 dark:bg-navy-700">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:0ms]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
                  <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">
                    AI sedang bekerja...
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="mt-4 flex items-end gap-3"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          placeholder="Tanyakan tentang bisnis SenjaMart... (Enter untuk kirim)"
          className={inputClass}
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-brand-500 px-5 py-3 text-sm font-bold text-white transition-all hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Kirim
        </button>
      </form>

      <p className="mt-2 text-[11px] text-gray-400">
        Jawaban dihitung dari data aktual Supabase. Tindakan yang mengubah data selalu
        memerlukan konfirmasi dan dicatat di audit log.
      </p>

      {/* Confirmation dialog */}
      {pending && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setPending(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Konfirmasi tindakan"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-navy-800"
          >
            <div className="flex items-center gap-3">
              <span className="text-3xl">⚠️</span>
              <h3 className="text-lg font-bold text-navy-700 dark:text-white">
                Konfirmasi Tindakan
              </h3>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
              {pending.summary}
            </p>
            <p className="mt-2 text-xs text-gray-400">
              Target: <span className="font-semibold">{pending.target}</span> · Tindakan:{' '}
              <code className="font-mono">{pending.action}</code>
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setPending(null)}
                disabled={loading}
                className="rounded-xl px-5 py-2.5 text-sm font-bold text-gray-500 transition-colors hover:text-navy-700 dark:hover:text-white"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => void confirmAction()}
                disabled={loading}
                className="inline-flex items-center rounded-xl bg-brand-500 px-6 py-2.5 text-sm font-bold text-white transition-all hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? 'Memproses...' : 'Lanjutkan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
