import React from 'react';
import { ServiceSummary } from '../../types/events';
import { AppMode } from '../../types/api';
import { Server, ArrowDownLeft, ArrowUpRight, AlertOctagon } from 'lucide-react';

interface ServiceMatrixProps {
  services: ServiceSummary[];
  selectedServiceId: string | null;
  onSelectService: (service: ServiceSummary) => void;
  mode?: AppMode;
}

export const ServiceMatrix: React.FC<ServiceMatrixProps> = ({
  services,
  selectedServiceId,
  onSelectService,
  mode = 'LIVE',
}) => {
  return (
    <div className="instrument-cluster-frame flex flex-col h-full overflow-hidden select-none">
      {/* 1. Matrix Header Bezel */}
      <div className="h-[40px] bg-[#0c1209] border-b border-chrono-grid flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-2.5 h-2.5 bg-chrono-phosphor rounded-sm shadow-[0_0_8px_#b8ff00]" />
          <span className="font-mono text-xs font-bold tracking-wider text-chrono-phosphor drop-shadow-[0_0_6px_rgba(184,255,0,0.5)]">
            SERVICE MATRIX // MULTI-COLUMN BUS
          </span>
          {mode === 'LIVE' ? (
            <span className="text-[9px] font-mono font-bold text-[#4ade80] border border-[#22c55e] bg-[#051a08] px-1.5 py-0.2 shadow-sm">
              LIVE BUS
            </span>
          ) : (
            <span className="text-[9px] font-mono font-bold text-chrono-amber border border-chrono-amber bg-[#201505] px-1.5 py-0.2 shadow-sm">
              PREVIEW
            </span>
          )}
        </div>
        <span className="text-[10px] font-mono text-chrono-text font-bold">
          {services.length} CHANNELS
        </span>
      </div>

      {/* 2. Integrated Instrumentation Rack Bays */}
      <div className="p-3 flex-1 overflow-y-auto space-y-3 bg-[#040604]">
        {services.map((svc, idx) => {
          const isSelected = selectedServiceId === svc.id;
          const isDegraded = svc.status !== 'HEALTHY' || svc.error_count > 0;

          return (
            <div
              key={svc.id}
              onClick={() => onSelectService(svc)}
              className={`matrix-rack-bay p-3.5 border relative cursor-pointer ${
                isSelected ? 'selected' : ''
              }`}
            >
              {/* Selected Left Neon Notch */}
              {isSelected && (
                <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-chrono-phosphor shadow-[0_0_8px_#b8ff00]" />
              )}

              {/* Bay Row 1: Channel Tag, Service Name & Status Lamp */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Server
                    className={`w-4 h-4 ${
                      isSelected ? 'text-chrono-phosphor' : 'text-chrono-muted'
                    }`}
                  />
                  <div>
                    <div className="font-mono font-bold text-xs text-chrono-text tracking-wider uppercase flex items-center gap-1.5">
                      <span className="text-chrono-muted text-[10px]">CH-0{idx + 1}:</span>
                      <span>{svc.name}</span>
                    </div>
                  </div>
                </div>

                {/* Status Indicator Jewel Lamp */}
                <div className="flex items-center gap-2">
                  <div
                    className={`w-2.5 h-2.5 rounded-full ${
                      isDegraded
                        ? 'bg-chrono-amber shadow-[0_0_8px_#ff9e00] animate-pulse'
                        : 'bg-chrono-success shadow-[0_0_8px_#00ff88]'
                    }`}
                  />
                  <span
                    className={`font-mono text-[10px] font-bold tracking-wider ${
                      isDegraded ? 'text-chrono-amber' : 'text-chrono-success'
                    }`}
                  >
                    {svc.status}
                  </span>
                </div>
              </div>

              {/* Bay Row 2: Port, Container & 5-Segment Activity Gauge */}
              <div className="flex items-center justify-between font-mono text-[10px] text-chrono-muted mb-2.5 bg-[#020402] px-2 py-1 border border-chrono-grid">
                <div>
                  PORT: <strong className="text-chrono-phosphor font-bold">{svc.port}</strong>
                </div>
                <div className="truncate max-w-[130px] text-chrono-text">
                  {svc.container_name}
                </div>

                {/* 5-Segment Automotive LED Bar Ladder Gauge */}
                <div className="flex items-center gap-1" title="Service Load/Traffic Meter">
                  <div className="w-1.5 h-3 bg-chrono-phosphor shadow-[0_0_4px_#b8ff00]" />
                  <div className="w-1.5 h-3 bg-chrono-phosphor shadow-[0_0_4px_#b8ff00]" />
                  <div className={`w-1.5 h-3 ${svc.inbound_calls > 1 ? 'bg-chrono-phosphor shadow-[0_0_4px_#b8ff00]' : 'bg-[#182607]'}`} />
                  <div className={`w-1.5 h-3 ${isDegraded ? 'bg-chrono-danger shadow-[0_0_4px_#ff2e17]' : 'bg-[#182607]'}`} />
                  <div className="w-1.5 h-3 bg-[#182607]" />
                </div>
              </div>

              {/* Bay Row 3: Multi-Column Recessed Telemetry Readouts */}
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-chrono-grid/60 font-mono">
                {/* Inbound Counter */}
                <div className="digital-readout-frame p-1.5 text-center">
                  <div className="text-chrono-muted text-[8px] flex items-center justify-center gap-1 font-bold mb-0.5">
                    <ArrowDownLeft className="w-2.5 h-2.5 text-chrono-phosphor" /> IN
                  </div>
                  <div className="relative font-digital font-bold text-sm tracking-wider">
                    <span className="absolute inset-0 digital-ghost digital-ghost-phosphor select-none">
                      88
                    </span>
                    <span className="relative z-10 digital-active-phosphor">
                      {String(svc.inbound_calls).padStart(2, '0')}
                    </span>
                  </div>
                </div>

                {/* Outbound Counter */}
                <div className="digital-readout-frame p-1.5 text-center">
                  <div className="text-chrono-muted text-[8px] flex items-center justify-center gap-1 font-bold mb-0.5">
                    <ArrowUpRight className="w-2.5 h-2.5 text-chrono-phosphor" /> OUT
                  </div>
                  <div className="relative font-digital font-bold text-sm tracking-wider">
                    <span className="absolute inset-0 digital-ghost digital-ghost-phosphor select-none">
                      88
                    </span>
                    <span className="relative z-10 digital-active-phosphor">
                      {String(svc.outbound_calls).padStart(2, '0')}
                    </span>
                  </div>
                </div>

                {/* Error Counter (Alert Highlight) */}
                <div className="digital-readout-frame p-1.5 text-center">
                  <div className="text-chrono-muted text-[8px] flex items-center justify-center gap-1 font-bold mb-0.5">
                    <AlertOctagon className={`w-2.5 h-2.5 ${svc.error_count > 0 ? 'text-chrono-danger' : 'text-chrono-muted'}`} /> ERR
                  </div>
                  <div className="relative font-digital font-bold text-sm tracking-wider">
                    <span className={`absolute inset-0 digital-ghost ${svc.error_count > 0 ? 'digital-ghost-danger' : 'digital-ghost-phosphor'} select-none`}>
                      88
                    </span>
                    <span className={`relative z-10 ${svc.error_count > 0 ? 'digital-active-danger' : 'digital-active-phosphor'}`}>
                      {String(svc.error_count).padStart(2, '0')}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
