import { ChronosEvent } from '../types/events';

export interface TraceLayoutParams {
  events: ChronosEvent[];
  containerWidth: number;
  zoomLevel: number;
  rightPadPx?: number;
}

export interface PlacedEventMarker {
  event: ChronosEvent;
  x: number;
  staggerRow: -1 | 0 | 1;
}

export interface TraceLayoutResult {
  hasPreExecEvents: boolean;
  preExecEvents: ChronosEvent[];
  zeroX: number;
  rightPadPx: number;
  maxOffset: number;
  trackWidthPx: number;
  usableSpanPx: number;
  majorTickStep: number;
  majorTicks: number[];
  timeToPx: (ms: number) => number;
  pxToTime: (px: number) => number;
  eventToPx: (evt: ChronosEvent) => number;
  markers: PlacedEventMarker[];
}

const COLLISION_THRESHOLD_PX = 82;
const MARKER_RIGHT_GUARD_PX = 44;

/**
 * Pure trace geometry calculator supporting 0.75X..2.5X zoom levels, natural
 * execution-span scaling, dedicated PRE-EXEC (< 0) staging bay, and per-lane
 * vertical collision staggering without distorting horizontal event timestamps.
 */
export const computeTraceLayout = ({
  events,
  containerWidth,
  zoomLevel,
  rightPadPx = 44,
}: TraceLayoutParams): TraceLayoutResult => {
  const preExecEvents = [...events]
    .filter((e) => (e.offset_ms ?? 0) < 0)
    .sort((a, b) => (a.offset_ms ?? 0) - (b.offset_ms ?? 0));
  const hasPreExecEvents = preExecEvents.length > 0;
  const zeroX = hasPreExecEvents ? 105 : 44;

  const execOffsets = events
    .map((e) => e.offset_ms ?? 0)
    .filter((ms) => ms >= 0);
  const lastOffset = execOffsets.length > 0 ? Math.max(...execOffsets) : 0;
  const marginMs = Math.max(8, Math.round(lastOffset * 0.12));
  const maxOffset = Math.max(40, lastOffset + marginMs);

  const safeContainerWidth = Math.max(480, containerWidth || 760);
  const clampedZoom = Math.max(0.75, Math.min(2.5, zoomLevel));
  // Keep 0.75X genuinely zoomed out (~75% of container) while preserving usable width
  const trackWidthPx = Math.max(360, Math.round(safeContainerWidth * clampedZoom));
  const maxPlotX = Math.max(zeroX + 80, trackWidthPx - rightPadPx);
  const usableSpanPx = Math.max(80, maxPlotX - zeroX);

  const timeToPx = (ms: number): number => {
    if (maxOffset <= 0) return zeroX;
    const clampedMs = Math.max(0, Math.min(maxOffset, ms));
    return zeroX + (clampedMs / maxOffset) * usableSpanPx;
  };

  const pxToTime = (px: number): number => {
    if (usableSpanPx <= 0 || maxOffset <= 0) return 0;
    const raw = ((px - zeroX) / usableSpanPx) * maxOffset;
    return Math.max(0, Math.min(maxOffset, raw));
  };

  const eventToPx = (evt: ChronosEvent): number => {
    const offset = evt.offset_ms ?? 0;
    if (offset >= 0) {
      return Math.min(trackWidthPx - MARKER_RIGHT_GUARD_PX, timeToPx(offset));
    }
    const count = preExecEvents.length;
    if (count <= 1) return 48;
    const preIdx = preExecEvents.findIndex((p) => p.event_id === evt.event_id);
    const startX = 28;
    const endX = zeroX - 28;
    return startX + ((preIdx < 0 ? 0 : preIdx) / (count - 1)) * Math.max(16, endX - startX);
  };

  // Adaptive grid ticks
  let baseTickStep = 10;
  if (maxOffset > 10000) baseTickStep = 2000;
  else if (maxOffset > 5000) baseTickStep = 1000;
  else if (maxOffset > 2000) baseTickStep = 500;
  else if (maxOffset > 800) baseTickStep = 200;
  else if (maxOffset > 400) baseTickStep = 100;
  else if (maxOffset > 160) baseTickStep = 50;
  else if (maxOffset > 60) baseTickStep = 20;

  const majorTickStep =
    clampedZoom >= 1.5 ? Math.max(5, Math.floor(baseTickStep / 2)) : baseTickStep;
  const majorTicks: number[] = [];
  for (let t = 0; t <= maxOffset; t += majorTickStep) {
    majorTicks.push(t);
  }

  // Assign vertical stagger row within each service lane when horizontal x spacing is tight
  const sortedByTime = [...events].sort(
    (a, b) => (a.offset_ms ?? 0) - (b.offset_ms ?? 0)
  );
  const byLane = new Map<string, { event: ChronosEvent; x: number }[]>();
  for (const evt of sortedByTime) {
    const lane = byLane.get(evt.service_id) ?? [];
    lane.push({ event: evt, x: eventToPx(evt) });
    byLane.set(evt.service_id, lane);
  }

  const staggerById = new Map<string, -1 | 0 | 1>();
  for (const laneItems of byLane.values()) {
    const rowLastX: Record<-1 | 0 | 1, number> = {
      [-1]: -Infinity,
      [0]: -Infinity,
      [1]: -Infinity,
    };

    for (let i = 0; i < laneItems.length; i++) {
      const curr = laneItems[i];
      const next = laneItems[i + 1];
      const hasNeighborCollision =
        Math.abs(curr.x - rowLastX[0]) < COLLISION_THRESHOLD_PX ||
        (next !== undefined && Math.abs(next.x - curr.x) < COLLISION_THRESHOLD_PX);

      let chosenRow: -1 | 0 | 1 = 0;
      if (hasNeighborCollision) {
        if (Math.abs(curr.x - rowLastX[-1]) >= COLLISION_THRESHOLD_PX) {
          chosenRow = -1;
        } else if (Math.abs(curr.x - rowLastX[1]) >= COLLISION_THRESHOLD_PX) {
          chosenRow = 1;
        } else {
          chosenRow = i % 2 === 0 ? -1 : 1;
        }
      }
      rowLastX[chosenRow] = curr.x;
      staggerById.set(curr.event.event_id, chosenRow);
    }
  }

  const markers: PlacedEventMarker[] = sortedByTime.map((evt) => ({
    event: evt,
    x: eventToPx(evt),
    staggerRow: staggerById.get(evt.event_id) ?? 0,
  }));

  return {
    hasPreExecEvents,
    preExecEvents,
    zeroX,
    rightPadPx,
    maxOffset,
    trackWidthPx,
    usableSpanPx,
    majorTickStep,
    majorTicks,
    timeToPx,
    pxToTime,
    eventToPx,
    markers,
  };
};

