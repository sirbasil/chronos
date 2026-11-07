# CHRONOS Desktop Instrument Shell (M1)

**Product Direction:** Standalone desktop application
**Visual Reference:** 1980 Bertone digital instrumentation (Lamborghini Athon / Volvo Tundra)
**Milestone:** M1 — Desktop Instrument Shell (Preview Mode)

---

## 1. Overview

Milestone 1 establishes the desktop instrument shell, visual language, and interaction model for CHRONOS. The application is built using **React 18 + TypeScript + Vite + Tailwind CSS** housed within a **Tauri 2** desktop configuration.

In M1, the interface operates in **PREVIEW MODE** using realistic, schema-accurate demo datasets (including normal checkout and controlled failure experiment traces). No real Docker calls or destructive failure injections are executed in this milestone.

---

## 2. Prerequisites & Environment

### Installed & Verified
- **Node.js**: v20.20.2
- **npm**: 10.8.2
- **WebView2 Runtime**: Installed (156.0.4314.58)
- **Offline Typography**: 100% locally bundled via `@fontsource` (zero external CDN or remote font calls)
- **Content Security Policy (CSP)**: Strict policy enforced in `tauri.conf.json` restricting execution to `'self'` and local backend

### Required for Native Windows Compilation (`npm run tauri dev` / `tauri build`)
- **Rust Toolchain**: `rustup` with `stable-x86_64-pc-windows-msvc` (`cargo`, `rustc`)
- **C++ Build Tools**: Microsoft Visual Studio C++ Build Tools (MSVC v143+ and Windows 10/11 SDK)

> **Note on Tooling:**
> When the Rust and MSVC C++ toolchains are not yet installed on the host machine, the frontend can be built, verified, and run with full operational fidelity using the Vite development server (`npm run dev`) or production preview server (`npm run preview`).

---

## 3. Quick Start & Development Commands

From the `frontend/` directory:

```bash
# Install dependencies
npm install

# Type-check and produce production bundle
npm run build

# Start the Vite development server (port 1420)
npm run dev

# Preview the production build locally
npm run preview -- --port 1420

# Launch native Tauri desktop shell (requires Rust & MSVC)
npm run tauri dev
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
