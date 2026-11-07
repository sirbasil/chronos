import React, { useState } from 'react';
import { InspectorTarget } from '../types/ui';
import { ChronosEvent } from '../types/events';
import { BackendHealth, BackendConnectionState, AppMode } from '../types/api';
import { X, Copy, Check, Info, Server, Box, Layers } from 'lucide-react';

interface InspectorProps {
  target: InspectorTarget;
  onClose: () => void;
  onSelectEvent?: (event: ChronosEvent) => void;
  backendHealth?: BackendHealth | null;
  connectionState?: BackendConnectionState;
  lastContactTime?: Date | null;
  mode?: AppMode;
}

export const Inspector: React.FC<InspectorProps> = ({
  target,
  onClose,
  backendHealth,
  connectionState = 'CONNECTED',
  lastContactTime,
  mode = 'LIVE',
}) => {
  const [copied, setCopied] = useState(false);

  const copyText = async (text: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <aside className="w-[380px] bg-[#070b05] border-l border-chrono-grid flex flex-col h-full shrink-0 select-none overflow-hidden z-20 shadow-2xl">
      {/* Inspector Top Bezel */}
      <div className="h-[40px] bg-[#0c1209] border-b border-chrono-grid flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-2.5 h-2.5 bg-chrono-phosphor shadow-[0_0_8px_#b8ff00]" />
          <span className="font-mono text-xs font-bold tracking-wider text-chrono-phosphor uppercase drop-shadow-[0_0_6px_rgba(184,255,0,0.5)]">
            CONTEXT INSPECTOR
          </span>
          {target && (
            <span className="text-[10px] font-mono font-bold px-2 py-0.5 bg-[#020402] border border-chrono-grid text-chrono-amber shadow-sm">
              {target.type}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 text-chrono-muted hover:text-chrono-phosphor hover:bg-[#12190e] transition-colors border border-transparent hover:border-chrono-grid"
          title="Close Inspector (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5 font-mono text-xs text-chrono-text bg-[#040604]">
        {!target ? (
          <div className="p-6 text-center text-chrono-muted space-y-2.5 bg-[#020402] border border-chrono-grid">
            <Info className="w-8 h-8 mx-auto text-chrono-grid" />
            <div className="text-xs font-bold text-chrono-text">NO ITEM SELECTED</div>
            <p className="text-[11px] leading-relaxed text-chrono-muted">
              Click any event capsule on the trace or a channel in the service matrix to inspect its telemetry, properties, and payload.
            </p>
          </div>
        ) : target.type === 'EVENT' ? (
          /* Event Telemetry Inspection */
          <div className="space-y-3.5">
            <div className="border border-chrono-grid bg-[#020402] p-3 space-y-2.5 shadow-sm">
              <div className="flex items-center justify-between border-b border-chrono-grid/60 pb-2">
                <span className="text-[10px] text-chrono-muted tracking-wider font-bold">EVENT TYPE</span>
                <span className="font-bold text-chrono-phosphor px-2 py-0.5 bg-[#12190e] border border-chrono-grid drop-shadow-[0_0_6px_rgba(184,255,0,0.5)]">
                  {target.event.event_type}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[10px] text-chrono-muted tracking-wider">SERVICE</span>
                <span className="text-chrono-text font-bold uppercase">{target.event.service_id}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[10px] text-chrono-muted tracking-wider">TIMESTAMP</span>
                <span className="text-chrono-text text-[11px]">{target.event.timestamp}</span>
              </div>

              {target.event.offset_ms !== undefined && (
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-chrono-muted tracking-wider">OFFSET</span>
                  <span className="text-chrono-amber font-digital text-base font-bold drop-shadow-[0_0_6px_rgba(255,158,0,0.6)]">
                    +{target.event.offset_ms}ms
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-[10px] text-chrono-muted tracking-wider">SEVERITY</span>
                <span
                  className={`px-2 py-0.5 text-[10px] font-bold border ${
                    target.event.severity === 'ERROR'
                      ? 'bg-[#2b0805] text-chrono-danger border-chrono-danger shadow-[0_0_6px_rgba(255,46,23,0.5)]'
                      : target.event.severity === 'WARNING'
                      ? 'bg-[#201505] text-chrono-amber border-chrono-amber shadow-[0_0_6px_rgba(255,158,0,0.5)]'
                      : 'bg-[#12190e] text-chrono-text border-chrono-grid'
                  }`}
                >
                  {target.event.severity}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[10px] text-chrono-muted tracking-wider">TRACE ID</span>
                <span className="text-chrono-muted">{target.event.trace_id ?? 'N/A (NOT SET)'}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[10px] text-chrono-muted tracking-wider">EVENT ID</span>
                <span className="text-chrono-muted text-[10px] truncate max-w-[200px]" title={target.event.event_id}>
                  {target.event.event_id}
                </span>
              </div>
            </div>

            {/* Event Payload Terminal */}
            <div className="border border-chrono-grid bg-[#020402] p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-chrono-muted tracking-wider font-bold">PAYLOAD (JSONB)</span>
                <button
                  onClick={() => copyText(JSON.stringify(target.event.payload, null, 2))}
                  className="flex items-center gap-1.5 text-[10px] font-bold text-chrono-muted hover:text-chrono-phosphor px-2 py-0.5 bg-[#12190e] border border-chrono-grid"
                  title="Copy JSON Payload"
                >
                  {copied ? <Check className="w-3 h-3 text-chrono-success" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? 'COPIED' : 'COPY'}</span>
                </button>
              </div>

              <pre className="p-2.5 bg-[#010301] border border-chrono-grid text-[11px] text-chrono-phosphor overflow-x-auto leading-relaxed shadow-inner">
                {JSON.stringify(target.event.payload, null, 2)}
              </pre>
            </div>
          </div>
        ) : target.type === 'SERVICE' ? (
          /* Service Channel Telemetry */
          <div className="space-y-3.5">
            <div className="border border-chrono-grid bg-[#020402] p-3 space-y-2.5">
              <div className="flex items-center justify-between border-b border-chrono-grid/60 pb-2">
                <span className="text-[10px] text-chrono-muted tracking-wider font-bold">SERVICE NAME</span>
                <span className="font-bold text-chrono-phosphor drop-shadow-[0_0_6px_rgba(184,255,0,0.5)]">
                  {target.service.name}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[10px] text-chrono-muted tracking-wider">SERVICE ID</span>
                <span className="text-chrono-text font-bold">{target.service.id}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[10px] text-chrono-muted tracking-wider">CONTAINER</span>
                <span className="text-chrono-muted text-[11px]">{target.service.container_name}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[10px] text-chrono-muted tracking-wider">PORT</span>
                <span className="text-chrono-amber font-mono font-bold text-sm">{target.service.port}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[10px] text-chrono-muted tracking-wider">STATUS</span>
                <span
                  className={`font-bold px-2 py-0.5 text-[10px] border ${
                    target.service.status === 'HEALTHY'
                      ? 'text-chrono-success bg-[#021f10] border-chrono-success shadow-[0_0_6px_rgba(0,255,136,0.5)]'
                      : 'text-chrono-amber bg-[#201505] border-chrono-amber shadow-[0_0_6px_rgba(255,158,0,0.5)]'
                  }`}
                >
                  {target.service.status}
                </span>
              </div>
            </div>

            <div className="border border-chrono-grid bg-[#020402] p-3 space-y-2">
              <span className="text-[10px] text-chrono-muted tracking-wider font-bold">OBSERVED TRAFFIC METRICS</span>
              <div className="grid grid-cols-3 gap-2 text-center pt-1">
                <div className="p-2 bg-[#070b05] border border-chrono-grid">
                  <div className="text-[8px] text-chrono-muted font-bold">INBOUND</div>
                  <div className="text-base font-digital font-bold text-chrono-phosphor drop-shadow-[0_0_6px_rgba(184,255,0,0.5)]">
                    {target.service.inbound_calls}
                  </div>
                </div>
                <div className="p-2 bg-[#070b05] border border-chrono-grid">
                  <div className="text-[8px] text-chrono-muted font-bold">OUTBOUND</div>
                  <div className="text-base font-digital font-bold text-chrono-phosphor drop-shadow-[0_0_6px_rgba(184,255,0,0.5)]">
                    {target.service.outbound_calls}
                  </div>
                </div>
                <div className="p-2 bg-[#070b05] border border-chrono-grid">
                  <div className="text-[8px] text-chrono-muted font-bold">ERRORS</div>
                  <div
                    className={`text-base font-digital font-bold ${
                      target.service.error_count > 0
                        ? 'text-chrono-danger drop-shadow-[0_0_6px_rgba(255,46,23,0.6)]'
                        : 'text-chrono-text'
                    }`}
                  >
                    {target.service.error_count}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : target.type === 'BACKEND_STATUS' ? (
          /* Backend Status Inspection */
          <div className="space-y-3.5">
            <div className="flex items-center gap-2 text-chrono-phosphor font-bold">
              <Server className="w-4 h-4" />
              <span>FASTAPI OBSERVED BACKEND ({mode || 'LIVE'})</span>
            </div>

            <div
              className={`p-2.5 border text-[10px] space-y-1 shadow-sm ${
                connectionState === 'CONNECTED'
                  ? 'bg-[#081a0b] border-[#22c55e] text-[#4ade80]'
                  : connectionState === 'CONNECTING'
                  ? 'bg-[#1f1403] border-chrono-amber text-chrono-amber'
                  : 'bg-[#240808] border-chrono-red text-chrono-red'
              }`}
            >
              <div className="font-bold flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    connectionState === 'CONNECTED'
                      ? 'bg-[#22c55e] shadow-[0_0_8px_#22c55e]'
                      : connectionState === 'CONNECTING'
                      ? 'bg-chrono-amber shadow-[0_0_6px_#ff9e00] animate-pulse'
                      : 'bg-chrono-red shadow-[0_0_8px_#ff3333]'
                  }`}
                />
                <span>STATE: {connectionState || 'CONNECTED'}</span>
              </div>
              <p className="text-chrono-text leading-tight">
                {connectionState === 'CONNECTED'
                  ? 'Active HTTP connection verified to FastAPI server at http://127.0.0.1:8000. Telemetry data is queried directly from PostgreSQL.'
                  : 'Backend unreachable or in preview mode. Check Docker Compose container 01-http-basics-orders-1.'}
              </p>
            </div>

            <div className="border border-chrono-grid bg-[#020402] p-3 space-y-2">
              <div className="flex justify-between">
                <span className="text-[10px] text-chrono-muted">FRAMEWORK</span>
                <span className="font-bold text-chrono-text">FastAPI / Uvicorn</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] text-chrono-muted">BASE URL</span>
                <span className="font-mono text-chrono-phosphor font-bold">http://127.0.0.1:8000</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] text-chrono-muted">DATABASE STORE</span>
                <span className="font-mono text-[#4ade80] font-bold">
                  {backendHealth?.database === 'connected' ? 'PostgreSQL 16 (Connected)' : 'PostgreSQL 16 (:5432)'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] text-chrono-muted">LAST CONTACT</span>
                <span className="text-chrono-text font-mono">
                  {lastContactTime ? lastContactTime.toLocaleTimeString() : 'N/A'}
                </span>
              </div>
            </div>

            <div className="border border-chrono-grid bg-[#020402] p-3 space-y-1.5 text-[11px]">
              <span className="text-[10px] text-chrono-muted font-bold tracking-wider">LIVE REST API CONTRACT</span>
              <ul className="space-y-1 text-chrono-muted font-mono text-[10px]">
                <li><code className="text-chrono-phosphor font-bold">GET /health</code> — Backend & DB health status</li>
                <li><code className="text-chrono-phosphor font-bold">GET /runs</code> — List historical persisted runs</li>
                <li><code className="text-chrono-phosphor font-bold">GET /runs/&#123;id&#125;</code> — Retrieve single run summary</li>
                <li><code className="text-chrono-phosphor font-bold">GET /runs/&#123;id&#125;/events</code> — Retrieve normalized run events</li>
                <li><code className="text-chrono-phosphor font-bold">GET /runs/&#123;id&#125;/topology</code> — Observed service DAG graph</li>
                <li><code className="text-chrono-phosphor font-bold">POST /runs</code> — Initialize experiment run</li>
                <li><code className="text-chrono-phosphor font-bold">POST /orders/&#123;id&#125;/checkout</code> — Correlated checkout execution</li>
                <li><code className="text-chrono-phosphor font-bold">POST /runs/&#123;id&#125;/failure</code> — Controlled Docker fault injection</li>
              </ul>
            </div>
          </div>
        ) : target.type === 'DOCKER_STATUS' ? (
          /* Docker Status Inspection */
          <div className="space-y-3.5">
            <div className="flex items-center gap-2 text-chrono-amber font-bold">
              <Box className="w-4 h-4" />
              <span>DOCKER COMPOSE TOPOLOGY (PREVIEW)</span>
            </div>

            <div className="p-2.5 bg-[#201505] border border-chrono-amber text-chrono-amber text-[10px] space-y-1 shadow-sm">
              <div className="font-bold flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-chrono-amber shadow-[0_0_6px_#ff9e00] animate-pulse" />
                PREVIEW MODE // NO LIVE DOCKER CALLS
              </div>
              <p className="text-chrono-text leading-tight">
                M1 enforces strict safety boundaries: no Docker socket queries, container kills, or command executions occur from this desktop shell.
              </p>
            </div>

            <div className="border border-chrono-grid bg-[#020402] p-3 space-y-2">
              <div className="flex justify-between">
                <span className="text-[10px] text-chrono-muted">COMPOSE PROJECT</span>
                <span className="font-mono text-chrono-text font-bold">01-http-basics</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] text-chrono-muted">SOCKET POLICY</span>
                <span className="text-chrono-text font-bold">/var/run/docker.sock (orders only)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] text-chrono-muted">TARGET ALLOWLIST</span>
                <span className="text-chrono-amber font-mono font-bold">payment (ONLY)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] text-chrono-muted">M1 PERMISSION</span>
                <span className="text-chrono-danger font-mono font-bold">DISABLED (PREVIEW ONLY)</span>
              </div>
            </div>

            <div className="border border-chrono-grid bg-[#020402] p-3 space-y-1.5 text-[11px]">
              <span className="text-[10px] text-chrono-muted font-bold tracking-wider">COMPOSE SERVICE DEFINITIONS</span>
              <div className="space-y-1 text-chrono-text">
                <div className="flex justify-between">
                  <span>01-http-basics-orders-1</span>
                  <span className="text-chrono-muted">orders (:8000) [TARGET SPEC]</span>
                </div>
                <div className="flex justify-between">
                  <span>01-http-basics-payment-1</span>
                  <span className="text-chrono-muted">payment (:8001) [TARGET SPEC]</span>
                </div>
                <div className="flex justify-between">
                  <span>01-http-basics-postgres-1</span>
                  <span className="text-chrono-muted">postgres (:5432) [TARGET SPEC]</span>
                </div>
              </div>
            </div>
          </div>
        ) : target.type === 'RUN_SUMMARY' ? (
          /* Run Summary Inspection */
          <div className="space-y-3.5">
            <div className="flex items-center gap-2 text-chrono-phosphor font-bold">
              <Layers className="w-4 h-4" />
              <span>PREVIEW RUN FIXTURE // METADATA</span>
            </div>
            <div className="border border-chrono-grid bg-[#020402] p-3 space-y-2">
              <div className="flex justify-between">
                <span className="text-[10px] text-chrono-muted">STATUS</span>
                <span className="font-bold text-chrono-phosphor">{target.run.status}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] text-chrono-muted">SCENARIO TYPE</span>
                <span className="text-chrono-amber font-bold">
                  {target.run.is_failure_experiment ? 'CONTROLLED FAILURE EXPERIMENT' : 'NORMAL CHECKOUT'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] text-chrono-muted">STARTED</span>
                <span className="text-chrono-text">{target.run.started_at}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] text-chrono-muted">COMPLETED</span>
                <span className="text-chrono-text">{target.run.completed_at ?? 'IN PROGRESS'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10px] text-chrono-muted">FIXTURE EVENTS</span>
                <span className="font-bold text-chrono-phosphor">{target.run.events.length}</span>
              </div>
            </div>
            <div className="p-3 bg-[#070b05] border border-chrono-grid text-chrono-text text-[11px] leading-relaxed">
              [FIXTURE DATA] {target.run.description}
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
};
