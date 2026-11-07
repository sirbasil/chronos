import React, { useState, useRef, useEffect } from 'react';
import { ChronosEvent, ChronosRun, ServiceSummary } from '../../types/events';
import { AppMode } from '../../types/api';
import { RotateCcw, ZoomIn, ZoomOut, Activity } from 'lucide-react';

interface TraceInstrumentProps {
  run: ChronosRun;
  services: ServiceSummary[];
  selectedEvent: ChronosEvent | null;
  selectedServiceId: string | null;
  currentTimeMs: number;
  onSelectEvent: (event: ChronosEvent) => void;
  onSelectService?: (service: ServiceSummary) => void;
  onTimeChange: (timeMs: number) => void;
  mode?: AppMode;
}

export const TraceInstrument: React.FC<TraceInstrumentProps> = ({
  run,
  services,
  selectedEvent,
  selectedServiceId,
  currentTimeMs,
  onSelectEvent,
  onSelectService,
  onTimeChange,
  mode = 'LIVE',
}) => {
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [hoveredEvent, setHoveredEvent] = useState<ChronosEvent | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number; placement: 'top' | 'bottom' } | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Maximum time duration in milliseconds with margin
  const offsets = run.events.map((e) => (e.offset_ms ?? 0) + 20);
  const maxOffset = Math.max(140, ...(offsets.length > 0 ? offsets : [140]));
  const baseWidthPx = 720;
  const pxPerMs = maxOffset > 600 ? Math.max(0.6, 900 / maxOffset) : 6.0;
  const trackWidthPx = Math.max(baseWidthPx, maxOffset * pxPerMs * zoomLevel);

  const timeToPx = (ms: number) => {
    return (ms / maxOffset) * (trackWidthPx - 60) + 30;
  };

  const pxToTime = (px: number) => {
    const raw = ((px - 30) / (trackWidthPx - 60)) * maxOffset;
    return Math.max(0, Math.min(maxOffset, raw));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only respond to primary button (left click)
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // Don't drag if clicking directly on an event marker or interactive button
    if (target.closest('[data-event-marker]') || target.closest('button')) {
      return;
    }
    if (!scrollContainerRef.current) return;
    const rect = scrollContainerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left + scrollContainerRef.current.scrollLeft;
    setIsDragging(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    onTimeChange(pxToTime(clickX));
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !scrollContainerRef.current) return;
    const rect = scrollContainerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left + scrollContainerRef.current.scrollLeft;
    onTimeChange(pxToTime(clickX));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      setIsDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  useEffect(() => {
    const upListener = () => setIsDragging(false);
    window.addEventListener('pointerup', upListener);
    window.addEventListener('pointercancel', upListener);
    return () => {
      window.removeEventListener('pointerup', upListener);
      window.removeEventListener('pointercancel', upListener);
    };
  }, []);

  // Time grid tick intervals adapted to run duration
  let baseTickStep = 25;
  if (maxOffset > 2000) baseTickStep = 500;
  else if (maxOffset > 800) baseTickStep = 200;
  else if (maxOffset > 400) baseTickStep = 100;
  else if (maxOffset > 200) baseTickStep = 50;

  const majorTickStep = zoomLevel >= 1.5 ? Math.max(5, Math.floor(baseTickStep / 2)) : baseTickStep;
  const majorTicks: number[] = [];
  for (let t = 0; t <= maxOffset; t += majorTickStep) {
    majorTicks.push(t);
  }

  // Get glyph styling and coloration for each event type
  const getEventStyle = (event: ChronosEvent) => {
    switch (event.event_type) {
      case 'REQUEST_START':
        return {
          label: 'START',
          badgeBg: 'bg-[#021f10]',
          textColor: 'text-chrono-success',
          borderColor: 'border-chrono-success',
          dotColor: 'bg-chrono-success shadow-[0_0_6px_#00ff88]',
          glow: 'shadow-[0_0_8px_rgba(0,255,136,0.6)]',
        };
      case 'SERVICE_CALL':
        return {
          label: 'CALL',
          badgeBg: 'bg-[#182607]',
          textColor: 'text-chrono-phosphor',
          borderColor: 'border-chrono-phosphor',
          dotColor: 'bg-chrono-phosphor shadow-[0_0_6px_#b8ff00]',
          glow: 'shadow-[0_0_8px_rgba(184,255,0,0.6)]',
        };
      case 'RESPONSE':
        return {
          label: 'RESP',
          badgeBg: 'bg-[#021f18]',
          textColor: 'text-[#00e5a3]',
          borderColor: 'border-[#00e5a3]',
          dotColor: 'bg-[#00e5a3] shadow-[0_0_6px_#00e5a3]',
          glow: 'shadow-[0_0_8px_rgba(0,229,163,0.6)]',
        };
      case 'SERVICE_ERROR':
        return {
          label: 'ERR',
          badgeBg: 'bg-[#2b0805]',
          textColor: 'text-chrono-danger',
          borderColor: 'border-chrono-danger',
          dotColor: 'bg-chrono-danger shadow-[0_0_8px_#ff2e17] animate-pulse',
          glow: 'shadow-[0_0_12px_rgba(255,46,23,0.8)]',
        };
      case 'FAILURE_INJECTED':
        return {
          label: 'KILL',
          badgeBg: 'bg-[#2b1704]',
          textColor: 'text-chrono-amber',
          borderColor: 'border-chrono-amber',
          dotColor: 'bg-chrono-amber shadow-[0_0_8px_#ff9e00]',
          glow: 'shadow-[0_0_12px_rgba(255,158,0,0.8)]',
        };
      case 'REQUEST_END':
        return {
          label: 'END',
          badgeBg: event.severity === 'ERROR' ? 'bg-[#2b0805]' : 'bg-[#021f10]',
          textColor: event.severity === 'ERROR' ? 'text-chrono-danger' : 'text-chrono-success',
          borderColor: event.severity === 'ERROR' ? 'border-chrono-danger' : 'border-chrono-success',
          dotColor: event.severity === 'ERROR' ? 'bg-chrono-danger shadow-[0_0_6px_#ff2e17]' : 'bg-chrono-success shadow-[0_0_6px_#00ff88]',
          glow: event.severity === 'ERROR' ? 'shadow-[0_0_10px_rgba(255,46,23,0.7)]' : 'shadow-[0_0_8px_rgba(0,255,136,0.6)]',
        };
    }
  };

  const getEventSummary = (event: ChronosEvent): string => {
    const p = event.payload || {};
    switch (event.event_type) {
      case 'REQUEST_START':
        return `Order ${p.order_id ?? ''} (${p.total_amount ? `$${p.total_amount} ${p.currency ?? ''}` : `${p.items_count ?? 1} items`})`;
      case 'SERVICE_CALL':
        return `${p.method ?? 'CALL'} ${p.endpoint ?? ''} -> ${p.destination_service ?? 'payment'}`;
      case 'RESPONSE':
        return `HTTP ${p.http_status ?? 200} [${p.status ?? 'AUTHORIZED'}]`;
      case 'FAILURE_INJECTED':
        return `${p.action ?? 'KILL'} (${p.signal ?? 'SIGKILL'}) -> ${p.target_service ?? 'payment'}`;
      case 'SERVICE_ERROR':
        return `${p.error_type ?? 'Error'}: ${p.detail ?? 'Connection failure'}`;
      case 'REQUEST_END':
        return `${p.checkout_status ?? 'DONE'} [HTTP ${p.http_status ?? 200}] (${p.duration_ms ?? event.offset_ms ?? 0}ms)`;
      default:
        return JSON.stringify(p);
    }
  };

  // Fixed Channel Geometry Constants
  const rulerHeightPx = 28;
  const channelHeightPx = 82;
  const channelMarginPx = 14;
  const channelTopPadPx = 12;

  const getServiceCenterY = (serviceId: string) => {
    const idx = services.findIndex((s) => s.id === serviceId);
    if (idx === -1) return rulerHeightPx + channelTopPadPx + channelHeightPx / 2;
    return rulerHeightPx + channelTopPadPx + idx * (channelHeightPx + channelMarginPx) + channelHeightPx / 2;
  };

  // Generate luminous plotted SVG trace path connecting consecutive events
  const sortedEvents = [...run.events].sort((a, b) => (a.offset_ms ?? 0) - (b.offset_ms ?? 0));
  let tracePathD = '';
  if (sortedEvents.length > 0) {
    const p0x = timeToPx(sortedEvents[0].offset_ms ?? 0);
    const p0y = getServiceCenterY(sortedEvents[0].service_id);
    tracePathD = `M ${p0x} ${p0y}`;

    for (let i = 1; i < sortedEvents.length; i++) {
      const prev = sortedEvents[i - 1];
      const curr = sortedEvents[i];
      const x1 = timeToPx(prev.offset_ms ?? 0);
      const y1 = getServiceCenterY(prev.service_id);
      const x2 = timeToPx(curr.offset_ms ?? 0);
      const y2 = getServiceCenterY(curr.service_id);

      if (y1 === y2) {
        tracePathD += ` L ${x2} ${y2}`;
      } else {
        const midX = (x1 + x2) / 2;
        tracePathD += ` L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
      }
    }
  }

  return (
    <div className="instrument-cluster-frame flex flex-col h-full overflow-hidden select-none">
      {/* 1. Oscilloscope Header Bezel */}
      <div className="h-[40px] bg-[#0c1209] border-b border-chrono-grid flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 bg-chrono-phosphor rounded-sm shadow-[0_0_8px_#b8ff00] animate-pulse" />
          <span className="font-mono text-xs font-bold tracking-wider text-chrono-phosphor drop-shadow-[0_0_6px_rgba(184,255,0,0.5)]">
            PANORAMIC EXECUTION TRACE // OSCILLOGRAPHIC DISPLAY
          </span>
          {mode === 'LIVE' ? (
            <span className="text-[9px] font-mono font-bold text-[#4ade80] border border-[#22c55e] bg-[#051a08] px-2 py-0.5 shadow-[0_0_6px_rgba(34,197,94,0.3)]">
              LIVE TELEMETRY
            </span>
          ) : (
            <span className="text-[9px] font-mono font-bold text-chrono-amber border border-chrono-amber bg-[#201505] px-2 py-0.5 shadow-[0_0_6px_rgba(255,158,0,0.3)]">
              PREVIEW FIXTURES
            </span>
          )}
        </div>

        {/* Zoom & Time Reset Controls */}
        <div className="flex items-center gap-2 font-mono text-xs">
          <div className="flex items-center border border-chrono-grid bg-[#040604]">
            <button
              onClick={() => setZoomLevel((z) => Math.max(0.75, +(z - 0.25).toFixed(2)))}
              className="px-2 py-1 hover:bg-[#12190e] text-chrono-muted hover:text-chrono-phosphor flex items-center gap-1 transition-colors"
              title="Zoom Out Graticule"
            >
              <ZoomOut className="w-3 h-3" />
            </button>
            <span className="px-2.5 py-0.5 text-[10px] text-chrono-phosphor font-bold border-x border-chrono-grid tracking-wider">
              {zoomLevel.toFixed(1)}X
            </span>
            <button
              onClick={() => setZoomLevel((z) => Math.min(2.5, +(z + 0.25).toFixed(2)))}
              className="px-2 py-1 hover:bg-[#12190e] text-chrono-muted hover:text-chrono-phosphor flex items-center gap-1 transition-colors"
              title="Zoom In Graticule"
            >
              <ZoomIn className="w-3 h-3" />
            </button>
          </div>

          <button
            onClick={() => onTimeChange(0)}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-[#040604] border border-chrono-grid hover:border-chrono-amber text-chrono-muted hover:text-chrono-amber transition-colors shadow-sm"
            title="Reset Cursor to T=0"
          >
            <RotateCcw className="w-3 h-3" />
            <span className="text-[10px] font-bold">RESET T=0</span>
          </button>
        </div>
      </div>

      {/* 2. Main Multi-Track Frame: Pinned Channel Plaque Column + Scrollable Timeline */}
      <div className="flex-1 flex overflow-hidden min-h-0 bg-[#040604]">
        {/* Pinned Left Channel Plaques Column */}
        <div className="w-[170px] shrink-0 border-r border-chrono-grid bg-[#070b05] flex flex-col z-20 shadow-md">
          {/* Top Header of Channel Column */}
          <div className="h-7 border-b border-chrono-grid-bright bg-[#060a04] px-2.5 flex items-center justify-between">
            <span className="text-[9px] font-mono font-bold text-chrono-muted tracking-widest uppercase">
              CHANNELS
            </span>
            <Activity className="w-3 h-3 text-chrono-phosphor" />
          </div>

          {/* Service Channel Headers (Exact alignment with timeline tracks) */}
          <div className="flex flex-col py-3 px-2 gap-[14px]">
            {services.map((svc, idx) => {
              const isSelected = selectedServiceId === svc.id;

              return (
                <div
                  key={svc.id}
                  onClick={onSelectService ? () => onSelectService(svc) : undefined}
                  className={`h-[82px] p-2 border flex flex-col justify-between transition-all cursor-pointer ${
                    isSelected
                      ? 'border-chrono-phosphor bg-[#121b0d] shadow-[inset_0_0_12px_rgba(184,255,0,0.2)]'
                      : 'border-chrono-grid bg-[#040604] hover:border-chrono-muted hover:bg-[#0c1209]'
                  }`}
                  title={`Click to inspect ${svc.name}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-mono font-bold text-chrono-muted">
                      CH-0{idx + 1}
                    </span>
                    <div
                      className={`w-2 h-2 rounded-full ${
                        svc.status === 'HEALTHY'
                          ? 'bg-chrono-success shadow-[0_0_6px_#00ff88]'
                          : 'bg-chrono-amber shadow-[0_0_6px_#ff9e00]'
                      }`}
                    />
                  </div>

                  <div>
                    <div className="font-mono font-bold text-xs text-chrono-text uppercase tracking-wider truncate">
                      {svc.name}
                    </div>
                    <div className="font-mono text-[9px] text-chrono-amber font-semibold">
                      PORT {svc.port}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Scrollable Timeline Graticule with Pointer Scrubbing */}
        <div
          ref={scrollContainerRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="flex-1 overflow-x-auto overflow-y-hidden relative crt-screen cursor-crosshair select-none"
          style={{ touchAction: 'none' }}
        >
          {/* CRT Init Sweep Animation */}
          <div className="crt-sweep-line" />

          {/* Scanline Texture Overlay (pointer-events-none so it never intercepts clicks) */}
          <div className="absolute inset-0 pointer-events-none crt-scanlines z-10" />

          <div
            className="relative h-full graticule-grid-major"
            style={{ width: `${trackWidthPx}px`, minWidth: '100%' }}
          >
            {/* Top Time Scale / Ruler */}
            <div className="h-7 border-b border-chrono-grid-bright bg-[#060a04]/90 flex items-center relative select-none">
              {majorTicks.map((tick) => {
                const xPos = timeToPx(tick);
                return (
                  <div
                    key={tick}
                    className="absolute bottom-0 flex flex-col items-center pointer-events-none"
                    style={{ left: `${xPos}px` }}
                  >
                    <span className="text-[10px] font-mono font-bold text-chrono-phosphor leading-none -translate-x-1/2 mb-1.5 drop-shadow-[0_0_4px_rgba(184,255,0,0.6)]">
                      {tick}ms
                    </span>
                    <div className="w-[1.5px] h-2.5 bg-chrono-phosphor/70" />
                  </div>
                );
              })}
            </div>

            {/* Vertical Illuminated Graticule Lines */}
            {majorTicks.map((tick) => {
              const xPos = timeToPx(tick);
              return (
                <div
                  key={`grid-${tick}`}
                  className="absolute top-7 bottom-0 w-[1px] bg-chrono-phosphor/15 pointer-events-none"
                  style={{ left: `${xPos}px` }}
                />
              );
            })}

            {/* SVG Luminous Plotted Signal Trace Layer */}
            <svg
              className="absolute top-0 left-0 w-full h-full pointer-events-none z-10"
              style={{ width: `${trackWidthPx}px`, height: '100%' }}
            >
              <defs>
                <filter id="trace-glow-sharp" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="2.5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Glowing Main Trace Path */}
              {tracePathD && (
                <path
                  d={tracePathD}
                  fill="none"
                  stroke="#b8ff00"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  filter="url(#trace-glow-sharp)"
                  opacity="0.95"
                />
              )}
            </svg>

            {/* Service Channel Track Lanes */}
            <div className="relative z-20 flex flex-col py-3 px-2 gap-[14px] pointer-events-none">
              {services.map((svc) => {
                const isServiceHighlighted = selectedServiceId === svc.id;
                const svcEvents = run.events.filter((e) => e.service_id === svc.id);

                return (
                  <div
                    key={svc.id}
                    className={`relative h-[82px] border transition-all flex items-center pointer-events-none ${
                      isServiceHighlighted
                        ? 'border-chrono-phosphor/80 bg-[#0c1608]/70 shadow-[inset_0_0_20px_rgba(184,255,0,0.15)]'
                        : 'border-chrono-grid/60 bg-[#060a04]/60'
                    }`}
                  >
                    {/* Horizontal Center Guide Rail */}
                    <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[1px] bg-chrono-phosphor/20 pointer-events-none" />

                    {/* Interactive Event Markers Placed on this Channel Track */}
                    {svcEvents.map((evt) => {
                      const offset = evt.offset_ms ?? 0;
                      const x = timeToPx(offset);
                      const isSelected = selectedEvent?.event_id === evt.event_id;
                      const style = getEventStyle(evt);

                      return (
                        <div
                          key={evt.event_id}
                          data-event-marker="true"
                          onPointerDown={(e) => {
                            // Stop propagation so pointerdown does not seek/drag the timeline!
                            e.stopPropagation();
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectEvent(evt);
                          }}
                          onMouseEnter={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            const showBelow = rect.top < 240;
                            const xPos = Math.max(140, Math.min(window.innerWidth - 180, rect.left + rect.width / 2));
                            const yPos = showBelow ? rect.bottom + 10 : rect.top - 10;
                            setHoveredEvent(evt);
                            setTooltipPos({ x: xPos, y: yPos, placement: showBelow ? 'bottom' : 'top' });
                          }}
                          onMouseLeave={() => setHoveredEvent(null)}
                          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 cursor-pointer group flex flex-col items-center transition-all pointer-events-auto select-none ${
                            isSelected ? 'scale-125 z-40' : 'hover:scale-115 z-30'
                          }`}
                          style={{ left: `${x}px` }}
                        >
                          {/* Event Capsule */}
                          <div
                            className={`px-2 py-0.5 border-2 text-[9px] font-mono font-bold tracking-wider flex items-center gap-1.5 rounded-none transition-all ${
                              style.badgeBg
                            } ${style.borderColor} ${style.textColor} ${style.glow} ${
                              isSelected
                                ? 'ring-2 ring-chrono-phosphor-bright shadow-[0_0_16px_rgba(184,255,0,0.9)]'
                                : ''
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${style.dotColor}`} />
                            <span>{style.label}</span>
                          </div>

                          {/* Offset Indicator Badge */}
                          <span className="text-[9px] font-mono font-semibold text-chrono-text mt-1 leading-none drop-shadow-[0_0_3px_#000]">
                            +{offset}ms
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {/* Interactive Amber Laser Scrubber Cursor */}
            <div
              className="absolute top-0 bottom-0 z-25 pointer-events-none flex flex-col items-center"
              style={{ left: `${timeToPx(currentTimeMs)}px` }}
            >
              {/* Scrubber Head Pin Readout */}
              <div className="bg-chrono-amber text-[#000] px-2 py-0.5 text-[10px] font-mono font-bold leading-none shadow-[0_0_12px_#ff9e00] -translate-x-1/2 border border-white/40">
                T+{currentTimeMs.toFixed(1)}ms
              </div>

              {/* Vertical Amber Laser Beam */}
              <div className="w-[2px] h-full bg-chrono-amber shadow-[0_0_8px_#ff9e00,0_0_16px_#ff6a00]" />
            </div>
          </div>
        </div>
      </div>

      {/* Floating Hover Tooltip Popover */}
      {hoveredEvent && tooltipPos && (
        <div
          className="fixed z-50 pointer-events-none bg-[#040604]/95 border-2 border-chrono-phosphor p-2.5 shadow-[0_0_16px_rgba(0,0,0,0.95)] text-xs font-mono"
          style={{
            left: `${tooltipPos.x}px`,
            top: `${tooltipPos.y}px`,
            transform: tooltipPos.placement === 'bottom' ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
          }}
        >
          <div className="flex items-center gap-2 mb-1.5 border-b border-chrono-grid pb-1">
            <span className="font-bold text-chrono-phosphor drop-shadow-[0_0_5px_rgba(184,255,0,0.8)]">
              {hoveredEvent.event_type}
            </span>
            <span className="text-chrono-muted">@ {hoveredEvent.service_id}</span>
            <span className="text-chrono-amber font-bold ml-auto">+{hoveredEvent.offset_ms}ms</span>
          </div>
          <div className="text-[10px] text-chrono-text max-w-[280px] bg-[#020402] p-1.5 border border-chrono-grid leading-normal">
            {getEventSummary(hoveredEvent)}
          </div>
          <div className="text-[9px] text-chrono-muted mt-1 font-semibold flex items-center justify-between">
            <span>CLICK TO PIN IN INSPECTOR</span>
            <span className="text-chrono-amber">SEV: {hoveredEvent.severity}</span>
          </div>
        </div>
      )}
    </div>
  );
};
