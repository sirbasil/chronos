import React from 'react';

interface DigitalDisplayProps {
  label: string;
  value: number | string;
  unit?: string;
  digits?: number;
  color?: 'amber' | 'phosphor' | 'danger';
  size?: 'hero' | 'standard';
  onClick?: () => void;
  className?: string;
}

export const DigitalDisplay: React.FC<DigitalDisplayProps> = ({
  label,
  value,
  unit,
  digits = 4,
  color = 'amber',
  size = 'standard',
  onClick,
  className = '',
}) => {
  const valueStr = String(value);
  const ghostStr = '8'.repeat(Math.max(digits, valueStr.length));
  const paddedValue = typeof value === 'number'
    ? valueStr.padStart(digits, '0')
    : valueStr;

  const activeColorClass =
    color === 'phosphor'
      ? 'digital-active-phosphor'
      : color === 'danger'
      ? 'digital-active-danger'
      : 'digital-active-amber';

  const ghostColorClass =
    color === 'phosphor'
      ? 'digital-ghost-phosphor'
      : color === 'danger'
      ? 'digital-ghost-danger'
      : 'digital-ghost-amber';

  const backlightGlowClass =
    color === 'phosphor'
      ? 'bg-[radial-gradient(circle_at_center,rgba(184,255,0,0.06)_0%,transparent_75%)]'
      : color === 'danger'
      ? 'bg-[radial-gradient(circle_at_center,rgba(255,46,23,0.06)_0%,transparent_75%)]'
      : 'bg-[radial-gradient(circle_at_center,rgba(255,158,0,0.06)_0%,transparent_75%)]';

  const isHero = size === 'hero';

  return (
    <div
      onClick={onClick}
      className={`digital-readout-frame flex flex-col justify-between transition-all ${
        onClick
          ? 'cursor-pointer hover:border-[var(--chrono-phosphor)] hover:shadow-[0_0_10px_rgba(184,255,0,0.2)]'
          : ''
      } ${className}`}
      style={{ minWidth: isHero ? '150px' : '125px' }}
      title={onClick ? `Click to inspect ${label}` : undefined}
    >
      {/* Background cathode light spill */}
      <div className={`absolute inset-0 pointer-events-none ${backlightGlowClass}`} />

      {/* Top Label & Unit Caption */}
      <div className="relative z-10 flex justify-between items-center text-[10px] tracking-wider text-chrono-muted uppercase font-mono mb-1">
        <span className="font-semibold text-chrono-text">{label}</span>
        {unit && <span className="text-[9px] text-chrono-amber opacity-90">[{unit}]</span>}
      </div>

      {/* Digit Field with 7-Segment Ghosting */}
      <div
        className={`relative font-digital font-bold leading-none tracking-widest text-right overflow-hidden py-0.5 ${
          isHero ? 'text-3xl' : 'text-2xl'
        }`}
      >
        {/* Unlit ghost segments */}
        <div className={`absolute right-0 top-0.5 digital-ghost pointer-events-none select-none ${ghostColorClass}`}>
          {ghostStr}
        </div>

        {/* Illuminated active numerals */}
        <span className={`relative z-10 transition-colors duration-200 ${activeColorClass}`}>
          {paddedValue}
        </span>
      </div>
    </div>
  );
};
