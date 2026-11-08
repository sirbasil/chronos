# CHRONOS — AWS Production Deployment Guide

**Deployment Date:** November 8, 2026  
**Target Region:** `ap-south-1` (Mumbai)  
**AWS Account ID:** `519725697841`  
**Public Hostname:** `chronos-mvp.duckdns.org`  
**Static Public IPv4:** `13.205.217.77` (`eipalloc-0994f4f700916a229`)

---

## 1. Production Architecture & Service Responsibilities

CHRONOS is deployed using an MVP single-host architecture balancing operational simplicity, zero cloud-lockin, robust security isolation, and cost efficiency.

```
[ Internet Users ]
       │
       ├─ HTTPS (Port 443) ──> [ AWS Amplify: Web Frontend ]
       │                         • React 18 + Vite client
       │                         • Cognito Hosted UI OAuth2 PKCE Login
       │                         • Calls Backend API at chronos-mvp.duckdns.org
       │
       └─ HTTPS (Port 443) ──> [ EC2 Host: chronos-mvp (Ubuntu 24.04 LTS) ]
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
                                       ▼ (IAM Instance Profile)
                         [ AWS Managed Services ]
                           • Amazon S3: Daily encrypted DB backups (14-day expiry)
                           • Amazon CloudWatch: Application & access log streaming
                           • AWS Systems Manager: Zero-trust shell access
```

### Component Roles & Responsibilities

| Component | Technology | Responsibility | Network Binding |
| :--- | :--- | :--- | :--- |
| **Frontend** | AWS Amplify Hosting | Hosts React/Vite bundle, handles user authentication via Cognito PKCE, renders live topology & metrics. | Public CDN / HTTPS |
| **Reverse Proxy** | Caddy v2 (Host Service) | Terminates TLS for `chronos-mvp.duckdns.org`, automatic ACME certificates via Let's Encrypt, HTTP-to-HTTPS redirect, proxies API requests to `127.0.0.1:8000`. | Public `0.0.0.0:80,443` |
| **Orders API** | FastAPI / Python 3.12 | Core backend service: JWT verification, database persistence, payment orchestration, and failure trigger dispatch. | Localhost `127.0.0.1:8000` |
| **Payment Service** | FastAPI / Python 3.12 | Simulated payment processing gateway with configurable latency and error injection. | Private Docker network only (no host port) |
| **Database** | PostgreSQL 16 (Alpine) | Persists order history, failure events, and system run logs. Uses persistent volume `postgres_data`. | Private Docker network only (no host port) |
| **Failure Controller** | Python 3.12 / Docker SDK | Privileged execution daemon for controlled container failure injection. Isolated on an internal-only Docker network with non-root UID 1001 and mapped `DOCKER_GID`. | Internal network `failure-control` only |
| **Authentication** | Amazon Cognito | Manages user identity, MFA, and RBAC groups (`chronos-admins`, `chronos-operators`). | Managed Cloud Service |
| **Host Management** | AWS Systems Manager | Secure remote shell access without opening port 22 or managing SSH key pairs. | Outbound HTTPS agent |
| **Database Backups** | Amazon S3 | Daily encrypted PostgreSQL pg_dump storage with 14-day automated expiration. | S3 VPC Endpoint / HTTPS |

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
Backend CORS origin validation is strictly enforced in `backend/server_fastapi.py`. The `CORS_ALLOWED_ORIGINS` environment variable must include the AWS Amplify frontend domain:
```bash
CORS_ALLOWED_ORIGINS=https://main.<app-id>.amplifyapp.com,https://chronos-mvp.duckdns.org
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
CORS_ALLOWED_ORIGINS=https://main.<amplify-app-id>.amplifyapp.com,https://chronos-mvp.duckdns.org
```

---

## 4. Operational Playbook

### Connecting to the EC2 Host via AWS Systems Manager
Since port 22 is closed, connect to the server securely using the AWS CLI:
```bash
aws ssm start-session \
  --target <INSTANCE_ID> \
  --profile chronos-dev \
  --region ap-south-1
```
Once connected, switch to the chronos deployer or root user:
```bash
sudo -i
cd /opt/chronos
```

### Managing the Docker Compose Stack
The production Compose definition is deployed at `/opt/chronos/backend/deploy/compose.prod.yml`:

```bash
# Check running container status and health
docker compose -f /opt/chronos/backend/deploy/compose.prod.yml ps

# View live logs for all services (or specify orders / payment / postgres)
docker compose -f /opt/chronos/backend/deploy/compose.prod.yml logs -f orders

# Restart all services cleanly
docker compose -f /opt/chronos/backend/deploy/compose.prod.yml restart

# Stop the stack
docker compose -f /opt/chronos/backend/deploy/compose.prod.yml down

# Start the stack in background
docker compose -f /opt/chronos/backend/deploy/compose.prod.yml up -d
```

### Checking Caddy Reverse Proxy
```bash
# View Caddy daemon status
sudo systemctl status caddy

# View live Caddy access and TLS certificate renewal logs
sudo journalctl -u caddy -f --no-pager

# Reload Caddy configuration after updating Caddyfile
sudo caddy reload --config /etc/caddy/Caddyfile
```

### Verifying Service Health Endpoints
```bash
# Host-level probe:
curl -I http://127.0.0.1:8000/health

# Public domain HTTPS probe:
curl -I https://chronos-mvp.duckdns.org/health
```

---

## 5. Safe Teardown Procedure (End of 15-Day Hosting Period)

At the conclusion of the evaluation period, execute the following steps to prevent ongoing AWS billing and cleanly release all resources:

1. **Stop and Terminate EC2 Instance:**
   ```bash
   aws ec2 terminate-instances \
     --instance-ids <INSTANCE_ID> \
     --profile chronos-dev \
     --region ap-south-1
   ```

2. **Release Elastic IP:**
   ```bash
   aws ec2 release-address \
     --allocation-id eipalloc-0994f4f700916a229 \
     --profile chronos-dev \
     --region ap-south-1
   ```
   *(Releasing the static IP is critical to avoid the ~$3.65/month idle IPv4 fee).*

3. **Delete Security Group:**
   ```bash
   aws ec2 delete-security-group \
     --group-id sg-03edd976c4e315db4 \
     --profile chronos-dev \
     --region ap-south-1
   ```

4. **Empty and Delete S3 Backup Bucket:**
   ```bash
   aws s3 rm s3://chronos-backups-519725697841-ap-south-1-an --recursive --profile chronos-dev --region ap-south-1
   aws s3api delete-bucket --bucket chronos-backups-519725697841-ap-south-1-an --profile chronos-dev --region ap-south-1
   ```

5. **Clean up IAM Instance Profile & Role:**
   ```bash
   aws iam remove-role-from-instance-profile --instance-profile-name chronos-ec2-role --role-name chronos-ec2-role --profile chronos-dev
   aws iam delete-instance-profile --instance-profile-name chronos-ec2-role --profile chronos-dev
   aws iam delete-role-policy --role-name chronos-ec2-role --policy-name chronos-ec2-runtime-policy --profile chronos-dev
   aws iam detach-role-policy --role-name chronos-ec2-role --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore --profile chronos-dev
   aws iam delete-role --role-name chronos-ec2-role --profile chronos-dev
   ```

6. **Delete AWS Amplify App (if retiring web frontend):**
   ```bash
   aws amplify delete-app --app-id <AMPLIFY_APP_ID> --profile chronos-dev --region ap-south-1
   ```

---

## 6. Known Limitations (MVP Phase)

The following items are documented architectural constraints for the November 8, 2026 MVP release:

1. **Run Creation UI Control:**
   - Run creation is implemented and fully operational via the backend API (`POST /runs`), but it is not yet exposed as an interactive trigger button in the web dashboard.
2. **Experiments View:**
   - The dedicated Experiments view in the frontend UI remains unimplemented in the current release.
3. **`GET /orders` Placeholder:**
   - The `GET /orders` endpoint currently returns a placeholder structure (`{"message": "Orders list placeholder", "orders": []}`). Individual order processing and order events are captured via the event bus and PostgreSQL timeline.
4. **End-to-End Production Checkout & Failure Injection Verification:**
   - While checkout flows and container failure isolation were thoroughly validated in isolated staging integration testing, full end-to-end checkout transactions under live failure injection on the production EC2 host remain to be executed.
