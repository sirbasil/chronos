import React, { useEffect, useRef, useState } from 'react';
import { ChronosRun } from '../../types/events';
import { AppMode, ExecutionErrorInfo, ExecutionResultInfo } from '../../types/api';
import { UserProfile } from '../../auth/AuthContext';
import {
  deriveCheckoutOutcome,
  getScopedExecutionError,
  getScopedExecutionResult,
  isAuthorizedOperator,
} from '../../utils/runTelemetry';
import {
  Play,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Terminal,
  X,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';

interface ExperimentStagingPanelProps {
  run: ChronosRun | null;
  mode?: AppMode;
  isLoading?: boolean;
  isExecutingCheckout: boolean;
  isInjectingFailure: boolean;
  failureInjected: boolean;
  checkoutExecuted: boolean;
  lastExecutionResult: ExecutionResultInfo | null;
  executionError: ExecutionErrorInfo | null;
  onExecuteCheckout: () => void;
  onInjectFailure: () => void;
  onDismissError?: () => void;
  user?: UserProfile | null;
  focusStagingToken?: number;
}

export const ExperimentStagingPanel: React.FC<ExperimentStagingPanelProps> = ({
  run,
  mode = 'LIVE',
  isLoading = false,
  isExecutingCheckout,
  isInjectingFailure,
  failureInjected,
  checkoutExecuted,
  lastExecutionResult,
  executionError,
  onExecuteCheckout,
  onInjectFailure,
  onDismissError,
  user,
  focusStagingToken = 0,
}) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [isFocusedHighlight, setIsFocusedHighlight] = useState(false);

  useEffect(() => {
    if (focusStagingToken <= 0) return;
    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setIsFocusedHighlight(true);
    const timer = window.setTimeout(() => {
      setIsFocusedHighlight(false);
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [focusStagingToken]);
  const isPlaceholderRun = !run || !run.run_id;
  const events = run?.events ?? [];
  const checkoutOutcome = run
    ? deriveCheckoutOutcome(run)
    : deriveCheckoutOutcome({ status: 'IN_PROGRESS', events: [] });

  const hasFailureInjected =
    !isPlaceholderRun &&
    (failureInjected ||
      checkoutOutcome.hasFailureInjected ||
      Boolean(run?.is_failure_experiment));

  const hasCheckoutCompleted =
    !isPlaceholderRun &&
    (checkoutExecuted ||
      run?.status === 'COMPLETED' ||
      run?.status === 'FAILED' ||
      events.some((e) => e.event_type === 'REQUEST_END'));

  const scopedExecutionError = getScopedExecutionError(executionError, run?.run_id);
  const visibleExecutionResult = getScopedExecutionResult(
    lastExecutionResult,
    executionError,
    run
  );

  const isAwaitingExecution =
    !isPlaceholderRun && run?.status === 'IN_PROGRESS' && !hasCheckoutCompleted;

  // Authorization check aligned strictly with backend require_operator_or_admin:
  // requires explicit membership in chronos-admins or chronos-operators.
  const operatorAuthorized = isAuthorizedOperator(mode, user?.groups);

  const canInjectFailure =
    !isPlaceholderRun &&
    !isLoading &&
    isAwaitingExecution &&
    !hasFailureInjected &&
    !isInjectingFailure &&
    !isExecutingCheckout &&
    mode === 'LIVE' &&
    operatorAuthorized;

  const canExecuteCheckout =
    !isPlaceholderRun &&
    !isLoading &&
    isAwaitingExecution &&
    !isExecutingCheckout &&
    !isInjectingFailure &&
    mode === 'LIVE';

  return (
    <div
      ref={panelRef}
      data-testid="experiment-staging-panel"
      className={`shrink-0 bg-[#070b05] border p-2.5 shadow-md flex flex-col gap-2 relative transition-all duration-300 ${
        isFocusedHighlight
          ? 'border-chrono-phosphor shadow-[0_0_16px_rgba(184,255,0,0.35)]'
          : 'border-chrono-grid'
      }`}
    >
      {/* 1. Header Bar: Experiment Identity & Telemetry Metadata */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-chrono-grid/60 pb-2">
        <div className="flex items-center gap-2.5">
          <Terminal className="w-4 h-4 text-chrono-phosphor drop-shadow-[0_0_6px_#b8ff00]" />
          <span className="font-ui font-bold text-xs tracking-wider text-chrono-phosphor uppercase">
            ACTIVE EXPERIMENT STAGING PANEL
          </span>
          <span className="text-[10px] font-mono text-chrono-muted hidden sm:inline">
            // RUN ID:
          </span>
          <span className="font-mono text-xs font-bold text-chrono-text bg-[#030502] px-2 py-0.5 border border-chrono-grid select-all">
            {run ? run.run_id : 'NONE (CREATE RUN)'}
          </span>
        </div>

        {/* Live Context Indicators */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Status Badge */}
          {!run ? (
            isLoading && mode === 'LIVE' ? (
              <span className="flex items-center gap-1.5 px-2 py-0.5 bg-[#201505] border border-chrono-amber text-chrono-amber font-mono text-[10px] font-bold">
                <Loader2 className="w-3 h-3 animate-spin text-chrono-amber" />
                STATUS: LOADING TELEMETRY...
              </span>
            ) : (
              <span className="flex items-center gap-1.5 px-2 py-0.5 bg-[#121412] border border-chrono-muted text-chrono-muted font-mono text-[10px] font-bold">
                STATUS: NO ACTIVE RUN
              </span>
            )
          ) : isLoading ? (
            <span className="flex items-center gap-1.5 px-2 py-0.5 bg-[#201505] border border-chrono-amber text-chrono-amber font-mono text-[10px] font-bold">
              <Loader2 className="w-3 h-3 animate-spin text-chrono-amber" />
              STATUS: LOADING RUN...
            </span>
          ) : isAwaitingExecution ? (
            <span className="flex items-center gap-1.5 px-2 py-0.5 bg-[#201505] border border-chrono-amber text-chrono-amber font-mono text-[10px] font-bold animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-chrono-amber" />
              STATUS: AWAITING EXECUTION
            </span>
          ) : run.status === 'COMPLETED' ? (
            <span className="flex items-center gap-1.5 px-2 py-0.5 bg-[#051a08] border border-[#22c55e] text-[#4ade80] font-mono text-[10px] font-bold">
              <CheckCircle2 className="w-3 h-3 text-[#22c55e]" />
              STATUS: COMPLETED
            </span>
          ) : run.status === 'FAILED' ? (
            <span className="flex items-center gap-1.5 px-2 py-0.5 bg-[#2b0805] border border-chrono-red text-chrono-red font-mono text-[10px] font-bold">
              <AlertTriangle className="w-3 h-3 text-chrono-red" />
              STATUS: FAILED
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-2 py-0.5 bg-[#121412] border border-chrono-muted text-chrono-muted font-mono text-[10px] font-bold">
              STATUS: {run.status}
            </span>
          )}

          {/* Scenario Badge */}
          <span
            className={`font-mono text-[10px] font-bold px-2 py-0.5 border ${
              hasFailureInjected
                ? 'bg-[#2b1005] border-chrono-amber text-chrono-amber drop-shadow-[0_0_4px_rgba(255,176,0,0.3)]'
                : 'bg-[#041219] border-chrono-cyan text-chrono-cyan drop-shadow-[0_0_4px_rgba(0,240,255,0.3)]'
            }`}
          >
            SCENARIO: {hasFailureInjected ? 'PAYMENT FAILURE EXPERIMENT' : 'NORMAL CHECKOUT'}
          </span>

          {/* Failure Injection State */}
          <span
            className={`font-mono text-[10px] font-bold px-2 py-0.5 border flex items-center gap-1 ${
              hasFailureInjected
                ? 'bg-[#240808] border-chrono-red text-chrono-red drop-shadow-[0_0_4px_rgba(255,51,51,0.4)] animate-pulse'
                : 'bg-[#030602] border-chrono-grid text-chrono-muted'
            }`}
          >
            {hasFailureInjected ? (
              <>
                <ShieldAlert className="w-3 h-3 text-chrono-red" />
                FAILURE: ARMED (PAYMENT KILL)
              </>
            ) : (
              <>
                <ShieldCheck className="w-3 h-3 text-chrono-muted" />
                FAILURE: STANDBY
              </>
            )}
          </span>

          {/* RBAC Visibility Badge matching backend require_operator_or_admin */}
          {mode === 'LIVE' && (
            <span
              className={`font-mono text-[10px] font-bold px-2 py-0.5 border ${
                operatorAuthorized
                  ? 'bg-[#051a08] border-[#22c55e]/60 text-[#4ade80]'
                  : 'bg-[#190c0c] border-chrono-red/60 text-chrono-red'
              }`}
              title={
                operatorAuthorized
                  ? 'Cognito group permits failure injection (chronos-admins / chronos-operators)'
                  : 'Read-only operator access: requires chronos-admins or chronos-operators Cognito group for failure injection'
              }
            >
              {operatorAuthorized ? 'RBAC: OPERATOR' : 'RBAC: NO INJECTION ROLE'}
            </span>
          )}
        </div>
      </div>

      {/* 2. Interactive Action Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-0.5">
        <div className="text-[11px] font-mono text-chrono-muted flex items-center gap-2">
          <span className="text-chrono-phosphor font-bold">&gt;&gt;</span>
          {!run ? (
            isLoading && mode === 'LIVE' ? (
              <span>Synchronizing persisted runs from PostgreSQL...</span>
            ) : (
              <span>
                No persisted run selected. Click <strong className="text-[#4ade80]">+ NEW RUN</strong> to initialize a real experiment run.
              </span>
            )
          ) : isLoading ? (
            <span>Synchronizing run telemetry from backend...</span>
          ) : isAwaitingExecution ? (
            hasFailureInjected ? (
              <span>
                Payment failure injected and recorded. Execute checkout for Order 101 to verify error propagation.
              </span>
            ) : (
              <span>
                Run initialized. Execute normal checkout or optionally inject a payment failure first.
              </span>
            )
          ) : hasCheckoutCompleted ? (
            checkoutOutcome.paymentRespondedAfterPriorFailure ? (
              <span className="text-chrono-amber">
                Checkout COMPLETED ({events.length} events). Prior FAILURE_INJECTED is recorded on this run, but Payment returned HTTP 200 at checkout.
              </span>
            ) : (
              <span className="text-chrono-text">
                Experiment concluded. Run finalized with{' '}
                <strong className="text-chrono-phosphor">{events.length}</strong> recorded trace events.
              </span>
            )
          ) : (
            <span>Run active. Available actions:</span>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Action B: Inject Failure */}
          <button
            onClick={onInjectFailure}
            disabled={!canInjectFailure}
            className={`flex items-center gap-1.5 px-3 py-1.5 font-mono text-xs font-bold tracking-wider border transition-all ${
              hasFailureInjected
                ? 'bg-[#140808] border-chrono-grid text-chrono-muted opacity-50 cursor-not-allowed'
                : canInjectFailure
                ? 'bg-[#2b1205] border-chrono-amber text-chrono-amber hover:bg-[#3d1907] hover:shadow-[0_0_10px_rgba(255,176,0,0.4)] cursor-pointer'
                : 'bg-[#0d100c] border-chrono-grid text-chrono-muted opacity-40 cursor-not-allowed'
            }`}
            title={
              mode !== 'LIVE'
                ? 'Failure injection is only available in LIVE mode'
                : isPlaceholderRun
                ? 'Create a real run before injecting failure'
                : isLoading
                ? 'Waiting for run telemetry synchronization'
                : !operatorAuthorized
                ? 'Requires chronos-admins or chronos-operators Cognito group permissions'
                : hasFailureInjected
                ? 'Failure has already been injected for this run'
                : !isAwaitingExecution
                ? 'Failure injection is only available while run is AWAITING EXECUTION'
                : 'Inject controlled SIGKILL to payment microservice (POST /runs/{run_id}/failure)'
            }
          >
            {isInjectingFailure ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-chrono-amber" />
                <span>INJECTING FAILURE...</span>
              </>
            ) : (
              <>
                <Zap className="w-3.5 h-3.5 fill-current text-chrono-amber" />
                <span>{hasFailureInjected ? 'FAILURE INJECTED' : 'INJECT FAILURE (PAYMENT)'}</span>
              </>
            )}
          </button>

          {/* Action A: Execute Checkout */}
          <button
            onClick={onExecuteCheckout}
            disabled={!canExecuteCheckout}
            className={`flex items-center gap-1.5 px-4 py-1.5 font-mono text-xs font-bold tracking-wider border transition-all ${
              canExecuteCheckout
                ? 'bg-[#12220f] border-[#22c55e] text-[#4ade80] hover:bg-[#1a3816] hover:shadow-[0_0_12px_rgba(34,197,94,0.5)] cursor-pointer'
                : 'bg-[#0d100c] border-chrono-grid text-chrono-muted opacity-40 cursor-not-allowed'
            }`}
            title={
              mode !== 'LIVE'
                ? 'Checkout execution is only available in LIVE mode'
                : isPlaceholderRun
                ? 'Create a real run before executing checkout'
                : isLoading
                ? 'Waiting for run telemetry synchronization'
                : hasCheckoutCompleted
                ? 'Checkout has already been executed for this run'
                : 'Execute checkout for Order 101 with X-Run-ID (POST /orders/101/checkout)'
            }
          >
            {isExecutingCheckout ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#4ade80]" />
                <span>EXECUTING CHECKOUT...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current text-[#4ade80]" />
                <span>{hasCheckoutCompleted ? 'CHECKOUT EXECUTED' : 'EXECUTE CHECKOUT (ORDER 101)'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 3. Feedback Alert / Execution Result Banners */}
      {scopedExecutionError && (
        <div
          className={`border px-3 py-1.5 flex items-center justify-between text-xs font-mono mt-1 ${
            scopedExecutionError.isExpectedFailurePropagation
              ? 'bg-[#291404] border-chrono-amber text-chrono-amber'
              : 'bg-[#1c0808] border-chrono-red text-chrono-red'
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            {scopedExecutionError.isExpectedFailurePropagation ? (
              <ShieldAlert className="w-4 h-4 shrink-0 text-chrono-amber drop-shadow-[0_0_6px_#ff9e00]" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0 text-chrono-red drop-shadow-[0_0_6px_#ff3333]" />
            )}
            <span>
              {scopedExecutionError.isExpectedFailurePropagation
                ? `FAULT PROPAGATION VERIFIED${scopedExecutionError.status ? ` (HTTP ${scopedExecutionError.status})` : ''}: ${scopedExecutionError.message}`
                : `${
                    scopedExecutionError.status
                      ? `EXECUTION FAILED (HTTP ${scopedExecutionError.status})`
                      : `EXECUTION FAILED (${scopedExecutionError.code})`
                  }: ${scopedExecutionError.message}`}
            </span>
            {scopedExecutionError.details && (
              <span className="text-[10px] text-chrono-muted font-normal ml-1">
                [{scopedExecutionError.details}]
              </span>
            )}
          </div>
          {onDismissError && (
            <button
              onClick={onDismissError}
              className="p-0.5 text-chrono-muted hover:text-white transition-colors cursor-pointer"
              title="Dismiss message"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {visibleExecutionResult && (
        <div
          className={`border px-3 py-1.5 flex items-center justify-between text-xs font-mono mt-1 ${
            visibleExecutionResult.status >= 200 && visibleExecutionResult.status < 300
              ? 'bg-[#051c09] border-[#22c55e] text-[#4ade80]'
              : 'bg-[#291404] border-chrono-amber text-chrono-amber'
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>
              HTTP {visibleExecutionResult.status}: {visibleExecutionResult.message}
            </span>
            {visibleExecutionResult.details && (
              <span className="text-[10px] text-chrono-muted font-normal ml-2">
                [{visibleExecutionResult.details}]
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
