# CHRONOS Web Instrument Console

**Product Direction:** Browser-based web application
**Visual Reference:** 1980 Bertone digital instrumentation (Lamborghini Athon / Volvo Tundra)
**Architecture:** React 18 + TypeScript + Vite + Tailwind CSS

---

## 1. Overview

CHRONOS provides a high-density operational telemetry and failure-injection console for distributed systems. The frontend is built as a pure web application using **React 18 + TypeScript + Vite + Tailwind CSS**.

The interface operates with dual mode capability:
- **LIVE MODE:** Connects to the local FastAPI backend (default: `http://127.0.0.1:8000`), streams real event telemetry, executes active order checkouts, and injects controlled microservice container failures. Protected by Amazon Cognito PKCE authentication.
- **PREVIEW MODE:** Operates offline with realistic, schema-accurate demo datasets (including normal checkout and controlled failure experiment traces) for demonstration and staging without backend connectivity.

---

## 2. Prerequisites & Environment

### Installed & Verified
- **Node.js**: v20.x
- **npm**: 10.x+
- **Offline Typography**: 100% locally bundled via `@fontsource` (zero external CDN or remote font calls)

---

## 3. Quick Start & Development Commands

From the `frontend/` directory:

```bash
# Install dependencies
npm install

# Start the Vite development server (port 5173)
npm run dev

# Type-check and produce production bundle
npm run build

# Preview the production build locally
npm run preview
```

---

## 4. Key Interactive Capabilities

1. **Multi-Track Event Trace & Failure Experiment Workflow**:
   - Time-ordered lanes for `orders`, `payment`, and `postgres` anchored at checkout execution start (`T=0`), with a dedicated `PRE` bay for pre-execution `FAILURE_INJECTED` events.
   - Hover over event markers to view live event type, service, and summary tooltip.
   - Click any event marker to pin its complete JSONB payload and diagnostic metadata into the Context Inspector.
   - Interactive time cursor: drag or click across the timeline to scrub time `T+...ms`.
   - Zoom controls (`0.75X` – `2.5X`) and `RESET T=0` affordance.
   - Create runs (`POST /runs`), trigger RBAC-protected Payment failure injection (`POST /runs/{id}/failure`), and execute checkout (`POST /orders/101/checkout` with `X-Run-ID`).

2. **Service Matrix & Live `/health` Probes**:
   - Status indicators (`HEALTHY`, `RECOVERED`, `DEGRADED`, `FAILED`, `OBSERVED`) and port allocations.
   - Inbound, outbound, and error counters derived chronologically from recorded events and `/health` probes.
   - Click a service card to illuminate its track and inspect service telemetry in the Inspector.

3. **Collapsible Context Inspector & Topology**:
   - Interactive React Flow (`@xyflow/react`) DAG in `TOPOLOGY` view derived from `GET /runs/{id}/topology`.
   - Run catalog in `RUNS` view (`COMPLETED`, `FAILED`, `IN_PROGRESS`) with one-click run loading.
   - Collapsible right drawer (`Escape` or toggle button) inspecting events, services, FastAPI/DB/Payment `/health`, Compose policy, and run metadata.

---

## 5. Security & Operational Boundaries

- Failure injection routes from `orders` to the isolated `failure-controller` sidecar over the internal Docker network (`payment` allowlist only) and requires `chronos-admins` or `chronos-operators` Cognito group membership.
- Browser preview mode (`PREVIEW`) renders clearly labeled simulated fixtures offline without mutating backend state.
- Local development uses `backend/docker-compose.yml` (Payment stops after `SIGKILL` until manually restarted via `docker compose start payment`).
- No credentials or `.env` files are tracked in version control.
