import React from 'react';
import { ChronosEvent, ChronosRun, ServiceSummary } from '../../types/events';
import { AppMode } from '../../types/api';
import { MetricsCluster } from './MetricsCluster';
import { TraceInstrument } from './TraceInstrument';
import { ServiceMatrix } from './ServiceMatrix';

interface MonitorViewProps {
  run: ChronosRun;
  services: ServiceSummary[];
  selectedEvent: ChronosEvent | null;
  selectedServiceId: string | null;
  currentTimeMs: number;
  onSelectEvent: (event: ChronosEvent) => void;
  onSelectService: (service: ServiceSummary) => void;
  onTimeChange: (timeMs: number) => void;
  onSelectMetric?: (metricKey: string) => void;
  mode?: AppMode;
}

export const MonitorView: React.FC<MonitorViewProps> = ({
  run,
  services,
  selectedEvent,
  selectedServiceId,
  currentTimeMs,
  onSelectEvent,
  onSelectService,
  onTimeChange,
  onSelectMetric,
  mode = 'LIVE',
}) => {
  return (
    <div className="flex-1 flex flex-col p-3.5 gap-3.5 overflow-hidden bg-chrono-bg">
      {/* 1. Top Panoramic Numerical Readouts Strip */}
      <div className="shrink-0 flex items-center justify-between bg-[#080d06] border border-chrono-grid p-2.5 shadow-md">
        <MetricsCluster run={run} onSelectMetric={onSelectMetric} />

        <div className="hidden xl:flex items-center gap-2.5 text-chrono-muted font-mono text-[11px] pr-3">
          <span className="w-2 h-2 rounded-full bg-chrono-phosphor shadow-[0_0_8px_#b8ff00] animate-pulse" />
          <span className="font-bold tracking-wider text-chrono-text">
            CHRONOMETRIC DIGITAL CLUSTER // BUS SYNC
          </span>
        </div>
      </div>

      {/* 2. Panoramic Instrument Field: Main Trace (68%) + Multi-Column Service Matrix (32%) */}
      <div className="flex-1 flex gap-3.5 overflow-hidden min-h-0">
        {/* Left: Main Panoramic Trace Oscilloscope (~68%) */}
        <div className="flex-[68] min-w-0 h-full">
          <TraceInstrument
            run={run}
            services={services}
            selectedEvent={selectedEvent}
            selectedServiceId={selectedServiceId}
            currentTimeMs={currentTimeMs}
            onSelectEvent={onSelectEvent}
            onSelectService={onSelectService}
            onTimeChange={onTimeChange}
            mode={mode}
          />
        </div>

        {/* Right: Service Status Matrix (~32%) */}
        <div className="flex-[32] min-w-[310px] max-w-[420px] h-full">
          <ServiceMatrix
            services={services}
            selectedServiceId={selectedServiceId}
            onSelectService={onSelectService}
            mode={mode}
          />
        </div>
      </div>
    </div>
  );
};
