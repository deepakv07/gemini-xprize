import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Bot, User } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// ChatBox
//
// Handles the send-message flow:
//   • Textarea + Send button
//   • POSTs to /api/v1/message (proxied → localhost:5000)
//   • Renders the conversation inline (user bubble left, bot bubble right)
//   • Calls onNewMessage() after a successful exchange so the history list refreshes
// ─────────────────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'bot';
  text: string;
}

interface ChatBoxProps {
  userId: string;
  businessId: string;
  onNewMessage: () => void;
}

export default function ChatBox({ userId, businessId, onNewMessage }: ChatBoxProps) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to newest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setError(null);
    setMessages((prev) => [...prev, { role: 'user', text }]);
    setLoading(true);

    try {
      const res = await fetch('/api/v1/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, businessId, message: text }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(data?.message ?? `HTTP ${res.status}`);
      }

      const { response } = await res.json() as { response: string };
      setMessages((prev) => [...prev, { role: 'bot', text: response }]);
      onNewMessage();
    } catch (err) {
      setError((err as Error).message);
      // Remove the optimistic user bubble on failure
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Message thread ──────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4 min-h-0">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 opacity-40">
            <Bot size={48} strokeWidth={1} />
            <p className="text-sm">Start a conversation…</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn(
              'flex items-end gap-2 max-w-[80%]',
              msg.role === 'user' ? 'ml-auto flex-row-reverse' : 'mr-auto',
            )}
          >
            {/* Avatar */}
            <div
              className={cn(
                'shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white',
                msg.role === 'user'
                  ? 'bg-indigo-500'
                  : 'bg-gradient-to-br from-violet-500 to-indigo-600',
              )}
            >
              {msg.role === 'user' ? <User size={14} /> : <Bot size={14} />}
            </div>

            {/* Bubble */}
            <div
              className={cn(
                'rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm',
                msg.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-br-sm'
                  : 'bg-[#1e1e35] text-slate-200 border border-[rgba(99,102,241,0.18)] rounded-bl-sm',
              )}
            >
              {msg.text}
            </div>
          </div>
        ))}

        {/* Loading bubble */}
        {loading && (
          <div className="flex items-end gap-2 max-w-[80%] mr-auto">
            <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-gradient-to-br from-violet-500 to-indigo-600">
              <Bot size={14} className="text-white" />
            </div>
            <div className="rounded-2xl rounded-bl-sm px-4 py-3 bg-[#1e1e35] border border-[rgba(99,102,241,0.18)]">
              <Loader2 size={16} className="animate-spin text-indigo-400" />
            </div>
          </div>
        )}

        {/* Error toast */}
        {error && (
          <div className="text-center text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-4 py-2">
            ⚠ {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Input area ──────────────────────────────────────────────────── */}
      <div className="shrink-0 px-4 pb-5 pt-3 border-t border-[rgba(99,102,241,0.18)]">
        <div className="flex items-end gap-3 bg-[#1e1e35] border border-[rgba(99,102,241,0.25)] rounded-2xl px-4 py-3 focus-within:border-indigo-500 transition-colors">
          <textarea
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message… (Enter to send)"
            className="flex-1 resize-none bg-transparent text-sm text-slate-200 placeholder:text-slate-500 outline-none leading-relaxed max-h-32"
            style={{ fieldSizing: 'content' } as React.CSSProperties}
          />
          <button
            onClick={() => void handleSend()}
            disabled={!input.trim() || loading}
            className={cn(
              'shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all',
              input.trim() && !loading
                ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/40 hover:scale-105'
                : 'bg-[#2a2a45] text-slate-600 cursor-not-allowed',
            )}
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={15} />
            )}
          </button>
        </div>
        <p className="text-[11px] text-slate-600 mt-1.5 ml-1">Shift+Enter for new line</p>
      </div>
    </div>
  );
}
