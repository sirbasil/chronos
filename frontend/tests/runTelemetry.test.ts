import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseUtcTimestampMs,
  transformEvents,
  computeRunDurationMs,
  formatSignedOffsetMs,
  deriveCheckoutOutcome,
  deriveServicesFromRun,
  buildChronosRun,
  isAuthorizedOperator,
  getScopedExecutionError,
  getScopedExecutionResult,
  shouldApplyRunResponse,
  canSwitchRun,
  canTriggerRunActions,
} from '../src/utils/runTelemetry';
import { computeTraceLayout } from '../src/utils/traceGeometry';
import {
  SIDEBAR_NAV_ITEMS,
  resolveNavigationSelection,
} from '../src/utils/navigation';
import {
  DEMO_RUN_FAILURE_EXPERIMENT,
  DEMO_RUN_SUCCESS,
  DEMO_SERVICES_FAILURE,
  DEMO_SERVICES_SUCCESS,
} from '../src/data/fixtures';
import { ChronosEvent } from '../src/types/events';

const makeEvent = (overrides: Partial<ChronosEvent> & { event_type: ChronosEvent['event_type'] }): ChronosEvent => ({
  event_id: overrides.event_id ?? '00000000-0000-0000-0000-000000000001',
  run_id: overrides.run_id ?? 'bafd76cd-887a-4296-a0d1-bda4abdc4d1d',
  timestamp: overrides.timestamp ?? '2026-11-11T08:35:56.901108Z',
  service_id: overrides.service_id ?? 'orders',
  trace_id: overrides.trace_id ?? null,
  event_type: overrides.event_type,
  source: overrides.source ?? 'orders-api',
  severity: overrides.severity ?? 'INFO',
  payload: overrides.payload ?? {},
});

test('parseUtcTimestampMs treats Z, +00:00, Postgres +00, and naive ISO strings consistently as UTC', () => {
  const expected = Date.parse('2026-11-11T08:35:56.901Z');
  assert.equal(parseUtcTimestampMs('2026-11-11T08:35:56.901Z'), expected);
  assert.equal(parseUtcTimestampMs('2026-11-11T08:35:56.901+00:00'), expected);
  assert.equal(parseUtcTimestampMs('2026-11-11 08:35:56.901+00'), expected);
  assert.equal(parseUtcTimestampMs('2026-11-11T08:35:56.901'), expected);
});

test('transformEvents and computeRunDurationMs isolate 27.8h pre-execution gap from checkout execution duration', () => {
  // Reproduces exact event timestamps observed on run bafd76cd-887a-4296-a0d1-bda4abdc4d1d
  const rawEvents: ChronosEvent[] = [
    makeEvent({
      event_id: '21238fb8-c37d-4a3e-9817-751fbd74a3a5',
      event_type: 'FAILURE_INJECTED',
      timestamp: '2026-11-10T04:48:30.479994Z',
      source: 'chronos-control',
      severity: 'WARNING',
      payload: { action: 'kill', target: 'payment' },
    }),
    makeEvent({
      event_id: 'a37c6062-a4f9-4fc4-af2b-4c21094afe7d',
      event_type: 'REQUEST_START',
      timestamp: '2026-11-11T08:35:56.901108Z',
      payload: { order_id: 101 },
    }),
    makeEvent({
      event_id: '8baf3f88-41bf-4d45-b09d-bb13d3275c0a',
      event_type: 'SERVICE_CALL',
      timestamp: '2026-11-11T08:35:56.915469Z',
      payload: { order_id: 101, destination_service: 'payment' },
    }),
    makeEvent({
      event_id: '3c4b6145-3028-4f99-b18f-9a6f4ccbd46e',
      event_type: 'RESPONSE',
      timestamp: '2026-11-11T08:35:56.927228Z',
      payload: { order_id: 101, status_code: 200, responding_service: 'payment' },
    }),
    makeEvent({
      event_id: 'd06a5a40-4045-4da2-8f80-ea569ae34217',
      event_type: 'REQUEST_END',
      timestamp: '2026-11-11T08:35:56.934938Z',
      payload: { order_id: 101, status: 'COMPLETED' },
    }),
  ];

  const transformed = transformEvents(rawEvents, '2026-11-10T04:48:27.297710Z');
  assert.equal(transformed.length, 5);
  assert.equal(transformed[0].event_type, 'FAILURE_INJECTED');
  assert.equal(transformed[0].offset_ms, -100046422);
  assert.equal(formatSignedOffsetMs(transformed[0].offset_ms!), '-27.8h');

  assert.equal(transformed[1].event_type, 'REQUEST_START');
  assert.equal(transformed[1].offset_ms, 0);
  assert.equal(transformed[2].offset_ms, 14);
  assert.equal(transformed[3].offset_ms, 26);
  assert.equal(transformed[4].offset_ms, 33);

  const durationMs = computeRunDurationMs(transformed, {
    started_at: '2026-11-10T04:48:27.297710Z',
    completed_at: '2026-11-11T08:35:56.934918Z',
  });
  assert.equal(durationMs, 33);

  const run = buildChronosRun(
    {
      run_id: 'bafd76cd-887a-4296-a0d1-bda4abdc4d1d',
      started_at: '2026-11-10T04:48:27.297710Z',
      completed_at: '2026-11-11T08:35:56.934918Z',
      status: 'COMPLETED',
    },
    rawEvents
  );
  assert.ok(run.description.endsWith('33ms'), `Unexpected description: ${run.description}`);
});

test('transformEvents and computeRunDurationMs handle same-session failures and staged-only runs', () => {
  const stagedOnly = transformEvents([
    makeEvent({
      event_type: 'FAILURE_INJECTED',
      timestamp: '2026-11-10T05:32:58.135475Z',
      severity: 'WARNING',
      payload: { action: 'kill', target: 'payment' },
    }),
  ]);
  assert.equal(stagedOnly[0].offset_ms, 0);
  assert.equal(computeRunDurationMs(stagedOnly), 0);

  const failedSession = transformEvents([
    makeEvent({
      event_id: 'e1',
      event_type: 'FAILURE_INJECTED',
      timestamp: '2026-11-10T05:32:58.135475Z',
      severity: 'WARNING',
      payload: { action: 'kill', target: 'payment' },
    }),
    makeEvent({
      event_id: 'e2',
      event_type: 'REQUEST_START',
      timestamp: '2026-11-10T05:32:58.168635Z',
      payload: { order_id: 101 },
    }),
    makeEvent({
      event_id: 'e3',
      event_type: 'SERVICE_CALL',
      timestamp: '2026-11-10T05:32:58.182344Z',
      payload: { order_id: 101, destination_service: 'payment' },
    }),
    makeEvent({
      event_id: 'e4',
      event_type: 'SERVICE_ERROR',
      timestamp: '2026-11-10T05:33:02.199914Z',
      severity: 'ERROR',
      payload: { order_id: 101, error_type: 'ConnectionError', destination_service: 'payment' },
    }),
    makeEvent({
      event_id: 'e5',
      event_type: 'REQUEST_END',
      timestamp: '2026-11-10T05:33:02.217157Z',
      severity: 'ERROR',
      payload: { order_id: 101, status: 'FAILED' },
    }),
  ]);
  assert.equal(failedSession[0].offset_ms, -33);
  assert.equal(formatSignedOffsetMs(failedSession[0].offset_ms!), '-33ms');
  assert.equal(failedSession[1].offset_ms, 0);
  assert.equal(computeRunDurationMs(failedSession), 4049);
});

test('deriveCheckoutOutcome and deriveServicesFromRun align payment service state and approval strictly with persisted events', () => {
  // Case 1: Earlier FAILURE_INJECTED superseded by later Payment HTTP 200 & COMPLETED REQUEST_END
  const completedAfterOldKill = buildChronosRun(
    {
      run_id: 'bafd76cd-887a-4296-a0d1-bda4abdc4d1d',
      started_at: '2026-11-10T04:48:27.297710Z',
      completed_at: '2026-11-11T08:35:56.934918Z',
      status: 'COMPLETED',
    },
    [
      makeEvent({
        event_id: 'e1',
        event_type: 'FAILURE_INJECTED',
        timestamp: '2026-11-10T04:48:30.479994Z',
        severity: 'WARNING',
        payload: { action: 'kill', target: 'payment' },
      }),
      makeEvent({
        event_id: 'e2',
        event_type: 'REQUEST_START',
        timestamp: '2026-11-11T08:35:56.901108Z',
        payload: { order_id: 101 },
      }),
      makeEvent({
        event_id: 'e3',
        event_type: 'SERVICE_CALL',
        timestamp: '2026-11-11T08:35:56.915469Z',
        payload: { order_id: 101, destination_service: 'payment' },
      }),
      makeEvent({
        event_id: 'e4',
        event_type: 'RESPONSE',
        timestamp: '2026-11-11T08:35:56.927228Z',
        payload: { order_id: 101, status_code: 200, responding_service: 'payment' },
      }),
      makeEvent({
        event_id: 'e5',
        event_type: 'REQUEST_END',
        timestamp: '2026-11-11T08:35:56.934938Z',
        payload: { order_id: 101, status: 'COMPLETED' },
      }),
    ]
  );

  const okOutcome = deriveCheckoutOutcome(completedAfterOldKill);
  assert.equal(okOutcome.hasConfirmedPaymentSuccess, true);
  assert.equal(okOutcome.paymentRespondedAfterPriorFailure, true);
  assert.equal(okOutcome.latestPaymentEventType, 'RESPONSE');

  const okServices = deriveServicesFromRun(completedAfterOldKill, {
    mode: 'LIVE',
    backendHealth: {
      status: 'ok',
      timestamp: '2026-11-11T08:36:00Z',
      database: 'connected',
      payment: 'healthy',
    },
  });
  const okPayment = okServices.find((s) => s.id === 'payment')!;
  assert.equal(okPayment.status, 'RECOVERED');
  assert.equal(okPayment.error_count, 0);
  assert.equal(okPayment.last_event_type, 'RESPONSE');
  assert.equal(okServices.find((s) => s.id === 'postgres')!.status, 'HEALTHY');

  // Case 2: Failed run with SERVICE_ERROR must never report confirmed approval and keeps payment FAILED
  const failedRun = buildChronosRun(
    {
      run_id: 'ab0f49e9-0044-4e25-b947-f998e904cdba',
      started_at: '2026-11-10T05:32:57.289774Z',
      completed_at: '2026-11-10T05:33:02.217126Z',
      status: 'FAILED',
    },
    [
      makeEvent({
        event_id: 'f1',
        event_type: 'FAILURE_INJECTED',
        timestamp: '2026-11-10T05:32:58.135475Z',
        severity: 'WARNING',
        payload: { action: 'kill', target: 'payment' },
      }),
      makeEvent({
        event_id: 'f2',
        event_type: 'REQUEST_START',
        timestamp: '2026-11-10T05:32:58.168635Z',
        payload: { order_id: 101 },
      }),
      makeEvent({
        event_id: 'f3',
        event_type: 'SERVICE_CALL',
        timestamp: '2026-11-10T05:32:58.182344Z',
        payload: { order_id: 101, destination_service: 'payment' },
      }),
      makeEvent({
        event_id: 'f4',
        event_type: 'SERVICE_ERROR',
        timestamp: '2026-11-10T05:33:02.199914Z',
        severity: 'ERROR',
        payload: { order_id: 101, error_type: 'ConnectionError', destination_service: 'payment' },
      }),
      makeEvent({
        event_id: 'f5',
        event_type: 'REQUEST_END',
        timestamp: '2026-11-10T05:33:02.217157Z',
        severity: 'ERROR',
        payload: { order_id: 101, status: 'FAILED' },
      }),
    ]
  );

  const failOutcome = deriveCheckoutOutcome(failedRun);
  assert.equal(failOutcome.hasConfirmedPaymentSuccess, false);
  assert.equal(failOutcome.hasServiceError, true);

  const failServices = deriveServicesFromRun(failedRun);
  const failPayment = failServices.find((s) => s.id === 'payment')!;
  assert.equal(failPayment.status, 'FAILED');
  assert.equal(failPayment.error_count, 1);
  assert.equal(failPayment.last_event_type, 'SERVICE_ERROR');

  // Case 3: Missing RESPONSE or non-approved payment_status never counts as confirmed approval
  const missingResponseRun = buildChronosRun(
    {
      run_id: '11111111-1111-1111-1111-111111111111',
      started_at: '2026-11-11T08:00:00Z',
      completed_at: '2026-11-11T08:00:01Z',
      status: 'COMPLETED',
    },
    [
      makeEvent({
        event_id: 'm1',
        event_type: 'REQUEST_START',
        timestamp: '2026-11-11T08:00:00.100Z',
      }),
      makeEvent({
        event_id: 'm2',
        event_type: 'REQUEST_END',
        timestamp: '2026-11-11T08:00:00.200Z',
        payload: { status: 'COMPLETED' },
      }),
    ]
  );
  assert.equal(deriveCheckoutOutcome(missingResponseRun).hasConfirmedPaymentSuccess, false);

  const declinedResponseRun = buildChronosRun(
    {
      run_id: '22222222-2222-2222-2222-222222222222',
      started_at: '2026-11-11T08:00:00Z',
      completed_at: '2026-11-11T08:00:01Z',
      status: 'COMPLETED',
    },
    [
      makeEvent({
        event_id: 'd1',
        event_type: 'REQUEST_START',
        timestamp: '2026-11-11T08:00:00.100Z',
      }),
      makeEvent({
        event_id: 'd2',
        event_type: 'RESPONSE',
        timestamp: '2026-11-11T08:00:00.150Z',
        payload: { status_code: 200, payment_status: 'declined', responding_service: 'payment' },
      }),
      makeEvent({
        event_id: 'd3',
        event_type: 'REQUEST_END',
        timestamp: '2026-11-11T08:00:00.200Z',
        payload: { status: 'COMPLETED' },
      }),
    ]
  );
  assert.equal(deriveCheckoutOutcome(declinedResponseRun).hasConfirmedPaymentSuccess, false);
});

test('isAuthorizedOperator rejects missing or empty Cognito groups and preview mode', () => {
  assert.equal(isAuthorizedOperator('LIVE', undefined), false);
  assert.equal(isAuthorizedOperator('LIVE', null), false);
  assert.equal(isAuthorizedOperator('LIVE', []), false);
  assert.equal(isAuthorizedOperator('LIVE', ['readonly-users']), false);
  assert.equal(isAuthorizedOperator('PREVIEW', ['chronos-admins']), false);
  assert.equal(isAuthorizedOperator('LIVE', ['chronos-operators']), true);
  assert.equal(isAuthorizedOperator('LIVE', ['chronos-admins']), true);
});

test('LIVE vs PREVIEW separation, null placeholder removal, and Payment live health signals', () => {
  // Without a live /health probe, null run or Preview mode never fabricates HEALTHY on Postgres/Payment
  const previewServices = deriveServicesFromRun(DEMO_RUN_FAILURE_EXPERIMENT, { mode: 'PREVIEW' });
  assert.equal(previewServices.find((s) => s.id === 'postgres')!.status, 'OBSERVED');
  assert.equal(previewServices.find((s) => s.id === 'postgres')!.inbound_calls, 5);
  assert.equal(previewServices.find((s) => s.id === 'payment')!.status, 'FAILED');

  const noHealthServices = deriveServicesFromRun(null, { mode: 'LIVE', backendHealth: null });
  assert.equal(noHealthServices.find((s) => s.id === 'postgres')!.status, 'OBSERVED');
  assert.equal(noHealthServices.find((s) => s.id === 'postgres')!.inbound_calls, 0);
  assert.equal(noHealthServices.find((s) => s.id === 'payment')!.status, 'OBSERVED');

  // Active IN_PROGRESS run reflects live Payment container kill vs restart recovery probe
  const activeRun = {
    run_id: '33333333-3333-3333-3333-333333333333',
    started_at: '2026-11-11T09:00:00Z',
    completed_at: null,
    status: 'IN_PROGRESS' as const,
    description: 'Active Run',
    is_failure_experiment: false,
    events: [],
  };
  const killedLive = deriveServicesFromRun(activeRun, {
    mode: 'LIVE',
    backendHealth: {
      status: 'ok',
      timestamp: '2026-11-11T09:00:05Z',
      database: 'connected',
      payment: 'unreachable',
    },
  });
  assert.equal(killedLive.find((s) => s.id === 'payment')!.status, 'FAILED');
  assert.equal(killedLive.find((s) => s.id === 'postgres')!.status, 'HEALTHY');

  const recoveredLive = deriveServicesFromRun(activeRun, {
    mode: 'LIVE',
    backendHealth: {
      status: 'ok',
      timestamp: '2026-11-11T09:00:15Z',
      database: 'connected',
      payment: 'healthy',
    },
  });
  assert.equal(recoveredLive.find((s) => s.id === 'payment')!.status, 'HEALTHY');

  // Verify corrected static fixture summaries match actual simulated runs
  assert.equal(DEMO_SERVICES_FAILURE.find((s) => s.id === 'payment')!.status, 'FAILED');
  assert.equal(DEMO_SERVICES_FAILURE.find((s) => s.id === 'orders')!.status, 'DEGRADED');
  assert.equal(
    DEMO_SERVICES_FAILURE.find((s) => s.id === 'postgres')!.inbound_calls,
    DEMO_RUN_FAILURE_EXPERIMENT.events.length
  );
  assert.equal(
    DEMO_SERVICES_SUCCESS.find((s) => s.id === 'postgres')!.inbound_calls,
    DEMO_RUN_SUCCESS.events.length
  );
});

test('async run guards, run-switching locks, and stale banner prevention', () => {
  // No placeholder / null run can ever trigger actions
  assert.equal(
    canTriggerRunActions({
      mode: 'LIVE',
      run: null,
      isLoading: false,
      isExecutingCheckout: false,
      isInjectingFailure: false,
      isCreatingRun: false,
    }),
    false
  );

  // Run switching blocked during active checkout/injection/creation
  assert.equal(
    canSwitchRun({
      isExecutingCheckout: true,
      isInjectingFailure: false,
      isCreatingRun: false,
    }),
    false
  );
  assert.equal(
    canSwitchRun({
      isExecutingCheckout: false,
      isInjectingFailure: true,
      isCreatingRun: false,
    }),
    false
  );
  assert.equal(
    canSwitchRun({
      isExecutingCheckout: false,
      isInjectingFailure: false,
      isCreatingRun: false,
    }),
    true
  );

  // Stale async responses rejected when requestId, mode, or selectedRunId changed
  assert.equal(
    shouldApplyRunResponse({
      requestId: 2,
      activeRequestId: 3,
      requestMode: 'LIVE',
      currentMode: 'LIVE',
      targetRunId: 'run-a',
      selectedRunId: 'run-a',
    }),
    false
  );
  assert.equal(
    shouldApplyRunResponse({
      requestId: 3,
      activeRequestId: 3,
      requestMode: 'LIVE',
      currentMode: 'PREVIEW',
      targetRunId: 'run-a',
      selectedRunId: 'run-a',
    }),
    false
  );
  assert.equal(
    shouldApplyRunResponse({
      requestId: 3,
      activeRequestId: 3,
      requestMode: 'LIVE',
      currentMode: 'LIVE',
      targetRunId: 'run-a',
      selectedRunId: 'run-b',
    }),
    false
  );
  assert.equal(
    shouldApplyRunResponse({
      requestId: 3,
      activeRequestId: 3,
      requestMode: 'LIVE',
      currentMode: 'LIVE',
      targetRunId: 'run-b',
      selectedRunId: 'run-b',
    }),
    true
  );

  // Stale banners never leak across runs or survive errors / unconfirmed telemetry
  const runFailed = {
    run_id: 'run-fail',
    status: 'FAILED' as const,
    events: [
      makeEvent({ event_id: 'e1', run_id: 'run-fail', event_type: 'REQUEST_START' }),
      makeEvent({
        event_id: 'e2',
        run_id: 'run-fail',
        event_type: 'SERVICE_ERROR',
        severity: 'ERROR',
      }),
      makeEvent({
        event_id: 'e3',
        run_id: 'run-fail',
        event_type: 'REQUEST_END',
        severity: 'ERROR',
        payload: { status: 'FAILED' },
      }),
    ],
  };
  const staleOkBanner = {
    runId: 'run-prev',
    kind: 'checkout' as const,
    status: 200,
    message: 'Order 101 checkout completed (approved)',
  };
  assert.equal(getScopedExecutionResult(staleOkBanner, null, runFailed), null);
  assert.equal(
    getScopedExecutionResult({ ...staleOkBanner, runId: 'run-fail' }, null, runFailed),
    null
  );
  assert.equal(
    getScopedExecutionError(
      { runId: 'run-prev', code: 'HTTP_503', message: 'Unavailable' },
      'run-fail'
    ),
    null
  );
});

test('historical run duration vs summary fallback', () => {
  // Loaded events use REQUEST_END - REQUEST_START even when completed_at - started_at spans hours
  assert.equal(
    computeRunDurationMs(
      transformEvents([
        makeEvent({
          event_id: 'h1',
          event_type: 'REQUEST_START',
          timestamp: '2026-11-11T08:00:10.000Z',
        }),
        makeEvent({
          event_id: 'h2',
          event_type: 'REQUEST_END',
          timestamp: '2026-11-11T08:00:10.042Z',
          payload: { status: 'COMPLETED' },
        }),
      ]),
      {
        started_at: '2026-11-11T07:00:00.000Z',
        completed_at: '2026-11-11T08:00:10.042Z',
      }
    ),
    42
  );

  // Unloaded historical summary row falls back to completed_at - started_at when events=[]
  assert.equal(
    computeRunDurationMs([], {
      started_at: '2026-11-11T08:00:00.000Z',
      completed_at: '2026-11-11T08:00:04.120Z',
    }),
    4120
  );
});

test('computeTraceLayout supports 0.75X..2.5X zoom, PRE placement, bounds clamping, and collision staggering', () => {
  const crowdedEvents = transformEvents([
    makeEvent({
      event_id: 't0',
      event_type: 'FAILURE_INJECTED',
      timestamp: '2026-11-10T04:48:30.479Z',
      payload: { target: 'payment' },
    }),
    makeEvent({
      event_id: 't1',
      event_type: 'REQUEST_START',
      timestamp: '2026-11-11T08:35:56.900Z',
    }),
    makeEvent({
      event_id: 't2',
      event_type: 'SERVICE_CALL',
      timestamp: '2026-11-11T08:35:56.905Z',
      payload: { destination_service: 'payment' },
    }),
    makeEvent({
      event_id: 't3',
      event_type: 'RESPONSE',
      timestamp: '2026-11-11T08:35:56.925Z',
      payload: { status_code: 200, responding_service: 'payment' },
    }),
    makeEvent({
      event_id: 't4',
      event_type: 'REQUEST_END',
      timestamp: '2026-11-11T08:35:56.935Z',
      payload: { status: 'COMPLETED' },
    }),
  ]);

  const zoom075 = computeTraceLayout({
    events: crowdedEvents,
    containerWidth: 800,
    zoomLevel: 0.75,
  });
  const zoom100 = computeTraceLayout({
    events: crowdedEvents,
    containerWidth: 800,
    zoomLevel: 1.0,
  });
  const zoom250 = computeTraceLayout({
    events: crowdedEvents,
    containerWidth: 800,
    zoomLevel: 2.5,
  });

  // 0.75X must actually zoom out narrower than 1.0X, and 2.5X must expand wider
  assert.equal(zoom075.trackWidthPx, 600);
  assert.equal(zoom100.trackWidthPx, 800);
  assert.equal(zoom250.trackWidthPx, 2000);
  assert.ok(zoom075.trackWidthPx < zoom100.trackWidthPx);
  assert.ok(zoom250.trackWidthPx > zoom100.trackWidthPx);

  // Pre-exec KILL must appear in dedicated PRE bay left of zeroX, not off-canvas
  const preMarker = zoom100.markers.find((m) => m.event.event_type === 'FAILURE_INJECTED')!;
  assert.ok(preMarker.x > 0 && preMarker.x < zoom100.zeroX);

  // Every marker must remain inside visible canvas bounds
  for (const layout of [zoom075, zoom100, zoom250]) {
    for (const marker of layout.markers) {
      assert.ok(marker.x >= 0 && marker.x <= layout.trackWidthPx - 44);
    }
  }

  // Tightly spaced orders-lane markers (REQUEST_START +5ms SERVICE_CALL) must stagger into distinct rows
  const ordersMarkers = zoom075.markers.filter((m) => m.event.service_id === 'orders');
  assert.equal(ordersMarkers.length, 3);
  assert.notEqual(ordersMarkers[0].staggerRow, ordersMarkers[1].staggerRow);
});

test('sidebar navigation routes EXPERIMENTS directly to MONITOR and disables ARCHIVE/SETTINGS as POST-MVP', () => {
  const byId = new Map(SIDEBAR_NAV_ITEMS.map((item) => [item.id, item]));
  const experiments = byId.get('EXPERIMENTS')!;
  const archive = byId.get('ARCHIVE')!;
  const settings = byId.get('SETTINGS')!;

  assert.equal(experiments.disabled, false);
  assert.equal(experiments.destination, 'MONITOR');
  assert.deepEqual(resolveNavigationSelection(experiments, 'RUNS'), {
    nextDestination: 'MONITOR',
    shouldFocusStaging: true,
  });
  assert.deepEqual(resolveNavigationSelection(experiments, 'MONITOR'), {
    nextDestination: 'MONITOR',
    shouldFocusStaging: true,
  });

  for (const deferred of [archive, settings]) {
    assert.equal(deferred.disabled, true);
    assert.equal(deferred.destination, undefined);
    assert.equal(deferred.badge, 'POST-MVP');
    assert.deepEqual(resolveNavigationSelection(deferred, 'TOPOLOGY'), {
      nextDestination: 'TOPOLOGY',
      shouldFocusStaging: false,
    });
  }
});
