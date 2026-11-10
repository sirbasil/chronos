export type EventType =
  | 'REQUEST_START'
  | 'SERVICE_CALL'
  | 'RESPONSE'
  | 'SERVICE_ERROR'
  | 'FAILURE_INJECTED'
  | 'REQUEST_END';

export type Severity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

export interface ChronosEvent {
  event_id: string;
  run_id: string;
  timestamp: string; // ISO 8601 string
  service_id: string;
  trace_id: string | null;
  event_type: EventType;
  source: string;
  payload: Record<string, unknown>;
  severity: Severity;
  offset_ms?: number; // relative millisecond offset from run started_at
}

export type RunStatus = 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'ABANDONED';

export interface ChronosRun {
  run_id: string;
  started_at: string;
  completed_at: string | null;
  status: RunStatus;
  order_id?: string;
  description: string;
  is_failure_experiment: boolean;
  events: ChronosEvent[];
}

export interface ServiceSummary {
  id: string;
  name: string;
  status: 'HEALTHY' | 'DEGRADED' | 'FAILED' | 'OBSERVED';
  container_name: string;
  compose_service: string;
  port: number;
  inbound_calls: number;
  outbound_calls: number;
  error_count: number;
  last_event_type: EventType | null;
}
