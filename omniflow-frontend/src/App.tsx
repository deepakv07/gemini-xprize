import { useState, useEffect, useCallback } from 'react';
import { Database, MessageSquare, Zap } from 'lucide-react';
import ChatBox from './components/ChatBox';
import ConversationHistory from './components/ConversationHistory';
import DashboardView from './components/DashboardView';
import type { ConversationEntry } from './types';
import { cn } from './lib/utils';

// Hardcoded for the demo
const DEMO_USER_ID = '123e4567-e89b-12d3-a456-426614174000';
const DEMO_BUSINESS_ID = '987fcdeb-51a2-43d7-9012-345678901234';

function App() {
  const [conversations, setConversations] = useState<ConversationEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'simulator' | 'dashboard'>('simulator');

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/conversations?userId=${DEMO_USER_ID}&limit=50`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      
      const data = await res.json() as { conversations: ConversationEntry[] };
      setConversations(data.conversations);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchHistory();
  }, [fetchHistory]);

  return (
    <div className="min-h-screen bg-[#0f0f1a] text-slate-200 font-sans p-4 md:p-8">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="max-w-5xl mx-auto mb-8 flex items-center justify-between border-b border-[rgba(99,102,241,0.08)] pb-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20 shadow-inner">
            <Zap className="text-indigo-400" size={20} />
          </div>
          <div>
            <h1 className="text-xl font-semibold bg-gradient-to-r from-indigo-200 to-white bg-clip-text text-transparent">
              OmniFlow
            </h1>
            <p className="text-xs text-indigo-400/80 font-medium">Agentic CX Platform</p>
          </div>
        </div>

        {/* ── Tab Switcher ────────────────────────────────────────────────── */}
        <div className="flex items-center gap-1.5 bg-[#16162a] border border-[rgba(99,102,241,0.15)] rounded-xl p-1 shrink-0 shadow-inner">
          <button
            onClick={() => setActiveTab('simulator')}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95 cursor-pointer',
              activeTab === 'simulator'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#1e1e35]'
            )}
          >
            Customer Simulator
          </button>
          <button
            onClick={() => setActiveTab('dashboard')}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95 cursor-pointer',
              activeTab === 'dashboard'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#1e1e35]'
            )}
          >
            Admin Dashboard
          </button>
        </div>
      </header>

      {/* ── Main Panel ──────────────────────────────────────────────────── */}
      <main className="max-w-5xl mx-auto">
        {activeTab === 'simulator' ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-160px)] min-h-[600px] animate-fade-in">
            {/* ── Left Column: Live Chat ────────────────────────────────────── */}
            <div className="lg:col-span-5 flex flex-col bg-[#16162a] rounded-3xl border border-[rgba(99,102,241,0.12)] shadow-2xl overflow-hidden relative">
              <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent opacity-50" />
              
              <div className="px-6 py-4 border-b border-[rgba(99,102,241,0.1)] flex items-center gap-3 bg-[#1e1e35]/50 shrink-0">
                <MessageSquare size={16} className="text-indigo-400" />
                <h2 className="text-sm font-semibold text-slate-200">Live Simulator</h2>
              </div>
              
              <div className="flex-1 overflow-hidden">
                <ChatBox 
                  userId={DEMO_USER_ID} 
                  businessId={DEMO_BUSINESS_ID}
                  onNewMessage={() => void fetchHistory()} 
                />
              </div>
            </div>

            {/* ── Right Column: Postgres History & Metadata ─────────────────── */}
            <div className="lg:col-span-7 flex flex-col bg-[#16162a] rounded-3xl border border-[rgba(99,102,241,0.12)] shadow-2xl overflow-hidden relative">
              <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent opacity-50" />
              
              <div className="px-6 py-4 border-b border-[rgba(99,102,241,0.1)] flex items-center justify-between bg-[#1e1e35]/50 shrink-0">
                <div className="flex items-center gap-3">
                  <Database size={16} className="text-indigo-400" />
                  <h2 className="text-sm font-semibold text-slate-200">Database Records</h2>
                </div>
                <div className="text-[11px] font-medium px-2 py-1 bg-indigo-500/10 text-indigo-300 rounded border border-indigo-500/20">
                  PostgreSQL
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto p-6">
                <ConversationHistory 
                  conversations={conversations} 
                  loading={loading} 
                  error={error} 
                />
              </div>
            </div>
          </div>
        ) : (
          <DashboardView />
        )}
      </main>
    </div>
  );
}

export default App;

