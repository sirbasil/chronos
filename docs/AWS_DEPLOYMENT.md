# CHRONOS — AWS Production Deployment & Operational Runbook

**Deployment Date:** November 8, 2026<br>
**Last Verified:** November 9, 2026<br>
**Target Region:** `ap-south-1` (Mumbai)<br>
**AWS Account ID:** `519725697841`<br>
**Public Hostname:** `chronos-mvp.duckdns.org`<br>
**Static Public IPv4:** `13.205.217.77` (`eipalloc-0994f4f700916a229`)<br>
**Frontend Application:** `https://main.d2d2s69fek5544.amplifyapp.com`<br>
**Project Source of Truth:** `CHRONOS_CONTEXT.md`

---

## 1. Production Architecture & Service Responsibilities

CHRONOS is deployed using an MVP single-host architecture balancing operational simplicity, zero cloud-lockin, robust security isolation, and cost efficiency.

```
[ Internet Users / Professor Demo ]
       │
       ├─ HTTPS (Port 443) ──> [ AWS Amplify: Web Frontend ]
       │                         • React 18 + Vite client (CloudFront CDN)
       │                         • Cognito Hosted UI OAuth2 PKCE Login
       │                         • Calls Backend API at chronos-mvp.duckdns.org
       │
       └─ HTTPS (Port 443) ──> [ EC2 Host: chronos-mvp (Ubuntu 24.04 LTS, t3.small) ]
                                 • Caddy Reverse Proxy (Automatic Let's Encrypt TLS)
                                 • Inbound Ports: 80, 443 only (No SSH port 22 open)
                                 • Administration: AWS Systems Manager (SSM)
                                       │
                                       ▼ (127.0.0.1:8000)
                         [ Docker Compose: 01-http-basics ]
                           ├── orders (FastAPI backend API)
                           ├── payment (Internal microservice)
                           ├── postgres (PostgreSQL 16 DB with persistent volume)
                           └── failure-controller (Isolated Docker socket agent)
                                       │
                                       ▼ (IAM Instance Profile: chronos-ec2-role)
                         [ AWS Managed Services ]
                           • Amazon S3: Verified on-demand encrypted DB backups (14-day expiry)
                           • Amazon CloudWatch: Staged log groups (/chronos/backend/orders, /chronos/caddy)
                           • AWS Systems Manager: Zero-trust shell access
```

### Component Roles & Responsibilities

| Component | Technology | Responsibility | Network Binding | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Frontend** | AWS Amplify Hosting | Hosts React/Vite bundle, handles Cognito PKCE authentication, renders live topology & metrics. | Public CDN / HTTPS | Operational |
| **Reverse Proxy** | Caddy v2 (Host Service) | Terminates TLS for `chronos-mvp.duckdns.org`, automatic ACME certificates via Let's Encrypt, HTTP-to-HTTPS redirect, proxies API requests to `127.0.0.1:8000`. | Public `0.0.0.0:80,443` | Operational |
| **Orders API** | FastAPI / Python 3.12 | Core backend service: JWT verification, database persistence, payment orchestration, and failure trigger dispatch. | Localhost `127.0.0.1:8000` | Operational |
| **Payment Service** | FastAPI / Python 3.12 | Simulated payment processing gateway with configurable latency and error injection. | Private Docker network only | Operational |
| **Database** | PostgreSQL 16 (Alpine) | Persists order history, failure events, and system run logs. Uses persistent volume `01-http-basics_postgres_data`. | Private Docker network only | Operational |
| **Failure Controller** | Python 3.12 / Docker SDK | Privileged execution daemon for controlled container failure injection. Isolated on an internal-only Docker network with non-root UID 1001 and mapped `DOCKER_GID`. | Internal network `failure-control` only | Operational |
| **Authentication** | Amazon Cognito | Manages user identity, MFA, and RBAC groups (`chronos-admins`, `chronos-operators`). | Managed Cloud Service | Operational |
| **Host Management** | AWS Systems Manager | Secure remote shell access without opening port 22 or managing SSH key pairs. | Outbound HTTPS agent | Operational |
| **Database Backups** | Amazon S3 | Verified custom-format pg_dump storage with 14-day automated lifecycle expiration. | S3 VPC Endpoint / HTTPS | Verified & Tested |
| **CloudWatch Logs** | Amazon CloudWatch | Log groups `/chronos/backend/orders` and `/chronos/caddy` (7-day retention). | CloudWatch API | Staged (Agent deferred) |

---

## 2. Security & Network Configuration

### Inbound Security Group (`sg-03edd976c4e315db4`)
- **Port 80 (TCP):** Open to `0.0.0.0/0` (Used exclusively for ACME HTTP-01 challenge validation and automatic 301 redirect to HTTPS).
- **Port 443 (TCP):** Open to `0.0.0.0/0` (HTTPS encrypted traffic).
- **Port 22 (SSH):** **COMPLETELY CLOSED.** Server access is restricted to AWS Systems Manager Session Manager.
- **Internal Ports (8000, 8001, 8002, 5432):** Strictly bound to `127.0.0.1` or internal Docker networks; never accessible from the public internet.

### Reverse Proxy Configuration (`deploy/Caddyfile`)
```caddy
chronos-mvp.duckdns.org {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8000
}
```

### CORS Configuration
Backend CORS origin validation is strictly enforced in `backend/server_fastapi.py`. The `CORS_ALLOWED_ORIGINS` environment variable on EC2 includes the AWS Amplify frontend domain:
```bash
CORS_ALLOWED_ORIGINS=https://main.d2d2s69fek5544.amplifyapp.com
```
Wildcards (`*`) are disallowed by design.

---

## 3. Production Environment Variables Reference

Production values are injected into `/opt/chronos/config/.env` on the EC2 host. **Never commit actual secrets to version control.**

```bash
# --- PostgreSQL Database ---
POSTGRES_USER=chronos
POSTGRES_PASSWORD=<SECURE_HIGH_ENTROPY_PASSWORD>
POSTGRES_DB=chronos
POSTGRES_HOST=postgres
POSTGRES_PORT=5432

# --- Internal Microservices ---
PAYMENT_SERVICE_URL=http://payment:8001
COMPOSE_PROJECT_NAME=01-http-basics
ENABLE_FAILURE_INJECTION=true

# --- Failure Controller Security ---
FAILURE_CONTROLLER_URL=http://failure-controller:8002
FAILURE_CONTROLLER_TOKEN=<32_BYTE_HEX_RANDOM_SECRET>
DOCKER_GID=999  # Host Docker GID determined via: stat -c '%g' /var/run/docker.sock

# --- Amazon Cognito Authentication & RBAC ---
APP_ENV=production
COGNITO_REGION=ap-south-1
COGNITO_USER_POOL_ID=ap-south-1_tDVeeHq0g
COGNITO_USER_POOL_CLIENT_ID=4268fo6vpodgv8dt37tim2aec3
COGNITO_ADMIN_GROUP=chronos-admins
COGNITO_OPERATOR_GROUP=chronos-operators

# --- CORS Allowed Origins ---
CORS_ALLOWED_ORIGINS=https://main.d2d2s69fek5544.amplifyapp.com
```

---

## 4. Operational Playbook

### Connecting to the EC2 Host via AWS Systems Manager
Since port 22 is closed, connect to the server securely using the AWS CLI:
```bash
aws ssm start-session \
  --target i-04fa58b2029d481a3 \
  --profile chronos-dev \
  --region ap-south-1
```
Once connected, switch to root user:
```bash
sudo -i
cd /opt/chronos
```

### Managing the Docker Compose Stack
The production Compose definition is deployed at `/opt/chronos/backend/deploy/compose.prod.yml`:
```bash
# Check running container status and health
docker compose -f /opt/chronos/config/compose.prod.yml ps

# View live logs for orders
docker compose -f /opt/chronos/config/compose.prod.yml logs -f orders

# Restart all services cleanly
docker compose -f /opt/chronos/config/compose.prod.yml restart
```

### Verifying Service Health Endpoints
```bash
# Localhost probe:
curl -s http://127.0.0.1:8000/health

# Public domain HTTPS probe:
curl -s -I https://chronos-mvp.duckdns.org/health

# Amplify frontend probe:
curl -s -I https://main.d2d2s69fek5544.amplifyapp.com
```

---

## 5. Demonstration Procedures & Pre-Demo Verification

Ahead of the professor demonstration, execute the following pre-flight verification:

### 5.1 Pre-Demo Verification Checklist
- [ ] **Public API:** `curl -s -I https://chronos-mvp.duckdns.org/health` returns HTTP 200 OK.
- [ ] **Frontend:** `https://main.d2d2s69fek5544.amplifyapp.com` loads the illuminated console.
- [ ] **Cognito Session:** Presenter must log in freshly via Cognito Hosted UI before the presentation (access tokens expire after 60 minutes).
- [ ] **Docker Containers:** All 4 containers (`orders`, `payment`, `postgres`, `failure-controller`) are `healthy` / `Up`.

### 5.2 Demonstration Scenario Walkthrough

#### Scenario A: Baseline Normal Run (Orders $\rightarrow$ Payment)
1. **Initialize Run:** Click `[ START NEW RUN ]` in the frontend dashboard, or call:
   ```bash
   RUN_ID=$(curl -s -X POST https://chronos-mvp.duckdns.org/runs \
     -H "Authorization: Bearer <COGNITO_TOKEN>" | jq -r '.run_id')
   ```
2. **Execute Checkout:** Trigger checkout with order ID 101:
   ```bash
   curl -s -X POST https://chronos-mvp.duckdns.org/orders/101/checkout \
     -H "Authorization: Bearer <COGNITO_TOKEN>" \
     -H "X-Run-ID: ${RUN_ID}"
   ```
3. **Inspect in Dashboard:** The timeline displays `REQUEST_START` $\rightarrow$ `SERVICE_CALL` $\rightarrow$ `RESPONSE` $\rightarrow$ `REQUEST_END` (`COMPLETED`). The topology graph shows an active green edge from `orders` to `payment`.

#### Scenario B: Controlled Failure Experiment (Container Kill $\rightarrow$ Error Propagation)
1. **Initialize Run:** Create a new run session.
2. **Inject Controlled Failure:** Call the failure injection endpoint (requires `chronos-operators` group):
   ```bash
   curl -s -X POST https://chronos-mvp.duckdns.org/runs/${RUN_ID}/failure \
     -H "Authorization: Bearer <COGNITO_OPERATOR_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"target": "payment"}'
   ```
   *Result:* The Failure Controller kills the payment container. Event `FAILURE_INJECTED` is persisted in PostgreSQL.
3. **Execute Checkout to Observe Failure:**
   ```bash
   curl -s -X POST https://chronos-mvp.duckdns.org/orders/101/checkout \
     -H "Authorization: Bearer <COGNITO_TOKEN>" \
     -H "X-Run-ID: ${RUN_ID}"
   ```
   *Result:* Orders attempts payment, encounters connection error (503), emits `SERVICE_ERROR`, and finalizes with `REQUEST_END` (`FAILED`).
4. **Inspect in Dashboard:** Visual playback highlights the killed container, error timeline event, and degraded topology edge.
5. **Recovery:** Docker's `restart: unless-stopped` automatically restarts the payment container within ~10 seconds.

---

## 6. Verified Database Backup & Disaster Recovery Runbook

A complete PostgreSQL backup and restore procedure has been tested and verified on the live EC2 environment.

### 6.1 Preserved Backup Copies (As of November 9, 2026)
1. **Cloud Backup (Amazon S3):**
   - Location: `s3://chronos-backups-519725697841-ap-south-1-an/postgres/2026/11/chronos_postgres_20261109_144351Z.dump`
   - Checksum: `d91cd8cd1fd8c5dca637f37917b6c7d852c2d25739d9ec85d3df6de3ae97534f`
2. **Local Project Archive (Repository):**
   - Location: `backups/production/chronos_postgres_20261109_144351Z.dump`
   - Checksum: `d91cd8cd1fd8c5dca637f37917b6c7d852c2d25739d9ec85d3df6de3ae97534f`

### 6.2 Taking an On-Demand Backup (Manual / Scripted)
```bash
BACKUP_FILE="/opt/chronos/backups/chronos_postgres_$(date -u +%Y%m%d_%H%M%SZ).dump"

# Dump database in PostgreSQL custom compressed format
docker exec 01-http-basics-postgres-1 pg_dump -U chronos -d chronos -F c -b -v > "${BACKUP_FILE}"

# Compute checksum
sha256sum "${BACKUP_FILE}" > "${BACKUP_FILE}.sha256"

# Upload to S3
aws s3 cp "${BACKUP_FILE}" s3://chronos-backups-519725697841-ap-south-1-an/postgres/$(date -u +%Y/%m)/ --region ap-south-1
aws s3 cp "${BACKUP_FILE}.sha256" s3://chronos-backups-519725697841-ap-south-1-an/postgres/$(date -u +%Y/%m)/ --region ap-south-1
```

### 6.3 Isolated Restore Validation Procedure (Zero Risk to Production)
To test that a backup is valid without modifying the production database:
```bash
# 1. Spin up an isolated temporary test container
docker run -d --name chronos-restore-validation \
  -e POSTGRES_USER=chronos \
  -e POSTGRES_PASSWORD=val_pwd \
  -e POSTGRES_DB=chronos_restored \
  postgres:16-alpine

# 2. Wait for container readiness
until docker exec chronos-restore-validation pg_isready -U chronos -d chronos_restored > /dev/null 2>&1; do
  sleep 1
done

# 3. Restore dump into isolated container
docker exec -i chronos-restore-validation pg_restore -U chronos -d chronos_restored < "${BACKUP_FILE}"

# 4. Verify restored tables and row counts
docker exec chronos-restore-validation psql -U chronos -d chronos_restored -c "
SELECT count(*) AS total_runs FROM runs;
SELECT count(*) AS total_events FROM events;
"

# 5. Teardown isolated test container
docker rm -f chronos-restore-validation
```

---

## 7. Post-Demonstration AWS Retirement Runbook

After the professor demonstration concludes, execute the following runbook to **completely retire all AWS infrastructure and eliminate all ongoing billing**.

> **CRITICAL PRE-REQUISITE:**
> Verify that the local project database archive (`backups/production/chronos_postgres_20261109_144351Z.dump`) exists and is backed up locally before executing resource deletions!

### 7.1 Complete Resource Inventory

| Resource Type | Resource Identifier | Billable? | Estimated Cost | Retirement Step |
| :--- | :--- | :---: | :--- | :--- |
| **EC2 Instance** | `i-04fa58b2029d481a3` | **YES** | ~$19.00/month | Step 1 |
| **EBS Volume** | `vol-08425fc2d0b5d44d2` (40 GB gp3) | **YES** | ~$3.84/month | Step 1 (Auto) or Step 2 |
| **Elastic IP** | `eipalloc-0994f4f700916a229` (`13.205.217.77`) | **YES** | ~$3.65/month (if idle) | Step 3 |
| **Security Group** | `sg-03edd976c4e315db4` | No | Free | Step 4 |
| **Amplify App** | `d2d2s69fek5544` | **YES** | Hosting / Data Transfer | Step 5 |
| **S3 Bucket** | `chronos-backups-519725697841-ap-south-1-an` | **YES** | Storage / Requests | Step 6 |
| **IAM Profile/Role** | `chronos-ec2-role` | No | Free | Step 7 |
| **Cognito User Pool**| `ap-south-1_tDVeeHq0g` (`chronos-users`) | No | Free tier (<50k MAU) | Step 8 |
| **Cognito Domain** | `chronos-auth-519725697841` | No | Free | Step 8 |
| **CloudWatch Logs** | `/chronos/backend/orders`, `/chronos/caddy` | No | Free (0 bytes stored) | Step 9 |

### 7.2 Step-by-Step Retirement Execution Order

#### Step 1: Terminate EC2 Instance
```bash
# If termination protection was enabled, disable it first:
aws ec2 modify-instance-attribute \
  --instance-id i-04fa58b2029d481a3 \
  --no-disable-api-termination \
  --profile chronos-dev \
  --region ap-south-1

# Terminate instance
aws ec2 terminate-instances \
  --instance-ids i-04fa58b2029d481a3 \
  --profile chronos-dev \
  --region ap-south-1

# Wait for instance to terminate
aws ec2 wait instance-terminated \
  --instance-ids i-04fa58b2029d481a3 \
  --profile chronos-dev \
  --region ap-south-1
```

#### Step 2: Delete Detached EBS Volume (if retained)
```bash
aws ec2 delete-volume \
  --volume-id vol-08425fc2d0b5d44d2 \
  --profile chronos-dev \
  --region ap-south-1 2>/dev/null || echo "Volume already deleted with instance termination."
```

#### Step 3: Release Elastic IP
*CRITICAL:* Unattached Elastic IPs incur an hourly charge. Release immediately:
```bash
aws ec2 release-address \
  --allocation-id eipalloc-0994f4f700916a229 \
  --profile chronos-dev \
  --region ap-south-1
```

#### Step 4: Delete Security Group
Must be executed after the network interface associated with the EC2 instance is released:
```bash
aws ec2 delete-security-group \
  --group-id sg-03edd976c4e315db4 \
  --profile chronos-dev \
  --region ap-south-1
```

#### Step 5: Delete AWS Amplify Application
```bash
aws amplify delete-app \
  --app-id d2d2s69fek5544 \
  --profile chronos-dev \
  --region ap-south-1
```

#### Step 6: Empty and Delete S3 Backup Bucket
```bash
# Delete all objects in bucket
aws s3 rm s3://chronos-backups-519725697841-ap-south-1-an --recursive --profile chronos-dev --region ap-south-1

# Delete bucket
aws s3api delete-bucket \
  --bucket chronos-backups-519725697841-ap-south-1-an \
  --profile chronos-dev \
  --region ap-south-1
```

#### Step 7: Clean Up IAM Instance Profile, Role, and Policies
```bash
# 1. Remove role from instance profile
aws iam remove-role-from-instance-profile \
  --instance-profile-name chronos-ec2-role \
  --role-name chronos-ec2-role \
  --profile chronos-dev

# 2. Delete instance profile
aws iam delete-instance-profile \
  --instance-profile-name chronos-ec2-role \
  --profile chronos-dev

# 3. Delete inline runtime policy
aws iam delete-role-policy \
  --role-name chronos-ec2-role \
  --policy-name chronos-ec2-runtime-policy \
  --profile chronos-dev

# 4. Detach managed SSM policy
aws iam detach-role-policy \
  --role-name chronos-ec2-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore \
  --profile chronos-dev

# 5. Delete role
aws iam delete-role \
  --role-name chronos-ec2-role \
  --profile chronos-dev
```

#### Step 8: Delete Cognito User Pool and Domain
```bash
# 1. Delete custom user pool domain prefix
aws cognito-idp delete-user-pool-domain \
  --domain chronos-auth-519725697841 \
  --user-pool-id ap-south-1_tDVeeHq0g \
  --region ap-south-1 \
  --profile chronos-dev

# 2. Delete user pool
aws cognito-idp delete-user-pool \
  --user-pool-id ap-south-1_tDVeeHq0g \
  --region ap-south-1 \
  --profile chronos-dev
```

#### Step 9: Delete CloudWatch Log Groups
```bash
aws logs delete-log-group --log-group-name /chronos/backend/orders --profile chronos-dev --region ap-south-1
aws logs delete-log-group --log-group-name /chronos/caddy --profile chronos-dev --region ap-south-1
```

### 7.3 Post-Retirement Verification Audit
Run the following commands to confirm that zero billable CHRONOS resources remain active:
```bash
# 1. Check for running instances (Must return empty list)
aws ec2 describe-instances --profile chronos-dev --region ap-south-1 --filters "Name=tag:Project,Values=CHRONOS" "Name=instance-state-name,Values=running,pending,stopped"

# 2. Check for allocated Elastic IPs (Must return empty list)
aws ec2 describe-addresses --profile chronos-dev --region ap-south-1 --filters "Name=allocation-id,Values=eipalloc-0994f4f700916a229"

# 3. Check for S3 bucket (Must return 404)
aws s3api head-bucket --bucket chronos-backups-519725697841-ap-south-1-an --profile chronos-dev --region ap-south-1 2>&1

# 4. Check Amplify apps (Must return empty list)
aws amplify list-apps --profile chronos-dev --region ap-south-1
```

---

## 8. Known Limitations & Architectural Constraints (Demonstration Context)

1. **Decoupled Frontend Run Creation:**
   - The `[ START NEW RUN ]` button in the UI creates an initialized run session via `POST /runs`, but does not automatically execute checkout. During the demo, an order checkout (`POST /orders/101/checkout` with `X-Run-ID`) must be triggered to populate events and render the topology graph.
2. **Failure Injection Operator Authorization:**
   - Failure injection requires a Cognito access token belonging to the `chronos-operators` or `chronos-admins` group. Ensure the demonstration credentials belong to `chronos-operators`.
3. **CloudWatch Streaming Deferred:**
   - CloudWatch log groups are staged, but log streaming from EC2 was deferred in favor of direct host journald inspection via AWS Systems Manager.
4. **Single-Node Docker Volume Backing:**
   - PostgreSQL runs on a named Docker volume backed by the root EBS volume. Backups in S3 and local archive provide disaster recovery protection.
