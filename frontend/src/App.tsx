import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { ChronosEvent, ChronosRun, ServiceSummary } from './types/events';
import { NavDestination, InspectorTarget } from './types/ui';
import { AppMode, BackendConnectionState, BackendHealth, TopologyResponse } from './types/api';
import { DEMO_PREVIEW_RUNS } from './data/fixtures';
import {
  checkHealth,
  getRuns,
  getRun,
  getRunEvents,
  getRunTopology,
  buildChronosRun,
  deriveServicesFromRun,
} from './services/chronosApi';
import { Header } from './components/Header';
import { Navigation } from './components/Navigation';
import { StatusStrip } from './components/StatusStrip';
import { Inspector } from './components/Inspector';
import { MonitorView } from './components/monitor/MonitorView';
import { TopologyView } from './components/views/TopologyView';
import { RunsView } from './components/views/RunsView';
import { UnimplementedView } from './components/views/UnimplementedView';
import { AlertTriangle, RefreshCw, Radio } from 'lucide-react';

const FALLBACK_EMPTY_RUN: ChronosRun = {
  run_id: '00000000-0000-0000-0000-000000000000',
  started_at: new Date().toISOString(),
  completed_at: null,
  status: 'IN_PROGRESS',
  description: 'Awaiting Run Telemetry...',
  is_failure_experiment: false,
  events: [],
};

export const App: React.FC = () => {
  // Mode & Connection States
  const [mode, setMode] = useState<AppMode>('LIVE');
  const [connectionState, setConnectionState] = useState<BackendConnectionState>('CONNECTING');
  const [backendHealth, setBackendHealth] = useState<BackendHealth | null>(null);
  const [lastContactTime, setLastContactTime] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Runs & Active Data
  const [liveRuns, setLiveRuns] = useState<ChronosRun[]>([]);
  const [currentRun, setCurrentRun] = useState<ChronosRun>(DEMO_PREVIEW_RUNS[0]);
  const [liveTopology, setLiveTopology] = useState<TopologyResponse | null>(null);

  // Active view list of runs
  const runs = mode === 'LIVE' ? liveRuns : DEMO_PREVIEW_RUNS;

  // Dynamically derive service metrics for the current run
  const services = useMemo<ServiceSummary[]>(() => {
    return deriveServicesFromRun(currentRun);
  }, [currentRun]);

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [currentDestination, setCurrentDestination] = useState<NavDestination>('MONITOR');
  const [selectedEvent, setSelectedEvent] = useState<ChronosEvent | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>('orders');
  const [currentTimeMs, setCurrentTimeMs] = useState<number>(0);

  const [inspectorOpen, setInspectorOpen] = useState<boolean>(true);
  const [inspectorTarget, setInspectorTarget] = useState<InspectorTarget>(null);

  const fetchRequestIdRef = useRef<number>(0);

  // Keyboard shortcut: Escape closes context inspector
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && inspectorOpen) {
        setInspectorOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [inspectorOpen]);

  // Load a specific run's full events and topology from FastAPI
  const loadLiveRunDetails = useCallback(
    async (runId: string, runSummaryList?: ChronosRun[]) => {
      const reqId = ++fetchRequestIdRef.current;
      setIsLoading(true);

      try {
        const [events, topology] = await Promise.all([
          getRunEvents(runId),
          getRunTopology(runId).catch(() => null),
        ]);

        // Stale response guard
        if (reqId !== fetchRequestIdRef.current) return;

        let summary = runSummaryList?.find((r) => r.run_id === runId);
        if (!summary) {
          const runRecord = await getRun(runId);
          summary = buildChronosRun(runRecord, events);
        } else {
          summary = buildChronosRun(
            {
              run_id: summary.run_id,
              started_at: summary.started_at,
              completed_at: summary.completed_at,
              status: summary.status,
            },
            events
          );
        }

        setCurrentRun(summary);
        setLiveTopology(topology);

        // Update selected event and timeline
        const initialEvent =
          summary.events.find((e) => e.event_type === 'FAILURE_INJECTED') ||
          summary.events.find((e) => e.event_type === 'SERVICE_ERROR') ||
          summary.events[0] ||
          null;

        setSelectedEvent(initialEvent);
        setSelectedServiceId(initialEvent ? initialEvent.service_id : 'orders');
        setCurrentTimeMs(initialEvent ? (initialEvent.offset_ms ?? 0) : 0);

        if (initialEvent) {
          setInspectorTarget({ type: 'EVENT', event: initialEvent });
        } else {
          setInspectorTarget({ type: 'RUN_SUMMARY', run: summary });
        }
      } catch (err: unknown) {
        if (reqId === fetchRequestIdRef.current) {
          console.error('Failed to load run details:', err);
        }
      } finally {
        if (reqId === fetchRequestIdRef.current) {
          setIsLoading(false);
        }
      }
    },
    []
  );

  // Primary loader for LIVE backend telemetry
  const loadLiveData = useCallback(async () => {
    setIsLoading(true);
    setConnectionState('CONNECTING');
    setErrorMessage(null);

    try {
      // 1. Health check
      const health = await checkHealth();
      setBackendHealth(health);
      setConnectionState('CONNECTED');
      setLastContactTime(new Date());

      // 2. Fetch runs list
      const summaries = await getRuns(50);
      if (summaries.length === 0) {
        setLiveRuns([]);
        setCurrentRun(FALLBACK_EMPTY_RUN);
        setLiveTopology(null);
        setSelectedEvent(null);
        setIsLoading(false);
        return;
      }

      // Convert summaries to initial ChronosRuns
      const convertedRuns: ChronosRun[] = summaries.map((s) => ({
        run_id: s.run_id,
        started_at: s.started_at,
        completed_at: s.completed_at,
        status: s.status,
        description: `Run ${s.run_id.slice(0, 8)} (${s.status})`,
        is_failure_experiment: false,
        events: [],
      }));

      setLiveRuns(convertedRuns);

      // Select latest completed run, or first run if none completed
      const defaultRun = convertedRuns.find((r) => r.status === 'COMPLETED') || convertedRuns[0];
      await loadLiveRunDetails(defaultRun.run_id, convertedRuns);
    } catch (err: unknown) {
      console.error('Live backend connection error:', err);
      setConnectionState('DISCONNECTED');
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Unable to connect to FastAPI backend at http://127.0.0.1:8000'
      );
    } finally {
      setIsLoading(false);
    }
  }, [loadLiveRunDetails]);

  // Initial mount load
  useEffect(() => {
    if (mode === 'LIVE') {
      loadLiveData();
    } else {
      setConnectionState('CONNECTED');
      setCurrentRun(DEMO_PREVIEW_RUNS[0]);
      const initialEvent =
        DEMO_PREVIEW_RUNS[0].events.find((e) => e.event_type === 'FAILURE_INJECTED') ||
        DEMO_PREVIEW_RUNS[0].events[0];
      setSelectedEvent(initialEvent);
      setSelectedServiceId('payment');
      setCurrentTimeMs(initialEvent ? (initialEvent.offset_ms ?? 0) : 0);
      setInspectorTarget(initialEvent ? { type: 'EVENT', event: initialEvent } : null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Modest background polling (every 5 seconds in LIVE mode)
  useEffect(() => {
    if (mode !== 'LIVE') return;

    const interval = setInterval(async () => {
      try {
        const health = await checkHealth();
        setBackendHealth(health);
        setConnectionState('CONNECTED');
        setLastContactTime(new Date());

        // If the current run is IN_PROGRESS, poll its events to track completion
        if (currentRun.status === 'IN_PROGRESS' && currentRun.run_id !== FALLBACK_EMPTY_RUN.run_id) {
          const [events, summary] = await Promise.all([
            getRunEvents(currentRun.run_id),
            getRun(currentRun.run_id),
          ]);
          if (events.length !== currentRun.events.length || summary.status !== currentRun.status) {
            const updated = buildChronosRun(summary, events);
            setCurrentRun(updated);
          }
        }
      } catch {
        setConnectionState('DISCONNECTED');
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [mode, currentRun.status, currentRun.run_id, currentRun.events.length]);

  // Switch between LIVE and PREVIEW modes
  const handleToggleMode = (newMode: AppMode) => {
    if (newMode === mode) return;
    setMode(newMode);

    if (newMode === 'PREVIEW') {
      setCurrentRun(DEMO_PREVIEW_RUNS[0]);
      setLiveTopology(null);
      const initialEvent =
        DEMO_PREVIEW_RUNS[0].events.find((e) => e.event_type === 'FAILURE_INJECTED') ||
        DEMO_PREVIEW_RUNS[0].events[0];
      setSelectedEvent(initialEvent);
      setSelectedServiceId('payment');
      setCurrentTimeMs(initialEvent ? (initialEvent.offset_ms ?? 0) : 0);
      setInspectorTarget(initialEvent ? { type: 'EVENT', event: initialEvent } : null);
    } else {
      loadLiveData();
    }
  };

  // When switching runs from selector
  const handleSelectRun = (newRun: ChronosRun) => {
    if (mode === 'LIVE') {
      loadLiveRunDetails(newRun.run_id);
    } else {
      setCurrentRun(newRun);
      const initialEvent =
        newRun.events.find((e) => e.event_type === 'FAILURE_INJECTED') || newRun.events[0] || null;
      setSelectedEvent(initialEvent);
      setSelectedServiceId(initialEvent ? initialEvent.service_id : 'orders');
      setCurrentTimeMs(initialEvent ? (initialEvent.offset_ms ?? 0) : 0);
      setInspectorTarget(initialEvent ? { type: 'EVENT', event: initialEvent } : null);
    }
  };

  const handleSelectEvent = (event: ChronosEvent) => {
    setSelectedEvent(event);
    setSelectedServiceId(event.service_id);
    setCurrentTimeMs(event.offset_ms ?? 0);
    setInspectorTarget({ type: 'EVENT', event });
    setInspectorOpen(true);
  };

  const handleSelectService = (service: ServiceSummary) => {
    setSelectedServiceId(service.id);
    const svcEvent = currentRun.events.find((e) => e.service_id === service.id);
    if (svcEvent) {
      setSelectedEvent(svcEvent);
      setCurrentTimeMs(svcEvent.offset_ms ?? 0);
    }
    setInspectorTarget({ type: 'SERVICE', service });
    setInspectorOpen(true);
  };

  const handleSelectMetric = (_metricKey: string) => {
    setInspectorTarget({ type: 'RUN_SUMMARY', run: currentRun });
    setInspectorOpen(true);
  };

  const isDisconnected = mode === 'LIVE' && connectionState === 'DISCONNECTED';

  return (
    <div className="flex flex-col w-screen h-screen overflow-hidden bg-chrono-bg select-none">
      {/* 1. Cockpit Header Bar */}
      <Header
        currentRun={currentRun}
        runs={runs}
        onSelectRun={handleSelectRun}
        mode={mode}
        onToggleMode={handleToggleMode}
        connectionState={connectionState}
        backendHealth={backendHealth}
        lastContactTime={lastContactTime}
        isLoading={isLoading}
        onRefresh={loadLiveData}
        inspectorOpen={inspectorOpen}
        onToggleInspector={() => setInspectorOpen(!inspectorOpen)}
        onSelectInspectorTarget={(target) => {
          setInspectorTarget(target);
          setInspectorOpen(true);
        }}
      />

      {/* 2. Main Middle Workspace: Left Persistent Navigation Rail + Center Instrument + Right Inspector */}
      <div className="flex-1 flex overflow-hidden min-h-0 relative">
        {/* Left Vertical Navigation */}
        <Navigation
          currentDestination={currentDestination}
          onSelectDestination={setCurrentDestination}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        />

        {/* Center Main Panoramic Field */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-chrono-bg">
          {isDisconnected ? (
            /* Honest Disconnected State */
            <div className="w-full h-full flex flex-col items-center justify-center p-8 bg-[#050804] text-center">
              <div className="p-6 bg-[#090e06] border border-chrono-red max-w-lg shadow-2xl space-y-4">
                <AlertTriangle className="w-10 h-10 text-chrono-red mx-auto drop-shadow-[0_0_10px_#ff3333]" />
                <div className="font-ui font-bold text-sm tracking-widest text-chrono-red uppercase">
                  BACKEND DISCONNECTED // HTTP 127.0.0.1:8000
                </div>
                <p className="font-mono text-xs text-chrono-muted leading-relaxed">
                  {errorMessage ||
                    'Could not establish HTTP connection to FastAPI backend. Verify that the Docker Compose stack is running and container 01-http-basics-orders-1 is healthy on port 8000.'}
                </p>
                <div className="p-3 bg-[#030502] border border-chrono-grid/60 text-left font-mono text-[10px] text-chrono-muted space-y-1">
                  <div>TARGET URL: http://127.0.0.1:8000</div>
                  <div>EXPECTED CONTAINER: 01-http-basics-orders-1</div>
                  <div>POSTGRES STORE: Port 5432</div>
                </div>
                <div className="flex items-center justify-center gap-3 pt-2">
                  <button
                    onClick={loadLiveData}
                    disabled={isLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-[#190c0c] border border-chrono-red text-chrono-red font-mono text-xs font-bold hover:bg-chrono-red hover:text-black transition-colors"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                    RETRY CONNECTION
                  </button>
                  <button
                    onClick={() => handleToggleMode('PREVIEW')}
                    className="flex items-center gap-2 px-4 py-2 bg-[#1c1407] border border-chrono-amber text-chrono-amber font-mono text-xs font-bold hover:bg-chrono-amber hover:text-black transition-colors"
                  >
                    <Radio className="w-3.5 h-3.5" />
                    SWITCH TO PREVIEW
                  </button>
                </div>
              </div>
            </div>
          ) : currentDestination === 'MONITOR' ? (
            <MonitorView
              run={currentRun}
              services={services}
              selectedEvent={selectedEvent}
              selectedServiceId={selectedServiceId}
              currentTimeMs={currentTimeMs}
              onSelectEvent={handleSelectEvent}
              onSelectService={handleSelectService}
              onTimeChange={setCurrentTimeMs}
              onSelectMetric={handleSelectMetric}
              mode={mode}
            />
          ) : currentDestination === 'TOPOLOGY' ? (
            <TopologyView
              run={currentRun}
              services={services}
              topologyData={liveTopology}
              mode={mode}
              selectedServiceId={selectedServiceId}
              onSelectService={handleSelectService}
              onSelectEvent={handleSelectEvent}
              onReturnToMonitor={() => setCurrentDestination('MONITOR')}
            />
          ) : currentDestination === 'RUNS' ? (
            <RunsView
              runs={runs}
              currentRun={currentRun}
              mode={mode}
              isLoading={isLoading}
              onRefresh={loadLiveData}
              onSelectRun={handleSelectRun}
              onSwitchToMonitor={() => setCurrentDestination('MONITOR')}
            />
          ) : (
            <UnimplementedView
              destination={currentDestination}
              onReturnToMonitor={() => setCurrentDestination('MONITOR')}
            />
          )}
        </main>

        {/* Right Context Inspector Panel */}
        {inspectorOpen && (
          <Inspector
            target={inspectorTarget}
            onClose={() => setInspectorOpen(false)}
            onSelectEvent={handleSelectEvent}
            backendHealth={backendHealth}
            connectionState={connectionState}
            lastContactTime={lastContactTime}
            mode={mode}
          />
        )}
      </div>

      {/* 3. Bottom Operational Status Strip */}
      <StatusStrip
        currentRun={currentRun}
        currentTimeMs={currentTimeMs}
        mode={mode}
      />
    </div>
  );
};

export default App;
