import React, { useState } from 'react';
import { ChronosRun } from '../../types/events';
import { AppMode } from '../../types/api';
import {
  Layers,
  Activity,
  RefreshCw,
  Check,
  Copy,
  ArrowRight,
  Filter,
  Play,
  Loader2,
  AlertTriangle,
  X,
} from 'lucide-react';

interface RunsViewProps {
  runs: ChronosRun[];
  currentRun: ChronosRun;
  mode: AppMode;
  isLoading: boolean;
  isCreatingRun?: boolean;
  creationError?: string | null;
  onRefresh: () => void;
  onSelectRun: (run: ChronosRun) => void;
  onSwitchToMonitor: () => void;
  onCreateRun?: () => void;
  onDismissError?: () => void;
}

export const RunsView: React.FC<RunsViewProps> = ({
  runs,
  currentRun,
  mode,
  isLoading,
  isCreatingRun = false,
  creationError = null,
  onRefresh,
  onSelectRun,
  onSwitchToMonitor,
  onCreateRun,
  onDismissError,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'COMPLETED' | 'FAILED' | 'IN_PROGRESS' | 'ABANDONED'>('ALL');

  const copyRunId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  const filteredRuns = runs.filter((r) => {
    if (filter === 'ALL') return true;
    return r.status === filter;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return (
          <span className="px-2 py-0.5 bg-[#051a08] border border-[#22c55e] text-[#4ade80] font-mono text-[10px] font-bold flex items-center gap-1.5 w-fit">
            <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e]" />
            COMPLETED
          </span>
        );
      case 'FAILED':
        return (
          <span className="px-2 py-0.5 bg-[#240808] border border-chrono-red text-chrono-red font-mono text-[10px] font-bold flex items-center gap-1.5 w-fit">
            <span className="w-1.5 h-1.5 rounded-full bg-chrono-red" />
            FAILED
          </span>
        );
      case 'IN_PROGRESS':
        return (
          <span className="px-2 py-0.5 bg-[#1f1403] border border-chrono-amber text-chrono-amber font-mono text-[10px] font-bold flex items-center gap-1.5 w-fit animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-chrono-amber" />
            IN_PROGRESS
          </span>
        );
      case 'ABANDONED':
        return (
          <span className="px-2 py-0.5 bg-[#121412] border border-chrono-muted/60 text-chrono-muted font-mono text-[10px] font-bold flex items-center gap-1.5 w-fit">
            <span className="w-1.5 h-1.5 rounded-full bg-chrono-muted" />
            ABANDONED
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 bg-[#080d07] border border-chrono-grid text-chrono-muted font-mono text-[10px] font-bold">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#030602] text-chrono-text relative overflow-hidden select-none">
      {/* 1. Header Toolbar */}
      <div className="h-10 bg-[#070b05] border-b border-chrono-grid flex items-center justify-between px-4 z-10 shrink-0">
        <div className="flex items-center gap-3">
          <Layers className="w-4 h-4 text-chrono-phosphor drop-shadow-[0_0_6px_#b8ff00]" />
          <div className="font-ui font-bold text-xs tracking-wider text-chrono-phosphor flex items-center gap-2">
            EXPERIMENT RUN CATALOG <span className="text-[10px] text-chrono-muted font-mono">// POSTGRESQL RECORD STORE</span>
          </div>
          {mode === 'LIVE' ? (
            <span className="text-[9px] font-mono px-2 py-0.5 bg-[#051a08] border border-[#22c55e] text-[#4ade80] font-bold">
              LIVE DATABASE
            </span>
          ) : (
            <span className="text-[9px] font-mono px-2 py-0.5 bg-[#1f1403] border border-chrono-amber text-chrono-amber font-bold">
              PREVIEW FIXTURES
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Status Filter Buttons */}
          <div className="flex items-center bg-[#020402] border border-chrono-grid p-0.5 font-mono text-[10px]">
            <span className="px-2 text-chrono-muted flex items-center gap-1">
              <Filter className="w-3 h-3" /> FILTER:
            </span>
            {(['ALL', 'COMPLETED', 'FAILED', 'IN_PROGRESS', 'ABANDONED'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`px-2 py-0.5 font-bold transition-all ${
                  filter === s
                    ? 'bg-[#121c0e] text-chrono-phosphor border border-chrono-grid'
                    : 'text-chrono-muted hover:text-chrono-text'
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          {/* START NEW RUN Button */}
          {onCreateRun && (
            <button
              onClick={onCreateRun}
              disabled={isLoading || isCreatingRun || mode === 'PREVIEW'}
              className={`flex items-center gap-1.5 px-3 py-1 bg-[#12220f] border border-[#22c55e] text-[#4ade80] font-mono text-[10px] font-bold tracking-wider hover:bg-[#1b3516] hover:shadow-[0_0_8px_rgba(34,197,94,0.4)] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                isCreatingRun ? 'animate-pulse' : ''
              }`}
              title={
                mode === 'PREVIEW'
                  ? 'Run creation is only available in LIVE mode'
                  : 'Initialize and start a new run on backend (POST /runs)'
              }
            >
              {isCreatingRun ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin text-chrono-phosphor" />
                  <span>STARTING...</span>
                </>
              ) : (
                <>
                  <Play className="w-3 h-3 fill-current text-[#4ade80]" />
                  <span>START NEW RUN</span>
                </>
              )}
            </button>
          )}

          <button
            onClick={onRefresh}
            disabled={isLoading || isCreatingRun}
            className={`p-1.5 bg-[#0c1209] border border-chrono-grid hover:border-chrono-phosphor text-chrono-muted hover:text-chrono-phosphor transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              isLoading ? 'animate-spin text-chrono-phosphor' : ''
            }`}
            title="Refresh Runs from PostgreSQL"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Error Alert Banner */}
      {creationError && (
        <div className="bg-[#1c0808] border-b border-chrono-red px-4 py-2 flex items-center justify-between text-xs font-mono text-chrono-red z-10 shrink-0">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-chrono-red drop-shadow-[0_0_6px_#ff3333]" />
            <span>RUN CREATION FAILED: {creationError}</span>
          </div>
          {onDismissError && (
            <button
              onClick={onDismissError}
              className="p-1 text-chrono-muted hover:text-white transition-colors cursor-pointer"
              title="Dismiss error"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* 2. Run Catalog Table */}
      <div className="flex-1 overflow-y-auto p-4 bg-[#040604]">
        {filteredRuns.length > 0 ? (
          <div className="border border-chrono-grid bg-[#070b05] shadow-lg">
            <table className="w-full text-left font-mono text-xs">
              <thead>
                <tr className="bg-[#020402] border-b border-chrono-grid text-[10px] text-chrono-muted uppercase tracking-wider">
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Run ID</th>
                  <th className="py-2.5 px-3">Description / Order</th>
                  <th className="py-2.5 px-3">Started At</th>
                  <th className="py-2.5 px-3">Duration</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-chrono-grid/40">
                {filteredRuns.map((r) => {
                  const isCurrent = currentRun.run_id === r.run_id;
                  const durationMs = r.completed_at
                    ? new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()
                    : r.events.length > 1
                    ? (r.events[r.events.length - 1].offset_ms ?? 0)
                    : 0;

                  return (
                    <tr
                      key={r.run_id}
                      className={`hover:bg-[#0c1409] transition-colors ${
                        isCurrent ? 'bg-[#0f1c0b] border-l-2 border-l-chrono-phosphor' : ''
                      }`}
                    >
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {getStatusBadge(r.status)}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="text-chrono-phosphor font-bold">{r.run_id.slice(0, 8)}</span>
                          <span className="text-chrono-muted text-[10px]">{r.run_id.slice(8, 18)}...</span>
                          <button
                            onClick={() => copyRunId(r.run_id)}
                            className="p-1 text-chrono-muted hover:text-chrono-phosphor transition-colors"
                            title="Copy Full UUID"
                          >
                            {copiedId === r.run_id ? (
                              <Check className="w-3 h-3 text-[#4ade80]" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="text-chrono-text font-ui font-semibold truncate max-w-[280px]">
                          {r.description}
                        </div>
                        {r.is_failure_experiment && (
                          <span className="text-[9px] font-mono text-chrono-amber font-bold">
                            [FAILURE EXPERIMENT]
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap text-chrono-muted text-[11px]">
                        {new Date(r.started_at).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap font-digital text-chrono-amber text-sm font-bold">
                        {durationMs > 0 ? `${durationMs}ms` : '—'}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap text-right">
                        {isCurrent ? (
                          <button
                            onClick={onSwitchToMonitor}
                            className="px-2.5 py-1 text-[10px] font-bold bg-[#12220f] border border-[#22c55e] text-[#4ade80] flex items-center gap-1 ml-auto"
                          >
                            ACTIVE <ArrowRight className="w-3 h-3" />
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              onSelectRun(r);
                              onSwitchToMonitor();
                            }}
                            className="px-2.5 py-1 text-[10px] font-bold bg-[#0c1209] border border-chrono-grid hover:border-chrono-phosphor text-chrono-muted hover:text-chrono-phosphor transition-colors flex items-center gap-1 ml-auto"
                          >
                            LOAD <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="w-full h-64 flex flex-col items-center justify-center text-center p-6 bg-[#070b05] border border-chrono-grid">
            <Activity className="w-8 h-8 text-chrono-muted mb-2" />
            <div className="font-ui font-bold text-sm text-chrono-text uppercase mb-1">
              NO RUNS RECORDED
            </div>
            <p className="font-mono text-xs text-chrono-muted max-w-sm mb-4">
              {mode === 'LIVE'
                ? 'No run records were returned by PostgreSQL. Start a new run or trigger an order checkout to populate the history.'
                : 'No preview fixtures match the selected filter.'}
            </p>
            {mode === 'LIVE' && onCreateRun && (
              <button
                onClick={onCreateRun}
                disabled={isLoading || isCreatingRun}
                className="flex items-center gap-2 px-4 py-2 bg-[#12220f] border border-[#22c55e] text-[#4ade80] font-mono text-xs font-bold tracking-wider hover:bg-[#1b3516] hover:shadow-[0_0_8px_rgba(34,197,94,0.4)] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isCreatingRun ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-chrono-phosphor" />
                    <span>STARTING RUN...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current text-[#4ade80]" />
                    <span>START NEW RUN</span>
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>

      {/* 3. Bottom Information Banner */}
      <div className="h-7 bg-[#070b05] border-t border-chrono-grid flex items-center justify-between px-4 text-[10px] font-mono text-chrono-muted shrink-0">
        <div>
          TOTAL PERSISTED RUNS: <span className="text-chrono-phosphor font-bold">{runs.length}</span>
        </div>
        <div>
          QUERY LIMIT: <span className="text-chrono-phosphor font-bold">50 RECORDS</span>
        </div>
      </div>
    </div>
  );
};
