# CHRONOS — Container Vulnerability Audit & Remediation Report

**Date:** 2026-11-12  
**Git Base Commit:** `3cd42d143fa864ec7824340d898026642f1f00b4` (`main`)  
**AWS Account / Region:** `519725697841` / `ap-south-1`  
**Registry:** `519725697841.dkr.ecr.ap-south-1.amazonaws.com`  
**Baseline Tag:** `mvp-2026-11-12-3cd42d1-scanfix1`  
**Remediated Tag:** `mvp-2026-11-12-3cd42d1-securityfix1`  

---

## 1. Executive Summary

- **Overall Outcome:** Remediated all **3 actionable CVEs** (`2 HIGH`, `1 MEDIUM` in `zlib1g`) reported by AWS ECR Basic Scanning across all three CHRONOS service images (`chronos-orders`, `chronos-payment`, and `chronos-failure-controller`), hardened container runtime configuration and Python dependency hygiene, verified full local backend test and runtime E2E functionality, and published new immutable `linux/amd64` single-image OCI manifests under tag `mvp-2026-11-12-3cd42d1-securityfix1`.
  - **OS Security Patch:** `zlib1g:amd64` upgraded cleanly from `1:1.3.dfsg+really1.3.1-1+b1` to `1:1.3.dfsg+really1.3.1-1+deb13u1` from Debian `trixie-security/main`, eliminating `CVE-2026-76844` (HIGH), `CVE-2026-85091` (HIGH), and `CVE-2026-27171` (MEDIUM).
  - **Container Hardening & Attack-Surface Reduction:**
    - `chronos-orders` and `chronos-payment` now run as dedicated non-root user `chronos` (`uid=1001`, `gid=1001`), matching `chronos-failure-controller`.
    - Added `PYTHONDONTWRITEBYTECODE=1` and `PYTHONUNBUFFERED=1` across all three Dockerfiles.
    - Isolated Payment's dependencies via `backend/requirements.payment.txt` (`fastapi==0.143.0`, `uvicorn==0.54.0`, `pydantic==2.14.0`), reducing Payment from **25 to 15** Python packages and removing unneeded `psycopg`, `psycopg-binary`, `PyJWT`, `cryptography`, `cffi`, `pycparser`, `requests`, `urllib3`, `charset-normalizer`, and `certifi` (reducing Payment ECR compressed size from `65,722,138` B to `49,389,585` B).
    - Pinned `pyjwt[crypto]==2.15.1` in `backend/requirements.txt` (eliminating `>=2.9.0` version drift while preserving the existing tested version).
  - **Zero Actionable Python Advisories:** Checked all 26 unique installed PyPI packages across the images against OSV (`api.osv.dev/v1/querybatch`); **0 advisories** were reported.
- **Deployment Readiness:** **READY WITH DOCUMENTED RESIDUAL RISKS**.
- **Important Remaining Risks:** **16 `glibc` CVEs** (`2 HIGH`, `10 MEDIUM`, `4 LOW`) remain in `libc6` (`2.41-12+deb13u4`). None have a supported Debian 13 (`trixie`) security fix (`14` are marked `nodsa: "Minor issue"` / deferred to the next Debian point release; `2` remain `open` even in Debian `sid`/`unstable` without an upstream package fix). Static code inspection and package audits confirm none of the affected `glibc` code paths (`strfmon`, deprecated DNS debug functions `ns_printrr*`/`fp_nquery`, wide `scanf`, `fopen(..., ",ccs=...")`, `tsearch`/`tdelete`, `wordexp`, `SHIFT_JISX0213`/`EUC_JISX0213` `iconv`, `nscd`, `setuid` `$ORIGIN` `DT_RPATH`, or Power8 `strncasecmp`) are invoked or exposed by CHRONOS.
- **Modified / Added Workspace Files (Uncommitted):**
  - Modified: `backend/Dockerfile.orders`, `backend/Dockerfile.payment`, `backend/failure_controller/Dockerfile`, `backend/requirements.txt`
  - Added: `backend/requirements.payment.txt`, `CHRONOS_SECURITY_REMEDIATION_REPORT.md`
  - Frontend code, production Compose (`backend/deploy/compose.prod.yml`), Git history, and all prior ECR tags (`mvp-2026-11-12-3cd42d1-scanfix1`, `mvp-2026-11-12-3cd42d1`) remain completely untouched.

---

## 2. Build Results

### Build Commands (Executed from Repository Root)

```bash
docker buildx build \
  --platform linux/amd64 \
  --provenance=false \
  --sbom=false \
  --no-cache \
  --load \
  -f backend/Dockerfile.orders \
  -t 519725697841.dkr.ecr.ap-south-1.amazonaws.com/chronos-orders:mvp-2026-11-12-3cd42d1-securityfix1 \
  backend

docker buildx build \
  --platform linux/amd64 \
  --provenance=false \
  --sbom=false \
  --no-cache \
  --load \
  -f backend/Dockerfile.payment \
  -t 519725697841.dkr.ecr.ap-south-1.amazonaws.com/chronos-payment:mvp-2026-11-12-3cd42d1-securityfix1 \
  backend

docker buildx build \
  --platform linux/amd64 \
  --provenance=false \
  --sbom=false \
  --no-cache \
  --load \
  -f backend/failure_controller/Dockerfile \
  -t 519725697841.dkr.ecr.ap-south-1.amazonaws.com/chronos-failure-controller:mvp-2026-11-12-3cd42d1-securityfix1 \
  backend/failure_controller
```

### Architecture, Tags, Digests & Manifest Format

| Repository | Tag | Architecture / OS | ECR Digest (`sha256`) | ECR Compressed Size (Bytes) | Manifest Media Type | Artifact Media Type |
|---|---|---|---|---:|---|---|
| `chronos-orders` | `mvp-2026-11-12-3cd42d1-scanfix1` (Original) | `linux/amd64` | `sha256:723f6d6fa64fd90858de08e103619bf4495a1f070692bc79ba222eb959f554f7` | 65,738,436 | `application/vnd.oci.image.manifest.v1+json` | `application/vnd.oci.image.config.v1+json` |
| `chronos-orders` | `mvp-2026-11-12-3cd42d1-securityfix1` (New) | `linux/amd64` | `sha256:94f39aaef93c718227f5ccc6b030af99878a7dd50dd8c75ba4e774b826ae0b42` | 62,173,975 | `application/vnd.oci.image.manifest.v1+json` | `application/vnd.oci.image.config.v1+json` |
| `chronos-payment` | `mvp-2026-11-12-3cd42d1-scanfix1` (Original) | `linux/amd64` | `sha256:bf911ca21bc7777902815de2671849c75fa12128434af40173c68508f4935ae3` | 65,722,138 | `application/vnd.oci.image.manifest.v1+json` | `application/vnd.oci.image.config.v1+json` |
| `chronos-payment` | `mvp-2026-11-12-3cd42d1-securityfix1` (New) | `linux/amd64` | `sha256:9707ea97008003223149183675a64c9497d909f00a5d437c957dcf6b8f9e52c8` | 49,389,585 | `application/vnd.oci.image.manifest.v1+json` | `application/vnd.oci.image.config.v1+json` |
| `chronos-failure-controller` | `mvp-2026-11-12-3cd42d1-scanfix1` (Original) | `linux/amd64` | `sha256:60156f41ef9cbd8872b35bdc4ebae134a19a2dfd568cde439a7eff5151e28cb0` | 54,305,524 | `application/vnd.oci.image.manifest.v1+json` | `application/vnd.oci.image.config.v1+json` |
| `chronos-failure-controller` | `mvp-2026-11-12-3cd42d1-securityfix1` (New) | `linux/amd64` | `sha256:fabd181723f6bd6878df675f2db3ac25f3faaf55fa89bdd365cf48ffb94a87b4` | 50,738,545 | `application/vnd.oci.image.manifest.v1+json` | `application/vnd.oci.image.config.v1+json` |

All three newly pushed images are single-image OCI manifests (`application/vnd.oci.image.manifest.v1+json`) without OCI indexes or attestation manifests, and completed AWS ECR Basic Scanning with status `COMPLETE`.

---

## 3. Package Verification

Direct inspection inside running containers launched from each `securityfix1` image verified:

### OS Release & Runtime Identity

- **OS Release (`/etc/os-release` across all 3 images):** `Debian GNU/Linux 13 (trixie)`, `VERSION_ID="13"`, `DEBIAN_VERSION_FULL=13.7`
- **Python Runtime (all 3 images):** `Python 3.14.10`
- **Runtime User (`id` across all 3 images):** `uid=1001(chronos) gid=1001(chronos) groups=1001(chronos)` (`orders` and `payment` upgraded from `root` to `chronos`)
- **Total OS (`dpkg`) Package Count:** `87` before -> `87` after in all 3 images (**0 added**, **0 removed**, **1 changed**).

### Key OS Package Comparison (`dpkg-query`)

| Package | Original (`scanfix1`) | New (`securityfix1`) | Change / Notes |
|---|---|---|---|
| `zlib1g` (`amd64`) | `1:1.3.dfsg+really1.3.1-1+b1` | `1:1.3.dfsg+really1.3.1-1+deb13u1` | Upgraded from `trixie-security/main`; resolves 3 `zlib` CVEs |
| `libc6` (`amd64`) | `2.41-12+deb13u4` | `2.41-12+deb13u4` | Unchanged; latest available in Debian `trixie` |
| `libssl3t64` (`amd64`) | `3.5.7-1~deb13u3` | `3.5.7-1~deb13u3` | Already at latest `trixie-security` version |
| `openssl` (`amd64`) | `3.5.7-1~deb13u3` | `3.5.7-1~deb13u3` | Already at latest `trixie-security` version |
| `ca-certificates` | `20250419+deb13u1` | `20250419+deb13u1` | Unchanged; latest in `trixie` |
| `tzdata` | `2026f-0+deb13u1` | `2026f-0+deb13u1` | Unchanged; latest in `trixie` |

### Python Dependency Comparison (`pip list`)

- **`chronos-orders`** (`25` packages -> `25` packages):
  - `fastapi==0.143.0`, `uvicorn==0.54.0`, `requests==2.34.2`, `pydantic==2.14.0`, `psycopg==3.3.7`, `psycopg-binary==3.3.7`, `PyJWT==2.15.1` (now exact-pinned in `requirements.txt`), `cryptography==50.0.2`, `starlette==1.10.0`, `anyio==4.16.0`, `urllib3==2.8.0`, `certifi==2026.10.23`, `charset-normalizer==3.5.2`, `idna==3.20`, `click==8.5.1`, `h11==0.16.0`, `cffi==2.1.1`, `pycparser==3.12`, `annotated-types==0.8.0`, `pydantic_core==2.50.0`, `opentelemetry-api==1.45.2`, `typing_extensions==4.16.0`, `typing-inspection==0.4.5`, `pip==26.2.2`.
  - Only change: transitive `annotated-doc` `0.0.5` -> `0.0.6`.
- **`chronos-payment`** (`25` packages -> `15` packages):
  - Retained minimal runtime packages only: `fastapi==0.143.0`, `uvicorn==0.54.0`, `pydantic==2.14.0`, `starlette==1.10.0`, `anyio==4.16.0`, `click==8.5.1`, `h11==0.16.0`, `idna==3.20`, `annotated-doc==0.0.6`, `annotated-types==0.8.0`, `pydantic_core==2.50.0`, `opentelemetry-api==1.45.2`, `typing_extensions==4.16.0`, `typing-inspection==0.4.5`, `pip==26.2.2`.
  - Removed `10` unneeded packages (`psycopg`, `psycopg-binary`, `PyJWT`, `cryptography`, `cffi`, `pycparser`, `requests`, `urllib3`, `charset-normalizer`, `certifi`).
- **`chronos-failure-controller`** (`20` packages -> `20` packages):
  - `docker==7.2.0`, `fastapi==0.143.0`, `uvicorn==0.54.0`, `pydantic==2.14.0`, `requests==2.34.2`, `urllib3==2.8.0`, `certifi==2026.10.23`, `charset-normalizer==3.5.2`, `idna==3.20`, `starlette==1.10.0`, `anyio==4.16.0`, `click==8.5.1`, `h11==0.16.0`, `annotated-types==0.8.0`, `pydantic_core==2.50.0`, `opentelemetry-api==1.45.2`, `typing_extensions==4.16.0`, `typing-inspection==0.4.5`, `pip==26.2.2`, plus transitive `annotated-doc` `0.0.5` -> `0.0.6`.

---

## 4. Test Results

### Automated Test Suite & Compose Validation

| Check | Exact Command | Result |
|---|---|---|
| Backend unit & integration tests (`chronos_test`) | `cd /home/washed/chronos/backend && .venv/bin/pytest -v` | **132 passed**, 0 failed, 1 warning (Starlette `httpx2` deprecation warning) in `12.78s` |
| Local Compose config validation | `cd /home/washed/chronos/backend && docker compose -f docker-compose.yml --env-file .env config -q` | Exited `0` (`docker-compose.yml valid`) |
| Prod Compose syntax validation | `cd /home/washed/chronos/backend && docker compose -f deploy/compose.prod.yml --env-file .env config -q` | Exited `0` (`deploy/compose.prod.yml valid`) |
| Frontend tests / TypeScript / build | — | Not run; no files under `frontend/` were modified (`git status --short` confirmed backend-only edits) |

### Local Multi-Container Runtime & E2E Verification

Rebuilt and started the local Compose stack via `docker compose -f docker-compose.yml --env-file .env up -d --build` (`orders`, `payment`, `failure-controller`, `postgres:16-alpine`):

- **Container User & Patch Check Inside Live Containers:** All three service containers reported `uid=1001(chronos) gid=1001(chronos) groups=1001(chronos)` and `zlib1g:amd64 1:1.3.dfsg+really1.3.1-1+deb13u1`.
- **PostgreSQL Connectivity:** `pg_isready -U chronos -d chronos` returned `/var/run/postgresql:5432 - accepting connections`.
- **Orders Health & Root:**
  - `GET http://127.0.0.1:8000/` -> `{"message":"Hello from CHRONOS"}`
  - `GET http://127.0.0.1:8000/health` -> `{"status":"ok","timestamp":"2026-11-12T10:30:18.732607Z","database":"connected","payment":"healthy"}`
- **Fail-Closed Auth Check:** Unauthenticated `GET http://127.0.0.1:8000/runs` returned HTTP `401`.
- **Payment Internal Health:** `http://payment:8001/health` -> `{"status":"ok","service":"payment"}`.
- **Failure Controller Internal Health:** `http://failure-controller:8002/health` -> `{"status":"ok","service":"failure-controller"}`.
- **E2E Checkout, Run Lifecycle, Failure Injection, Recovery & Telemetry Persistence (executed against `chronos_test` database using real running `payment`, `failure-controller`, and `postgres` containers, then cleaned up):**
  1. **Run 1 (Normal Checkout):** `POST /runs` (`201`) -> `POST /orders/101/checkout` (`200`, `{'order_id': 101, 'payment_status': 'approved'}`) -> Run status transitioned to `COMPLETED`. Persisted events: `['REQUEST_START', 'SERVICE_CALL', 'RESPONSE', 'REQUEST_END']`; topology edge: `[{'source': 'orders', 'target': 'payment', 'event_type': 'SERVICE_CALL'}]`.
  2. **Run 2 (Controlled Failure Injection):** `POST /runs` (`201`) -> `POST /runs/{run_id}/failure` (`{"target": "payment"}`) -> `200`, `{'status': 'injected', 'target': 'payment', 'action': 'kill'}` via `failure-controller` `POST /internal/failures/payment/kill` over `/var/run/docker.sock`. Verified `01-http-basics-payment-1` state transitioned to `running=false exit=137` (`SIGKILL`) and live `GET /health` reported `{"status":"ok","database":"connected","payment":"unreachable"}`. Subsequent `POST /orders/101/checkout` failed cleanly with HTTP `503` (`Payment service Unavailable`), Run 2 status transitioned to `FAILED`, and persisted events matched `['FAILURE_INJECTED', 'REQUEST_START', 'SERVICE_CALL', 'SERVICE_ERROR', 'REQUEST_END']`.
  3. **Payment Recovery & Run 3:** `docker compose start payment` restored `01-http-basics-payment-1` to `(healthy)` -> live `GET /health` returned `payment: "healthy"` -> Run 3 `POST /runs` + `POST /orders/101/checkout` returned `200` (`{'order_id': 101, 'payment_status': 'approved'}`) and transitioned to `COMPLETED`.
- **Application Logs & Regressions:** Inspected `docker compose logs --tail=30` across `orders`, `payment`, and `failure-controller`; clean startup, non-root execution, and expected HTTP handling with **0 regressions or unexpected errors**.

---

## 5. CVE Remediation Matrix

All **19 CVEs** from the baseline scan were identical across `chronos-orders`, `chronos-payment`, and `chronos-failure-controller`.

| CVE | Package | Original Version | New Version | Severity | Status | Evidence |
|---|---|---|---|---|---|---|
| `CVE-2026-76844` | `zlib` (`zlib1g`) | `1:1.3.dfsg+really1.3.1-1+b1` | `1:1.3.dfsg+really1.3.1-1+deb13u1` | HIGH | **FIXED** | `trixie-security` update installed (Debian bug #1153063 resolved at `1:1.3.dfsg+really1.3.1-1+deb13u1`); gone from ECR rescan on all 3 images |
| `CVE-2026-85091` | `zlib` (`zlib1g`) | `1:1.3.dfsg+really1.3.1-1+b1` | `1:1.3.dfsg+really1.3.1-1+deb13u1` | HIGH | **FIXED** | `trixie-security` update installed (Debian bug #1146895 resolved at `1:1.3.dfsg+really1.3.1-1+deb13u1`; NVD upstream text also notes `1.3.1.2`–`1.3.2`); gone from ECR rescan on all 3 images |
| `CVE-2026-27171` | `zlib` (`zlib1g`) | `1:1.3.dfsg+really1.3.1-1+b1` | `1:1.3.dfsg+really1.3.1-1+deb13u1` | MEDIUM | **FIXED** | `trixie-security` update installed (Debian bug #1128336 resolved at `1:1.3.dfsg+really1.3.1-1+deb13u1`); gone from ECR rescan on all 3 images |
| `CVE-2026-19499` | `glibc` (`libc6`) | `2.41-12+deb13u4` | `2.41-12+deb13u4` | HIGH | **NO FIX AVAILABLE** | Open in Debian `trixie` (`nodsa: "Minor issue"`, `next_point_update: True`, resolved in `sid` `2.43-5`, bug #1145891); `strfmon`/`strfmon_l` unreachable in CHRONOS |
| `CVE-2026-5435` | `glibc` (`libc6`) | `2.41-12+deb13u4` | `2.41-12+deb13u4` | HIGH | **NO FIX AVAILABLE** | Open in Debian `trixie` (`nodsa: "Minor issue"`, `next_point_update: True`, resolved in `sid` `2.43-3`, bug #1135230); deprecated `ns_printrrf`/`ns_printrr`/`fp_nquery` unreachable |
| `CVE-2026-115819` | `glibc` (`libc6`) | `2.41-12+deb13u4` | `2.41-12+deb13u4` | MEDIUM | **NO FIX AVAILABLE** | Open in Debian `trixie` AND `sid` (no fixed Debian version yet); wide `scanf` (`swscanf` et al.) `%s`/`%[` not called by CHRONOS |
| `CVE-2026-18374` | `glibc` (`libc6`) | `2.41-12+deb13u4` | `2.41-12+deb13u4` | MEDIUM | **NO FIX AVAILABLE** | Open in Debian `trixie` (`nodsa: "Minor issue"`, `next_point_update: True`, `sid` `2.43-5`, bug #1146721); `fopen(..., ",ccs=...")` unreachable |
| `CVE-2026-19542` | `glibc` (`libc6`) | `2.41-12+deb13u4` | `2.41-12+deb13u4` | MEDIUM | **NO FIX AVAILABLE** | Open in Debian `trixie` (`nodsa: "Minor issue"`, `next_point_update: True`, `sid` `2.43-4`); `tsearch`/`tdelete` tree API unused |
| `CVE-2026-6238` | `glibc` (`libc6`) | `2.41-12+deb13u4` | `2.41-12+deb13u4` | MEDIUM | **NO FIX AVAILABLE** | Open in Debian `trixie` (`nodsa: "Minor issue"`, `next_point_update: True`, `sid` `2.43-3`, bug #1135231); debug-only `ns_printrr*`/`fp_nquery` unused |
| `CVE-2026-6791` | `glibc` (`libc6`) | `2.41-12+deb13u4` | `2.41-12+deb13u4` | MEDIUM | **NO FIX AVAILABLE** | Open in Debian `trixie` (`nodsa: "Minor issue"`, `next_point_update: True`, `sid` `2.43-3`); `wordexp` `parse_tilde` unused |
| `CVE-2026-77117` | `glibc` (`libc6`) | `2.41-12+deb13u4` | `2.41-12+deb13u4` | MEDIUM | **NO FIX AVAILABLE** | Open in Debian `trixie` (`nodsa: "Minor issue"`, `next_point_update: True`, `sid` `2.43-5`, bug #1145880); `SHIFT_JISX0213` `iconv` conversion unused |
| `CVE-2026-80489` | `glibc` (`libc6`) | `2.41-12+deb13u4` | `2.41-12+deb13u4` | MEDIUM | **NO FIX AVAILABLE** | Open in Debian `trixie` (`nodsa: "Minor issue"`, `next_point_update: True`, `sid` `2.43-5`, bug #1145987); `EUC_JISX0213` `iconv` conversion unused |
| `CVE-2026-8674` | `glibc` (`libc6`) | `2.41-12+deb13u4` | `2.41-12+deb13u4` | MEDIUM | **NO FIX AVAILABLE** | Open in Debian `trixie` (`nodsa: "Minor issue"`, `next_point_update: True`, `sid` `2.43-6`, bug #1148168); `/etc/resolv.conf` & `LOCALDOMAIN` controlled by Docker/AWS VPC |
| `CVE-2026-86805` | `glibc` (`libc6`) | `2.41-12+deb13u4` | `2.41-12+deb13u4` | MEDIUM | **NO FIX AVAILABLE** | Open in Debian `trixie` (`nodsa: "Minor issue"`, `next_point_update: True`, `sid` `2.43-7`, bug #1148727); requires local shell + setuid binary + `fs.protected_hardlinks=0` |
| `CVE-2026-89092` | `glibc` (`libc6`) | `2.41-12+deb13u4` | `2.41-12+deb13u4` | MEDIUM | **NOT AFFECTED** | Open in Debian `trixie` (`nodsa: "Minor issue"`, `sid` `2.43-7`, bug #1147395), but targets `nscd` daemon; `nscd` is not installed (`dpkg-query`) or running |
| `CVE-2026-100290` | `glibc` (`libc6`) | `2.41-12+deb13u4` | `2.41-12+deb13u4` | LOW | **NO FIX AVAILABLE** | Open in Debian `trixie` AND `sid` (no fixed version); targets C `regcomp`/`regexec` under allocation failure (Python uses `sre`) |
| `CVE-2026-6368` | `glibc` (`libc6`) | `2.41-12+deb13u4` | `2.41-12+deb13u4` | LOW | **NO FIX AVAILABLE** | Open in Debian `trixie` (`nodsa: "Minor issue"`, `next_point_update: True`, `sid` `2.43-4`, bug #1144252); `wordexp(WRDE_APPEND)` unused |
| `CVE-2026-95818` | `glibc` (`libc6`) | `2.41-12+deb13u4` | `2.41-12+deb13u4` | LOW | **NO FIX AVAILABLE** | Open in Debian `trixie` (`nodsa: "Minor issue"`, `next_point_update: True`, `sid` `2.43-7`, bug #1148728); requires local attacker + setuid/setgid `DT_RPATH` `$ORIGIN` |
| `CVE-2026-97399` | `glibc` (`libc6`) | `2.41-12+deb13u4` | `2.41-12+deb13u4` | LOW | **NOT AFFECTED** | Open in Debian `trixie` (`nodsa: "Minor issue"`, `sid` `2.43-7`, bug #1149647), but affects Power8 (`ppc64le`) `strncasecmp` only; all images are `linux/amd64` |

**Newly introduced CVEs across all 3 rescanned images:** `0`.

---

## 6. ECR Scan Comparison

| Repository | Original Critical | Original High | Original Medium | Original Low | New Critical | New High | New Medium | New Low |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `chronos-orders` | 0 | 4 | 11 | 4 | 0 | 2 | 10 | 4 |
| `chronos-payment` | 0 | 4 | 11 | 4 | 0 | 2 | 10 | 4 |
| `chronos-failure-controller` | 0 | 4 | 11 | 4 | 0 | 2 | 10 | 4 |

---

## 7. Remaining Vulnerabilities

All **16 remaining findings** belong strictly to `glibc` (`libc6` `2.41-12+deb13u4`) in Debian 13 (`trixie`). Debian has not released a `trixie-security` update for `glibc` (nor should `glibc` be forced from Debian `unstable`/`sid`, which breaks ABI consistency and stability).

1. **`CVE-2026-19499` (HIGH, CVSS 7.7)** — *Why it remains:* Open in Debian `trixie` (`nodsa: "Minor issue"`, `next_point_update: True`, fixed in `sid` `2.43-5`). *Reachability & Impact:* Out-of-bounds write in `strfmon`/`strfmon_l` with right-justified width padding; CHRONOS is pure Python and never calls `strfmon` (`grep` confirmed 0 matches). *Exploitability:* Not exploitable in CHRONOS. *Recommended action:* Rebuild images when Debian 13 point release ships updated `glibc`.
2. **`CVE-2026-5435` (HIGH, CVSS 7.3)** — *Why it remains:* Open in Debian `trixie` (`nodsa: "Minor issue"`, `next_point_update: True`, fixed in `sid` `2.43-3`). *Reachability & Impact:* Buffer overflow in deprecated DNS debug functions `ns_printrrf`, `ns_printrr`, and `fp_nquery` for TSIG records; per NVD and `glibc`, these debug functions are not part of standard DNS resolution and are not called by CHRONOS. *Exploitability:* Not reachable. *Recommended action:* Absorb via future Debian 13 point-release base rebuild.
3. **`CVE-2026-115819` (MEDIUM, CVSS 4.8)** — *Why it remains:* Open in Debian `trixie`, `forky`, and `sid` (`fixed_version: None`). *Reachability & Impact:* Extra NUL write in wide `scanf` (`swscanf`/`fwscanf`/`wscanf`) `%s`/`%[` without `l` modifier; CHRONOS never calls C wide `scanf`. *Exploitability:* Not reachable. *Recommended action:* Monitor Debian tracker for future upstream/distro fix.
4. **`CVE-2026-18374` (MEDIUM, CVSS 4.9)** — *Why it remains:* Open in `trixie` (`nodsa: "Minor issue"`, `next_point_update: True`, `sid` `2.43-5`). *Reachability & Impact:* Requires attacker-controlled mode string passed to C `fopen(..., ",ccs=...")`. Python `open()` does not accept user-controlled glibc `ccs=` mode strings in CHRONOS. *Exploitability:* Not reachable. *Recommended action:* Absorb on next Debian point release.
5. **`CVE-2026-19542` (MEDIUM, CVSS 5.6)** — *Why it remains:* Open in `trixie` (`nodsa: "Minor issue"`, `next_point_update: True`, `sid` `2.43-4`). *Reachability & Impact:* Stack write in `tdelete` on a POSIX `tsearch` tree at depth >= 40; CHRONOS never uses `tsearch`/`tdelete`. *Exploitability:* Not reachable. *Recommended action:* Absorb on next Debian point release.
6. **`CVE-2026-6238` (MEDIUM, CVSS 6.5)** — *Why it remains:* Open in `trixie` (`nodsa: "Minor issue"`, `next_point_update: True`, `sid` `2.43-3`). *Reachability & Impact:* Deprecated debug-only `ns_printrrf`/`ns_printrr`/`fp_nquery` RDATA length check; outside resolver path and unused in CHRONOS. *Exploitability:* Not reachable. *Recommended action:* Absorb on next Debian point release.
7. **`CVE-2026-6791` (MEDIUM)** — *Why it remains:* Open in `trixie` (`nodsa: "Minor issue"`, `next_point_update: True`, `sid` `2.43-3`). *Reachability & Impact:* Stack clash via untrusted `~user` input to C `wordexp()`. CHRONOS never calls `wordexp()`. *Exploitability:* Not reachable. *Recommended action:* Absorb on next Debian point release.
8. **`CVE-2026-77117` (MEDIUM, CVSS 5.9)** — *Why it remains:* Open in `trixie` (`nodsa: "Minor issue"`, `next_point_update: True`, `sid` `2.43-5`). *Reachability & Impact:* Infinite loop converting crafted `SHIFT_JISX0213` via `iconv`; CHRONOS processes UTF-8 JSON/HTTP via Python codecs and never converts `SHIFT_JISX0213` via glibc `iconv`. *Exploitability:* Not reachable. *Recommended action:* Absorb on next Debian point release.
9. **`CVE-2026-80489` (MEDIUM, CVSS 5.9)** — *Why it remains:* Open in `trixie` (`nodsa: "Minor issue"`, `next_point_update: True`, `sid` `2.43-5`). *Reachability & Impact:* Infinite loop converting crafted `EUC_JISX0213` via `iconv`; same as above — unused in CHRONOS. *Exploitability:* Not reachable. *Recommended action:* Absorb on next Debian point release.
10. **`CVE-2026-8674` (MEDIUM, CVSS 5.3)** — *Why it remains:* Open in `trixie` (`nodsa: "Minor issue"`, `next_point_update: True`, `sid` `2.43-6`). *Reachability & Impact:* Resolver assertion failure if `/etc/resolv.conf` search domain or `LOCALDOMAIN` exceeds ~200 characters. Container DNS config is provisioned strictly by Docker Compose and AWS VPC (trusted internal network, no attacker-supplied DHCP/VPN search domains). *Exploitability:* Mitigated by infrastructure boundary. *Recommended action:* Absorb on next Debian point release.
11. **`CVE-2026-86805` (MEDIUM, CVSS 6.3)** — *Why it remains:* Open in `trixie` (`nodsa: "Minor issue"`, `next_point_update: True`, `sid` `2.43-7`). *Reachability & Impact:* Local dynamic-loader TOCTOU on `setuid`/`setgid` binaries using `$ORIGIN/..` `DT_RPATH` when `fs.protected_hardlinks=0`. Containers have no attacker shell access, run as non-root `chronos`, drop capabilities on `failure-controller`, and run on Linux with `fs.protected_hardlinks=1` default. *Exploitability:* Not applicable in containerized deployment. *Recommended action:* Absorb on next Debian point release.
12. **`CVE-2026-89092` (MEDIUM, CVSS 4.2)** — *Why it remains:* Open in `trixie` (`nodsa: "Minor issue"`, `next_point_update: True`, `sid` `2.43-7`). *Reachability & Impact:* Affects the `nscd` name-service caching daemon; `nscd` is absent from all three images (`dpkg-query` confirmed 0 matching packages). *Exploitability:* Not affected. *Recommended action:* No action required; monitor next Debian point release.
13. **`CVE-2026-100290` (LOW, CVSS 3.7)** — *Why it remains:* Open in Debian `trixie`, `forky`, and `sid` (`fixed_version: None`). *Reachability & Impact:* Double-free on `malloc` failure inside glibc `regcomp`/`regexec`. Python uses its own `sre` regex engine, not glibc `regcomp`/`regexec`. *Exploitability:* Not reachable. *Recommended action:* Monitor Debian tracker for future upstream/distro fix.
14. **`CVE-2026-6368` (LOW)** — *Why it remains:* Open in `trixie` (`nodsa: "Minor issue"`, `next_point_update: True`, `sid` `2.43-4`). *Reachability & Impact:* Use-after-free in `wordexp` with `WRDE_APPEND` + `wordfree`. CHRONOS never calls `wordexp()`. *Exploitability:* Not reachable. *Recommended action:* Absorb on next Debian point release.
15. **`CVE-2026-95818` (LOW, CVSS 3.6)** — *Why it remains:* Open in `trixie` (`nodsa: "Minor issue"`, `next_point_update: True`, `sid` `2.43-7`). *Reachability & Impact:* Local stack overflow in `ld.so` for `setuid`/`setgid` binaries whose `DT_RPATH` starts with `$ORIGIN`. Requires local unprivileged shell + vulnerable setuid binary. *Exploitability:* Not applicable. *Recommended action:* Absorb on next Debian point release.
16. **`CVE-2026-97399` (LOW, CVSS 3.7)** — *Why it remains:* Open in `trixie` (`nodsa: "Minor issue"`, `next_point_update: True`, `sid` `2.43-7`). *Reachability & Impact:* Over-read in Power8-optimized `strncasecmp`; affects Power8 (`ppc64le`) only, whereas all CHRONOS images target `linux/amd64`. *Exploitability:* Not affected (`amd64`). *Recommended action:* No action required.

---

## 8. Final Deployment Verdict

**Verdict:** **`READY WITH DOCUMENTED RESIDUAL RISKS`**

**Reasoning:**
1. Every actionable vulnerability with an official Debian 13 (`trixie-security`) patch—all 3 `zlib` CVEs (`CVE-2026-76844`, `CVE-2026-85091`, `CVE-2026-27171`)—has been remediated to `1:1.3.dfsg+really1.3.1-1+deb13u1`, verified inside all three containers, and confirmed cleared in fresh AWS ECR Basic Scans (`HIGH: 4 -> 2`, `MEDIUM: 11 -> 10`, `LOW: 4 -> 4`, `0` new CVEs).
2. All installed Python dependencies (`PyJWT==2.15.1` pinned, `cryptography==50.0.2`, `fastapi==0.143.0`, `uvicorn==0.54.0`, `docker==7.2.0`, `psycopg==3.3.7`, etc.) show **0 OSV advisories**, Payment's Python surface area was minimized (`25 -> 15` packages), and all three services execute as unprivileged `chronos` (`uid=1001`).
3. Full backend verification (`132 passed, 0 failed`), Compose validation, single-image OCI manifest checks, and live multi-container E2E testing (health endpoints, fail-closed `401` auth, Postgres connectivity, checkout, run lifecycle, controlled `SIGKILL` failure injection, Payment recovery, and telemetry persistence) succeeded without regressions.
4. All 16 remaining findings are `glibc` (`2.41-12+deb13u4`) issues with no supported Debian `trixie` security fix; none are reachable or applicable in CHRONOS, and rolling back to `mvp-2026-11-12-3cd42d1-scanfix1` remains intact in ECR if needed.

