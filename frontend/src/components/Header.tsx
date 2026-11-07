import React from 'react';
import { ChronosRun } from '../types/events';
import { InspectorTarget } from '../types/ui';
import { AppMode, BackendConnectionState, BackendHealth } from '../types/api';
import { Server, Box, SidebarClose, SidebarOpen, RefreshCw, Radio } from 'lucide-react';

interface HeaderProps {
  currentRun: ChronosRun;
  runs: ChronosRun[];
  onSelectRun: (run: ChronosRun) => void;
  mode: AppMode;
  onToggleMode: (mode: AppMode) => void;
  connectionState: BackendConnectionState;
  backendHealth: BackendHealth | null;
  lastContactTime: Date | null;
  isLoading: boolean;
  onRefresh: () => void;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  onSelectInspectorTarget: (target: InspectorTarget) => void;
  user?: { username: string; email?: string } | null;
  onSignOut?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentRun,
  runs,
  onSelectRun,
  mode,
  onToggleMode,
  connectionState,
  backendHealth: _backendHealth,
  lastContactTime,
  isLoading,
  onRefresh,
  inspectorOpen,
  onToggleInspector,
  onSelectInspectorTarget,
  user,
  onSignOut,
}) => {
  const getBackendStatusBadge = () => {
    if (mode === 'PREVIEW') {
      return {
        lamp: 'bg-chrono-amber shadow-[0_0_6px_#ff9e00]',
        text: 'text-chrono-amber',
        label: 'PREVIEW',
      };
    }
    switch (connectionState) {
      case 'CONNECTED':
        return {
          lamp: 'bg-[#22c55e] shadow-[0_0_8px_#22c55e] animate-pulse',
          text: 'text-[#4ade80]',
          label: 'ONLINE (8000)',
        };
      case 'CONNECTING':
        return {
          lamp: 'bg-chrono-amber shadow-[0_0_6px_#ff9e00] animate-pulse',
          text: 'text-chrono-amber',
          label: 'CONNECTING...',
        };
      case 'DISCONNECTED':
        return {
          lamp: 'bg-chrono-red shadow-[0_0_6px_#ff3333]',
          text: 'text-chrono-red',
          label: 'DISCONNECTED',
        };
      case 'ERROR':
      default:
        return {
          lamp: 'bg-chrono-red shadow-[0_0_8px_#ff3333]',
          text: 'text-chrono-red',
          label: 'ERROR',
        };
    }
  };

  const backendStatus = getBackendStatusBadge();

  return (
    <header className="h-[52px] bg-[#070b05] border-b border-chrono-grid flex items-center justify-between px-4 select-none shrink-0 z-20">
      {/* Left: Brand Identity & Bertone / Athon Digital Cluster Badge */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-2.5 h-7 bg-chrono-phosphor shadow-[0_0_10px_#b8ff00]" />
          <div>
            <div className="font-ui font-bold text-sm tracking-widest text-chrono-phosphor flex items-center gap-2 drop-shadow-[0_0_6px_rgba(184,255,0,0.6)]">
              CHRONOS <span className="text-[10px] text-chrono-muted font-mono tracking-wider">// DIGITAL INSTRUMENT</span>
            </div>
            <div className="text-[9px] font-mono text-chrono-text tracking-wider leading-none">
              REV 0.2 // M2 LIVE TELEMETRY
            </div>
          </div>
        </div>

        {/* Mode Selector Switch (Bertone Cockpit Selector Pill) */}
        <div className="flex items-center bg-[#020402] border border-chrono-grid p-0.5 shadow-inner">
          <button
            onClick={() => onToggleMode('LIVE')}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono font-bold tracking-wider transition-all ${
              mode === 'LIVE'
                ? 'bg-[#12220f] border border-[#22c55e] text-[#4ade80] shadow-[0_0_8px_rgba(34,197,94,0.4)]'
                : 'text-chrono-muted hover:text-chrono-text'
            }`}
            title="Switch to Live Telemetry from FastAPI backend"
          >
            <Radio className={`w-3 h-3 ${mode === 'LIVE' ? 'text-[#4ade80] animate-pulse' : 'text-chrono-muted'}`} />
            LIVE MODE
          </button>
          <button
            onClick={() => onToggleMode('PREVIEW')}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono font-bold tracking-wider transition-all ${
              mode === 'PREVIEW'
                ? 'bg-[#241505] border border-chrono-amber text-chrono-amber shadow-[0_0_8px_rgba(255,158,0,0.4)]'
                : 'text-chrono-muted hover:text-chrono-text'
            }`}
            title="Switch to Offline Preview Fixtures"
          >
            <span className={`w-1.5 h-1.5 rounded-full ${mode === 'PREVIEW' ? 'bg-chrono-amber' : 'bg-chrono-muted'}`} />
            PREVIEW
          </button>
        </div>
      </div>

      {/* Center: Run Context Selector (Automotive Instrument Module) */}
      <div className="flex items-center gap-2 bg-[#020402] border border-chrono-grid px-3 py-1 shadow-inner">
        <span className="text-[10px] font-mono text-chrono-muted tracking-widest uppercase font-bold">
          {mode === 'LIVE' ? 'PERSISTED RUN:' : 'DEMO FIXTURE:'}
        </span>
        {runs.length > 0 ? (
          <select
            value={currentRun.run_id}
            onChange={(e) => {
              const found = runs.find((r) => r.run_id === e.target.value);
              if (found) onSelectRun(found);
            }}
            disabled={isLoading}
            className="bg-[#0b1009] text-chrono-phosphor font-mono text-xs font-bold px-2.5 py-0.5 border border-chrono-grid cursor-pointer focus:outline-none focus:border-chrono-phosphor max-w-[320px] truncate"
          >
            {runs.map((r, i) => (
              <option key={r.run_id} value={r.run_id}>
                #{i + 1}: {r.description.includes(r.status) ? r.description : `${r.description} (${r.status})`}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-[11px] font-mono text-chrono-amber px-2 py-0.5 italic">
            NO RECORDED RUNS
          </span>
        )}
        <button
          onClick={() => onSelectInspectorTarget({ type: 'RUN_SUMMARY', run: currentRun })}
          className="text-[10px] font-mono font-bold px-2 py-0.5 bg-[#12190e] border border-chrono-grid text-chrono-muted hover:text-chrono-phosphor hover:border-chrono-phosphor transition-colors"
          title="Inspect Run Telemetry Metadata"
        >
          DETAILS
        </button>
      </div>

      {/* Right: Operational Status Indicators & Inspector Toggle Switch */}
      <div className="flex items-center gap-2.5">
        {/* Backend Indicator Pod */}
        <button
          onClick={() => onSelectInspectorTarget({ type: 'BACKEND_STATUS' })}
          className="flex items-center gap-2 px-2.5 py-1 bg-[#040604] border border-chrono-grid hover:border-chrono-phosphor hover:bg-[#0c1209] transition-all group shadow-sm"
          title={`Backend: http://127.0.0.1:8000 (${connectionState}) ${
            lastContactTime ? `Last contact: ${lastContactTime.toLocaleTimeString()}` : ''
          }`}
        >
          <Server className="w-3.5 h-3.5 text-chrono-muted group-hover:text-chrono-phosphor" />
          <div className={`w-2 h-2 rounded-full ${backendStatus.lamp}`} />
          <span className="font-mono text-[10px] text-chrono-muted group-hover:text-chrono-text">
            FASTAPI: <span className={`font-bold ${backendStatus.text}`}>{backendStatus.label}</span>
          </span>
        </button>

        {/* Refresh / Retry Button */}
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className={`p-1.5 bg-[#040604] border border-chrono-grid hover:border-chrono-phosphor text-chrono-muted hover:text-chrono-phosphor transition-all ${
            isLoading ? 'animate-spin text-chrono-phosphor border-chrono-phosphor' : ''
          }`}
          title="Refresh Telemetry & Ping Backend"
          aria-label="Refresh Telemetry"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>

        {/* Docker Indicator Pod */}
        <button
          onClick={() => onSelectInspectorTarget({ type: 'DOCKER_STATUS' })}
          className="flex items-center gap-2 px-2.5 py-1 bg-[#040604] border border-chrono-grid hover:border-chrono-amber hover:bg-[#0c1209] transition-all group shadow-sm"
          title="Docker Compose: 01-http-basics"
        >
          <Box className="w-3.5 h-3.5 text-chrono-muted group-hover:text-chrono-amber" />
          <div className="w-2 h-2 rounded-full bg-[#22c55e] shadow-[0_0_6px_#22c55e]" />
          <span className="font-mono text-[10px] text-chrono-muted group-hover:text-chrono-amber">
            DOCKER: <span className="text-[#4ade80] font-bold">READY</span>
          </span>
        </button>

        {/* Authenticated Operator Pod */}
        {user ? (
          <div className="flex items-center gap-2 px-2.5 py-1 bg-[#040604] border border-chrono-grid shadow-sm">
            <span className="w-2 h-2 rounded-full bg-[#22c55e] shadow-[0_0_6px_#22c55e]" />
            <span
              className="font-mono text-[10px] text-chrono-text max-w-[130px] truncate"
              title={user.email || user.username}
            >
              {user.email || user.username}
            </span>
            {onSignOut && (
              <button
                onClick={onSignOut}
                className="ml-1 text-[9px] font-mono px-1.5 py-0.5 bg-[#190c0c] border border-chrono-red/60 text-chrono-red hover:bg-chrono-red hover:text-black transition-colors"
                title="Sign out of Cognito session"
              >
                SIGN OUT
              </button>
            )}
          </div>
        ) : null}

        {/* Separator */}
        <div className="w-[1px] h-6 bg-chrono-grid mx-0.5" />

        {/* Inspector Panel Toggle Switch */}
        <button
          onClick={onToggleInspector}
          className={`flex items-center gap-2 px-3 py-1 font-mono text-xs font-bold transition-all switch-selector ${
            inspectorOpen ? 'active' : 'text-chrono-muted'
          }`}
          title="Toggle Context Inspector"
        >
          {inspectorOpen ? (
            <SidebarClose className="w-4 h-4 text-chrono-phosphor drop-shadow-[0_0_4px_#b8ff00]" />
          ) : (
            <SidebarOpen className="w-4 h-4 text-chrono-muted" />
          )}
          <span className={inspectorOpen ? 'text-chrono-phosphor drop-shadow-[0_0_4px_#b8ff00]' : 'text-chrono-muted'}>
            INSPECTOR
          </span>
        </button>
      </div>
    </header>
  );
};
