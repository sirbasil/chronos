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

## 4. Key Interactive Capabilities in M1

1. **Multi-Track Event Trace**:
   - Time-ordered lanes for `orders`, `payment`, and `postgres`.
   - Hover over event markers to view live event type, service, and summary tooltip.
   - Click any event marker to pin its complete JSONB payload and diagnostic metadata into the Context Inspector.
   - Interactive time cursor: drag or click across the timeline to scrub time `T+...ms`.
   - Zoom controls (`0.75X` – `2.5X`) and `T=0` reset affordance.

2. **Service Matrix**:
   - Status indicators (`HEALTHY`, `OBSERVED`, `DEGRADED`) and port allocations.
   - Inbound, outbound, and error counters derived from recorded events.
   - Click a service card to illuminate its track and inspect service telemetry in the Inspector.

3. **Digital Readouts & Metrics Cluster**:
   - Segmented digital readout frames with vintage amber/phosphor glows and background ghost digits.
   - Live metrics for run duration, recorded events, observed services, and injected failures.

4. **Collapsible Context Inspector**:
   - Collapsible right drawer (via toggle button, close icon, or `Escape` key).
   - Preserves active selection state across open/close cycles.
   - Contextual views for:
     - Events (payload, offset, severity, trace ID)
     - Services (network ports, container names, traffic summary)
     - Backend status (FastAPI host, persistence state, endpoints)
     - Docker status (Compose project name, socket mount rules, safety policy)
     - Run summary (UUID, start/completion times, status)

5. **Run Context Switching**:
   - Header dropdown allows switching between **Demo Run 1 (Controlled Payment Failure)** and **Demo Run 2 (Normal Checkout Happy Path)**.

6. **Honest Unimplemented Navigation States**:
   - `RUNS`, `TOPOLOGY`, `EXPERIMENTS`, `ARCHIVE`, and `SETTINGS` display honest "NOT IMPLEMENTED IN M1" panels detailing the scheduled milestone roadmap.

---

## 5. M1 Safety & Non-Destructive Boundaries

- All backend code (`backend/`), Docker Compose files (`backend/docker-compose*.yml`), and Python test suites remain completely untouched.
- No network requests are made to kill containers or trigger checkout workflows.
- No credentials or `.env` files are tracked in version control.
