import React from 'react';

export type IndicatorState = 'HEALTHY' | 'DEGRADED' | 'FAILED' | 'OBSERVED' | 'OFFLINE' | 'PREVIEW';

interface StatusIndicatorProps {
  state: IndicatorState;
  label?: string;
  size?: 'sm' | 'md';
  pulse?: boolean;
}

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  state,
  label,
  size = 'md',
  pulse = false,
}) => {
  const getColor = () => {
    switch (state) {
      case 'HEALTHY':
        return { bg: 'var(--chrono-success)', glow: '0 0 8px var(--chrono-success)' };
      case 'DEGRADED':
      case 'PREVIEW':
        return { bg: 'var(--chrono-amber)', glow: '0 0 8px var(--chrono-amber)' };
      case 'FAILED':
        return { bg: 'var(--chrono-danger)', glow: '0 0 8px var(--chrono-danger)' };
      case 'OBSERVED':
        return { bg: 'var(--chrono-phosphor)', glow: '0 0 8px var(--chrono-phosphor)' };
      case 'OFFLINE':
      default:
        return { bg: 'var(--chrono-muted)', glow: 'none' };
    }
  };

  const { bg, glow } = getColor();
  const dimension = size === 'sm' ? 'w-2 h-2' : 'w-2.5 h-2.5';

  return (
    <div className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-wide">
      <span
        className={`inline-block ${dimension} ${pulse ? 'animate-pulse' : ''}`}
        style={{
          backgroundColor: bg,
          boxShadow: glow,
          borderRadius: '2px',
          border: '1px solid rgba(0,0,0,0.8)',
        }}
      />
      {label && <span className="text-[var(--chrono-text)] uppercase font-semibold">{label}</span>}
    </div>
  );
};
