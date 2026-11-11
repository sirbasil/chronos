import { fetchAuthSession } from 'aws-amplify/auth';
import { isCognitoConfigured } from '../auth/amplifyConfig';
import {
  BackendHealth,
  RunSummaryResponse,
  TopologyResponse,
  CheckoutResponse,
  FailureInjectionResponse,
  ApiError,
} from '../types/api';
import { ChronosEvent } from '../types/events';
export {
  parseUtcTimestampMs,
  formatSignedOffsetMs,
  formatExactSignedDelta,
  getEventChannel,
  transformEvents,
  computeRunDurationMs,
  deriveCheckoutOutcome,
  buildChronosRun,
  deriveServicesFromRun,
  isAuthorizedOperator,
  getScopedExecutionError,
  getScopedExecutionResult,
  shouldApplyRunResponse,
  canSwitchRun,
  canTriggerRunActions,
} from '../utils/runTelemetry';
export type { CheckoutOutcome, DeriveServicesOptions } from '../utils/runTelemetry';

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

export const DEFAULT_TIMEOUT_MS = 5000;
export const CHECKOUT_TIMEOUT_MS = 12000;
export const FAILURE_INJECTION_TIMEOUT_MS = 12000;

export const parseApiError = (
  err: unknown,
  fallbackMessage: string
): { status?: number; code: string; message: string } => {
  if (err && typeof err === 'object') {
    const record = err as { status?: unknown; code?: unknown; message?: unknown };
    const status =
      typeof record.status === 'number' && record.status > 0 ? record.status : undefined;
    const code =
      typeof record.code === 'string' && record.code.length > 0
        ? record.code
        : status
        ? `HTTP_${status}`
        : 'UNKNOWN_ERROR';
    const message =
      typeof record.message === 'string' && record.message.length > 0
        ? record.message
        : fallbackMessage;
    return { status, code, message };
  }
  if (err instanceof Error) {
    return { code: 'UNKNOWN_ERROR', message: err.message || fallbackMessage };
  }
  return { code: 'UNKNOWN_ERROR', message: fallbackMessage };
};

const fetchWithTimeout = async (
  endpoint: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
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
      const timeoutErr: ApiError = {
        status: 0,
        code: 'TIMEOUT',
        message: `Request to ${endpoint} timed out after ${timeoutMs}ms`,
      };
      throw timeoutErr;
    }
    if (err instanceof TypeError) {
      const networkErr: ApiError = {
        status: 0,
        code: 'NETWORK_ERROR',
        message: err.message || `Network failure reaching ${endpoint}`,
      };
      throw networkErr;
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

export const createRun = async (
  signal?: AbortSignal
): Promise<RunSummaryResponse> => {
  const res = await fetchWithTimeout('/runs', {
    method: 'POST',
    signal,
  });
  return handleResponse<RunSummaryResponse>(res);
};

export const checkoutOrder = async (
  orderId = 101,
  runId?: string,
  signal?: AbortSignal
): Promise<CheckoutResponse> => {
  const headers: Record<string, string> = {};
  if (runId) {
    headers['X-Run-ID'] = runId;
  }
  const res = await fetchWithTimeout(
    `/orders/${orderId}/checkout`,
    {
      method: 'POST',
      headers,
      signal,
    },
    CHECKOUT_TIMEOUT_MS
  );
  return handleResponse<CheckoutResponse>(res);
};

export const injectFailure = async (
  runId: string,
  target = 'payment',
  signal?: AbortSignal
): Promise<FailureInjectionResponse> => {
  const res = await fetchWithTimeout(
    `/runs/${runId}/failure`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ target }),
      signal,
    },
    FAILURE_INJECTION_TIMEOUT_MS
  );
  return handleResponse<FailureInjectionResponse>(res);
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
