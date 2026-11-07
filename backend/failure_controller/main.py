"""
CHRONOS Isolated Internal Failure Controller.
Runs as a separate, internal-only microservice with access to /var/run/docker.sock.
Exposes exactly one restricted operation: killing the designated CHRONOS payment container.
No generic Docker management, container creation, execution, or inspection endpoints are exposed.
"""

from contextlib import asynccontextmanager
from datetime import datetime, timezone
import hmac
import logging
import os
from typing import Any

import docker
import docker.errors
from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("failure_controller")


def get_controller_token() -> str:
    """Return configured shared secret for internal service-to-service auth."""
    return os.environ.get("FAILURE_CONTROLLER_TOKEN", "").strip()


def get_compose_project_name() -> str:
    """Return expected Compose project name."""
    return os.environ.get("COMPOSE_PROJECT_NAME", "01-http-basics").strip()


def get_docker_client() -> docker.DockerClient:
    """Obtain a connected Docker client, raising 503 if daemon is unreachable."""
    try:
        return docker.from_env()
    except docker.errors.DockerException as err:
        logger.error("Failed to connect to Docker daemon: %s", err)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Docker daemon unavailable",
        )


def verify_internal_auth(
    authorization: str | None = Header(default=None, alias="Authorization"),
    x_token: str | None = Header(default=None, alias="X-Failure-Controller-Token"),
) -> None:
    """
    Authenticate internal service requests using constant-time comparison.
    Rejects missing or invalid credentials with 401. Never logs or echoes the token.
    """
    expected_token = get_controller_token()
    if not expected_token:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Controller authentication misconfigured",
        )

    provided = None
    if authorization:
        parts = authorization.split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            provided = parts[1]
        elif len(parts) == 1:
            provided = parts[0]
    elif x_token:
        provided = x_token.strip()

    if not provided or not hmac.compare_digest(provided, expected_token):
        logger.warning("Unauthorized access attempt to failure controller")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized: Invalid internal controller credentials",
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Validate controller configuration on startup.
    Fails closed immediately if the required shared secret is absent.
    """
    token = get_controller_token()
    if not token:
        raise RuntimeError(
            "CRITICAL: FAILURE_CONTROLLER_TOKEN must be configured for failure-controller startup."
        )
    logger.info(
        "Failure controller initialized for Compose project '%s'",
        get_compose_project_name(),
    )
    yield


app = FastAPI(
    title="CHRONOS Failure Controller",
    description="Internal-only controller for restricted payment failure injection",
    lifespan=lifespan,
)


class FailureResultResponse(BaseModel):
    status: str
    target: str
    action: str
    container_id: str
    container_name: str
    compose_project: str
    timestamp: str | None = None


@app.get("/health")
def health_check():
    """Internal health probe."""
    return {"status": "ok", "service": "failure-controller"}


@app.post(
    "/internal/failures/payment/kill",
    response_model=FailureResultResponse,
    status_code=status.HTTP_200_OK,
)
def kill_payment_container(
    _=Depends(verify_internal_auth),
) -> dict[str, Any]:
    """
    Strictly restricted failure operation:
    1. Resolve payment container using Compose project and service labels.
    2. Ensure exactly one matching container is found.
    3. Verify Compose labels match expected values.
    4. Confirm container is running.
    5. Execute SIGKILL.
    6. Return container metadata for event recording.
    """
    project_name = get_compose_project_name()
    expected_service = "payment"

    client = get_docker_client()
    try:
        # 1. Resolve container using exact project and service label filters
        filters = {
            "label": [
                f"com.docker.compose.project={project_name}",
                f"com.docker.compose.service={expected_service}",
            ]
        }
        try:
            containers = client.containers.list(all=True, filters=filters)
        except docker.errors.DockerException as err:
            logger.error("Error querying Docker containers: %s", err)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Docker daemon unavailable",
            )

        # 2. Check match count
        if len(containers) == 0:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No container found for service '{expected_service}' in project '{project_name}'",
            )
        if len(containers) > 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Ambiguous match: found {len(containers)} containers for service '{expected_service}' in project '{project_name}'",
            )

        container = containers[0]

        # 3. Explicit label verification
        labels = getattr(container, "labels", None) or {}
        actual_project = labels.get("com.docker.compose.project")
        actual_service = labels.get("com.docker.compose.service")

        if actual_project != project_name or actual_service != expected_service:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(
                    f"Container label verification failed: expected project='{project_name}', "
                    f"service='{expected_service}'; got project='{actual_project}', service='{actual_service}'"
                ),
            )

        # Explicit safeguard against infrastructure targeting
        if actual_service in ("postgres", "orders"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Prohibited target service '{actual_service}'",
            )

        # 4. Reload container state before trusting status
        try:
            container.reload()
        except docker.errors.APIError as err:
            logger.error(
                "Docker API error while reloading container %s: %s",
                getattr(container, "id", "unknown"),
                err,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Docker API error while verifying container status: {err}",
            )
        except docker.errors.DockerException as err:
            logger.error(
                "Docker daemon unavailable while reloading container %s: %s",
                getattr(container, "id", "unknown"),
                err,
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Docker daemon unavailable while verifying container status",
            )
        except Exception as err:
            logger.error(
                "Unexpected error while reloading container %s: %s",
                getattr(container, "id", "unknown"),
                err,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Failed to verify container status: {err}",
            )

        if container.status != "running":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Container '{container.name}' is not running (current status: '{container.status}')",
            )

        # 5. Execute kill action
        try:
            container.kill()
        except docker.errors.APIError as err:
            logger.error("Docker API error killing container %s: %s", getattr(container, "id", "unknown"), err)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Failed to kill container '{container.name}': {err}",
            )
        except docker.errors.DockerException as err:
            logger.error("Docker connection error killing container %s: %s", getattr(container, "id", "unknown"), err)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Docker daemon unavailable",
            )

        return {
            "status": "injected",
            "target": expected_service,
            "action": "kill",
            "container_id": getattr(container, "id", "unknown"),
            "container_name": getattr(container, "name", "unknown"),
            "compose_project": project_name,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    finally:
        try:
            client.close()
        except Exception as close_err:
            logger.warning("Failed to close Docker client: %s", close_err)
