import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { ChronosEvent, ChronosRun, ServiceSummary } from './types/events';
import { NavDestination, InspectorTarget } from './types/ui';
import {
  AppMode,
  BackendConnectionState,
  BackendHealth,
  TopologyResponse,
  ExecutionResultInfo,
  ExecutionErrorInfo,
} from './types/api';
import { DEMO_PREVIEW_RUNS } from './data/fixtures';
import {
  checkHealth,
  getRuns,
  getRun,
  createRun,
  checkoutOrder,
  injectFailure,
  getRunEvents,
  getRunTopology,
  buildChronosRun,
  deriveServicesFromRun,
  deriveCheckoutOutcome,
  canSwitchRun,
  shouldApplyRunResponse,
  parseApiError,
} from './services/chronosApi';
import { Header } from './components/Header';
import { Navigation } from './components/Navigation';
import { StatusStrip } from './components/StatusStrip';
import { Inspector } from './components/Inspector';
import { MonitorView } from './components/monitor/MonitorView';
import { TopologyView } from './components/views/TopologyView';
import { RunsView } from './components/views/RunsView';
import { AlertTriangle, RefreshCw, Radio, Lock, KeyRound } from 'lucide-react';
import { AuthProvider, useAuth } from './auth/AuthContext';

const CockpitApp: React.FC = () => {
  const { status: authStatus, user, error: authError, signIn, signOut } = useAuth();

  // Mode & Connection States
  const [mode, setMode] = useState<AppMode>('LIVE');
  const [connectionState, setConnectionState] = useState<BackendConnectionState>('CONNECTING');
  const [backendHealth, setBackendHealth] = useState<BackendHealth | null>(null);
  const [lastContactTime, setLastContactTime] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isCreatingRun, setIsCreatingRun] = useState<boolean>(false);
  const [runCreationError, setRunCreationError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Active Experiment Execution States
  const [isExecutingCheckout, setIsExecutingCheckout] = useState<boolean>(false);
  const [isInjectingFailure, setIsInjectingFailure] = useState<boolean>(false);
  const [lastExecutionResult, setLastExecutionResult] = useState<ExecutionResultInfo | null>(null);
  const [executionError, setExecutionError] = useState<ExecutionErrorInfo | null>(null);
  const selectedRunIdRef = useRef<string | null>(null);

  // Runs & Active Data
  const [liveRuns, setLiveRuns] = useState<ChronosRun[]>([]);
  const [currentRun, setCurrentRun] = useState<ChronosRun | null>(null);
  const [liveTopology, setLiveTopology] = useState<TopologyResponse | null>(null);

  // Active view list of runs
  const runs = mode === 'LIVE' ? liveRuns : DEMO_PREVIEW_RUNS;

  // Dynamically derive service metrics for the current run and live health signals
  const services = useMemo<ServiceSummary[]>(() => {
    return deriveServicesFromRun(currentRun, { mode, backendHealth });
  }, [currentRun, mode, backendHealth]);

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [currentDestination, setCurrentDestination] = useState<NavDestination>('MONITOR');
  const [focusStagingToken, setFocusStagingToken] = useState<number>(0);
  const [selectedEvent, setSelectedEvent] = useState<ChronosEvent | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>('orders');
  const [currentTimeMs, setCurrentTimeMs] = useState<number>(0);

  const [inspectorOpen, setInspectorOpen] = useState<boolean>(true);
  const [inspectorTarget, setInspectorTarget] = useState<InspectorTarget>(null);

  const fetchRequestIdRef = useRef<number>(0);
  const liveDataRequestIdRef = useRef<number>(0);
  const modeRef = useRef<AppMode>(mode);
  const isActionInProgressRef = useRef<boolean>(false);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    isActionInProgressRef.current = isExecutingCheckout || isInjectingFailure || isCreatingRun;
  }, [isExecutingCheckout, isInjectingFailure, isCreatingRun]);

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
    async (runId: string, runSummaryList?: ChronosRun[]): Promise<ChronosRun | null> => {
      const reqId = ++fetchRequestIdRef.current;
      if (modeRef.current !== 'LIVE') {
        setIsLoading(false);
        return null;
      }
      setIsLoading(true);

      try {
        const [events, topology] = await Promise.all([
          getRunEvents(runId),
          getRunTopology(runId).catch(() => null),
        ]);

        // Stale response and mode-leakage guards
        if (
          !shouldApplyRunResponse({
            requestId: reqId,
            activeRequestId: fetchRequestIdRef.current,
            requestMode: 'LIVE',
            currentMode: modeRef.current,
            targetRunId: runId,
            selectedRunId: selectedRunIdRef.current,
          })
        ) {
          return null;
        }

        let summary = runSummaryList?.find((r) => r.run_id === runId);
        if (!summary) {
          const runRecord = await getRun(runId);
          if (
            !shouldApplyRunResponse({
              requestId: reqId,
              activeRequestId: fetchRequestIdRef.current,
              requestMode: 'LIVE',
              currentMode: modeRef.current,
              targetRunId: runId,
              selectedRunId: selectedRunIdRef.current,
            })
          ) {
            return null;
          }
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
        selectedRunIdRef.current = runId;

        // Update selected event and timeline (clamp scrubber to >= 0 execution timeline)
        const initialEvent =
          summary.events.find((e) => e.event_type === 'FAILURE_INJECTED') ||
          summary.events.find((e) => e.event_type === 'SERVICE_ERROR') ||
          summary.events[0] ||
          null;

        setSelectedEvent(initialEvent);
        setSelectedServiceId(initialEvent ? initialEvent.service_id : 'orders');
        setCurrentTimeMs(initialEvent ? Math.max(0, initialEvent.offset_ms ?? 0) : 0);

        if (initialEvent) {
          setInspectorTarget({ type: 'EVENT', event: initialEvent });
        } else {
          setInspectorTarget({ type: 'RUN_SUMMARY', run: summary });
        }
        return summary;
      } catch (err: unknown) {
        if (reqId === fetchRequestIdRef.current && modeRef.current === 'LIVE') {
          console.error('Failed to load run details:', err);
        }
        return null;
      } finally {
        if (reqId === fetchRequestIdRef.current || modeRef.current !== 'LIVE') {
          setIsLoading(false);
        }
      }
    },
    []
  );

  // Primary loader for LIVE backend telemetry
  const loadLiveData = useCallback(async () => {
    if (modeRef.current !== 'LIVE' || authStatus !== 'AUTHENTICATED') return;
    const reqId = ++liveDataRequestIdRef.current;
    let delegatedToDetails = false;

    setIsLoading(true);
    setConnectionState('CONNECTING');
    setErrorMessage(null);

    try {
      // 1. Health check
      const health = await checkHealth();
      if (reqId !== liveDataRequestIdRef.current || modeRef.current !== 'LIVE') return;
      setBackendHealth(health);
      setConnectionState('CONNECTED');
      setLastContactTime(new Date());

      // 2. Fetch runs list
      const summaries = await getRuns(50);
      if (reqId !== liveDataRequestIdRef.current || modeRef.current !== 'LIVE') return;

      if (summaries.length === 0) {
        selectedRunIdRef.current = null;
        setLiveRuns([]);
        setCurrentRun(null);
        setLiveTopology(null);
        setSelectedEvent(null);
        setInspectorTarget(null);
        return;
      }

      // Convert summaries to initial ChronosRuns
      const convertedRuns: ChronosRun[] = summaries.map((s) => ({
        run_id: s.run_id,
        started_at: s.started_at,
        completed_at: s.completed_at ?? null,
        status: s.status,
        description: `Run ${s.run_id.slice(0, 8)} (${s.status})`,
        is_failure_experiment: false,
        events: [],
      }));

      setLiveRuns(convertedRuns);

      // Preserve currently selected run if present in the fresh list, otherwise select latest run (or first)
      const preservedRun = selectedRunIdRef.current
        ? convertedRuns.find((r) => r.run_id === selectedRunIdRef.current)
        : null;
      const targetRun = preservedRun || convertedRuns[0];
      if (!preservedRun || selectedRunIdRef.current !== targetRun.run_id) {
        setLastExecutionResult(null);
        setExecutionError(null);
      }
      selectedRunIdRef.current = targetRun.run_id;
      delegatedToDetails = true;
      await loadLiveRunDetails(targetRun.run_id, convertedRuns);
    } catch (err: unknown) {
      if (reqId !== liveDataRequestIdRef.current || modeRef.current !== 'LIVE') return;
      console.error('Live backend connection error:', err);
      setConnectionState('DISCONNECTED');
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Unable to connect to FastAPI backend at http://127.0.0.1:8000'
      );
    } finally {
      if (reqId === liveDataRequestIdRef.current && (!delegatedToDetails || modeRef.current !== 'LIVE')) {
        setIsLoading(false);
      }
    }
  }, [authStatus, loadLiveRunDetails]);

  // Initial mount and mode-change load
  useEffect(() => {
    if (mode === 'LIVE') {
      if (authStatus === 'AUTHENTICATED') {
        loadLiveData();
      }
    } else {
      setIsLoading(false);
      setConnectionState('CONNECTED');
      setCurrentRun(DEMO_PREVIEW_RUNS[0]);
      const initialEvent =
        DEMO_PREVIEW_RUNS[0].events.find((e) => e.event_type === 'FAILURE_INJECTED') ||
        DEMO_PREVIEW_RUNS[0].events[0];
      setSelectedEvent(initialEvent);
      setSelectedServiceId('payment');
      setCurrentTimeMs(initialEvent ? Math.max(0, initialEvent.offset_ms ?? 0) : 0);
      setInspectorTarget(initialEvent ? { type: 'EVENT', event: initialEvent } : null);
    }
  }, [mode, authStatus, loadLiveData]);

  // Modest background polling (every 5 seconds in LIVE mode)
  useEffect(() => {
    if (mode !== 'LIVE' || authStatus !== 'AUTHENTICATED') return;
    let cancelled = false;

    const interval = setInterval(async () => {
      if (cancelled || modeRef.current !== 'LIVE' || isActionInProgressRef.current || isLoading) {
        return;
      }

      const polledRunId = currentRun?.run_id ?? null;

      try {
        const health = await checkHealth();
        if (cancelled || modeRef.current !== 'LIVE') return;
        setBackendHealth(health);
        setConnectionState('CONNECTED');
        setLastContactTime(new Date());

        // If the current run is IN_PROGRESS, poll its events to track completion
        if (
          !isActionInProgressRef.current &&
          currentRun &&
          currentRun.status === 'IN_PROGRESS' &&
          polledRunId &&
          selectedRunIdRef.current === polledRunId
        ) {
          const [events, summary] = await Promise.all([
            getRunEvents(polledRunId),
            getRun(polledRunId),
          ]);
          if (
            cancelled ||
            modeRef.current !== 'LIVE' ||
            isActionInProgressRef.current ||
            selectedRunIdRef.current !== polledRunId
          ) {
            return;
          }
          if (events.length !== currentRun.events.length || summary.status !== currentRun.status) {
            const updated = buildChronosRun(summary, events);
            setCurrentRun(updated);
            setLiveRuns((prev) =>
              prev.map((r) =>
                r.run_id === polledRunId
                  ? { ...r, status: summary.status, completed_at: summary.completed_at ?? null }
                  : r
              )
            );
          }
        }
      } catch {
        if (!cancelled && modeRef.current === 'LIVE') {
          setConnectionState('DISCONNECTED');
        }
      }
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [mode, currentRun?.status, currentRun?.run_id, currentRun?.events.length, isLoading]);

  // Switch between LIVE and PREVIEW modes
  const handleToggleMode = (newMode: AppMode) => {
    if (newMode === mode || isActionInProgressRef.current) return;
    modeRef.current = newMode;
    ++fetchRequestIdRef.current;
    ++liveDataRequestIdRef.current;

    setRunCreationError(null);
    setLastExecutionResult(null);
    setExecutionError(null);
    setErrorMessage(null);
    setMode(newMode);

    if (newMode === 'PREVIEW') {
      selectedRunIdRef.current = null;
      setIsLoading(false);
      setLiveRuns([]);
      setLiveTopology(null);
      setConnectionState('CONNECTED');
      setCurrentRun(DEMO_PREVIEW_RUNS[0]);
      const initialEvent =
        DEMO_PREVIEW_RUNS[0].events.find((e) => e.event_type === 'FAILURE_INJECTED') ||
        DEMO_PREVIEW_RUNS[0].events[0];
      setSelectedEvent(initialEvent);
      setSelectedServiceId('payment');
      setCurrentTimeMs(initialEvent ? Math.max(0, initialEvent.offset_ms ?? 0) : 0);
      setInspectorTarget(initialEvent ? { type: 'EVENT', event: initialEvent } : null);
    } else {
      selectedRunIdRef.current = null;
      setCurrentRun(null);
      setLiveTopology(null);
      setSelectedEvent(null);
      setInspectorTarget(null);
    }
  };

  // When switching runs from selector
  const handleSelectRun = (newRun: ChronosRun) => {
    if (
      !canSwitchRun({
        isExecutingCheckout,
        isInjectingFailure,
        isCreatingRun,
      }) ||
      isActionInProgressRef.current
    ) {
      return;
    }

    selectedRunIdRef.current = newRun.run_id;
    setLastExecutionResult(null);
    setExecutionError(null);
    if (modeRef.current === 'LIVE') {
      loadLiveRunDetails(newRun.run_id);
    } else {
      setCurrentRun(newRun);
      const initialEvent =
        newRun.events.find((e) => e.event_type === 'FAILURE_INJECTED') || newRun.events[0] || null;
      setSelectedEvent(initialEvent);
      setSelectedServiceId(initialEvent ? initialEvent.service_id : 'orders');
      setCurrentTimeMs(initialEvent ? Math.max(0, initialEvent.offset_ms ?? 0) : 0);
      setInspectorTarget(initialEvent ? { type: 'EVENT', event: initialEvent } : null);
    }
  };

  // Create a new run via POST /runs and immediately load it
  const handleCreateRun = async () => {
    if (
      isCreatingRun ||
      isExecutingCheckout ||
      isInjectingFailure ||
      isActionInProgressRef.current ||
      modeRef.current !== 'LIVE'
    ) {
      return;
    }

    isActionInProgressRef.current = true;
    setIsCreatingRun(true);
    setRunCreationError(null);
    setLastExecutionResult(null);
    setExecutionError(null);

    try {
      const newRunSummary = await createRun();
      if (modeRef.current !== 'LIVE') return;

      const newRunId = newRunSummary.run_id;
      selectedRunIdRef.current = newRunId;

      // Refresh runs list from backend
      const summaries = await getRuns(50);
      if (modeRef.current !== 'LIVE') return;

      let convertedRuns: ChronosRun[] = summaries.map((s) => ({
        run_id: s.run_id,
        started_at: s.started_at,
        completed_at: s.completed_at ?? null,
        status: s.status,
        description: `Run ${s.run_id.slice(0, 8)} (${s.status})`,
        is_failure_experiment: false,
        events: [],
      }));

      // Guarantee the newly created run is present at the top
      if (!convertedRuns.some((r) => r.run_id === newRunId)) {
        convertedRuns = [
          {
            run_id: newRunSummary.run_id,
            started_at: newRunSummary.started_at,
            completed_at: newRunSummary.completed_at ?? null,
            status: newRunSummary.status,
            description: `Run ${newRunSummary.run_id.slice(0, 8)} (${newRunSummary.status})`,
            is_failure_experiment: false,
            events: [],
          },
          ...convertedRuns,
        ];
      }
      setLiveRuns(convertedRuns);

      // Load full events and topology for the new run
      await loadLiveRunDetails(newRunId, convertedRuns);
      if (modeRef.current !== 'LIVE') return;

      // Return the user to Monitor view so the new run is immediately accessible
      setCurrentDestination('MONITOR');
    } catch (err: unknown) {
      if (modeRef.current !== 'LIVE') return;
      console.error('Failed to create run:', err);
      const parsed = parseApiError(err, 'Failed to initialize run on backend');
      setRunCreationError(
        parsed.status ? `HTTP ${parsed.status}: ${parsed.message}` : parsed.message
      );
    } finally {
      setIsCreatingRun(false);
    }
  };

  // Execute checkout for Order 101 associated with current run ID
  const handleExecuteCheckout = async () => {
    if (
      isExecutingCheckout ||
      isInjectingFailure ||
      isCreatingRun ||
      isLoading ||
      isActionInProgressRef.current ||
      modeRef.current !== 'LIVE' ||
      !currentRun?.run_id
    ) {
      return;
    }

    isActionInProgressRef.current = true;
    setIsExecutingCheckout(true);
    setLastExecutionResult(null);
    setExecutionError(null);

    const targetRunId = currentRun.run_id;
    const wasFailureExperimentArmed =
      currentRun.events.some((e) => e.event_type === 'FAILURE_INJECTED') ||
      currentRun.is_failure_experiment;

    try {
      const res = await checkoutOrder(101, targetRunId);
      if (modeRef.current !== 'LIVE' || selectedRunIdRef.current !== targetRunId) return;

      const rawPaymentStatus =
        typeof res.payment_status === 'string' ? res.payment_status.trim() : '';

      // Reload persisted events and run summary BEFORE rendering any approval banner
      const loadedRun = await loadLiveRunDetails(targetRunId);
      if (modeRef.current !== 'LIVE') return;

      // Refresh runs list to show updated status
      const summaries = await getRuns(50);
      if (modeRef.current !== 'LIVE') return;
      const convertedRuns: ChronosRun[] = summaries.map((s) => ({
        run_id: s.run_id,
        started_at: s.started_at,
        completed_at: s.completed_at ?? null,
        status: s.status,
        description: `Run ${s.run_id.slice(0, 8)} (${s.status})`,
        is_failure_experiment: false,
        events: [],
      }));
      setLiveRuns(convertedRuns);

      if (selectedRunIdRef.current !== targetRunId) return;

      if (!loadedRun) {
        setLastExecutionResult(null);
        setExecutionError({
          runId: targetRunId,
          code: 'TELEMETRY_UNVERIFIED',
          message:
            'Checkout returned HTTP 200, but reloading persisted run events failed.',
          isExpectedFailurePropagation: false,
          details:
            'Approval banner suppressed until persisted RESPONSE and REQUEST_END COMPLETED events can be verified.',
        });
        return;
      }

      const outcome = deriveCheckoutOutcome(loadedRun);
      if (
        rawPaymentStatus.toLowerCase() === 'approved' &&
        outcome.hasConfirmedPaymentSuccess
      ) {
        setLastExecutionResult({
          runId: targetRunId,
          kind: 'checkout',
          status: 200,
          message: `Order 101 checkout completed (${rawPaymentStatus})`,
          details: outcome.paymentRespondedAfterPriorFailure
            ? `Confirmed persisted RESPONSE 200 & REQUEST_END COMPLETED (prior FAILURE_INJECTED existed, but Payment returned HTTP 200 at checkout) | Item: ${res.item || 'Keyboard'}`
            : `Confirmed persisted RESPONSE 200 & REQUEST_END COMPLETED | Item: ${res.item || 'Keyboard'} | Status: ${res.status || 'completed'}`,
        });
      } else {
        setLastExecutionResult(null);
        setExecutionError({
          runId: targetRunId,
          code: 'UNCONFIRMED_PAYMENT_OUTCOME',
          message:
            'Checkout response could not be confirmed as Payment-approved from persisted run telemetry.',
          isExpectedFailurePropagation: false,
          details: `run.status=${loadedRun.status}, payment_status=${rawPaymentStatus || 'missing'}, hasResponse2xx=${outcome.hasResponse2xx}, hasServiceError=${outcome.hasServiceError}`,
        });
      }
    } catch (err: unknown) {
      if (modeRef.current !== 'LIVE') return;
      console.error('Checkout execution error:', err);
      const parsed = parseApiError(err, 'Checkout execution request failed');
      setLastExecutionResult(null);

      // Expected fault propagation occurs only when a failure experiment was armed and
      // Orders received an upstream failure from Payment (HTTP 502/503/504)
      const isExpectedFault =
        wasFailureExperimentArmed &&
        (parsed.status === 502 || parsed.status === 503 || parsed.status === 504);

      if (selectedRunIdRef.current === targetRunId) {
        setExecutionError({
          runId: targetRunId,
          status: parsed.status,
          code: parsed.code,
          message: parsed.message,
          isExpectedFailurePropagation: isExpectedFault,
          details: isExpectedFault
            ? 'Orders received the injected Payment failure, recorded SERVICE_ERROR and REQUEST_END, and transitioned the run to FAILED.'
            : parsed.code === 'TIMEOUT'
              ? 'Client waited longer than the backend timeout without receiving a response. Run telemetry is being refreshed.'
              : undefined,
        });
      }

      // Refresh persisted backend state unless network is completely unreachable
      if (parsed.code !== 'NETWORK_ERROR') {
        try {
          if (selectedRunIdRef.current === targetRunId) {
            await loadLiveRunDetails(targetRunId);
          }
          if (modeRef.current !== 'LIVE') return;
          const summaries = await getRuns(50);
          if (modeRef.current !== 'LIVE') return;
          const convertedRuns: ChronosRun[] = summaries.map((s) => ({
            run_id: s.run_id,
            started_at: s.started_at,
            completed_at: s.completed_at ?? null,
            status: s.status,
            description: `Run ${s.run_id.slice(0, 8)} (${s.status})`,
            is_failure_experiment: false,
            events: [],
          }));
          setLiveRuns(convertedRuns);
        } catch {
          // secondary catch ignored so original error stays intact
        }
      }
    } finally {
      setIsExecutingCheckout(false);
    }
  };

  // Inject failure into payment service for the current run
  const handleInjectFailure = async () => {
    if (
      isInjectingFailure ||
      isExecutingCheckout ||
      isCreatingRun ||
      isLoading ||
      isActionInProgressRef.current ||
      modeRef.current !== 'LIVE' ||
      !currentRun?.run_id
    ) {
      return;
    }

    isActionInProgressRef.current = true;
    setIsInjectingFailure(true);
    setLastExecutionResult(null);
    setExecutionError(null);

    const targetRunId = currentRun.run_id;

    try {
      const res = await injectFailure(targetRunId, 'payment');
      if (modeRef.current !== 'LIVE' || selectedRunIdRef.current !== targetRunId) return;

      setLastExecutionResult({
        runId: targetRunId,
        kind: 'failure_injection',
        status: 200,
        message: `Payment failure injected: Target '${res.target}', Action '${res.action}'`,
        details:
          'FAILURE_INJECTED event persisted. Payment stays stopped until manually restarted via docker compose start payment.',
      });

      // Reload run details to immediately surface FAILURE_INJECTED event
      await loadLiveRunDetails(targetRunId);
      if (modeRef.current !== 'LIVE') return;

      const summaries = await getRuns(50);
      if (modeRef.current !== 'LIVE') return;
      setLiveRuns(
        summaries.map((s) => ({
          run_id: s.run_id,
          started_at: s.started_at,
          completed_at: s.completed_at ?? null,
          status: s.status,
          description: `Run ${s.run_id.slice(0, 8)} (${s.status})`,
          is_failure_experiment: false,
          events: [],
        }))
      );
    } catch (err: unknown) {
      if (modeRef.current !== 'LIVE') return;
      console.error('Failure injection error:', err);
      const parsed = parseApiError(err, 'Failure injection request failed');
      setLastExecutionResult(null);

      // Refresh run details before finalizing UI state on timeout or ambiguous error
      let persistedFailureEvent = false;
      if (parsed.code !== 'NETWORK_ERROR' && selectedRunIdRef.current === targetRunId) {
        try {
          const [events, runRecord] = await Promise.all([
            getRunEvents(targetRunId),
            getRun(targetRunId),
          ]);
          if (modeRef.current === 'LIVE' && selectedRunIdRef.current === targetRunId) {
            persistedFailureEvent = events.some((e) => e.event_type === 'FAILURE_INJECTED');
            const updated = buildChronosRun(runRecord, events);
            setCurrentRun(updated);
            const focusEvent =
              updated.events.find((e) => e.event_type === 'FAILURE_INJECTED') ||
              updated.events[0] ||
              null;
            if (focusEvent) {
              setSelectedEvent(focusEvent);
              setSelectedServiceId(focusEvent.service_id);
              setCurrentTimeMs(Math.max(0, focusEvent.offset_ms ?? 0));
              setInspectorTarget({ type: 'EVENT', event: focusEvent });
            }
          }
        } catch {
          // secondary catch ignored
        }
      }

      if (modeRef.current === 'LIVE' && selectedRunIdRef.current === targetRunId) {
        setExecutionError({
          runId: targetRunId,
          status: parsed.status,
          code: parsed.code,
          message: parsed.message,
          isExpectedFailurePropagation: false,
          details: persistedFailureEvent
            ? 'Refreshed telemetry shows FAILURE_INJECTED was recorded on the backend despite the error response. Check run events before retrying.'
            : 'Refreshed run telemetry. Failure injection did not receive a 2xx confirmation from the backend.',
        });
      }
    } finally {
      setIsInjectingFailure(false);
    }
  };

  const handleSelectEvent = (event: ChronosEvent) => {
    setSelectedEvent(event);
    setSelectedServiceId(event.service_id);
    setCurrentTimeMs(Math.max(0, event.offset_ms ?? 0));
    setInspectorTarget({ type: 'EVENT', event });
    setInspectorOpen(true);
  };

  const handleSelectService = (service: ServiceSummary) => {
    setSelectedServiceId(service.id);
    const svcEvent = currentRun?.events.find((e) => e.service_id === service.id);
    if (svcEvent) {
      setSelectedEvent(svcEvent);
      setCurrentTimeMs(Math.max(0, svcEvent.offset_ms ?? 0));
    }
    setInspectorTarget({ type: 'SERVICE', service });
    setInspectorOpen(true);
  };

  const handleSelectMetric = (_metricKey: string) => {
    if (!currentRun) return;
    setInspectorTarget({ type: 'RUN_SUMMARY', run: currentRun });
    setInspectorOpen(true);
  };

  const isDisconnected = mode === 'LIVE' && connectionState === 'DISCONNECTED';

  if (authStatus === 'LOADING') {
    return (
      <div className="flex flex-col h-screen bg-[#020402] text-chrono-text font-mono items-center justify-center p-6 select-none">
        <div className="max-w-md w-full bg-[#070b05] border border-chrono-grid p-6 text-center space-y-4 shadow-[0_0_20px_rgba(0,0,0,0.8)]">
          <div className="w-3 h-8 bg-chrono-phosphor mx-auto shadow-[0_0_12px_#b8ff00] animate-pulse" />
          <div className="font-ui font-bold text-sm tracking-widest text-chrono-phosphor drop-shadow-[0_0_6px_rgba(184,255,0,0.6)]">
            CHRONOS // AUTHENTICATION GATEWAY
          </div>
          <div className="text-xs text-chrono-muted animate-pulse">
            SYNCHRONIZING OPERATOR SESSION...
          </div>
        </div>
      </div>
    );
  }

  if (authStatus === 'CONFIG_ERROR' && mode === 'LIVE') {
    return (
      <div className="flex flex-col h-screen bg-[#020402] text-chrono-text font-mono items-center justify-center p-6 select-none">
        <div className="max-w-lg w-full bg-[#070b05] border border-chrono-amber/80 p-6 space-y-4 shadow-[0_0_24px_rgba(255,158,0,0.2)]">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-chrono-amber animate-pulse" />
            <div className="font-ui font-bold text-sm tracking-widest text-chrono-amber">
              SECURITY CONFIGURATION WARNING
            </div>
          </div>
          <div className="text-xs text-chrono-text leading-relaxed">
            Amazon Cognito environment variables (<code className="text-chrono-phosphor">VITE_COGNITO_USER_POOL_ID</code>, <code className="text-chrono-phosphor">VITE_COGNITO_USER_POOL_CLIENT_ID</code>, <code className="text-chrono-phosphor">VITE_COGNITO_REGION</code>) are not configured in this client bundle.
          </div>
          <div className="p-3 bg-[#030502] border border-chrono-grid text-[10px] text-chrono-muted space-y-1">
            <div>TARGET POOL: ap-south-1_tDVeeHq0g (chronos-users)</div>
            <div>CLIENT ID: 4268fo6vpodgv8dt37tim2aec3</div>
            <div>STATUS: UNCONFIGURED CLIENT ENVIRONMENT</div>
          </div>
          <div className="flex items-center justify-between pt-2">
            <span className="text-[10px] text-chrono-muted">Explore offline without credentials:</span>
            <button
              onClick={() => handleToggleMode('PREVIEW')}
              className="flex items-center gap-2 px-4 py-2 bg-[#1c1407] border border-chrono-amber text-chrono-amber font-mono text-xs font-bold hover:bg-chrono-amber hover:text-black transition-colors"
            >
              <Radio className="w-3.5 h-3.5" />
              SWITCH TO PREVIEW MODE
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (authStatus === 'UNAUTHENTICATED' && mode === 'LIVE') {
    return (
      <div className="flex flex-col h-screen bg-[#020402] text-chrono-text font-mono items-center justify-center p-6 select-none">
        <div className="max-w-lg w-full bg-[#070b05] border border-chrono-phosphor/80 p-8 space-y-6 shadow-[0_0_30px_rgba(184,255,0,0.15)] relative">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-chrono-phosphor via-transparent to-chrono-phosphor" />

          <div className="flex items-center gap-3">
            <div className="w-2.5 h-8 bg-chrono-phosphor shadow-[0_0_10px_#b8ff00]" />
            <div>
              <div className="font-ui font-bold text-base tracking-widest text-chrono-phosphor drop-shadow-[0_0_6px_rgba(184,255,0,0.6)]">
                CHRONOS // COCKPIT ACCESS
              </div>
              <div className="text-[10px] text-chrono-muted tracking-wider">
                DISTRIBUTED OBSERVABILITY & FAILURE INJECTION PLATFORM
              </div>
            </div>
          </div>

          <div className="p-4 bg-[#030502] border border-chrono-grid/80 space-y-2 text-xs">
            <div className="flex items-center gap-2 text-chrono-phosphor font-bold text-[11px] mb-1">
              <Lock className="w-3.5 h-3.5" />
              <span>AUTHENTICATION REQUIRED</span>
            </div>
            <div className="text-chrono-muted text-[11px] leading-relaxed">
              This terminal is connected to an authenticated distributed cluster. You must authenticate via Amazon Cognito Managed Login to access live telemetry, active runs, and fault injection capabilities.
            </div>
            <div className="pt-2 border-t border-chrono-grid/50 grid grid-cols-2 gap-2 text-[10px] text-chrono-muted">
              <div>USER POOL: <span className="text-chrono-text">ap-south-1_tDVeeHq0g</span></div>
              <div>CLIENT: <span className="text-chrono-text">chronos-web-client</span></div>
              <div>AUTH FLOW: <span className="text-chrono-text">PKCE Authorization Code</span></div>
              <div>REGION: <span className="text-chrono-text">ap-south-1</span></div>
            </div>
          </div>

          {authError && (
            <div className="p-3 bg-[#190c0c] border border-chrono-red text-chrono-red text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{authError}</span>
            </div>
          )}

          <div className="space-y-3 pt-2">
            <button
              onClick={signIn}
              className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-[#12220f] border-2 border-chrono-phosphor text-chrono-phosphor font-mono text-xs font-bold tracking-widest hover:bg-chrono-phosphor hover:text-black transition-all shadow-[0_0_15px_rgba(184,255,0,0.3)] cursor-pointer"
            >
              <KeyRound className="w-4 h-4" />
              [ INITIATE SECURE SIGN IN ]
            </button>

            <div className="flex items-center justify-between pt-2">
              <span className="text-[10px] text-chrono-muted">Explore offline telemetry:</span>
              <button
                onClick={() => handleToggleMode('PREVIEW')}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1c1407] border border-chrono-amber/80 text-chrono-amber font-mono text-[11px] font-bold hover:bg-chrono-amber hover:text-black transition-colors"
              >
                <Radio className="w-3 h-3" />
                EXPLORE DEMO PREVIEW
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
        isLoading={isLoading || isCreatingRun}
        onRefresh={loadLiveData}
        inspectorOpen={inspectorOpen}
        onToggleInspector={() => setInspectorOpen(!inspectorOpen)}
        onSelectInspectorTarget={(target) => {
          setInspectorTarget(target);
          setInspectorOpen(true);
        }}
        user={user}
        onSignOut={signOut}
        onCreateRun={handleCreateRun}
        isCreatingRun={isCreatingRun}
        isActionInProgress={isExecutingCheckout || isInjectingFailure}
      />

      {/* 2. Main Middle Workspace: Left Persistent Navigation Rail + Center Instrument + Right Inspector */}
      <div className="flex-1 flex overflow-hidden min-h-0 relative">
        {/* Left Vertical Navigation */}
        <Navigation
          currentDestination={currentDestination}
          onSelectDestination={setCurrentDestination}
          onFocusExperiments={() => {
            setCurrentDestination('MONITOR');
            setFocusStagingToken((prev) => prev + 1);
          }}
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
              isCreatingRun={isCreatingRun}
              isActionInProgress={isExecutingCheckout || isInjectingFailure}
              creationError={runCreationError}
              onRefresh={loadLiveData}
              onSelectRun={handleSelectRun}
              onSwitchToMonitor={() => setCurrentDestination('MONITOR')}
              onCreateRun={handleCreateRun}
              onDismissError={() => setRunCreationError(null)}
            />
          ) : (
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
              backendHealth={backendHealth}
              isLoading={isLoading}
              isExecutingCheckout={isExecutingCheckout}
              isInjectingFailure={isInjectingFailure}
              failureInjected={
                Boolean(
                  currentRun &&
                    (currentRun.events.some((e) => e.event_type === 'FAILURE_INJECTED') ||
                      currentRun.is_failure_experiment)
                )
              }
              checkoutExecuted={
                Boolean(
                  currentRun &&
                    (currentRun.status !== 'IN_PROGRESS' ||
                      currentRun.events.some((e) => e.event_type === 'REQUEST_END'))
                )
              }
              lastExecutionResult={lastExecutionResult}
              executionError={executionError}
              onExecuteCheckout={handleExecuteCheckout}
              onInjectFailure={handleInjectFailure}
              onDismissExecutionError={() => setExecutionError(null)}
              user={user}
              focusStagingToken={focusStagingToken}
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

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <CockpitApp />
    </AuthProvider>
  );
};

export default App;
