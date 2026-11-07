import { ChronosEvent, ChronosRun, ServiceSummary } from './events';

export type NavDestination =
  | 'MONITOR'
  | 'RUNS'
  | 'TOPOLOGY'
  | 'EXPERIMENTS'
  | 'ARCHIVE'
  | 'SETTINGS';

export type InspectorTarget =
  | { type: 'EVENT'; event: ChronosEvent }
  | { type: 'SERVICE'; service: ServiceSummary }
  | { type: 'BACKEND_STATUS' }
  | { type: 'DOCKER_STATUS' }
  | { type: 'RUN_SUMMARY'; run: ChronosRun }
  | null;
