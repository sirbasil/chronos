import React from 'react';
import { ChronosEvent, ChronosRun, ServiceSummary } from '../../types/events';
import { AppMode, BackendHealth, ExecutionErrorInfo, ExecutionResultInfo } from '../../types/api';
import { UserProfile } from '../../auth/AuthContext';
import { MetricsCluster } from './MetricsCluster';
import { TraceInstrument } from './TraceInstrument';
import { ServiceMatrix } from './ServiceMatrix';
import { ExperimentStagingPanel } from './ExperimentStagingPanel';

interface MonitorViewProps {
  run: ChronosRun | null;
  services: ServiceSummary[];
  selectedEvent: ChronosEvent | null;
  selectedServiceId: string | null;
  currentTimeMs: number;
  onSelectEvent: (event: ChronosEvent) => void;
  onSelectService: (service: ServiceSummary) => void;
  onTimeChange: (timeMs: number) => void;
  onSelectMetric?: (metricKey: string) => void;
  mode?: AppMode;
  backendHealth?: BackendHealth | null;
  isLoading?: boolean;
  isExecutingCheckout?: boolean;
  isInjectingFailure?: boolean;
  failureInjected?: boolean;
  checkoutExecuted?: boolean;
  lastExecutionResult?: ExecutionResultInfo | null;
  executionError?: ExecutionErrorInfo | null;
  onExecuteCheckout?: () => void;
  onInjectFailure?: () => void;
  onDismissExecutionError?: () => void;
  user?: UserProfile | null;
  focusStagingToken?: number;
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
  backendHealth = null,
  isLoading = false,
  isExecutingCheckout = false,
  isInjectingFailure = false,
  failureInjected = false,
  checkoutExecuted = false,
  lastExecutionResult = null,
  executionError = null,
  onExecuteCheckout,
  onInjectFailure,
  onDismissExecutionError,
  user,
  focusStagingToken = 0,
}) => {
  return (
    <div className="flex-1 flex flex-col p-3 gap-3 overflow-y-auto xl:overflow-hidden bg-chrono-bg min-h-0">
      {/* 1. Top Panoramic Numerical Readouts Strip */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 bg-[#080d06] border border-chrono-grid p-2.5 shadow-md">
        <MetricsCluster run={run} onSelectMetric={onSelectMetric} />

        <div className="hidden xl:flex items-center gap-2.5 text-chrono-muted font-mono text-[11px] pr-3">
          <span className="w-2 h-2 rounded-full bg-chrono-phosphor shadow-[0_0_8px_#b8ff00] animate-pulse" />
          <span className="font-bold tracking-wider text-chrono-text">
            CHRONOMETRIC DIGITAL CLUSTER // BUS SYNC
          </span>
        </div>
      </div>

      {/* 2. Active Experiment Staging Panel */}
      {onExecuteCheckout && (
        <ExperimentStagingPanel
          run={run}
          mode={mode}
          isLoading={isLoading}
          isExecutingCheckout={isExecutingCheckout}
          isInjectingFailure={isInjectingFailure}
          failureInjected={failureInjected}
          checkoutExecuted={checkoutExecuted}
          lastExecutionResult={lastExecutionResult}
          executionError={executionError}
          onExecuteCheckout={onExecuteCheckout}
          onInjectFailure={onInjectFailure ?? (() => {})}
          onDismissError={onDismissExecutionError}
          user={user}
          focusStagingToken={focusStagingToken}
        />
      )}

      {/* 3. Panoramic Instrument Field: Main Trace (68%) + Multi-Column Service Matrix (32%) */}
      <div className="flex-1 flex flex-col xl:flex-row gap-3.5 min-h-[340px] xl:min-h-0 xl:overflow-hidden">
        {/* Left: Main Panoramic Trace Oscilloscope (~68%) */}
        <div className="w-full xl:flex-[68] min-w-0 min-h-[320px] xl:h-full">
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
        <div className="w-full xl:flex-[32] xl:min-w-[290px] xl:max-w-[420px] shrink-0 xl:h-full">
          <ServiceMatrix
            services={services}
            selectedServiceId={selectedServiceId}
            onSelectService={onSelectService}
            mode={mode}
            backendHealth={backendHealth}
          />
        </div>
      </div>
    </div>
  );
};
