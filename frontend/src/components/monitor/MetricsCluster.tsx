import React from 'react';
import { ChronosRun } from '../../types/events';
import { DigitalDisplay } from '../common/DigitalDisplay';

interface MetricsClusterProps {
  run: ChronosRun;
  onSelectMetric?: (metricKey: string) => void;
}

export const MetricsCluster: React.FC<MetricsClusterProps> = ({ run, onSelectMetric }) => {
  // Compute metrics from actual run events
  const totalEvents = run.events.length;
  const uniqueServices = new Set(run.events.map((e) => e.service_id)).size;
  const failureInjections = run.events.filter((e) => e.event_type === 'FAILURE_INJECTED').length;

  const lastOffset = run.events.length > 0
    ? Math.max(...run.events.map((e) => e.offset_ms ?? 0))
    : 0;

  return (
    <div className="flex items-center gap-3 select-none flex-nowrap shrink-0">
      {/* Primary Hero Readout: Duration (Amber / Hazard Glow) */}
      <DigitalDisplay
        label="Run Duration"
        value={lastOffset}
        unit="ms"
        digits={4}
        size="hero"
        color="amber"
        onClick={onSelectMetric ? () => onSelectMetric('duration') : undefined}
      />

      {/* Primary Hero Readout: Failure Injection (Red Alert / Amber) */}
      <DigitalDisplay
        label="Failure Injected"
        value={failureInjections}
        unit="KILL"
        digits={2}
        size="hero"
        color={failureInjections > 0 ? 'danger' : 'amber'}
        onClick={onSelectMetric ? () => onSelectMetric('failures') : undefined}
      />

      {/* Separator Bevel Notch */}
      <div className="w-[1px] h-10 bg-chrono-grid mx-1 shrink-0" />

      {/* Secondary Companion Readouts: Chartreuse / Phosphor */}
      <DigitalDisplay
        label="Recorded Events"
        value={totalEvents}
        unit="EVT"
        digits={3}
        size="standard"
        color="phosphor"
        onClick={onSelectMetric ? () => onSelectMetric('events') : undefined}
      />

      <DigitalDisplay
        label="Active Services"
        value={uniqueServices}
        unit="SYS"
        digits={2}
        size="standard"
        color="phosphor"
        onClick={onSelectMetric ? () => onSelectMetric('services') : undefined}
      />
    </div>
  );
};
