"""
Controlled failure injection client for CHRONOS Orders service.
Communicates with the isolated internal failure-controller over the private Docker network.
The Orders service has NO Docker daemon socket mount and NO Docker SDK dependency.
"""

import logging
import os
import time
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
import requests

from database import get_events_by_run, save_event
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


def get_failure_controller_url() -> str:
    """Return the base URL of the internal failure-controller service."""
    return os.environ.get("FAILURE_CONTROLLER_URL", "http://failure-controller:8002").rstrip("/")


def get_failure_controller_token() -> str:
    """Return the shared secret for internal service-to-service authentication."""
    return os.environ.get("FAILURE_CONTROLLER_TOKEN", "").strip()


def inject_failure(target: str, run_id: UUID) -> dict[str, Any]:
    """
    Delegate payment container kill to the isolated internal failure-controller,
    then record a FAILURE_INJECTED event in PostgreSQL upon confirmed completion.

    Safety & Validation Rules:
    - 403: Failure injection is disabled by configuration.
    - 400: Unsupported or prohibited target.
    - 503: Failure controller service unconfigured or unavailable.
    - 504: Failure controller timed out.
    - 404: Target container not found.
    - 409: Ambiguous match or container is already stopped.
    - 502: Internal controller auth failed, Compose label mismatch, or Docker API error.
    - 500: Database persistence fails after container is killed.
    """
    # 1. Feature flag verification
    if not is_failure_injection_enabled():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Failure injection is disabled by configuration",
        )

    # 2. Target allowlist check
    if target not in ALLOWED_TARGETS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported failure target '{target}'. Allowed targets: {sorted(ALLOWED_TARGETS.keys())}",
        )

    # 3. Check if failure has already been injected for this run to avoid duplicate events
    try:
        existing_events = get_events_by_run(run_id)
        if any(e.event_type == "FAILURE_INJECTED" for e in existing_events):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Failure injection already recorded for run {run_id}",
            )
    except HTTPException:
        raise
    except Exception as pre_err:
        logger.warning("Could not pre-check existing events for run %s: %s", run_id, pre_err)

    # 4. Check internal service credentials
    controller_token = get_failure_controller_token()
    if not controller_token:
        logger.error("FAILURE_CONTROLLER_TOKEN is not configured in Orders service")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Failure controller authentication unconfigured",
        )

    controller_url = get_failure_controller_url()
    endpoint = f"{controller_url}/internal/failures/payment/kill"

    # 4. Invoke internal failure-controller over private network
    try:
        resp = requests.post(
            endpoint,
            headers={
                "Authorization": f"Bearer {controller_token}",
                "Accept": "application/json",
            },
            timeout=5.0,
        )
    except requests.exceptions.Timeout:
        logger.error("Timeout calling failure controller at %s", endpoint)
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Failure controller timed out",
        )
    except requests.exceptions.ConnectionError as err:
        logger.error("Connection error calling failure controller at %s: %s", endpoint, err)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Failure controller service unavailable: {err}",
        )
    except Exception as err:
        logger.error("Unexpected error calling failure controller: %s", err)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failure controller communication error: {err}",
        )

    # 5. Handle controller response status
    if resp.status_code != status.HTTP_200_OK:
        detail_msg = f"Failure controller returned HTTP {resp.status_code}"
        try:
            err_data = resp.json()
            if "detail" in err_data:
                detail_msg = err_data["detail"]
        except Exception:
            pass

        if resp.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN):
            logger.error("Authentication rejected by internal failure controller")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Internal failure controller authentication failed",
            )
        elif resp.status_code == status.HTTP_404_NOT_FOUND:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail_msg)
        elif resp.status_code == status.HTTP_409_CONFLICT:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail_msg)
        elif resp.status_code == status.HTTP_503_SERVICE_UNAVAILABLE:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=detail_msg)
        else:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail_msg)

    controller_result = resp.json()

    # 6. Save FAILURE_INJECTED ChronosEvent in PostgreSQL with bounded retries
    container_id = controller_result.get("container_id", "unknown")
    container_name = controller_result.get("container_name", "unknown")
    compose_project = controller_result.get("compose_project", "01-http-basics")

    failure_event = ChronosEvent(
        run_id=run_id,
        service_id="orders",
        event_type="FAILURE_INJECTED",
        source="chronos-control",
        payload={
            "target": target,
            "action": "kill",
            "container_id": container_id,
            "container_name": container_name,
            "compose_project": compose_project,
        },
        severity="WARNING",
    )

    kill_timestamp = controller_result.get("timestamp") or failure_event.timestamp.isoformat()
    max_db_attempts = 3
    base_backoff_sec = 0.05
    last_db_err: Exception | None = None

    for attempt in range(1, max_db_attempts + 1):
        try:
            save_event(failure_event)
            last_db_err = None
            break
        except Exception as db_err:
            last_db_err = db_err
            logger.warning(
                "Attempt %d/%d to persist FAILURE_INJECTED event failed for run_id=%s, container_id=%s: %s",
                attempt,
                max_db_attempts,
                run_id,
                container_id,
                db_err,
            )
            if attempt < max_db_attempts:
                time.sleep(base_backoff_sec * (2 ** (attempt - 1)))

    if last_db_err is not None:
        logger.critical(
            "CRITICAL PERSISTENCE FAILURE: Docker container %s (id=%s, service=%s) was successfully killed, "
            "but persisting FAILURE_INJECTED event to PostgreSQL failed after %d attempts for run_id=%s. "
            "Timestamp: %s. Error: %s",
            container_name,
            container_id,
            target,
            max_db_attempts,
            run_id,
            kill_timestamp,
            last_db_err,
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(
                f"Container '{container_name}' (ID: {container_id}) was stopped at {kill_timestamp}, "
                f"but event persistence failed after {max_db_attempts} attempts. "
                f"Database error: {last_db_err}. Manual state verification required."
            ),
        )

    return {
        "status": "injected",
        "run_id": str(run_id),
        "target": target,
        "action": "kill",
    }
