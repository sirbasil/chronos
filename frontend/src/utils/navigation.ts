import { NavDestination } from '../types/ui';

export type SidebarNavItemId =
  | 'MONITOR'
  | 'RUNS'
  | 'TOPOLOGY'
  | 'EXPERIMENTS'
  | 'ARCHIVE'
  | 'SETTINGS';

export interface SidebarNavItemConfig {
  id: SidebarNavItemId;
  label: string;
  sublabel: string;
  destination?: NavDestination;
  disabled: boolean;
  focusStaging?: boolean;
  badge?: string;
  title: string;
}

export const SIDEBAR_NAV_ITEMS: SidebarNavItemConfig[] = [
  {
    id: 'MONITOR',
    label: 'MONITOR',
    sublabel: 'LIVE TRACE',
    destination: 'MONITOR',
    disabled: false,
    title: 'Monitor View — Live execution trace, staging panel & service matrix',
  },
  {
    id: 'RUNS',
    label: 'RUNS',
    sublabel: 'LOG ARCHIVE',
    destination: 'RUNS',
    disabled: false,
    title: 'Runs — Persisted experiment run catalog',
  },
  {
    id: 'TOPOLOGY',
    label: 'TOPOLOGY',
    sublabel: 'DAG GRAPH',
    destination: 'TOPOLOGY',
    disabled: false,
    title: 'Topology — Observed service dependency graph',
  },
  {
    id: 'EXPERIMENTS',
    label: 'EXPERIMENTS',
    sublabel: 'INJECTION',
    destination: 'MONITOR',
    disabled: false,
    focusStaging: true,
    badge: 'MONITOR',
    title: 'Open Monitor View and highlight Experiment Staging Panel',
  },
  {
    id: 'ARCHIVE',
    label: 'ARCHIVE',
    sublabel: 'RECORDS',
    disabled: true,
    badge: 'POST-MVP',
    title: 'ARCHIVE // RECORDS — Deferred to Post-MVP roadmap (view persisted runs in RUNS)',
  },
  {
    id: 'SETTINGS',
    label: 'SETTINGS',
    sublabel: 'PARAMS',
    disabled: true,
    badge: 'POST-MVP',
    title: 'SETTINGS // PARAMS — Deferred to Post-MVP roadmap',
  },
];

export const resolveNavigationSelection = (
  item: SidebarNavItemConfig,
  currentDestination: NavDestination
): { nextDestination: NavDestination; shouldFocusStaging: boolean } => {
  if (item.disabled || !item.destination) {
    return {
      nextDestination: currentDestination,
      shouldFocusStaging: false,
    };
  }
  return {
    nextDestination: item.destination,
    shouldFocusStaging: Boolean(item.focusStaging),
  };
};

