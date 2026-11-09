import { RunStatus } from './events';

export type AppMode = 'LIVE' | 'PREVIEW';

export type BackendConnectionState = 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';

export interface BackendHealth {
  status: 'ok' | 'degraded';
  timestamp: string;
  database: 'connected' | 'disconnected';
}

export interface RunSummaryResponse {
  run_id: string;
  started_at: string;
  completed_at?: string | null;
  status: RunStatus;
}

export type CreateRunResponse = RunSummaryResponse;

export interface TopologyNode {
  id: string;
  service_id: string;
}

export interface TopologyEdge {
  source: string;
  target: string;
  event_type: string;
}

export interface TopologyResponse {
  run_id: string;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

export interface ApiError {
  status: number;
  code: string;
  message: string;
}
