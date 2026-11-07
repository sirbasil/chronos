"""
Automated unit tests for the CHRONOS Isolated Internal Failure Controller.
All Docker daemon interactions are strictly mocked. No containers are ever killed.

Tests:
- Valid internal authentication (Bearer and custom header)
- Missing internal authentication (HTTP 401)
- Invalid internal authentication (HTTP 401)
- Exactly one valid running payment container (HTTP 200)
- Incorrect Compose project label (HTTP 502)
- Incorrect service label (HTTP 502)
- No matching payment container (HTTP 404)
- Multiple matching containers / ambiguous (HTTP 409)
- Payment container already stopped (HTTP 409)
- Docker daemon unavailable on connect (HTTP 503)
- Docker daemon unavailable on list (HTTP 503)
- Docker reload API error (HTTP 502)
- Docker reload connection failure (HTTP 503)
- Docker kill API error (HTTP 502)
- Docker kill connection failure (HTTP 503)
- Docker client closed in all paths
- Missing configuration fails closed on startup
- Fixed route isolation (arbitrary targets/signals cannot be executed)
"""

import os
import sys
from unittest.mock import MagicMock, patch

import docker.errors
from fastapi.testclient import TestClient
import pytest

# Ensure failure_controller package is importable
CONTROLLER_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "failure_controller")
)
if CONTROLLER_DIR not in sys.path:
    sys.path.insert(0, CONTROLLER_DIR)

from failure_controller.main import app as controller_app, lifespan

TEST_TOKEN = "test-secret-token-1234567890abcdef"
TEST_PROJECT = "01-http-basics"

controller_client = TestClient(controller_app, raise_server_exceptions=False)


def _mock_container(
    container_id: str = "payment_cid_123",
    name: str = "01-http-basics-payment-1",
    status: str = "running",
    project: str = TEST_PROJECT,
    service: str = "payment",
):
    """Create a mock Docker container with specified attributes and labels."""
    mock = MagicMock()
    mock.id = container_id
    mock.name = name
    mock.status = status
    mock.labels = {
        "com.docker.compose.project": project,
        "com.docker.compose.service": service,
    }
    mock.reload = MagicMock()
    mock.kill = MagicMock()
    return mock


@pytest.fixture(autouse=True)
def setup_controller_env():
    """Configure environment variables for controller testing."""
    with patch.dict(
        os.environ,
        {
            "FAILURE_CONTROLLER_TOKEN": TEST_TOKEN,
            "COMPOSE_PROJECT_NAME": TEST_PROJECT,
        },
    ):
        yield


# ===========================================================================
# 1. Internal Authentication Tests
# ===========================================================================

def test_controller_missing_auth_header_401():
    """Requests without credentials must be rejected with 401."""
    resp = controller_client.post("/internal/failures/payment/kill")
    assert resp.status_code == 401
    assert "Invalid internal controller credentials" in resp.json()["detail"]


def test_controller_invalid_auth_token_401():
    """Requests with incorrect token must be rejected with 401."""
    resp = controller_client.post(
        "/internal/failures/payment/kill",
        headers={"Authorization": "Bearer wrong-token-xyz"},
    )
    assert resp.status_code == 401
    assert "Invalid internal controller credentials" in resp.json()["detail"]


def test_controller_valid_bearer_token_success():
    """Valid Bearer token succeeds when matching running container exists."""
    mock_c = _mock_container()
    mock_docker = MagicMock()
    mock_docker.containers.list.return_value = [mock_c]

    with patch("failure_controller.main.get_docker_client", return_value=mock_docker):
        resp = controller_client.post(
            "/internal/failures/payment/kill",
            headers={"Authorization": f"Bearer {TEST_TOKEN}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "injected"
        assert data["target"] == "payment"
        assert data["action"] == "kill"
        assert data["container_id"] == "payment_cid_123"
        assert data["compose_project"] == TEST_PROJECT
        mock_c.reload.assert_called_once()
        mock_c.kill.assert_called_once()
        mock_docker.close.assert_called_once()


def test_controller_custom_header_token_success():
    """Valid token passed via X-Failure-Controller-Token header succeeds."""
    mock_c = _mock_container()
    mock_docker = MagicMock()
    mock_docker.containers.list.return_value = [mock_c]

    with patch("failure_controller.main.get_docker_client", return_value=mock_docker):
        resp = controller_client.post(
            "/internal/failures/payment/kill",
            headers={"X-Failure-Controller-Token": TEST_TOKEN},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "injected"


# ===========================================================================
# 2. Container Resolution & Validation Tests
# ===========================================================================

def test_controller_no_matching_container_404():
    """When list returns no containers for payment service, return 404."""
    mock_docker = MagicMock()
    mock_docker.containers.list.return_value = []

    with patch("failure_controller.main.get_docker_client", return_value=mock_docker):
        resp = controller_client.post(
            "/internal/failures/payment/kill",
            headers={"Authorization": f"Bearer {TEST_TOKEN}"},
        )
        assert resp.status_code == 404
        assert "No container found for service 'payment'" in resp.json()["detail"]
        mock_docker.close.assert_called_once()


def test_controller_multiple_matching_containers_409():
    """Ambiguous match (>1 container) must return 409 and not kill any container."""
    c1 = _mock_container(container_id="cid_1", name="payment_1")
    c2 = _mock_container(container_id="cid_2", name="payment_2")
    mock_docker = MagicMock()
    mock_docker.containers.list.return_value = [c1, c2]

    with patch("failure_controller.main.get_docker_client", return_value=mock_docker):
        resp = controller_client.post(
            "/internal/failures/payment/kill",
            headers={"Authorization": f"Bearer {TEST_TOKEN}"},
        )
        assert resp.status_code == 409
        assert "Ambiguous match" in resp.json()["detail"]
        c1.kill.assert_not_called()
        c2.kill.assert_not_called()
        mock_docker.close.assert_called_once()


def test_controller_project_label_mismatch_502():
    """Container with wrong project label must return 502 and not call kill."""
    mock_c = _mock_container(project="other-project")
    mock_docker = MagicMock()
    mock_docker.containers.list.return_value = [mock_c]

    with patch("failure_controller.main.get_docker_client", return_value=mock_docker):
        resp = controller_client.post(
            "/internal/failures/payment/kill",
            headers={"Authorization": f"Bearer {TEST_TOKEN}"},
        )
        assert resp.status_code == 502
        assert "label verification failed" in resp.json()["detail"].lower()
        mock_c.kill.assert_not_called()
        mock_docker.close.assert_called_once()


def test_controller_service_label_mismatch_502():
    """Container with wrong service label must return 502 and not call kill."""
    mock_c = _mock_container(service="orders")
    mock_docker = MagicMock()
    mock_docker.containers.list.return_value = [mock_c]

    with patch("failure_controller.main.get_docker_client", return_value=mock_docker):
        resp = controller_client.post(
            "/internal/failures/payment/kill",
            headers={"Authorization": f"Bearer {TEST_TOKEN}"},
        )
        assert resp.status_code == 502
        assert "label verification failed" in resp.json()["detail"].lower()
        mock_c.kill.assert_not_called()


def test_controller_container_already_stopped_409():
    """Container with non-running status must return 409 and not call kill."""
    mock_c = _mock_container(status="exited")
    mock_docker = MagicMock()
    mock_docker.containers.list.return_value = [mock_c]

    with patch("failure_controller.main.get_docker_client", return_value=mock_docker):
        resp = controller_client.post(
            "/internal/failures/payment/kill",
            headers={"Authorization": f"Bearer {TEST_TOKEN}"},
        )
        assert resp.status_code == 409
        assert "is not running" in resp.json()["detail"]
        mock_c.reload.assert_called_once()
        mock_c.kill.assert_not_called()
        mock_docker.close.assert_called_once()


# ===========================================================================
# 3. Docker Daemon & API Error Handling Tests
# ===========================================================================

def test_controller_docker_daemon_unavailable_on_connect_503():
    """Failure to connect to Docker daemon must return 503."""
    with patch(
        "failure_controller.main.docker.from_env",
        side_effect=docker.errors.DockerException("Daemon socket missing"),
    ):
        resp = controller_client.post(
            "/internal/failures/payment/kill",
            headers={"Authorization": f"Bearer {TEST_TOKEN}"},
        )
        assert resp.status_code == 503
        assert "daemon unavailable" in resp.json()["detail"].lower()


def test_controller_docker_daemon_unavailable_on_list_503():
    """DockerException during container query must return 503."""
    mock_docker = MagicMock()
    mock_docker.containers.list.side_effect = docker.errors.DockerException("Daemon crashed")

    with patch("failure_controller.main.get_docker_client", return_value=mock_docker):
        resp = controller_client.post(
            "/internal/failures/payment/kill",
            headers={"Authorization": f"Bearer {TEST_TOKEN}"},
        )
        assert resp.status_code == 503
        assert "daemon unavailable" in resp.json()["detail"].lower()
        mock_docker.close.assert_called_once()


def test_controller_reload_api_error_502():
    """APIError during reload must return 502 and abort kill."""
    mock_c = _mock_container()
    mock_c.reload.side_effect = docker.errors.APIError("Daemon returned 500 on inspect")
    mock_docker = MagicMock()
    mock_docker.containers.list.return_value = [mock_c]

    with patch("failure_controller.main.get_docker_client", return_value=mock_docker):
        resp = controller_client.post(
            "/internal/failures/payment/kill",
            headers={"Authorization": f"Bearer {TEST_TOKEN}"},
        )
        assert resp.status_code == 502
        assert "API error while verifying container status" in resp.json()["detail"]
        mock_c.kill.assert_not_called()
        mock_docker.close.assert_called_once()


def test_controller_reload_daemon_unavailable_503():
    """Connection drop during reload must return 503 and abort kill."""
    mock_c = _mock_container()
    mock_c.reload.side_effect = docker.errors.DockerException("Socket disconnected")
    mock_docker = MagicMock()
    mock_docker.containers.list.return_value = [mock_c]

    with patch("failure_controller.main.get_docker_client", return_value=mock_docker):
        resp = controller_client.post(
            "/internal/failures/payment/kill",
            headers={"Authorization": f"Bearer {TEST_TOKEN}"},
        )
        assert resp.status_code == 503
        mock_c.kill.assert_not_called()
        mock_docker.close.assert_called_once()


def test_controller_kill_api_error_502():
    """APIError during kill must return 502."""
    mock_c = _mock_container()
    mock_c.kill.side_effect = docker.errors.APIError("Kill failed")
    mock_docker = MagicMock()
    mock_docker.containers.list.return_value = [mock_c]

    with patch("failure_controller.main.get_docker_client", return_value=mock_docker):
        resp = controller_client.post(
            "/internal/failures/payment/kill",
            headers={"Authorization": f"Bearer {TEST_TOKEN}"},
        )
        assert resp.status_code == 502
        assert "Failed to kill container" in resp.json()["detail"]
        mock_docker.close.assert_called_once()


def test_controller_kill_daemon_unavailable_503():
    """Connection drop during kill must return 503."""
    mock_c = _mock_container()
    mock_c.kill.side_effect = docker.errors.DockerException("Daemon crashed during kill")
    mock_docker = MagicMock()
    mock_docker.containers.list.return_value = [mock_c]

    with patch("failure_controller.main.get_docker_client", return_value=mock_docker):
        resp = controller_client.post(
            "/internal/failures/payment/kill",
            headers={"Authorization": f"Bearer {TEST_TOKEN}"},
        )
        assert resp.status_code == 503
        assert "daemon unavailable" in resp.json()["detail"].lower()
        mock_docker.close.assert_called_once()


# ===========================================================================
# 4. Configuration & Startup Tests
# ===========================================================================

@pytest.mark.anyio
async def test_controller_lifespan_refuses_startup_without_token():
    """Controller must raise RuntimeError during startup if FAILURE_CONTROLLER_TOKEN is missing."""
    with patch.dict(os.environ, {"FAILURE_CONTROLLER_TOKEN": ""}):
        with pytest.raises(RuntimeError) as excinfo:
            async with lifespan(controller_app):
                pass
        assert "CRITICAL: FAILURE_CONTROLLER_TOKEN must be configured" in str(excinfo.value)


def test_controller_health():
    """Healthcheck endpoint must return 200 without authentication."""
    resp = controller_client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
    assert resp.json()["service"] == "failure-controller"


def test_controller_rejects_arbitrary_targets():
    """Attempting to target other services via non-existent routes returns 404/405."""
    resp_orders = controller_client.post(
        "/internal/failures/orders/kill",
        headers={"Authorization": f"Bearer {TEST_TOKEN}"},
    )
    assert resp_orders.status_code in (404, 405)

    resp_postgres = controller_client.post(
        "/internal/failures/postgres/kill",
        headers={"Authorization": f"Bearer {TEST_TOKEN}"},
    )
    assert resp_postgres.status_code in (404, 405)
