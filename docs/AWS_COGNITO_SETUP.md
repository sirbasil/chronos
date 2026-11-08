# CHRONOS — Amazon Cognito Setup, Security Architecture & AWS Deployment Guide

This document defines the Amazon Cognito authentication architecture, role-based authorization matrix, backend JWT verification design, Docker failure injection security audit, and AWS deployment readiness checklist for CHRONOS.


## 1. Cognito Resource Inventory (Verified Live)

The following AWS Cognito resources were inspected in `ap-south-1` (Mumbai) using read-only AWS CLI calls under profile `chronos-dev`:

| Parameter | Value |
|---|---|
| **AWS Account ID** | `519725697841` |
| **IAM Caller Identity** | `arn:aws:iam::519725697841:user/chronos-cli` |
| **AWS Region** | `ap-south-1` |
| **Cognito User Pool ID** | `ap-south-1_tDVeeHq0g` |
| **User Pool Name** | `chronos-users` |
| **User Pool Status** | Active (Self-registration disabled, admin-create-only, 12+ char password policy) |
| **App Client ID** | `4268fo6vpodgv8dt37tim2aec3` |
| **App Client Name** | `chronos-web-client` |
| **Client Type** | Public client (No client secret) |
| **OAuth Flow** | Authorization Code Grant with PKCE (`code`) |
| **OAuth Scopes** | `openid`, `email`, `profile` |
| **Configured Callbacks** | `http://localhost:5173/`, `http://127.0.0.1:5173/` |
| **Configured Sign-Outs** | `http://localhost:5173/`, `http://127.0.0.1:5173/` |
| **Cognito Domain Prefix** | `chronos-auth-519725697841` |
| **Full Domain URL** | `https://chronos-auth-519725697841.auth.ap-south-1.amazoncognito.com` |
| **Managed Login Status** | Active (Managed Login Version 2) |


## 2. Environment Variables Configuration

### Frontend (`frontend/.env.local` or AWS Amplify Console)

All `VITE_*` variables are embedded into client JavaScript. **Never place secrets here.**

```bash
# Backend API Base URL
VITE_API_BASE_URL=http://127.0.0.1:8000

# Amazon Cognito Public Configuration
VITE_COGNITO_REGION=ap-south-1
VITE_COGNITO_USER_POOL_ID=ap-south-1_tDVeeHq0g
VITE_COGNITO_USER_POOL_CLIENT_ID=4268fo6vpodgv8dt37tim2aec3
VITE_COGNITO_OAUTH_DOMAIN=chronos-auth-519725697841.auth.ap-south-1.amazoncognito.com
VITE_COGNITO_REDIRECT_SIGN_IN=http://127.0.0.1:5173/
VITE_COGNITO_REDIRECT_SIGN_OUT=http://127.0.0.1:5173/
```

> **For Production (Amplify):**
> Update `VITE_API_BASE_URL` to the public backend domain (e.g. `https://api.chronos.example.com`).
> Update `VITE_COGNITO_REDIRECT_SIGN_IN` and `VITE_COGNITO_REDIRECT_SIGN_OUT` to the production Amplify domain (e.g. `https://main.<app-id>.amplifyapp.com/`).

### Backend (`backend/.env` on EC2)

```bash
# Environment Mode
APP_ENV=development # Set to 'production' on EC2

# Cognito Configuration
COGNITO_REGION=ap-south-1
COGNITO_USER_POOL_ID=ap-south-1_tDVeeHq0g
COGNITO_USER_POOL_CLIENT_ID=4268fo6vpodgv8dt37tim2aec3
COGNITO_ADMIN_GROUP=chronos-admins
COGNITO_OPERATOR_GROUP=chronos-operators

# CORS Allowed Origins (Comma-separated, no wildcards allowed)
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://localhost:1420,http://127.0.0.1:1420,http://tauri.localhost

# Failure Injection Flag (Controlled container testing)
ENABLE_FAILURE_INJECTION=false
COMPOSE_PROJECT_NAME=01-http-basics
```

---

## 3. Route Protection & Authorization Matrix

The backend enforces authentication via FastAPI dependency injection in `backend/server_fastapi.py`:

| HTTP Method | Route | Authorization Level | Enforcement Mechanism |
|---|---|---|---|
| `GET` | `/` | **Public** | None |
| `GET` | `/health` | **Public** | Probes DB connectivity; no auth required |
| `GET` | `/orders` | **Authenticated** | `Depends(get_current_user)` |
| `GET` | `/orders/{order_id}` | **Authenticated** | `Depends(get_current_user)` |
| `POST` | `/orders/{order_id}/checkout` | **Authenticated** | `Depends(get_current_user)` |
| `GET` | `/runs` | **Authenticated** | `Depends(get_current_user)` |
| `POST` | `/runs` | **Authenticated** | `Depends(get_current_user)` |
| `GET` | `/runs/{run_id}` | **Authenticated** | `Depends(get_current_user)` |
| `GET` | `/runs/{run_id}/events` | **Authenticated** | `Depends(get_current_user)` |
| `GET` | `/runs/{run_id}/topology` | **Authenticated** | `Depends(get_current_user)` |
| `POST` | `/runs/{run_id}/failure` | **Operator / Admin Only** | `Depends(require_operator_or_admin)` |

---

## 4. Backend JWT Verification Design (`backend/auth.py`)

Access tokens issued by Cognito are cryptographically verified using `PyJWT[crypto]` and the User Pool JWKS:

1. **JWKS Key Retrieval & Caching:**
   - Keys are downloaded from `https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_tDVeeHq0g/.well-known/jwks.json`.
   - Keys are cached thread-safely with a 1-hour TTL.
   - If a token arrives with an unknown `kid` (key identifier), an on-demand cache refresh is triggered to handle Cognito key rotation gracefully.
   - If JWKS cannot be fetched and no cached keys exist, endpoints fail closed with `HTTP 503 Service Unavailable`.

2. **Access Token Validation:**
   - Algorithm must be `RS256`.
   - RSA signature verified against matching `kid` in JWKS.
   - Issuer (`iss`) verified: `https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_tDVeeHq0g`.
   - Token expiration (`exp`) and not-before (`nbf`) verified.
   - Token use check: `token_use == 'access'`. ID tokens (`token_use == 'id'`) are strictly rejected.
   - Client ID verified: `client_id == 4268fo6vpodgv8dt37tim2aec3`. (Note: Cognito access tokens contain `client_id` rather than `aud`).
   - Subject claim (`sub`) must be present and non-empty.

3. **Role-Based Access Control (RBAC):**
   - The user's groups are extracted strictly from the token claim: `cognito:groups`.
   - Membership in `chronos-admins` or `chronos-operators` is required for `/runs/{run_id}/failure`.
   - Client-supplied headers or body parameters requesting elevated privileges are ignored.
   - Users without the required group receive `HTTP 403 Forbidden`.

4. **Fail-Closed Guarantees:**
   - In `APP_ENV=production`: Missing Cognito configuration immediately halts application startup with a `RuntimeError`.
   - In `APP_ENV=development`: If unconfigured, protected routes return `HTTP 503 Service Unavailable`.

---

## 5. Frontend Authentication Architecture

The React/Vite frontend leverages modular AWS Amplify v6 (`aws-amplify@6.22.2`):

1. **Pre-render Initialization:**
   `Amplify.configure()` is executed in `frontend/src/auth/amplifyConfig.ts` before React renders, setting up User Pool ID, App Client ID, and OAuth redirect parameters.

2. **Global Auth Context (`frontend/src/auth/AuthContext.tsx`):**
   - State machine: `LOADING` -> `AUTHENTICATED` | `UNAUTHENTICATED` | `CONFIG_ERROR`.
   - On page load, `fetchAuthSession()` and `getCurrentUser()` restore active sessions.
   - Subscribes to Amplify `Hub` events on the `auth` channel (`signInWithRedirect`, `signedIn`, `tokenRefresh`, `signedOut`).

3. **Cockpit UI Gate (`frontend/src/App.tsx`):**
   - When `UNAUTHENTICATED`: An illuminated Bertone cockpit authentication console is presented, explaining the required credentials and providing the `[ INITIATE SECURE SIGN IN ]` action (redirecting to Cognito Managed Login).
   - A fallback `[ EXPLORE DEMO PREVIEW ]` option allows operators to inspect offline preview telemetry without logging in.
   - When `AUTHENTICATED`: The cockpit displays the operational dashboard, showing the signed-in operator in the header (`Header.tsx`) with a `[ SIGN OUT ]` action button.

4. **Centralized API Client (`frontend/src/services/chronosApi.ts`):**
   - In `fetchWithTimeout`: Calls `fetchAuthSession()` to acquire the access token and injects `Authorization: Bearer <access_token>`.
   - Strictly uses the access token, never the ID token.
   - Differentiates `HTTP 401 Unauthorized` and `HTTP 403 Forbidden`.
   - Preserves `VITE_API_BASE_URL`, timeouts, request cancellation, and `X-Run-ID` tracking.
   - Never logs tokens to the console or includes tokens in error objects.

---

## 6. Docker Failure Injection Security Architecture (IMPLEMENTED)

### Historical Vulnerability (Resolved)
Previously, in `backend/docker-compose.failure-injection.yml`, the host Docker socket was mounted directly into the `orders` service container. Because `orders` is the public-facing HTTP API server, any application compromise would have exposed the EC2 host root.

### Implemented Isolated Internal Failure Controller Architecture
Docker socket access has been completely removed from `orders` and isolated into `failure-controller`:

```
                  PUBLIC INTERNET
                        |
                        v
                FastAPI / Orders
              (NO Docker socket)
              (NO Docker SDK lib)
                        |
                        |
            Private Docker network (internal: true)
            (Authenticated via shared secret token)
                        |
                        v
                Failure Controller
             (Internal-only microservice)
             (Has /var/run/docker.sock)
             (NO published ports)
             (NO Postgres credentials)
                        |
                        v
                  Docker daemon
                        |
                        v
                  Payment service
```

1. **Orders Service Hardening:**
   - No `/var/run/docker.sock` mount.
   - `docker` SDK removed from `requirements.txt` and `Dockerfile.orders`.
   - Communicates with controller via internal URL `http://failure-controller:8002` using `requests`.
   - Requires valid Cognito operator/admin authentication (`chronos-admins` or `chronos-operators`) before delegating.
   - Persists `FAILURE_INJECTED` ChronosEvent to PostgreSQL only upon confirmed 200 OK kill from controller.
2. **Failure Controller Isolation:**
   - Dedicated service located in `backend/failure_controller/`.
   - Exposes exactly one restricted endpoint: `POST /internal/failures/payment/kill`.
   - Resolves payment container strictly using server-side Compose project name and `com.docker.compose.service=payment`.
   - Rejects arbitrary targets, containers, or signals.
   - Validates that the container is running before issuing SIGKILL.
   - Service-to-service authentication using `FAILURE_CONTROLLER_TOKEN` via constant-time comparison (`hmac.compare_digest`).
   - Runs with dropped capabilities (`cap_drop: [ALL]`), `no-new-privileges: true`, and non-root user `chronos:1001`.
   - No published ports to host; joins only the `internal: true` failure-control network.
   - Has zero access to PostgreSQL credentials or Cognito user tokens.
3. **Network Isolation:**
   - `failure-control` network configured with `internal: true`.
   - Only `orders` and `failure-controller` join `failure-control`.
   - `payment` and `postgres` join `default` network only and cannot reach `failure-controller`.

---

## 7. Manual Operator Runbook (AWS CLI Commands)

> **IMPORTANT:**
> Under execution security boundaries, the AI assistant did not create or modify live AWS resources.
> The operator should run the following commands manually in an authorized AWS CLI shell using `--profile chronos-dev`.

### Step 1: Create Missing Cognito Groups
The live User Pool currently has **0 groups**. Run these commands to create the required roles:

```bash
# 1. Create chronos-admins group (highest priority)
aws cognito-idp create-group \
  --user-pool-id ap-south-1_tDVeeHq0g \
  --group-name chronos-admins \
  --description "CHRONOS System Administrators with full operational privileges" \
  --precedence 1 \
  --region ap-south-1 \
  --profile chronos-dev

# 2. Create chronos-operators group
aws cognito-idp create-group \
  --user-pool-id ap-south-1_tDVeeHq0g \
  --group-name chronos-operators \
  --description "CHRONOS Flight Operators with telemetry and failure injection privileges" \
  --precedence 10 \
  --region ap-south-1 \
  --profile chronos-dev
```

### Step 2: Create Operator User & Assign Group
Because self-registration is disabled, create users via the admin CLI:

```bash
# 1. Create an operator user
aws cognito-idp admin-create-user \
  --user-pool-id ap-south-1_tDVeeHq0g \
  --username "operator@chronos.internal" \
  --user-attributes Name=email,Value="operator@chronos.internal" Name=email_verified,Value=true \
  --message-action SUPPRESS \
  --region ap-south-1 \
  --profile chronos-dev

# 2. Set permanent password (minimum 12 characters, uppercase, lowercase, numbers, symbols)
aws cognito-idp admin-set-user-password \
  --user-pool-id ap-south-1_tDVeeHq0g \
  --username "operator@chronos.internal" \
  --password "ReplaceWithSecurePassword!2026" \
  --permanent \
  --region ap-south-1 \
  --profile chronos-dev

# 3. Add operator to chronos-operators group
aws cognito-idp admin-add-user-to-group \
  --user-pool-id ap-south-1_tDVeeHq0g \
  --username "operator@chronos.internal" \
  --group-name chronos-operators \
  --region ap-south-1 \
  --profile chronos-dev
```

### Step 3: Configure Production Callbacks (When Amplify Is Deployed)
Once the AWS Amplify domain is allocated:

```bash
# Update Cognito App Client callback URLs to include production domain
aws cognito-idp update-user-pool-client \
  --user-pool-id ap-south-1_tDVeeHq0g \
  --client-id 4268fo6vpodgv8dt37tim2aec3 \
  --allowed-o-auth-flows "code" \
  --allowed-o-auth-flows-user-pool-client \
  --allowed-o-auth-scopes "email" "openid" "profile" \
  --callback-urls "http://localhost:5173/","http://127.0.0.1:5173/","https://main.<app-id>.amplifyapp.com/" \
  --logout-urls "http://localhost:5173/","http://127.0.0.1:5173/","https://main.<app-id>.amplifyapp.com/" \
  --supported-identity-providers "COGNITO" \
  --region ap-south-1 \
  --profile chronos-dev
```

---

## 8. AWS Deployment Readiness Checklist

| Category | Item | Status | Notes |
|---|---|---|---|
| **Cognito** | User Pool & Web Client | **VERIFIED** | Active in `ap-south-1` (`ap-south-1_tDVeeHq0g`, client `4268fo6vpodgv8dt37tim2aec3`) |
| **Cognito** | Managed Login Domain | **VERIFIED** | Active (`chronos-auth-519725697841`) |
| **Cognito** | User Groups | **REQUIRES MANUAL ACTION** | Groups `chronos-admins` and `chronos-operators` must be created by operator |
| **Cognito** | User Accounts | **REQUIRES MANUAL ACTION** | Admin must provision user accounts via CLI |
| **Cognito** | Production Callback URLs | **REQUIRES MANUAL ACTION** | Must add Amplify production URL to client callbacks after Amplify deployment |
| **Backend** | JWT Signature Verification | **VERIFIED** | Tested via RS256 JWKS validation (20 unit tests in `test_cognito_jwt.py`) |
| **Backend** | Fail-Closed Startup | **VERIFIED** | Verified startup fails in production without Cognito configuration |
| **Backend** | Route Authorization Matrix | **VERIFIED** | Public vs Authenticated vs Admin/Operator routes strictly enforced |
| **Backend** | CORS Configuration | **VERIFIED** | Dynamic origin parsing, wildcards strictly rejected |
| **Frontend** | Modular Amplify v6 Setup | **VERIFIED** | `aws-amplify@6.22.2` integrated, builds cleanly without TypeScript errors |
| **Frontend** | Cockpit Auth Console | **VERIFIED** | Bertone illuminated auth gate implemented with fallback to demo preview |
| **Frontend** | Centralized API Bearer Token | **VERIFIED** | Tokens attached in `chronosApi.ts`; no token logging or manual storage |
| **Security** | Docker Socket Isolation | **VERIFIED** | Socket access removed from Orders; isolated in internal `failure-controller` with shared secret and private network |
| **Infrastructure** | HTTPS / Caddy Reverse Proxy | **BLOCKS DEPLOYMENT** | Must provision Caddy on EC2 before exposing backend API publicly |
| **Infrastructure** | EC2 Security Groups | **BLOCKS DEPLOYMENT** | Port 8000 must NOT be public; only Caddy (443/80) should receive traffic |
| **Infrastructure** | CloudWatch & S3 Backups | **PENDING** | Automated DB dump script and CloudWatch log agent for Phase 2 |
