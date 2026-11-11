"""
Controlled failure injection client for CHRONOS Orders service.
Communicates with the isolated internal failure-controller over the private Docker network.
The Orders service has NO Docker daemon socket mount and NO Docker SDK dependency.
"""

from datetime import datetime, timezone
import logging
import os
import threading
import time
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
import requests

from database import save_event, verify_failure_injection_permitted
from event_schema import ChronosEvent

logger = logging.getLogger(__name__)

# Single-flight in-process guard preventing concurrent kill requests for the same run_id
# without holding database locks open across external HTTP calls to failure-controller.
_active_injection_runs: set[UUID] = set()
_active_injection_lock = threading.Lock()


def is_failure_injection_in_progress(run_id: UUID) -> bool:
    """Return True if a failure injection request is currently active for `run_id`."""
    with _active_injection_lock:
        return run_id in _active_injection_runs

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

    # 3. Single-flight reservation per run_id (released after DB persistence finishes)
    with _active_injection_lock:
        if run_id in _active_injection_runs:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Failure injection already in progress for run {run_id}",
            )
        _active_injection_runs.add(run_id)

    try:
        # 4. Fail-closed DB eligibility verification using short row-locked transaction
        try:
            perm_status, run_row = verify_failure_injection_permitted(run_id)
        except Exception as pre_err:
            logger.error(
                "Fail-closed abort: unable to verify run eligibility for run_id=%s: %s",
                run_id,
                pre_err,
                exc_info=True,
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Unable to verify run eligibility for failure injection (database error)",
            )

        if perm_status == "NOT_FOUND":
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
        if perm_status == "NOT_IN_PROGRESS":
            current_status = run_row["status"] if run_row else "unknown"
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Run {run_id} is not in progress (status: {current_status})",
            )
        if perm_status == "ALREADY_INJECTED":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Failure injection already recorded for run {run_id}",
            )
        if perm_status == "CHECKOUT_ALREADY_STARTED":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Checkout already started for run {run_id}; cannot inject failure",
            )

        # 5. Check internal service credentials
        controller_token = get_failure_controller_token()
        if not controller_token:
            logger.error("FAILURE_CONTROLLER_TOKEN is not configured in Orders service")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Failure controller authentication unconfigured",
            )

        controller_url = get_failure_controller_url()
        endpoint = f"{controller_url}/internal/failures/payment/kill"

        # 6. Invoke internal failure-controller over private network (no DB lock held)
        controller_result = _invoke_controller_kill(endpoint, controller_token)

        # 7. Save FAILURE_INJECTED ChronosEvent in PostgreSQL with bounded retries
        _persist_failure_event_with_retries(run_id, target, controller_result)

        return {
            "status": "injected",
            "run_id": str(run_id),
            "target": target,
            "action": "kill",
        }
    finally:
        with _active_injection_lock:
            _active_injection_runs.discard(run_id)


def _invoke_controller_kill(endpoint: str, controller_token: str) -> dict[str, Any]:
    """Call internal failure-controller kill endpoint and normalize error responses."""
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

    return resp.json()


def _parse_controller_timestamp(raw_timestamp: Any) -> datetime:
    """Parse failure-controller ISO-8601 timestamp as timezone-aware UTC datetime."""
    if isinstance(raw_timestamp, str) and raw_timestamp.strip():
        candidate = raw_timestamp.strip()
        if candidate.endswith("Z"):
            candidate = f"{candidate[:-1]}+00:00"
        try:
            parsed = datetime.fromisoformat(candidate)
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
        except ValueError:
            pass
    return datetime.now(timezone.utc)


def _persist_failure_event_with_retries(
    run_id: UUID,
    target: str,
    controller_result: dict[str, Any],
) -> None:
    """Persist FAILURE_INJECTED event in PostgreSQL with bounded retries."""
    container_id = controller_result.get("container_id", "unknown")
    container_name = controller_result.get("container_name", "unknown")
    compose_project = controller_result.get("compose_project", "01-http-basics")
    event_timestamp = _parse_controller_timestamp(controller_result.get("timestamp"))

    payload: dict[str, Any] = {
        "target": target,
        "action": "kill",
        "container_id": container_id,
        "container_name": container_name,
        "compose_project": compose_project,
    }
    if controller_result.get("container_state"):
        payload["container_state"] = controller_result["container_state"]

    failure_event = ChronosEvent(
        run_id=run_id,
        timestamp=event_timestamp,
        service_id="orders",
        event_type="FAILURE_INJECTED",
        source="chronos-control",
        payload=payload,
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
