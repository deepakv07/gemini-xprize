import { useState, useEffect, useCallback } from 'react';
import { 
  Users, 
  TrendingUp, 
  DollarSign, 
  Award, 
  RefreshCw, 
  Search, 
  Sparkles,
  Percent
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface CustomerEntry {
  id: string;
  name: string;
  phoneNumber: string;
  segment: 'high-value' | 'frequent-buyer' | 'price-sensitive' | 'at-risk' | 'new';
  purchaseProbability: number;
  expectedOrderValue: number;
  recommendedAction: {
    discount: number;
    bundle: string[];
    reason: string;
  } | null;
  createdAt: string;
}

interface DashboardData {
  metrics: {
    totalCustomers: number;
    avgPurchaseProbability: number;
    avgExpectedOrderValue: number;
    avgLtv: number;
    forecastedRevenue: number;
  };
  segments: Record<string, number>;
  customers: CustomerEntry[];
}

export default function DashboardView() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchStats = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const res = await fetch('/api/v1/dashboard/stats');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json() as { 
        status: string; 
        metrics: DashboardData['metrics']; 
        segments: Record<string, number>; 
        customers: CustomerEntry[]; 
      };
      setData(result);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchStats();
  }, [fetchStats]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 opacity-60">
        <RefreshCw className="animate-spin text-indigo-400" size={36} />
        <p className="text-sm font-medium text-slate-400">Loading metrics and statistics…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center text-sm text-red-400 bg-red-900/10 border border-red-800/20 rounded-2xl px-6 py-8 max-w-md mx-auto my-8">
        <p className="font-semibold mb-2">Failed to load Dashboard data</p>
        <p className="text-xs text-red-400/80 mb-4">{error ?? 'Unknown error'}</p>
        <button
          onClick={() => void fetchStats()}
          className="px-4 py-2 bg-red-950 border border-red-800 text-red-200 rounded-lg hover:bg-red-900 transition-colors text-xs font-medium"
        >
          Retry Load
        </button>
      </div>
    );
  }

  // Filter customers by search query
  const filteredCustomers = data.customers.filter((c) => {
    const term = searchQuery.toLowerCase();
    return (
      c.name.toLowerCase().includes(term) ||
      c.phoneNumber.toLowerCase().includes(term) ||
      c.segment.toLowerCase().includes(term)
    );
  });

  const { metrics, segments } = data;

  const segmentLabels: Record<string, string> = {
    'high-value': 'High-Value',
    'frequent-buyer': 'Frequent Buyer',
    'price-sensitive': 'Price Sensitive',
    'at-risk': 'At Risk',
    'new': 'New Customer',
  };

  const segmentColors: Record<string, { bg: string; text: string; bar: string; border: string }> = {
    'high-value': {
      bg: 'bg-emerald-500/10',
      text: 'text-emerald-400',
      bar: 'bg-gradient-to-r from-emerald-500 to-teal-400',
      border: 'border-emerald-500/20',
    },
    'frequent-buyer': {
      bg: 'bg-indigo-500/10',
      text: 'text-indigo-400',
      bar: 'bg-gradient-to-r from-indigo-500 to-violet-400',
      border: 'border-indigo-500/20',
    },
    'price-sensitive': {
      bg: 'bg-amber-500/10',
      text: 'text-amber-400',
      bar: 'bg-gradient-to-r from-amber-500 to-yellow-400',
      border: 'border-amber-500/20',
    },
    'at-risk': {
      bg: 'bg-rose-500/10',
      text: 'text-rose-400',
      bar: 'bg-gradient-to-r from-rose-500 to-red-400',
      border: 'border-rose-500/20',
    },
    'new': {
      bg: 'bg-slate-500/10',
      text: 'text-slate-400',
      bar: 'bg-gradient-to-r from-slate-500 to-slate-400',
      border: 'border-slate-500/20',
    },
  };

  return (
    <div className="space-y-8 animate-fade-in">
      {/* ── Dashboard Header ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold bg-gradient-to-r from-indigo-200 to-white bg-clip-text text-transparent">
            Executive Analytics
          </h2>
          <p className="text-xs text-slate-400">Live operational data from the agentic pipeline</p>
        </div>
        <button
          onClick={() => void fetchStats(true)}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-1.5 bg-[#16162a] border border-[rgba(99,102,241,0.2)] hover:border-indigo-500 rounded-xl text-xs font-semibold text-slate-300 hover:text-white transition-all shadow-md active:scale-95 disabled:opacity-50"
        >
          <RefreshCw size={14} className={cn(refreshing && 'animate-spin')} />
          {refreshing ? 'Refreshing…' : 'Refresh Data'}
        </button>
      </div>

      {/* ── KPI Grid ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-5">
        {/* Card 1: Total Customers */}
        <div className="bg-[#16162a] border border-[rgba(99,102,241,0.12)] p-5 rounded-2xl relative overflow-hidden group hover:border-[rgba(99,102,241,0.3)] transition-all">
          <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-full blur-xl group-hover:bg-indigo-500/10 transition-all" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Total Customers</span>
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Users size={16} />
            </div>
          </div>
          <h3 className="text-2xl font-bold text-slate-200">{metrics.totalCustomers}</h3>
          <p className="text-[10px] text-slate-500 mt-1">Identified in database</p>
        </div>

        {/* Card 2: Purchase Probability */}
        <div className="bg-[#16162a] border border-[rgba(99,102,241,0.12)] p-5 rounded-2xl relative overflow-hidden group hover:border-[rgba(99,102,241,0.3)] transition-all">
          <div className="absolute top-0 right-0 w-24 h-24 bg-violet-500/5 rounded-full blur-xl group-hover:bg-violet-500/10 transition-all" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Avg Conversion Prob</span>
            <div className="w-8 h-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-400">
              <Percent size={14} />
            </div>
          </div>
          <h3 className="text-2xl font-bold text-slate-200">{(metrics.avgPurchaseProbability * 100).toFixed(1)}%</h3>
          <p className="text-[10px] text-slate-500 mt-1">Mean purchase probability</p>
        </div>

        {/* Card 3: Avg Expected Order Value */}
        <div className="bg-[#16162a] border border-[rgba(99,102,241,0.12)] p-5 rounded-2xl relative overflow-hidden group hover:border-[rgba(99,102,241,0.3)] transition-all">
          <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full blur-xl group-hover:bg-amber-500/10 transition-all" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Avg Order Value</span>
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <TrendingUp size={15} />
            </div>
          </div>
          <h3 className="text-2xl font-bold text-slate-200">${metrics.avgExpectedOrderValue.toLocaleString()}</h3>
          <p className="text-[10px] text-slate-500 mt-1">Predicted basket size</p>
        </div>

        {/* Card 4: Avg Customer LTV */}
        <div className="bg-[#16162a] border border-[rgba(99,102,241,0.12)] p-5 rounded-2xl relative overflow-hidden group hover:border-[rgba(99,102,241,0.3)] transition-all">
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-xl group-hover:bg-emerald-500/10 transition-all" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Avg Customer LTV</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Award size={16} />
            </div>
          </div>
          <h3 className="text-2xl font-bold text-slate-200">${metrics.avgLtv.toLocaleString()}</h3>
          <p className="text-[10px] text-slate-500 mt-1">Predicted Customer Value</p>
        </div>

        {/* Card 5: Glowing Forecasted Revenue */}
        <div className="bg-gradient-to-b from-[#1e1a40] to-[#13112a] border border-indigo-500/30 p-5 rounded-2xl relative overflow-hidden group hover:border-indigo-500/60 shadow-lg shadow-indigo-950/40 transition-all">
          <div className="absolute inset-0 bg-indigo-500/5 opacity-50 group-hover:opacity-100 transition-opacity" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider">Forecasted Revenue</span>
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-300 animate-pulse">
              <DollarSign size={16} />
            </div>
          </div>
          <h3 className="text-2xl font-extrabold text-white">${metrics.forecastedRevenue.toLocaleString()}</h3>
          <p className="text-[10px] text-indigo-400 font-medium mt-1 flex items-center gap-1">
            <Sparkles size={10} /> Live Agentic Pipeline
          </p>
        </div>
      </div>

      {/* ── Segment Distribution Charts & Graphs ───────────────────────── */}
      <div className="bg-[#16162a] border border-[rgba(99,102,241,0.12)] rounded-3xl p-6 relative">
        <h3 className="text-sm font-semibold text-slate-200 mb-6">Customer Segment Profile Distribution</h3>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
          {Object.entries(segments).map(([segment, count]) => {
            const pct = metrics.totalCustomers > 0 ? (count / metrics.totalCustomers) * 100 : 0;
            const style = segmentColors[segment] || segmentColors['new'];
            return (
              <div 
                key={segment} 
                className={cn(
                  "p-4 rounded-2xl border bg-[#1e1e35]/30 flex flex-col justify-between transition-all",
                  style.border
                )}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full", style.bg, style.text)}>
                      {segmentLabels[segment] || segment}
                    </span>
                    <span className="text-sm font-bold text-slate-200">{count}</span>
                  </div>
                  <p className="text-[10px] text-slate-500">
                    {pct.toFixed(0)}% of total users
                  </p>
                </div>
                {/* Horizontal Progress Bar */}
                <div className="w-full h-1.5 bg-[#252542] rounded-full overflow-hidden mt-4">
                  <div 
                    className={cn("h-full rounded-full transition-all duration-500", style.bar)}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Customer Directory Table ────────────────────────────────────── */}
      <div className="bg-[#16162a] border border-[rgba(99,102,241,0.12)] rounded-3xl overflow-hidden relative">
        {/* Table Controls */}
        <div className="p-6 border-b border-[rgba(99,102,241,0.1)] flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <h3 className="text-sm font-semibold text-slate-200">Customer Agentic Records</h3>
          
          <div className="flex items-center bg-[#1e1e35] border border-[rgba(99,102,241,0.2)] focus-within:border-indigo-500 rounded-xl px-3 py-1.5 max-w-sm transition-colors">
            <Search size={14} className="text-slate-500 mr-2 shrink-0" />
            <input
              type="text"
              placeholder="Search name, phone, segment…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent text-xs text-slate-200 placeholder:text-slate-500 outline-none w-full"
            />
          </div>
        </div>

        {/* Directory Table */}
        <div className="overflow-x-auto">
          {filteredCustomers.length === 0 ? (
            <div className="text-center py-12 text-xs text-slate-500">
              No matching customer records found.
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[rgba(99,102,241,0.06)] text-slate-400 font-semibold bg-[#1e1e35]/25">
                  <th className="py-3.5 px-6">Customer Name</th>
                  <th className="py-3.5 px-6">Phone Number</th>
                  <th className="py-3.5 px-6">Assigned Segment</th>
                  <th className="py-3.5 px-6">Conversion Probability</th>
                  <th className="py-3.5 px-6">Expected Order Value</th>
                  <th className="py-3.5 px-6">Recommended Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(99,102,241,0.04)]">
                {filteredCustomers.map((c) => {
                  const style = segmentColors[c.segment] || segmentColors['new'];
                  return (
                    <tr key={c.id} className="hover:bg-[#1e1e35]/20 transition-colors">
                      <td className="py-3.5 px-6 font-semibold text-slate-200">{c.name}</td>
                      <td className="py-3.5 px-6 text-slate-400">{c.phoneNumber}</td>
                      <td className="py-3.5 px-6">
                        <span className={cn("inline-block text-[10px] font-bold px-2 py-0.5 rounded-full", style.bg, style.text)}>
                          {segmentLabels[c.segment] || c.segment}
                        </span>
                      </td>
                      <td className="py-3.5 px-6">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-200">{(c.purchaseProbability * 100).toFixed(0)}%</span>
                          <div className="w-16 h-1.5 bg-[#252542] rounded-full overflow-hidden">
                            <div 
                              className={cn("h-full rounded-full", style.bar)}
                              style={{ width: `${c.purchaseProbability * 100}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-6 font-bold text-slate-200">
                        ${c.expectedOrderValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-3.5 px-6">
                        {c.recommendedAction ? (
                          <div className="space-y-0.5 max-w-[240px]">
                            <p className="font-semibold text-indigo-400">
                              {c.recommendedAction.discount}% Discount + {c.recommendedAction.bundle.join(', ')}
                            </p>
                            <p className="text-[10px] text-slate-500 truncate" title={c.recommendedAction.reason}>
                              {c.recommendedAction.reason}
                            </p>
                          </div>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
