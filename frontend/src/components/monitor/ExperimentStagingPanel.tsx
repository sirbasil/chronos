import React from 'react';
import { ChronosRun } from '../../types/events';
import { AppMode } from '../../types/api';
import { UserProfile } from '../../auth/AuthContext';
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
  run: ChronosRun;
  mode?: AppMode;
  isExecutingCheckout: boolean;
  isInjectingFailure: boolean;
  failureInjected: boolean;
  checkoutExecuted: boolean;
  lastExecutionResult: {
    status: number;
    message: string;
    details?: string;
  } | null;
  executionError: string | null;
  onExecuteCheckout: () => void;
  onInjectFailure: () => void;
  onDismissError?: () => void;
  user?: UserProfile | null;
}

export const ExperimentStagingPanel: React.FC<ExperimentStagingPanelProps> = ({
  run,
  mode = 'LIVE',
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
}) => {
  const hasFailureInjected =
    failureInjected ||
    run.events.some((e) => e.event_type === 'FAILURE_INJECTED') ||
    run.is_failure_experiment;

  const hasCheckoutCompleted =
    checkoutExecuted ||
    run.status === 'COMPLETED' ||
    run.status === 'FAILED' ||
    run.status === 'ABANDONED' ||
    run.events.some((e) => e.event_type === 'REQUEST_END');

  const isAwaitingExecution = run.status === 'IN_PROGRESS' && !hasCheckoutCompleted;

  // Authorization check for failure injection (chronos-admins or chronos-operators)
  const isAuthorizedOperator =
    !user ||
    !user.groups ||
    user.groups.length === 0 ||
    user.groups.includes('chronos-admins') ||
    user.groups.includes('chronos-operators');

  return (
    <div className="shrink-0 bg-[#070b05] border border-chrono-grid p-2.5 shadow-md flex flex-col gap-2 relative">
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
            {run.run_id}
          </span>
        </div>

        {/* Live Context Indicators */}
        <div className="flex items-center gap-2">
          {/* Status Badge */}
          {isAwaitingExecution ? (
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
        </div>
      </div>

      {/* 2. Interactive Action Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-0.5">
        <div className="text-[11px] font-mono text-chrono-muted flex items-center gap-2">
          <span className="text-chrono-phosphor font-bold">&gt;&gt;</span>
          {isAwaitingExecution ? (
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
            <span className="text-chrono-text">
              Experiment concluded. Run finalized with{' '}
              <strong className="text-chrono-phosphor">{run.events.length}</strong> recorded trace events.
            </span>
          ) : (
            <span>Run active. Available actions:</span>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2.5">
          {/* Action B: Inject Failure */}
          <button
            onClick={onInjectFailure}
            disabled={
              !isAwaitingExecution ||
              hasFailureInjected ||
              isInjectingFailure ||
              isExecutingCheckout ||
              mode !== 'LIVE' ||
              !isAuthorizedOperator
            }
            className={`flex items-center gap-1.5 px-3 py-1.5 font-mono text-xs font-bold tracking-wider border transition-all cursor-pointer ${
              hasFailureInjected
                ? 'bg-[#140808] border-chrono-grid text-chrono-muted opacity-50 cursor-not-allowed'
                : isAwaitingExecution && mode === 'LIVE' && isAuthorizedOperator
                ? 'bg-[#2b1205] border-chrono-amber text-chrono-amber hover:bg-[#3d1907] hover:shadow-[0_0_10px_rgba(255,176,0,0.4)]'
                : 'bg-[#0d100c] border-chrono-grid text-chrono-muted opacity-40 cursor-not-allowed'
            }`}
            title={
              !isAuthorizedOperator
                ? 'Requires chronos-admins or chronos-operators permissions'
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
            disabled={
              !isAwaitingExecution ||
              isExecutingCheckout ||
              isInjectingFailure ||
              mode !== 'LIVE'
            }
            className={`flex items-center gap-1.5 px-4 py-1.5 font-mono text-xs font-bold tracking-wider border transition-all cursor-pointer ${
              isAwaitingExecution && mode === 'LIVE'
                ? 'bg-[#12220f] border-[#22c55e] text-[#4ade80] hover:bg-[#1a3816] hover:shadow-[0_0_12px_rgba(34,197,94,0.5)]'
                : 'bg-[#0d100c] border-chrono-grid text-chrono-muted opacity-40 cursor-not-allowed'
            }`}
            title={
              hasCheckoutCompleted
                ? 'Checkout has already been executed for this run'
                : mode !== 'LIVE'
                ? 'Checkout execution is only available in LIVE mode'
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
      {executionError && (
        <div className="bg-[#1c0808] border border-chrono-red px-3 py-1.5 flex items-center justify-between text-xs font-mono text-chrono-red mt-1">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-chrono-red drop-shadow-[0_0_6px_#ff3333]" />
            <span>EXECUTION FAILED: {executionError}</span>
          </div>
          {onDismissError && (
            <button
              onClick={onDismissError}
              className="p-0.5 text-chrono-muted hover:text-white transition-colors cursor-pointer"
              title="Dismiss error"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {lastExecutionResult && !executionError && (
        <div
          className={`border px-3 py-1.5 flex items-center justify-between text-xs font-mono mt-1 ${
            lastExecutionResult.status >= 200 && lastExecutionResult.status < 300
              ? 'bg-[#051c09] border-[#22c55e] text-[#4ade80]'
              : 'bg-[#291404] border-chrono-amber text-chrono-amber'
          }`}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>
              HTTP {lastExecutionResult.status}: {lastExecutionResult.message}
            </span>
            {lastExecutionResult.details && (
              <span className="text-[10px] text-chrono-muted font-normal ml-2">
                [{lastExecutionResult.details}]
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
