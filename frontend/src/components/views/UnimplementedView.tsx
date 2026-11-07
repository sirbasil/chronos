import React from 'react';
import { NavDestination } from '../../types/ui';
import { Layers, Network, Zap, Archive, Settings, ArrowLeft } from 'lucide-react';

interface UnimplementedViewProps {
  destination: NavDestination;
  onReturnToMonitor: () => void;
}

export const UnimplementedView: React.FC<UnimplementedViewProps> = ({
  destination,
  onReturnToMonitor,
}) => {
  const getDestinationDetails = () => {
    switch (destination) {
      case 'RUNS':
        return {
          title: 'RUNS // EXPERIMENT HISTORY',
          icon: Layers,
          plannedMilestone: 'M3 (Timeline & Run Explorer)',
          description:
            'Searchable experiment run catalog with side-by-side run comparisons, outcome filtering, and persistence audit.',
        };
      case 'TOPOLOGY':
        return {
          title: 'TOPOLOGY // SERVICE GRAPH',
          icon: Network,
          plannedMilestone: 'M2 (Topology & Live Data)',
          description:
            'Interactive node-link graph reconstructed from recorded SERVICE_CALL events with animated signal flows and edge inspection.',
        };
      case 'EXPERIMENTS':
        return {
          title: 'EXPERIMENTS // FAILURE WORKBENCH',
          icon: Zap,
          plannedMilestone: 'M4 (Controlled Failure Workbench)',
          description:
            'Interactive runner for normal checkout and controlled Docker failure injection against payment container with explicit safety confirmations.',
        };
      case 'ARCHIVE':
        return {
          title: 'ARCHIVE // SAVED RUN COMPARISONS',
          icon: Archive,
          plannedMilestone: 'M5 (Archive & Analysis)',
          description:
            'Long-term experiment artifact storage, diffing event sequences between happy path and failure scenarios.',
        };
      case 'SETTINGS':
        return {
          title: 'SETTINGS // ENVIRONMENT & PREFERENCES',
          icon: Settings,
          plannedMilestone: 'M5 (System Preferences)',
          description:
            'Local environment configuration, Docker socket bindings, phosphor brightness calibration, and reduced-motion controls.',
        };
      default:
        return {
          title: 'DESTINATION',
          icon: Layers,
          plannedMilestone: 'Future Milestone',
          description: 'This area is not yet implemented.',
        };
    }
  };

  const details = getDestinationDetails();
  const Icon = details.icon;

  return (
    <div className="flex-1 flex items-center justify-center p-8 bg-chrono-bg select-none">
      <div className="max-w-md w-full instrument-panel p-6 border-chrono-grid space-y-4 text-center">
        <div className="w-12 h-12 mx-auto bg-chrono-panel-raised border border-chrono-grid flex items-center justify-center text-chrono-amber">
          <Icon className="w-6 h-6" />
        </div>

        <div>
          <div className="font-mono text-xs font-bold text-chrono-amber tracking-wider mb-1">
            NOT IMPLEMENTED IN M1
          </div>
          <div className="font-ui font-bold text-base text-chrono-text">
            {details.title}
          </div>
        </div>

        <p className="font-mono text-xs text-chrono-muted leading-relaxed">
          {details.description}
        </p>

        <div className="bg-chrono-panel border border-chrono-grid-subtle p-2 font-mono text-[11px] text-chrono-muted">
          SCHEDULED FOR: <strong className="text-chrono-phosphor">{details.plannedMilestone}</strong>
        </div>

        <div className="pt-2">
          <button
            onClick={onReturnToMonitor}
            className="inline-flex items-center gap-2 px-4 py-2 bg-chrono-panel-raised border border-chrono-phosphor text-chrono-phosphor font-mono text-xs hover:bg-chrono-phosphor hover:text-[#090B08] transition-colors shadow-[0_0_8px_rgba(195,206,99,0.3)]"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>RETURN TO MONITOR</span>
          </button>
        </div>
      </div>
    </div>
  );
};
