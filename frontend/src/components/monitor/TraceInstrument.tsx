import React, { useState, useRef, useEffect } from 'react';
import { ChronosEvent, ChronosRun, ServiceSummary } from '../../types/events';
import { AppMode } from '../../types/api';
import { formatSignedOffsetMs, formatExactSignedDelta } from '../../utils/runTelemetry';
import { computeTraceLayout } from '../../utils/traceGeometry';
import { RotateCcw, ZoomIn, ZoomOut, Activity } from 'lucide-react';

interface TraceInstrumentProps {
  run: ChronosRun | null;
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
  const [containerWidth, setContainerWidth] = useState<number>(760);

  // Track container width dynamically to keep 1.0X zoom panoramic across all screens
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const updateWidth = () => {
      if (el.clientWidth > 100) {
        setContainerWidth(el.clientWidth);
      }
    };
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const runEvents = run?.events ?? [];
  const layout = computeTraceLayout({
    events: runEvents,
    containerWidth,
    zoomLevel,
  });
  const {
    hasPreExecEvents,
    zeroX,
    trackWidthPx,
    majorTicks,
    timeToPx,
    pxToTime,
    eventToPx,
    markers,
  } = layout;

  // Auto-scroll to selected event if zoomed in and out of viewport
  useEffect(() => {
    if (selectedEvent && scrollContainerRef.current) {
      const x = eventToPx(selectedEvent);
      const container = scrollContainerRef.current;
      const visibleWidth = container.clientWidth;
      if (x < container.scrollLeft + 40 || x > container.scrollLeft + visibleWidth - 40) {
        container.scrollTo({
          left: Math.max(0, x - visibleWidth / 2),
          behavior: 'smooth',
        });
      }
    }
  }, [selectedEvent?.event_id, zoomLevel, trackWidthPx]);

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
      default:
        return {
          label: (event.event_type as string) || 'EVT',
          badgeBg: 'bg-[#0f140d]',
          textColor: 'text-chrono-phosphor',
          borderColor: 'border-chrono-phosphor',
          dotColor: 'bg-chrono-phosphor shadow-[0_0_6px_#b8ff00]',
          glow: 'shadow-[0_0_8px_rgba(184,255,0,0.6)]',
        };
    }
  };

  const getEventSummary = (event: ChronosEvent): string => {
    const p = event.payload || {};
    switch (event.event_type) {
      case 'REQUEST_START':
        return `Order ${p.order_id ?? ''} (${p.total_amount ? `$${p.total_amount} ${p.currency ?? ''}` : `${p.items_count ?? 1} items`})`;
      case 'SERVICE_CALL':
        return `${p.method ?? 'POST'} ${p.endpoint ?? '/payments'} -> ${p.destination_service ?? 'payment'}`;
      case 'RESPONSE': {
        const httpStatus = p.http_status ?? p.status_code ?? 200;
        const statusText = p.status ?? 'AUTHORIZED';
        return `HTTP ${httpStatus} [${statusText}]`;
      }
      case 'FAILURE_INJECTED': {
        const action = p.action ?? 'KILL';
        const target = p.target ?? p.target_service ?? 'payment';
        const signal = p.signal ? ` (${p.signal})` : '';
        return `${action}${signal} -> ${target}`;
      }
      case 'SERVICE_ERROR': {
        const errorType = p.error_type ?? 'Error';
        const detail = p.detail ?? (p.destination_service ? `${p.destination_service} unavailable` : 'Connection failure');
        return `${errorType}: ${detail}`;
      }
      case 'REQUEST_END': {
        const status = (p.status || p.checkout_status || 'DONE') as string;
        const httpStatus = p.http_status || (status === 'COMPLETED' ? 200 : 503);
        const duration = p.duration_ms ?? event.offset_ms ?? 0;
        return `${status} [HTTP ${httpStatus}] (${duration}ms)`;
      }
      default:
        return JSON.stringify(p);
    }
  };

  // Fixed Channel Geometry Constants — compact so 3 channels avoid vertical clipping
  const rulerHeightPx = 28;
  const channelHeightPx = 76;
  const channelMarginPx = 10;
  const channelTopPadPx = 10;
  const totalTrackHeightPx =
    rulerHeightPx +
    channelTopPadPx * 2 +
    services.length * channelHeightPx +
    Math.max(0, services.length - 1) * channelMarginPx;

  const getServiceCenterY = (serviceId: string) => {
    const idx = services.findIndex((s) => s.id === serviceId);
    if (idx === -1) return rulerHeightPx + channelTopPadPx + channelHeightPx / 2;
    return rulerHeightPx + channelTopPadPx + idx * (channelHeightPx + channelMarginPx) + channelHeightPx / 2;
  };

  // Generate luminous plotted SVG trace path connecting consecutive events
  const sortedEvents = markers.map((m) => m.event);
  let tracePathD = '';
  if (sortedEvents.length > 0) {
    const p0x = eventToPx(sortedEvents[0]);
    const p0y = getServiceCenterY(sortedEvents[0].service_id);
    tracePathD = `M ${p0x} ${p0y}`;

    for (let i = 1; i < sortedEvents.length; i++) {
      const prev = sortedEvents[i - 1];
      const curr = sortedEvents[i];
      const x1 = eventToPx(prev);
      const y1 = getServiceCenterY(prev.service_id);
      const x2 = eventToPx(curr);
      const y2 = getServiceCenterY(curr.service_id);

      if (y1 === y2) {
        tracePathD += ` L ${x2} ${y2}`;
      } else {
        const midX = (x1 + x2) / 2;
        tracePathD += ` L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
      }
    }
  }

  const getChannelLampClass = (status: ServiceSummary['status']) => {
    switch (status) {
      case 'HEALTHY':
        return 'bg-chrono-success shadow-[0_0_6px_#00ff88]';
      case 'RECOVERED':
        return 'bg-[#22d3ee] shadow-[0_0_6px_#22d3ee]';
      case 'FAILED':
        return 'bg-chrono-red shadow-[0_0_6px_#ff3333] animate-pulse';
      case 'DEGRADED':
        return 'bg-chrono-amber shadow-[0_0_6px_#ff9e00] animate-pulse';
      default:
        return 'bg-chrono-muted';
    }
  };

  return (
    <div className="instrument-cluster-frame flex flex-col h-full min-h-[280px] overflow-hidden select-none">
      {/* 1. Oscilloscope Header Bezel */}
      <div className="min-h-[40px] bg-[#0c1209] border-b border-chrono-grid flex flex-wrap items-center justify-between gap-2 px-3 py-1 shrink-0">
        <div className="flex flex-wrap items-center gap-2.5">
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
              title="Zoom Out Graticule (min 0.75X)"
            >
              <ZoomOut className="w-3 h-3" />
            </button>
            <span className="px-2.5 py-0.5 text-[10px] text-chrono-phosphor font-bold border-x border-chrono-grid tracking-wider">
              {zoomLevel.toFixed(2).replace(/\.00$/, '.0')}X
            </span>
            <button
              onClick={() => setZoomLevel((z) => Math.min(2.5, +(z + 0.25).toFixed(2)))}
              className="px-2 py-1 hover:bg-[#12190e] text-chrono-muted hover:text-chrono-phosphor flex items-center gap-1 transition-colors"
              title="Zoom In Graticule (max 2.50X)"
            >
              <ZoomIn className="w-3 h-3" />
            </button>
          </div>

          <button
            onClick={() => {
              onTimeChange(0);
              scrollContainerRef.current?.scrollTo({ left: 0, behavior: 'smooth' });
            }}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-[#040604] border border-chrono-grid hover:border-chrono-amber text-chrono-muted hover:text-chrono-amber transition-colors shadow-sm"
            title="Reset Cursor to T=0"
          >
            <RotateCcw className="w-3 h-3" />
            <span className="text-[10px] font-bold">RESET T=0</span>
          </button>
        </div>
      </div>

      {/* 2. Main Multi-Track Frame: Synchronized vertical scroll for Channel Column + Timeline */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden flex items-start min-h-0 bg-[#040604]">
        {/* Pinned Left Channel Plaques Column */}
        <div
          className="w-[155px] sm:w-[170px] shrink-0 border-r border-chrono-grid bg-[#070b05] flex flex-col z-20 shadow-md"
          style={{ minHeight: `${totalTrackHeightPx}px` }}
        >
          {/* Top Header of Channel Column */}
          <div className="h-7 border-b border-chrono-grid-bright bg-[#060a04] px-2.5 flex items-center justify-between shrink-0">
            <span className="text-[9px] font-mono font-bold text-chrono-muted tracking-widest uppercase">
              CHANNELS
            </span>
            <Activity className="w-3 h-3 text-chrono-phosphor" />
          </div>

          {/* Service Channel Headers (Exact alignment with timeline tracks) */}
          <div className="flex flex-col py-[10px] px-2 gap-[10px]">
            {services.map((svc, idx) => {
              const isSelected = selectedServiceId === svc.id;

              return (
                <div
                  key={svc.id}
                  onClick={onSelectService ? () => onSelectService(svc) : undefined}
                  className={`h-[76px] p-2 border flex flex-col justify-between transition-all cursor-pointer ${
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
                    <div className={`w-2 h-2 rounded-full ${getChannelLampClass(svc.status)}`} />
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
          style={{ touchAction: 'none', minHeight: `${totalTrackHeightPx}px` }}
        >
          {/* CRT Init Sweep Animation */}
          <div className="crt-sweep-line" />

          {/* Scanline Texture Overlay (pointer-events-none so it never intercepts clicks) */}
          <div className="absolute inset-0 pointer-events-none crt-scanlines z-10" />

          <div
            className="relative graticule-grid-major"
            style={{ width: `${trackWidthPx}px`, height: `${totalTrackHeightPx}px` }}
          >
            {/* Top Time Scale / Ruler */}
            <div className="h-7 border-b border-chrono-grid-bright bg-[#060a04]/90 flex items-center relative select-none">
              {hasPreExecEvents && (
                <div
                  className="absolute bottom-0 flex flex-col items-center pointer-events-none"
                  style={{ left: '48px' }}
                >
                  <span className="text-[9px] font-mono font-bold text-chrono-amber leading-none -translate-x-1/2 mb-1.5">
                    PRE
                  </span>
                  <div className="w-[1px] h-2 bg-chrono-amber/60" />
                </div>
              )}
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

            {hasPreExecEvents && (
              <div
                className="absolute top-7 bottom-0 border-l border-dashed border-chrono-amber/40 pointer-events-none"
                style={{ left: `${zeroX}px` }}
              />
            )}

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
              className="absolute top-0 left-0 pointer-events-none z-10"
              style={{ width: `${trackWidthPx}px`, height: `${totalTrackHeightPx}px` }}
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

            {/* Empty State Notice */}
            {(!run || runEvents.length === 0) && (
              <div className="absolute inset-0 top-7 flex items-center justify-center pointer-events-none z-15">
                <div className="px-4 py-2 bg-[#040604]/90 border border-chrono-grid font-mono text-[11px] text-chrono-muted">
                  {!run
                    ? 'NO ACTIVE RUN SELECTED — CREATE A RUN TO BEGIN TRACE CAPTURE'
                    : 'NO EVENTS RECORDED FOR THIS RUN YET — EXECUTE CHECKOUT OR INJECT FAILURE'}
                </div>
              </div>
            )}

            {/* Service Channel Track Lanes */}
            <div className="relative z-20 flex flex-col py-[10px] px-2 gap-[10px] pointer-events-none">
              {services.map((svc) => {
                const isServiceHighlighted = selectedServiceId === svc.id;
                const svcMarkers = markers.filter((m) => m.event.service_id === svc.id);

                return (
                  <div
                    key={svc.id}
                    className={`relative h-[76px] border transition-all flex items-center pointer-events-none ${
                      isServiceHighlighted
                        ? 'border-chrono-phosphor/80 bg-[#0c1608]/70 shadow-[inset_0_0_20px_rgba(184,255,0,0.15)]'
                        : 'border-chrono-grid/60 bg-[#060a04]/60'
                    }`}
                  >
                    {/* Horizontal Center Guide Rail */}
                    <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[1px] bg-chrono-phosphor/20 pointer-events-none" />

                    {/* Interactive Event Markers Placed on this Channel Track */}
                    {svcMarkers.map(({ event: evt, x, staggerRow }) => {
                      const offset = evt.offset_ms ?? 0;
                      const isSelected = selectedEvent?.event_id === evt.event_id;
                      const style = getEventStyle(evt);
                      const topPosClass =
                        staggerRow === -1
                          ? 'top-[28%]'
                          : staggerRow === 1
                          ? 'top-[72%]'
                          : 'top-1/2';

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
                          className={`absolute ${topPosClass} -translate-y-1/2 -translate-x-1/2 cursor-pointer group flex flex-col items-center transition-all pointer-events-auto select-none ${
                            isSelected ? 'scale-120 z-40' : 'hover:scale-110 z-30'
                          }`}
                          style={{ left: `${x}px` }}
                          title={formatExactSignedDelta(offset)}
                        >
                          {/* Event Capsule */}
                          <div
                            className={`px-2 py-0.5 border-2 text-[9px] font-mono font-bold tracking-wider flex items-center gap-1 rounded-none transition-all whitespace-nowrap ${
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
                          <span className="text-[9px] font-mono font-semibold text-chrono-text mt-0.5 leading-none drop-shadow-[0_0_3px_#000] whitespace-nowrap">
                            {formatSignedOffsetMs(offset)}
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
            <span className="text-chrono-amber font-bold ml-auto">
              {formatSignedOffsetMs(hoveredEvent.offset_ms ?? 0)}
            </span>
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
