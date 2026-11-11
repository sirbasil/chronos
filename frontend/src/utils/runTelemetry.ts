import { ChronosEvent, ChronosRun, EventType, RunStatus, ServiceSummary } from '../types/events';
import { AppMode, BackendHealth, ExecutionErrorInfo, ExecutionResultInfo } from '../types/api';

const ISO_DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?$/;
const TZ_SUFFIX_RE = /([zZ]|[+-]\d{2}(:?\d{2})?)$/;

/**
 * Parse ISO-8601 timestamp strings consistently as UTC milliseconds.
 * Appends 'Z' when a timestamp omits an explicit timezone offset so browsers
 * never reinterpret timezone-naive UTC strings in local time.
 */
export const parseUtcTimestampMs = (timestamp: string): number => {
  if (!timestamp || typeof timestamp !== 'string') return NaN;
  const trimmed = timestamp.trim().replace(' ', 'T');
  if (!trimmed) return NaN;

  let normalized =
    ISO_DATE_TIME_RE.test(trimmed) && !TZ_SUFFIX_RE.test(trimmed)
      ? `${trimmed}Z`
      : trimmed;

  if (/[+-]\d{2}$/.test(normalized)) {
    normalized = `${normalized}:00`;
  }

  return Date.parse(normalized);
};

/**
 * Format signed offset relative to experiment execution start (T=0).
 * Positive offsets stay exact milliseconds (+14ms); pre-execution negative
 * offsets use compact human-readable units (-33ms, -27.8h).
 */
export const formatSignedOffsetMs = (offsetMs: number): string => {
  const rounded = Math.round(offsetMs);
  if (rounded >= 0) {
    return `+${rounded}ms`;
  }

  const abs = Math.abs(rounded);
  if (abs < 1000) return `-${abs}ms`;
  if (abs < 60_000) return `-${(abs / 1000).toFixed(1)}s`;
  if (abs < 3_600_000) return `-${(abs / 60_000).toFixed(1)}m`;
  return `-${(abs / 3_600_000).toFixed(1)}h`;
};

/**
 * Format full signed millisecond delta with h/m/s context for tooltips/inspector.
 */
export const formatExactSignedDelta = (offsetMs: number): string => {
  const rounded = Math.round(offsetMs);
  if (rounded >= 0) {
    return `+${rounded.toLocaleString('en-US')}ms`;
  }

  const abs = Math.abs(rounded);
  const totalSec = Math.floor(abs / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  if (hours > 0) {
    return `-${abs.toLocaleString('en-US')}ms (-${hours}h ${mins}m ${secs}s before T=0)`;
  }
  if (mins > 0) {
    return `-${abs.toLocaleString('en-US')}ms (-${mins}m ${secs}s before T=0)`;
  }
  return `-${abs.toLocaleString('en-US')}ms before T=0`;
};

/**
 * Resolve service channel for timeline track plotting while preserving explicit service IDs.
 */
export const getEventChannel = (event: ChronosEvent): string => {
  if (event.service_id && event.service_id !== 'orders') {
    return event.service_id;
  }

  switch (event.event_type) {
    case 'FAILURE_INJECTED':
      return (
        (event.payload?.target as string) ||
        (event.payload?.target_service as string) ||
        'payment'
      );
    case 'RESPONSE':
      return (
        (event.payload?.responding_service as string) ||
        (event.payload?.destination_service as string) ||
        'payment'
      );
    case 'SERVICE_ERROR':
      return (
        (event.payload?.destination_service as string) ||
        (event.payload?.target as string) ||
        'payment'
      );
    default:
      return event.service_id || 'orders';
  }
};

const sortChronologically = (events: ChronosEvent[]): ChronosEvent[] => {
  return [...events].sort((a, b) => {
    const tA = parseUtcTimestampMs(a.timestamp);
    const tB = parseUtcTimestampMs(b.timestamp);
    if (Number.isFinite(tA) && Number.isFinite(tB) && tA !== tB) {
      return tA - tB;
    }
    return a.event_id.localeCompare(b.event_id);
  });
};

/**
 * Normalize backend events chronologically and anchor T=0 to experiment execution
 * start (REQUEST_START). Pre-execution staging events such as FAILURE_INJECTED
 * receive their exact signed negative delta instead of shifting REQUEST_START
 * or inflating run duration.
 */
export const transformEvents = (
  rawEvents: ChronosEvent[],
  _runStartedAt?: string
): ChronosEvent[] => {
  if (!rawEvents || rawEvents.length === 0) return [];

  const sorted = sortChronologically(rawEvents);
  const requestStartEvent = sorted.find((e) => e.event_type === 'REQUEST_START');
  const baseEvent = requestStartEvent || sorted[0];
  const baseTime = parseUtcTimestampMs(baseEvent.timestamp);

  return sorted.map((evt) => {
    const evtTime = parseUtcTimestampMs(evt.timestamp);
    const offset_ms =
      Number.isFinite(evtTime) && Number.isFinite(baseTime)
        ? Math.round(evtTime - baseTime)
        : 0;
    const service_id = getEventChannel(evt);
    return {
      ...evt,
      service_id,
      offset_ms,
    };
  });
};

/**
 * Compute checkout execution duration in milliseconds from event timestamps:
 * REQUEST_START -> REQUEST_END when available, avoiding distortion from idle gaps
 * between POST /runs, pre-execution FAILURE_INJECTED staging, and checkout.
 */
export const computeRunDurationMs = (
  events: ChronosEvent[],
  summary?: { started_at: string; completed_at?: string | null }
): number => {
  if (events && events.length > 0) {
    const sorted = sortChronologically(events);
    const requestStart = sorted.find((e) => e.event_type === 'REQUEST_START');

    if (requestStart) {
      const startMs = parseUtcTimestampMs(requestStart.timestamp);
      if (!Number.isFinite(startMs)) return 0;

      const requestEnd = [...sorted].reverse().find((e) => e.event_type === 'REQUEST_END');
      if (requestEnd) {
        const endMs = parseUtcTimestampMs(requestEnd.timestamp);
        if (Number.isFinite(endMs)) {
          return Math.max(0, Math.round(endMs - startMs));
        }
      }

      const execTimestamps = sorted
        .map((e) => parseUtcTimestampMs(e.timestamp))
        .filter((ms) => Number.isFinite(ms) && ms >= startMs);
      if (execTimestamps.length > 0) {
        return Math.max(0, Math.round(Math.max(...execTimestamps) - startMs));
      }
      return 0;
    }

    // No REQUEST_START yet (e.g., staged FAILURE_INJECTED awaiting checkout)
    if (sorted.length <= 1) {
      return 0;
    }

    const firstMs = parseUtcTimestampMs(sorted[0].timestamp);
    const lastMs = parseUtcTimestampMs(sorted[sorted.length - 1].timestamp);
    if (Number.isFinite(firstMs) && Number.isFinite(lastMs)) {
      return Math.max(0, Math.round(lastMs - firstMs));
    }
    return 0;
  }

  if (summary?.completed_at && summary?.started_at) {
    const startMs = parseUtcTimestampMs(summary.started_at);
    const endMs = parseUtcTimestampMs(summary.completed_at);
    if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
      return Math.max(0, Math.round(endMs - startMs));
    }
  }

  return 0;
};

export interface CheckoutOutcome {
  hasFailureInjected: boolean;
  hasResponse2xx: boolean;
  hasServiceError: boolean;
  hasCompletedRequestEnd: boolean;
  hasFailedRequestEnd: boolean;
  hasConfirmedPaymentSuccess: boolean;
  paymentRespondedAfterPriorFailure: boolean;
  latestPaymentEventType: EventType | null;
}

const isPaymentResponseEvent = (evt: ChronosEvent): boolean => {
  if (evt.event_type !== 'RESPONSE') return false;
  const responder = evt.payload?.responding_service as string | undefined;
  return responder === 'payment' || evt.service_id === 'payment' || !responder;
};

const isResponse2xxConfirmed = (evt: ChronosEvent): boolean => {
  if (!isPaymentResponseEvent(evt)) return false;
  const rawCode = evt.payload?.status_code ?? evt.payload?.http_status;
  if (typeof rawCode !== 'number' || rawCode < 200 || rawCode >= 300) {
    return false;
  }
  const paymentStatus = evt.payload?.payment_status ?? evt.payload?.status;
  if (typeof paymentStatus === 'string') {
    const normalized = paymentStatus.trim().toLowerCase();
    if (
      normalized.length > 0 &&
      !['approved', 'authorized', 'succeeded', 'completed', 'ok'].includes(normalized)
    ) {
      return false;
    }
  }
  return true;
};

const isPaymentScopedEvent = (evt: ChronosEvent): boolean => {
  return (
    evt.service_id === 'payment' ||
    evt.payload?.destination_service === 'payment' ||
    evt.payload?.responding_service === 'payment' ||
    (evt.event_type === 'FAILURE_INJECTED' &&
      (evt.payload?.target === 'payment' ||
        evt.payload?.target_service === 'payment' ||
        !evt.payload?.target))
  );
};

/**
 * Derive authoritative checkout outcome exclusively from persisted run status and
 * chronological events. Never assumes payment approval without a confirmed 2xx
 * RESPONSE, zero SERVICE_ERROR events, and COMPLETED REQUEST_END.
 */
export const deriveCheckoutOutcome = (
  run: Pick<ChronosRun, 'status' | 'events'>
): CheckoutOutcome => {
  const sorted = sortChronologically(run.events || []);

  const failureEvents = sorted.filter((e) => e.event_type === 'FAILURE_INJECTED');
  const serviceErrors = sorted.filter((e) => e.event_type === 'SERVICE_ERROR');
  const confirmedResponses = sorted.filter(isResponse2xxConfirmed);
  const requestEnds = sorted.filter((e) => e.event_type === 'REQUEST_END');
  const lastRequestEnd =
    requestEnds.length > 0 ? requestEnds[requestEnds.length - 1] : null;

  const endStatusRaw = String(
    lastRequestEnd?.payload?.status ?? lastRequestEnd?.payload?.checkout_status ?? ''
  ).toUpperCase();

  const hasCompletedRequestEnd = Boolean(
    lastRequestEnd &&
      lastRequestEnd.severity !== 'ERROR' &&
      endStatusRaw !== 'FAILED' &&
      (endStatusRaw === 'COMPLETED' || endStatusRaw === 'SUCCEEDED')
  );

  const hasFailedRequestEnd = Boolean(
    lastRequestEnd && (lastRequestEnd.severity === 'ERROR' || endStatusRaw === 'FAILED')
  );

  const hasFailureInjected = failureEvents.length > 0;
  const hasResponse2xx = confirmedResponses.length > 0;
  const hasServiceError = serviceErrors.length > 0;

  const hasConfirmedPaymentSuccess =
    run.status === 'COMPLETED' &&
    hasResponse2xx &&
    !hasServiceError &&
    hasCompletedRequestEnd &&
    !hasFailedRequestEnd;

  let paymentRespondedAfterPriorFailure = false;
  if (hasConfirmedPaymentSuccess && hasFailureInjected) {
    const lastFailureMs = Math.max(
      ...failureEvents.map((e) => parseUtcTimestampMs(e.timestamp)).filter(Number.isFinite)
    );
    const lastResponseMs = Math.max(
      ...confirmedResponses.map((e) => parseUtcTimestampMs(e.timestamp)).filter(Number.isFinite)
    );
    if (Number.isFinite(lastFailureMs) && Number.isFinite(lastResponseMs)) {
      paymentRespondedAfterPriorFailure = lastResponseMs > lastFailureMs;
    }
  }

  const paymentEvents = sorted.filter(isPaymentScopedEvent);
  const latestPaymentEvent =
    paymentEvents.length > 0 ? paymentEvents[paymentEvents.length - 1] : null;

  return {
    hasFailureInjected,
    hasResponse2xx,
    hasServiceError,
    hasCompletedRequestEnd,
    hasFailedRequestEnd,
    hasConfirmedPaymentSuccess,
    paymentRespondedAfterPriorFailure,
    latestPaymentEventType: latestPaymentEvent?.event_type ?? null,
  };
};

export const buildChronosRun = (
  summary: {
    run_id: string;
    started_at: string;
    completed_at?: string | null;
    status: RunStatus;
  },
  rawEvents: ChronosEvent[]
): ChronosRun => {
  const events = transformEvents(rawEvents, summary.started_at);
  const startReq = events.find((e) => e.event_type === 'REQUEST_START');
  const orderId = startReq?.payload?.order_id
    ? String(startReq.payload.order_id)
    : undefined;
  const isFailure = events.some((e) => e.event_type === 'FAILURE_INJECTED');
  const durationMs = computeRunDurationMs(events, summary);

  let desc = `Run ${summary.run_id.slice(0, 8)} (${summary.status})`;
  if (isFailure) {
    desc = `Run ${summary.run_id.slice(0, 8)} [FAULT INJECTED] - ${durationMs}ms`;
  } else if (orderId) {
    desc = `Order #${orderId} checkout (${summary.status}) - ${durationMs}ms`;
  }

  return {
    run_id: summary.run_id,
    started_at: summary.started_at,
    completed_at: summary.completed_at ?? null,
    status: summary.status,
    order_id: orderId,
    description: desc,
    is_failure_experiment: isFailure,
    events,
  };
};

export interface DeriveServicesOptions {
  mode?: AppMode;
  backendHealth?: BackendHealth | null;
}

export const deriveServicesFromRun = (
  run: ChronosRun | null,
  options: DeriveServicesOptions = {}
): ServiceSummary[] => {
  const { mode = 'LIVE', backendHealth = null } = options;
  const sorted = sortChronologically(run?.events || []);

  // Orders Service
  const ordersEvents = sorted.filter((e) => e.service_id === 'orders');
  const ordersInbound = ordersEvents.filter((e) => e.event_type === 'REQUEST_START').length;
  const ordersOutbound = ordersEvents.filter((e) => e.event_type === 'SERVICE_CALL').length;
  const ordersErrors = ordersEvents.filter(
    (e) => e.severity === 'ERROR' || e.event_type === 'SERVICE_ERROR'
  ).length;
  const lastOrdersEvent =
    ordersEvents.length > 0 ? ordersEvents[ordersEvents.length - 1] : null;

  let ordersStatus: ServiceSummary['status'] = 'OBSERVED';
  if (ordersEvents.length > 0) {
    ordersStatus = ordersErrors > 0 || run?.status === 'FAILED' ? 'DEGRADED' : 'HEALTHY';
  } else if (mode === 'LIVE' && backendHealth) {
    ordersStatus = backendHealth.status === 'ok' ? 'HEALTHY' : 'DEGRADED';
  }

  const ordersService: ServiceSummary = {
    id: 'orders',
    name: 'Orders Service',
    status: ordersStatus,
    container_name: '01-http-basics-orders-1',
    compose_service: 'orders',
    port: 8000,
    inbound_calls: Math.max(ordersInbound, ordersEvents.length > 0 ? 1 : 0),
    outbound_calls: ordersOutbound,
    error_count: ordersErrors,
    last_event_type: lastOrdersEvent?.event_type || null,
  };

  // Payment Service — evaluated chronologically so a subsequent 2xx RESPONSE is shown
  // as RECOVERED (or HEALTHY without prior kill), never stuck on FAILED.
  const paymentEvents = sorted.filter(isPaymentScopedEvent);
  const paymentFailureInjections = paymentEvents.filter(
    (e) => e.event_type === 'FAILURE_INJECTED'
  );
  const paymentErrorsList = paymentEvents.filter(
    (e) =>
      (e.event_type === 'SERVICE_ERROR' && e.payload?.destination_service === 'payment') ||
      (e.service_id === 'payment' && e.severity === 'ERROR')
  );
  const paymentConfirmedResponses = paymentEvents.filter(isResponse2xxConfirmed);

  const lastFailureMs =
    paymentFailureInjections.length > 0
      ? parseUtcTimestampMs(paymentFailureInjections[paymentFailureInjections.length - 1].timestamp)
      : null;
  const lastResponseMs =
    paymentConfirmedResponses.length > 0
      ? parseUtcTimestampMs(
          paymentConfirmedResponses[paymentConfirmedResponses.length - 1].timestamp
        )
      : null;

  const hasUnrecoveredKill =
    lastFailureMs !== null &&
    Number.isFinite(lastFailureMs) &&
    (lastResponseMs === null || !Number.isFinite(lastResponseMs) || lastFailureMs >= lastResponseMs);

  let paymentStatus: ServiceSummary['status'] = 'OBSERVED';
  if (paymentErrorsList.length > 0) {
    paymentStatus = paymentFailureInjections.length > 0 ? 'FAILED' : 'DEGRADED';
  } else if (hasUnrecoveredKill) {
    paymentStatus = 'FAILED';
  } else if (
    paymentConfirmedResponses.length > 0 &&
    lastFailureMs !== null &&
    lastResponseMs !== null &&
    lastResponseMs > lastFailureMs
  ) {
    paymentStatus = 'RECOVERED';
  } else if (paymentConfirmedResponses.length > 0) {
    paymentStatus = 'HEALTHY';
  } else if (mode === 'LIVE' && backendHealth?.payment) {
    paymentStatus = backendHealth.payment === 'healthy' ? 'HEALTHY' : 'FAILED';
  } else if (paymentEvents.length > 0) {
    paymentStatus = 'OBSERVED';
  }

  const lastPaymentEvent =
    paymentEvents.length > 0 ? paymentEvents[paymentEvents.length - 1] : null;
  const paymentErrorCount =
    paymentErrorsList.length > 0
      ? paymentErrorsList.length
      : paymentStatus === 'FAILED'
      ? Math.max(1, paymentFailureInjections.length)
      : 0;

  const paymentService: ServiceSummary = {
    id: 'payment',
    name: 'Payment Service',
    status: paymentStatus,
    container_name: '01-http-basics-payment-1',
    compose_service: 'payment',
    port: 8001,
    inbound_calls: paymentEvents.filter((e) => e.event_type === 'SERVICE_CALL').length,
    outbound_calls: 0,
    error_count: paymentErrorCount,
    last_event_type: lastPaymentEvent?.event_type || null,
  };

  // PostgreSQL Store — never claims HEALTHY unless backed by a real LIVE /health signal.
  let postgresStatus: ServiceSummary['status'] = 'OBSERVED';
  if (mode === 'LIVE' && backendHealth) {
    postgresStatus = backendHealth.database === 'connected' ? 'HEALTHY' : 'FAILED';
  }

  const postgresService: ServiceSummary = {
    id: 'postgres',
    name: 'PostgreSQL Store',
    status: postgresStatus,
    container_name: '01-http-basics-postgres-1',
    compose_service: 'postgres',
    port: 5432,
    inbound_calls: sorted.length,
    outbound_calls: 0,
    error_count: mode === 'LIVE' && backendHealth?.database === 'disconnected' ? 1 : 0,
    last_event_type: null,
  };

  return [ordersService, paymentService, postgresService];
};

/**
 * RBAC check aligned with backend require_operator_or_admin: requires LIVE mode and explicit
 * Cognito group membership in 'chronos-admins' or 'chronos-operators'.
 */
export const isAuthorizedOperator = (
  mode: AppMode,
  groups?: string[] | null
): boolean => {
  if (mode !== 'LIVE' || !Array.isArray(groups) || groups.length === 0) {
    return false;
  }
  return groups.some(
    (group) => group === 'chronos-admins' || group === 'chronos-operators'
  );
};

export const getScopedExecutionError = (
  error: ExecutionErrorInfo | null,
  activeRunId: string | null | undefined
): ExecutionErrorInfo | null => {
  if (!error || !activeRunId || error.runId !== activeRunId) {
    return null;
  }
  return error;
};

export const getScopedExecutionResult = (
  result: ExecutionResultInfo | null,
  error: ExecutionErrorInfo | null,
  run: Pick<ChronosRun, 'run_id' | 'status' | 'events'> | null
): ExecutionResultInfo | null => {
  if (!result || !run || result.runId !== run.run_id) {
    return null;
  }
  if (getScopedExecutionError(error, run.run_id)) {
    return null;
  }
  if (result.kind === 'checkout') {
    const outcome = deriveCheckoutOutcome(run);
    if (!outcome.hasConfirmedPaymentSuccess) {
      return null;
    }
  }
  return result;
};

export const shouldApplyRunResponse = (params: {
  requestId: number;
  activeRequestId: number;
  requestMode: AppMode;
  currentMode: AppMode;
  targetRunId: string;
  selectedRunId: string | null;
}): boolean => {
  if (params.requestId !== params.activeRequestId) return false;
  if (params.requestMode !== 'LIVE' || params.currentMode !== 'LIVE') return false;
  if (params.selectedRunId && params.selectedRunId !== params.targetRunId) return false;
  return true;
};

export const canSwitchRun = (params: {
  isExecutingCheckout: boolean;
  isInjectingFailure: boolean;
  isCreatingRun: boolean;
}): boolean => {
  return !(
    params.isExecutingCheckout ||
    params.isInjectingFailure ||
    params.isCreatingRun
  );
};

export const canTriggerRunActions = (params: {
  mode: AppMode;
  run: Pick<ChronosRun, 'run_id' | 'status' | 'events'> | null;
  isLoading: boolean;
  isExecutingCheckout: boolean;
  isInjectingFailure: boolean;
  isCreatingRun: boolean;
}): boolean => {
  if (params.mode !== 'LIVE' || !params.run || !params.run.run_id) return false;
  if (
    params.isLoading ||
    params.isExecutingCheckout ||
    params.isInjectingFailure ||
    params.isCreatingRun
  ) {
    return false;
  }
  if (params.run.status !== 'IN_PROGRESS') return false;
  const hasEnded = params.run.events.some((e) => e.event_type === 'REQUEST_END');
  return !hasEnded;
};
