import React from 'react';
import { NavDestination } from '../types/ui';
import {
  Activity,
  Layers,
  Network,
  Zap,
  Archive,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';

interface NavigationProps {
  currentDestination: NavDestination;
  onSelectDestination: (dest: NavDestination) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

interface NavItem {
  id: NavDestination;
  label: string;
  sublabel: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'MONITOR', label: 'MONITOR', sublabel: 'LIVE TRACE', icon: Activity },
  { id: 'RUNS', label: 'RUNS', sublabel: 'LOG ARCHIVE', icon: Layers },
  { id: 'TOPOLOGY', label: 'TOPOLOGY', sublabel: 'DAG GRAPH', icon: Network },
  { id: 'EXPERIMENTS', label: 'EXPERIMENTS', sublabel: 'INJECTION', icon: Zap },
  { id: 'ARCHIVE', label: 'ARCHIVE', sublabel: 'RECORDS', icon: Archive },
  { id: 'SETTINGS', label: 'SETTINGS', sublabel: 'PARAMS', icon: Settings },
];

export const Navigation: React.FC<NavigationProps> = ({
  currentDestination,
  onSelectDestination,
  collapsed,
  onToggleCollapse,
}) => {
  return (
    <aside
      className={`bg-[#070b05] border-r border-chrono-grid flex flex-col shrink-0 select-none z-20 justify-between transition-all duration-200 ease-out ${
        collapsed ? 'w-[64px]' : 'w-[220px]'
      }`}
    >
      {/* Switch Bank Header with Collapse/Expand Control */}
      <div>
        <div className="h-[36px] bg-[#0c1209] border-b border-chrono-grid flex items-center justify-between px-2.5">
          {!collapsed ? (
            <>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-chrono-phosphor rounded-full shadow-[0_0_6px_#b8ff00] animate-pulse" />
                <span className="font-mono text-[10px] font-bold tracking-widest text-chrono-muted uppercase">
                  // SELECTOR BANK
                </span>
              </div>
              <button
                onClick={onToggleCollapse}
                className="p-1 text-chrono-muted hover:text-chrono-phosphor hover:bg-[#12190e] border border-transparent hover:border-chrono-grid transition-colors"
                title="Collapse Sidebar"
                aria-label="Collapse Sidebar"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </>
          ) : (
            <div className="w-full flex items-center justify-center">
              <button
                onClick={onToggleCollapse}
                className="p-1 text-chrono-muted hover:text-chrono-phosphor hover:bg-[#12190e] border border-transparent hover:border-chrono-grid transition-colors"
                title="Expand Sidebar"
                aria-label="Expand Sidebar"
              >
                <PanelLeftOpen className="w-4 h-4 text-chrono-phosphor drop-shadow-[0_0_4px_#b8ff00]" />
              </button>
            </div>
          )}
        </div>

        {/* Vertical Switch Stack */}
        <div className="p-2 space-y-1.5">
          {NAV_ITEMS.map((item) => {
            const isActive = currentDestination === item.id;
            const Icon = item.icon;

            return (
              <button
                key={item.id}
                onClick={() => onSelectDestination(item.id)}
                title={`${item.label} — ${item.sublabel}`}
                className={`w-full switch-selector text-left relative rounded-none transition-all ${
                  collapsed
                    ? 'h-11 flex items-center justify-center px-0'
                    : 'px-3 py-2.5 flex items-center gap-3'
                } ${isActive ? 'active' : ''}`}
              >
                {/* Neon Indicator on left edge */}
                {isActive && <div className="switch-neon-indicator" />}

                <Icon
                  className={`${collapsed ? 'w-5 h-5' : 'w-4 h-4'} transition-colors shrink-0 ${
                    isActive
                      ? 'text-chrono-phosphor drop-shadow-[0_0_6px_rgba(184,255,0,0.8)]'
                      : 'text-chrono-muted'
                  }`}
                />

                {!collapsed && (
                  <>
                    <div className="flex flex-col min-w-0">
                      <span
                        className={`font-mono text-xs font-bold tracking-wider leading-tight ${
                          isActive
                            ? 'text-chrono-phosphor drop-shadow-[0_0_6px_rgba(184,255,0,0.6)]'
                            : 'text-chrono-text hover:text-chrono-phosphor'
                        }`}
                      >
                        {item.label}
                      </span>
                      <span className="font-mono text-[9px] text-chrono-muted tracking-widest">
                        {item.sublabel}
                      </span>
                    </div>

                    {item.id === 'MONITOR' && (
                      <span
                        className={`ml-auto w-1.5 h-1.5 rounded-full shrink-0 ${
                          isActive
                            ? 'bg-chrono-phosphor shadow-[0_0_6px_#b8ff00] animate-pulse'
                            : 'bg-chrono-grid'
                        }`}
                      />
                    )}
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom Chassis Notch */}
      <div className="p-2.5 border-t border-chrono-grid bg-[#0a0e07] text-[9px] font-mono text-chrono-muted flex flex-col gap-1">
        {!collapsed ? (
          <>
            <div className="flex items-center justify-between text-chrono-text">
              <span>CONSOLE:</span>
              <span className="text-chrono-phosphor font-bold">ATHON-01</span>
            </div>
            <div className="text-[8px] text-chrono-muted tracking-wider">BERTONE DIGITAL CLUSTER</div>
          </>
        ) : (
          <div className="text-center text-chrono-phosphor font-bold text-[10px]">
            AT-01
          </div>
        )}
      </div>
    </aside>
  );
};
