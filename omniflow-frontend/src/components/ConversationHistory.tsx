import { Activity, Clock, User, Bot, AlertCircle } from 'lucide-react';
import type { ConversationEntry } from '../types';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// ConversationHistory
//
// Displays the history of messages for a given user, fetched via GET /api/v1/conversations.
// Includes details like Intent, Sentiment, and Urgency returned by the BehaviorAgent.
// ─────────────────────────────────────────────────────────────────────────────

interface ConversationHistoryProps {
  conversations: ConversationEntry[];
  loading: boolean;
  error: string | null;
}

export default function ConversationHistory({ conversations, loading, error }: ConversationHistoryProps) {
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-red-400 bg-red-900/10 rounded-xl border border-red-900/30">
        <AlertCircle className="w-8 h-8 mb-2" />
        <p className="text-sm">Failed to load history</p>
        <p className="text-xs opacity-70 mt-1">{error}</p>
      </div>
    );
  }

  if (loading && conversations.length === 0) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="animate-pulse flex gap-2">
          <div className="w-2 h-2 rounded-full bg-indigo-500/50" />
          <div className="w-2 h-2 rounded-full bg-indigo-500/50 delay-75" />
          <div className="w-2 h-2 rounded-full bg-indigo-500/50 delay-150" />
        </div>
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="text-center p-8 text-slate-500 text-sm">
        No conversation history yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {conversations.map((conv) => (
        <div
          key={conv.id}
          className="bg-[#1e1e35] rounded-xl p-4 border border-[rgba(99,102,241,0.18)] flex gap-4"
        >
          {/* Avatar column */}
          <div className="shrink-0 flex flex-col items-center gap-2">
            <div
              className={cn(
                'w-10 h-10 rounded-full flex items-center justify-center text-white shadow-sm',
                conv.sender === 'USER'
                  ? 'bg-indigo-500'
                  : 'bg-gradient-to-br from-violet-500 to-indigo-600'
              )}
            >
              {conv.sender === 'USER' ? <User size={18} /> : <Bot size={18} />}
            </div>
            {/* Thread line if we wanted one could go here */}
          </div>

          {/* Content column */}
          <div className="flex-1 min-w-0">
            {/* Header */}
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-medium text-sm text-slate-200">
                {conv.sender === 'USER' ? 'Customer' : 'OmniBot'}
              </span>
              <div className="flex items-center text-slate-500 text-[11px] gap-1.5">
                <Clock size={12} />
                {new Date(conv.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>

            {/* Message Body */}
            <p className="text-slate-300 text-sm leading-relaxed mb-3">
              {conv.message}
            </p>

            {/* AI Metadata Tags (only show if they exist, usually on USER messages) */}
            {(conv.intent || conv.sentiment !== null || conv.urgency !== null) && (
              <div className="flex flex-wrap gap-2 pt-3 border-t border-[rgba(99,102,241,0.1)]">
                {conv.intent && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-indigo-500/10 text-indigo-300 text-[11px] font-medium border border-indigo-500/20">
                    <Activity size={12} />
                    {conv.intent}
                  </div>
                )}
                
                {conv.sentiment !== null && (
                  <div className={cn(
                    "px-2.5 py-1 rounded-md text-[11px] font-medium border",
                    conv.sentiment > 0.3 ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                    conv.sentiment < -0.3 ? "bg-rose-500/10 text-rose-400 border-rose-500/20" :
                    "bg-slate-500/10 text-slate-400 border-slate-500/20"
                  )}>
                    Sentiment: {(conv.sentiment * 100).toFixed(0)}%
                  </div>
                )}

                {conv.urgency !== null && (
                  <div className={cn(
                    "px-2.5 py-1 rounded-md text-[11px] font-medium border",
                    conv.urgency > 0.7 ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                    "bg-slate-500/10 text-slate-400 border-slate-500/20"
                  )}>
                    Urgency: {(conv.urgency * 100).toFixed(0)}%
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
