import React from 'react';
import { NavDestination } from '../types/ui';
import {
  SIDEBAR_NAV_ITEMS,
  SidebarNavItemId,
  resolveNavigationSelection,
} from '../utils/navigation';
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
  onFocusExperiments?: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

const NAV_ICONS: Record<SidebarNavItemId, React.ComponentType<{ className?: string }>> = {
  MONITOR: Activity,
  RUNS: Layers,
  TOPOLOGY: Network,
  EXPERIMENTS: Zap,
  ARCHIVE: Archive,
  SETTINGS: Settings,
};

export const Navigation: React.FC<NavigationProps> = ({
  currentDestination,
  onSelectDestination,
  onFocusExperiments,
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
          {SIDEBAR_NAV_ITEMS.map((item) => {
            const isActive =
              !item.disabled && !item.focusStaging && currentDestination === item.id;
            const Icon = NAV_ICONS[item.id];

            const handleItemClick = () => {
              const { nextDestination, shouldFocusStaging } = resolveNavigationSelection(
                item,
                currentDestination
              );
              if (item.disabled) return;
              if (shouldFocusStaging && onFocusExperiments) {
                onFocusExperiments();
                return;
              }
              onSelectDestination(nextDestination);
            };

            return (
              <button
                key={item.id}
                type="button"
                disabled={item.disabled}
                aria-disabled={item.disabled || undefined}
                onClick={handleItemClick}
                title={item.title}
                className={`w-full switch-selector text-left relative rounded-none transition-all group ${
                  collapsed
                    ? 'h-11 flex items-center justify-center px-0'
                    : 'px-3 py-2.5 flex items-center gap-3'
                } ${isActive ? 'active' : ''}`}
              >
                {/* Neon Indicator on left edge */}
                {isActive && <div className="switch-neon-indicator" />}

                <Icon
                  className={`${collapsed ? 'w-5 h-5' : 'w-4 h-4'} transition-colors shrink-0 ${
                    item.disabled
                      ? 'text-chrono-muted/70'
                      : isActive
                      ? 'text-chrono-phosphor drop-shadow-[0_0_6px_rgba(184,255,0,0.8)]'
                      : 'text-chrono-muted group-hover:text-chrono-phosphor'
                  }`}
                />

                {!collapsed && (
                  <>
                    <div className="flex flex-col min-w-0">
                      <span
                        className={`font-mono text-xs font-bold tracking-wider leading-tight ${
                          item.disabled
                            ? 'text-chrono-muted'
                            : isActive
                            ? 'text-chrono-phosphor drop-shadow-[0_0_6px_rgba(184,255,0,0.6)]'
                            : 'text-chrono-text group-hover:text-chrono-phosphor'
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

                    {item.badge && (
                      <span
                        className={`ml-auto font-mono text-[8px] font-bold px-1.5 py-0.5 border tracking-wider shrink-0 ${
                          item.disabled
                            ? 'border-chrono-grid bg-[#040604] text-chrono-muted'
                            : 'border-chrono-phosphor/35 bg-[#0b1208] text-chrono-phosphor/85'
                        }`}
                      >
                        {item.badge}
                      </span>
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
