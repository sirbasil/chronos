import React, { useState } from 'react';
import { ChronosRun } from '../types/events';
import { AppMode } from '../types/api';
import { Copy, Check, Terminal, Clock, ShieldCheck } from 'lucide-react';

interface StatusStripProps {
  currentRun: ChronosRun | null;
  currentTimeMs: number;
  mode?: AppMode;
}

export const StatusStrip: React.FC<StatusStripProps> = ({
  currentRun,
  currentTimeMs,
  mode = 'LIVE',
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopyRunId = () => {
    if (!currentRun) return;
    navigator.clipboard.writeText(currentRun.run_id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <footer className="min-h-[32px] bg-[#070b05] border-t border-chrono-grid flex flex-wrap items-center justify-between gap-2 px-4 py-1 select-none shrink-0 font-mono text-[11px] text-chrono-muted z-20">
      {/* Left: Active Run UUID & Overall Status */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-chrono-text">
          <Terminal className="w-3.5 h-3.5 text-chrono-muted" />
          <span className="text-[10px] text-chrono-muted font-bold">RUN:</span>
          {currentRun ? (
            <>
              <span className="font-bold text-chrono-phosphor drop-shadow-[0_0_4px_rgba(184,255,0,0.6)]">
                {currentRun.run_id.slice(0, 8)}...{currentRun.run_id.slice(-4)}
              </span>
              <button
                onClick={handleCopyRunId}
                className="hover:text-chrono-phosphor p-0.5 ml-1 transition-colors"
                title="Copy Full Run ID"
              >
                {copied ? (
                  <Check className="w-3 h-3 text-chrono-success drop-shadow-[0_0_4px_#00ff88]" />
                ) : (
                  <Copy className="w-3 h-3 text-chrono-muted hover:text-chrono-phosphor" />
                )}
              </button>
            </>
          ) : (
            <span className="text-chrono-muted italic">NONE</span>
          )}
        </div>

        <span className="text-chrono-grid">|</span>

        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-chrono-muted font-bold">STATUS:</span>
          {currentRun ? (
            <span
              className={`font-bold px-1.5 py-0.2 border text-[10px] ${
                currentRun.status === 'COMPLETED'
                  ? 'text-chrono-success border-chrono-success bg-[#021f10] shadow-[0_0_6px_rgba(0,255,136,0.4)]'
                  : currentRun.status === 'FAILED'
                  ? 'text-chrono-danger border-chrono-danger bg-[#2b0805] shadow-[0_0_6px_rgba(255,46,23,0.4)]'
                  : 'text-chrono-amber border-chrono-amber bg-[#201505] shadow-[0_0_6px_rgba(255,158,0,0.4)]'
              }`}
            >
              {currentRun.status}
            </span>
          ) : (
            <span className="font-bold px-1.5 py-0.2 border text-[10px] text-chrono-muted border-chrono-grid bg-[#0a0f08]">
              NO ACTIVE RUN
            </span>
          )}
        </div>
      </div>

      {/* Center: Laser Scrubber Position Readout */}
      <div className="flex items-center gap-2 bg-[#020402] px-3 py-0.5 border border-chrono-grid shadow-inner">
        <Clock className="w-3.5 h-3.5 text-chrono-amber" />
        <span className="text-chrono-amber font-digital text-sm font-bold tracking-widest drop-shadow-[0_0_6px_rgba(255,158,0,0.7)]">
          T+{currentTimeMs.toFixed(1)}ms
        </span>
        <span className="text-[9px] text-chrono-muted font-bold uppercase">(SCRUBBER)</span>
      </div>

      {/* Right: Environment & Telemetry Data Source */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-chrono-text">
          <ShieldCheck className="w-3.5 h-3.5 text-chrono-success" />
          <span className="text-[10px] text-chrono-muted font-bold">ENV:</span>
          <span className="text-chrono-text font-bold">WSL2 // LOCAL</span>
        </div>

        <span className="text-chrono-grid">|</span>

        <div className="flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              mode === 'LIVE'
                ? 'bg-[#22c55e] shadow-[0_0_6px_#22c55e]'
                : 'bg-chrono-amber shadow-[0_0_6px_#ff9e00]'
            }`}
          />
          <span className="text-chrono-muted text-[10px] font-bold">
            DATA:{' '}
            <span className={mode === 'LIVE' ? 'text-[#4ade80]' : 'text-chrono-amber'}>
              {mode === 'LIVE' ? 'LIVE_POSTGRESQL' : 'FIXTURE_PREVIEW'}
            </span>
          </span>
        </div>
      </div>
    </footer>
  );
};
