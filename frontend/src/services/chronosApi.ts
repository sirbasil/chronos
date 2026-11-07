import { fetchAuthSession } from 'aws-amplify/auth';
import { isCognitoConfigured } from '../auth/amplifyConfig';
import {
  BackendHealth,
  RunSummaryResponse,
  TopologyResponse,
  ApiError,
} from '../types/api';
import { ChronosEvent, ChronosRun, ServiceSummary } from '../types/events';

const resolveInitialApiBaseUrl = (): string => {
  const envUrl = import.meta.env?.VITE_API_BASE_URL;
  if (typeof envUrl === 'string' && envUrl.trim().length > 0) {
    return envUrl.trim().replace(/\/+$/, '');
  }
  return 'http://127.0.0.1:8000';
};

let API_BASE_URL = resolveInitialApiBaseUrl();

export const setApiBaseUrl = (url: string) => {
  API_BASE_URL = url.trim().replace(/\/+$/, '');
};

export const getApiBaseUrl = (): string => API_BASE_URL;

const fetchWithTimeout = async (
  endpoint: string,
  options: RequestInit = {},
  timeoutMs = 5000
): Promise<Response> => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  const combinedSignal = options.signal
    ? anySignal([options.signal, controller.signal])
    : controller.signal;

  try {
    const url = `${API_BASE_URL}${endpoint}`;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    // Attach Cognito Bearer access token if authenticated
    if (isCognitoConfigured() && !headers['Authorization']) {
      try {
        const session = await fetchAuthSession();
        const token = session.tokens?.accessToken?.toString();
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
      } catch {
        // Unauthenticated or offline: proceed without token
      }
    }

    const res = await fetch(url, {
      ...options,
      signal: combinedSignal,
      headers,
    });
    return res;
  } catch (err: unknown) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`Request to ${endpoint} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(id);
  }
};

// Polyfill-friendly AbortSignal combiner
function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const sig of signals) {
    if (sig.aborted) {
      controller.abort();
      return controller.signal;
    }
    sig.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}

const handleResponse = async <T>(res: Response): Promise<T> => {
  if (!res.ok) {
    let message = `HTTP ${res.status} ${res.statusText}`;
    try {
      const errJson = await res.json();
      if (errJson.detail) message = errJson.detail;
    } catch {
      // ignore
    }

    let code = `HTTP_${res.status}`;
    if (res.status === 401) {
      code = 'UNAUTHORIZED';
    } else if (res.status === 403) {
      code = 'FORBIDDEN';
    }

    const error: ApiError = {
      status: res.status,
      code,
      message,
    };
    throw error;
  }
  return res.json() as Promise<T>;
};

export const checkHealth = async (signal?: AbortSignal): Promise<BackendHealth> => {
  const res = await fetchWithTimeout('/health', { method: 'GET', signal });
  return handleResponse<BackendHealth>(res);
};

export const getRuns = async (
  limit = 50,
  signal?: AbortSignal
): Promise<RunSummaryResponse[]> => {
  const res = await fetchWithTimeout(`/runs?limit=${limit}`, { method: 'GET', signal });
  return handleResponse<RunSummaryResponse[]>(res);
};

export const getRun = async (
  runId: string,
  signal?: AbortSignal
): Promise<RunSummaryResponse> => {
  const res = await fetchWithTimeout(`/runs/${runId}`, { method: 'GET', signal });
  return handleResponse<RunSummaryResponse>(res);
};

export const getRunEvents = async (
  runId: string,
  signal?: AbortSignal
): Promise<ChronosEvent[]> => {
  const res = await fetchWithTimeout(`/runs/${runId}/events`, { method: 'GET', signal });
  return handleResponse<ChronosEvent[]>(res);
};

export const getRunTopology = async (
  runId: string,
  signal?: AbortSignal
): Promise<TopologyResponse> => {
  const res = await fetchWithTimeout(`/runs/${runId}/topology`, { method: 'GET', signal });
  return handleResponse<TopologyResponse>(res);
};

export const transformEvents = (
  rawEvents: ChronosEvent[],
  runStartedAt?: string
): ChronosEvent[] => {
  if (!rawEvents || rawEvents.length === 0) return [];

  // Sort chronologically by timestamp
  const sorted = [...rawEvents].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const baseTime = runStartedAt
    ? new Date(runStartedAt).getTime()
    : new Date(sorted[0].timestamp).getTime();

  return sorted.map((evt) => {
    const evtTime = new Date(evt.timestamp).getTime();
    const offset_ms = Math.max(0, evtTime - baseTime);
    return {
      ...evt,
      offset_ms,
    };
  });
};

export const buildChronosRun = (
  summary: RunSummaryResponse,
  rawEvents: ChronosEvent[]
): ChronosRun => {
  const events = transformEvents(rawEvents, summary.started_at);
  const startReq = events.find((e) => e.event_type === 'REQUEST_START');
  const orderId = startReq?.payload?.order_id
    ? String(startReq.payload.order_id)
    : undefined;
  const isFailure = events.some((e) => e.event_type === 'FAILURE_INJECTED');

  const durationMs = summary.completed_at
    ? new Date(summary.completed_at).getTime() - new Date(summary.started_at).getTime()
    : events.length > 1
    ? (events[events.length - 1].offset_ms ?? 0)
    : 0;

  let desc = `Run ${summary.run_id.slice(0, 8)} (${summary.status})`;
  if (isFailure) {
    desc = `Run ${summary.run_id.slice(0, 8)} [FAULT INJECTED]`;
  } else if (orderId) {
    desc = `Order #${orderId} checkout (${summary.status}) - ${durationMs}ms`;
  }

  return {
    run_id: summary.run_id,
    started_at: summary.started_at,
    completed_at: summary.completed_at,
    status: summary.status,
    order_id: orderId,
    description: desc,
    is_failure_experiment: isFailure,
    events,
  };
};

export const deriveServicesFromRun = (run: ChronosRun): ServiceSummary[] => {
  const events = run.events || [];

  // Orders Service
  const ordersEvents = events.filter((e) => e.service_id === 'orders');
  const ordersInbound = ordersEvents.filter((e) => e.event_type === 'REQUEST_START').length;
  const ordersOutbound = ordersEvents.filter((e) => e.event_type === 'SERVICE_CALL').length;
  const ordersErrors = ordersEvents.filter(
    (e) => e.severity === 'ERROR' || e.event_type === 'SERVICE_ERROR'
  ).length;
  const lastOrdersEvent = ordersEvents.length > 0 ? ordersEvents[ordersEvents.length - 1] : null;

  let ordersStatus: ServiceSummary['status'] = 'OBSERVED';
  if (ordersEvents.length > 0) {
    ordersStatus = ordersErrors > 0 || run.status === 'FAILED' ? 'DEGRADED' : 'HEALTHY';
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

  // Payment Service
  const paymentCalls = events.filter(
    (e) =>
      e.payload?.destination_service === 'payment' ||
      e.payload?.responding_service === 'payment' ||
      e.service_id === 'payment'
  );
  const failureInjected = events.some(
    (e) => e.event_type === 'FAILURE_INJECTED' && (e.payload?.target === 'payment' || !e.payload?.target)
  );
  const paymentErrors = events.filter(
    (e) =>
      (e.event_type === 'SERVICE_ERROR' && e.payload?.destination_service === 'payment') ||
      (e.service_id === 'payment' && e.severity === 'ERROR')
  ).length;
  const paymentResponses = events.filter(
    (e) => e.event_type === 'RESPONSE' && e.payload?.responding_service === 'payment'
  ).length;

  let paymentStatus: ServiceSummary['status'] = 'OBSERVED';
  if (failureInjected) {
    paymentStatus = 'FAILED';
  } else if (paymentErrors > 0) {
    paymentStatus = 'DEGRADED';
  } else if (paymentResponses > 0) {
    paymentStatus = 'HEALTHY';
  } else if (paymentCalls.length > 0) {
    paymentStatus = 'OBSERVED';
  }

  const lastPaymentEvent = paymentCalls.length > 0 ? paymentCalls[paymentCalls.length - 1] : null;

  const paymentService: ServiceSummary = {
    id: 'payment',
    name: 'Payment Service',
    status: paymentStatus,
    container_name: '01-http-basics-payment-1',
    compose_service: 'payment',
    port: 8001,
    inbound_calls: paymentCalls.filter((e) => e.event_type === 'SERVICE_CALL').length,
    outbound_calls: 0,
    error_count: failureInjected ? Math.max(1, paymentErrors) : paymentErrors,
    last_event_type: failureInjected ? 'FAILURE_INJECTED' : lastPaymentEvent?.event_type || null,
  };

  // PostgreSQL Store
  const postgresService: ServiceSummary = {
    id: 'postgres',
    name: 'PostgreSQL Store',
    status: 'HEALTHY',
    container_name: '01-http-basics-postgres-1',
    compose_service: 'postgres',
    port: 5432,
    inbound_calls: Math.max(1, events.length),
    outbound_calls: 0,
    error_count: 0,
    last_event_type: null,
  };

  return [ordersService, paymentService, postgresService];
};
