"""
Controlled failure injection module for CHRONOS.
Communicates with the Docker daemon to deliberately stop allowed local Compose containers.
"""

import logging
import os
from typing import Any
from uuid import UUID

import docker
import docker.errors
from fastapi import HTTPException

from database import save_event
from event_schema import ChronosEvent

logger = logging.getLogger(__name__)

# Strict allowlist of supported failure targets
ALLOWED_TARGETS: dict[str, dict[str, Any]] = {
    "payment": {
        "compose_service": "payment",
        "allowed_actions": ["kill"],
    }
}


def is_failure_injection_enabled() -> bool:
    """Return whether failure injection is enabled via configuration."""
    return os.environ.get("ENABLE_FAILURE_INJECTION", "false").lower() in ("true", "1", "yes")


def get_compose_project_name() -> str:
    """Return the expected Docker Compose project name."""
    return os.environ.get("COMPOSE_PROJECT_NAME", "01-http-basics")


def get_docker_client() -> docker.DockerClient:
    """Obtain a connected Docker client, raising 503 if daemon is unreachable."""
    try:
        return docker.from_env()
    except docker.errors.DockerException as err:
        logger.error("Failed to connect to Docker daemon: %s", err)
        raise HTTPException(
            status_code=503,
            detail=f"Docker daemon unavailable: {err}",
        )


def inject_failure(target: str, run_id: UUID) -> dict[str, Any]:
    """
    Deliberately stop an allowed Compose container and record a FAILURE_INJECTED event.

    Safety & Validation Rules:
    - 403: Failure injection is disabled by configuration.
    - 400: Unsupported or prohibited target.
    - 503: Docker daemon is unavailable.
    - 404: Target container not found.
    - 409: Ambiguous match or container is already stopped.
    - 502: Compose label/project verification failure, or Docker API error during reload/kill.
    - 500: Database persistence fails after container is killed.
    """
    # 1. Feature flag verification
    if not is_failure_injection_enabled():
        raise HTTPException(
            status_code=403,
            detail="Failure injection is disabled by configuration",
        )

    # 2. Target allowlist check
    if target not in ALLOWED_TARGETS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported failure target '{target}'. Allowed targets: {sorted(ALLOWED_TARGETS.keys())}",
        )

    expected_service = ALLOWED_TARGETS[target]["compose_service"]
    project_name = get_compose_project_name()

    # 3. Connect to Docker daemon
    try:
        client = get_docker_client()
    except HTTPException:
        raise
    except docker.errors.DockerException as err:
        logger.error("Failed to connect to Docker daemon: %s", err)
        raise HTTPException(
            status_code=503,
            detail=f"Docker daemon unavailable: {err}",
        )

    try:
        # 4. Resolve container using exact project and service label filters
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
                status_code=503,
                detail=f"Docker daemon unavailable: {err}",
            )

        # 5. Check match count
        if len(containers) == 0:
            raise HTTPException(
                status_code=404,
                detail=f"No container found for service '{expected_service}' in project '{project_name}'",
            )
        if len(containers) > 1:
            raise HTTPException(
                status_code=409,
                detail=f"Ambiguous match: found {len(containers)} containers for service '{expected_service}' in project '{project_name}'",
            )

        container = containers[0]

        # 6. Verify labels again
        labels = getattr(container, "labels", None) or {}
        actual_project = labels.get("com.docker.compose.project")
        actual_service = labels.get("com.docker.compose.service")

        if actual_project != project_name or actual_service != expected_service:
            raise HTTPException(
                status_code=502,
                detail=(
                    f"Container label verification failed: expected project='{project_name}', "
                    f"service='{expected_service}'; got project='{actual_project}', service='{actual_service}'"
                ),
            )

        # Prohibit targeting infrastructure or orders service
        if actual_service in ("postgres", "orders"):
            raise HTTPException(
                status_code=400,
                detail=f"Prohibited target service '{actual_service}'",
            )

        # 7. Reload container before trusting its status (fail-closed if reload fails)
        try:
            container.reload()
        except docker.errors.APIError as err:
            logger.error(
                "Docker API error while reloading container %s: %s",
                getattr(container, "id", "unknown"),
                err,
            )
            raise HTTPException(
                status_code=502,
                detail=f"Docker API error while verifying container status: {err}",
            )
        except docker.errors.DockerException as err:
            logger.error(
                "Docker daemon unavailable while reloading container %s: %s",
                getattr(container, "id", "unknown"),
                err,
            )
            raise HTTPException(
                status_code=503,
                detail=f"Docker daemon unavailable while verifying container status: {err}",
            )
        except Exception as err:
            logger.error(
                "Unexpected error while reloading container %s: %s",
                getattr(container, "id", "unknown"),
                err,
            )
            raise HTTPException(
                status_code=502,
                detail=f"Failed to verify container status: {err}",
            )

        if container.status != "running":
            raise HTTPException(
                status_code=409,
                detail=f"Container '{container.name}' is not running (current status: '{container.status}')",
            )

        # 8. Execute kill action
        try:
            container.kill()
        except docker.errors.APIError as err:
            logger.error("Docker API error killing container %s: %s", container.id, err)
            raise HTTPException(
                status_code=502,
                detail=f"Failed to kill container '{container.name}': {err}",
            )
        except docker.errors.DockerException as err:
            logger.error("Docker connection error killing container %s: %s", container.id, err)
            raise HTTPException(
                status_code=503,
                detail=f"Docker daemon unavailable: {err}",
            )

        # 9. Handle non-atomic Docker/PostgreSQL operation explicitly:
        # Save FAILURE_INJECTED immediately after Docker confirms the kill.
        # If persistence fails, log a critical error and do not return a successful response.
        failure_event = ChronosEvent(
            run_id=run_id,
            service_id="orders",
            event_type="FAILURE_INJECTED",
            source="chronos-control",
            payload={
                "target": target,
                "action": "kill",
                "container_id": getattr(container, "id", "unknown"),
                "container_name": getattr(container, "name", "unknown"),
                "compose_project": project_name,
            },
            severity="WARNING",
        )

        try:
            save_event(failure_event)
        except Exception as db_err:
            logger.critical(
                "CRITICAL: Docker container %s (%s) was killed, but persisting FAILURE_INJECTED event failed: %s",
                getattr(container, "id", "unknown"),
                getattr(container, "name", "unknown"),
                db_err,
                exc_info=True,
            )
            raise HTTPException(
                status_code=500,
                detail="Failure injected into container, but event persistence failed",
            )

        return {
            "status": "injected",
            "run_id": str(run_id),
            "target": target,
            "action": "kill",
        }
    finally:
        # Guarantee Docker client is always closed in all success and error paths
        try:
            client.close()
        except Exception as close_err:
            logger.warning("Failed to close Docker client: %s", close_err)
