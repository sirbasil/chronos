"""
Tests for Controlled Failure Injection.
Verifies container resolution, allowlist validation, Docker client error handling,
failure injection execution, database persistence failure, Docker client cleanup,
and event correlation. All Docker interactions are strictly mocked.
"""

from unittest.mock import MagicMock, patch
from uuid import UUID, uuid4

import docker.errors
import pytest
from fastapi.testclient import TestClient

from database import create_run, get_events_by_run, get_run, update_run_status
from server_fastapi import app

client = TestClient(app, raise_server_exceptions=True)


# ---------------------------------------------------------------------------
# Helpers & Mocks
# ---------------------------------------------------------------------------

def _mock_container(
    container_id: str = "payment_cid_123",
    name: str = "01-http-basics-payment-1",
    status: str = "running",
    project: str = "01-http-basics",
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


# ---------------------------------------------------------------------------
# 1. POST /runs Tests
# ---------------------------------------------------------------------------

class TestCreateRunEndpoint:
    """Tests for POST /runs."""

    def test_post_runs_generates_server_side_uuid(self):
        """POST /runs must generate run_id server-side and return 201 Created."""
        resp = client.post("/runs")
        assert resp.status_code == 201
        data = resp.json()
        assert "run_id" in data
        assert data["status"] == "IN_PROGRESS"
        assert "started_at" in data

        run_uuid = UUID(data["run_id"])
        db_run = get_run(run_uuid)
        assert db_run is not None
        assert db_run["status"] == "IN_PROGRESS"


# ---------------------------------------------------------------------------
# 2. Validation & Safety Tests for Failure Injection
# ---------------------------------------------------------------------------

class TestFailureInjectionValidation:
    """Tests for authorization, target allowlist, and run state validation."""

    def test_injection_disabled_by_default(self):
        """When ENABLE_FAILURE_INJECTION is false or omitted, return 403 Forbidden."""
        run = client.post("/runs").json()
        run_id = run["run_id"]

        with patch.dict("os.environ", {"ENABLE_FAILURE_INJECTION": "false"}):
            resp = client.post(f"/runs/{run_id}/failure", json={"target": "payment"})
            assert resp.status_code == 403
            assert "disabled" in resp.json()["detail"].lower()

    def test_injection_unsupported_target_400(self):
        """Targets other than 'payment' must be rejected with 400 Bad Request."""
        run = client.post("/runs").json()
        run_id = run["run_id"]

        with patch.dict("os.environ", {"ENABLE_FAILURE_INJECTION": "true"}):
            for bad_target in ["postgres", "orders", "docker_desktop", "unknown"]:
                resp = client.post(f"/runs/{run_id}/failure", json={"target": bad_target})
                assert resp.status_code == 400
                assert "unsupported" in resp.json()["detail"].lower()

    def test_injection_unknown_run_404(self):
        """Non-existent run_id must return 404 Not Found."""
        fake_id = str(uuid4())
        with patch.dict("os.environ", {"ENABLE_FAILURE_INJECTION": "true"}):
            resp = client.post(f"/runs/{fake_id}/failure", json={"target": "payment"})
            assert resp.status_code == 404
            assert "not found" in resp.json()["detail"].lower()

    def test_injection_inactive_run_409(self):
        """Completed or failed runs must return 409 Conflict."""
        run = client.post("/runs").json()
        run_id = UUID(run["run_id"])
        update_run_status(run_id, status="COMPLETED")

        with patch.dict("os.environ", {"ENABLE_FAILURE_INJECTION": "true"}):
            resp = client.post(f"/runs/{run_id}/failure", json={"target": "payment"})
            assert resp.status_code == 409
            assert "not in progress" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# 3. Docker Resolution, Reload, and Error Handling Tests
# ---------------------------------------------------------------------------

class TestDockerResolutionAndErrors:
    """Tests for Docker API interactions, container state, reload handling, and client cleanup."""

    def test_docker_daemon_unavailable_503(self):
        """DockerException during connection must return 503 Service Unavailable."""
        run = client.post("/runs").json()
        run_id = run["run_id"]

        with patch.dict("os.environ", {"ENABLE_FAILURE_INJECTION": "true"}):
            with patch(
                "failure_injector.get_docker_client",
                side_effect=docker.errors.DockerException("Daemon socket missing"),
            ):
                resp = client.post(f"/runs/{run_id}/failure", json={"target": "payment"})
                assert resp.status_code == 503
                assert "unavailable" in resp.json()["detail"].lower()

    def test_container_not_found_404(self):
        """If no matching container is found in the project, return 404."""
        run = client.post("/runs").json()
        run_id = run["run_id"]

        mock_client = MagicMock()
        mock_client.containers.list.return_value = []

        with patch.dict("os.environ", {"ENABLE_FAILURE_INJECTION": "true"}):
            with patch("failure_injector.get_docker_client", return_value=mock_client):
                resp = client.post(f"/runs/{run_id}/failure", json={"target": "payment"})
                assert resp.status_code == 404
                assert "no container found" in resp.json()["detail"].lower()
                mock_client.close.assert_called_once()

    def test_ambiguous_container_match_409(self):
        """If multiple containers match the project/service filter, return 409."""
        run = client.post("/runs").json()
        run_id = run["run_id"]

        mock_c1 = _mock_container(container_id="c1")
        mock_c2 = _mock_container(container_id="c2")

        mock_client = MagicMock()
        mock_client.containers.list.return_value = [mock_c1, mock_c2]

        with patch.dict("os.environ", {"ENABLE_FAILURE_INJECTION": "true"}):
            with patch("failure_injector.get_docker_client", return_value=mock_client):
                resp = client.post(f"/runs/{run_id}/failure", json={"target": "payment"})
                assert resp.status_code == 409
                assert "ambiguous" in resp.json()["detail"].lower()
                mock_client.close.assert_called_once()

    def test_label_project_verification_failure_502(self):
        """If container labels do not match expected project/service, return 502."""
        run = client.post("/runs").json()
        run_id = run["run_id"]

        # Container belongs to a different project
        mock_c = _mock_container(project="other-project")
        mock_client = MagicMock()
        mock_client.containers.list.return_value = [mock_c]

        with patch.dict("os.environ", {"ENABLE_FAILURE_INJECTION": "true"}):
            with patch("failure_injector.get_docker_client", return_value=mock_client):
                resp = client.post(f"/runs/{run_id}/failure", json={"target": "payment"})
                assert resp.status_code == 502
                assert "verification failed" in resp.json()["detail"].lower()
                mock_client.close.assert_called_once()

    def test_already_stopped_container_409(self):
        """Already stopped container must return 409 and not call kill()."""
        run = client.post("/runs").json()
        run_id = run["run_id"]

        mock_c = _mock_container(status="exited")
        mock_client = MagicMock()
        mock_client.containers.list.return_value = [mock_c]

        with patch.dict("os.environ", {"ENABLE_FAILURE_INJECTION": "true"}):
            with patch("failure_injector.get_docker_client", return_value=mock_client):
                resp = client.post(f"/runs/{run_id}/failure", json={"target": "payment"})
                assert resp.status_code == 409
                assert "not running" in resp.json()["detail"].lower()
                mock_c.kill.assert_not_called()
                mock_client.close.assert_called_once()

    def test_reload_docker_connection_failure_does_not_call_kill_503(self):
        """DockerException during container.reload() must return 503 and abort kill()."""
        run = client.post("/runs").json()
        run_id = UUID(run["run_id"])

        mock_c = _mock_container(status="running")
        mock_c.reload.side_effect = docker.errors.DockerException("Connection to Docker lost during reload")
        mock_client = MagicMock()
        mock_client.containers.list.return_value = [mock_c]

        with patch.dict("os.environ", {"ENABLE_FAILURE_INJECTION": "true"}):
            with patch("failure_injector.get_docker_client", return_value=mock_client):
                resp = client.post(f"/runs/{run_id}/failure", json={"target": "payment"})
                assert resp.status_code == 503
                assert "unavailable" in resp.json()["detail"].lower()
                mock_c.kill.assert_not_called()
                mock_client.close.assert_called_once()

        # Confirm no FAILURE_INJECTED event was saved
        events = get_events_by_run(run_id)
        assert len(events) == 0

    def test_reload_docker_api_error_does_not_call_kill_502(self):
        """docker.errors.APIError during container.reload() must return 502 and abort kill()."""
        run = client.post("/runs").json()
        run_id = UUID(run["run_id"])

        mock_c = _mock_container(status="running")
        mock_c.reload.side_effect = docker.errors.APIError("Docker daemon returned HTTP 500 on inspect")
        mock_client = MagicMock()
        mock_client.containers.list.return_value = [mock_c]

        with patch.dict("os.environ", {"ENABLE_FAILURE_INJECTION": "true"}):
            with patch("failure_injector.get_docker_client", return_value=mock_client):
                resp = client.post(f"/runs/{run_id}/failure", json={"target": "payment"})
                assert resp.status_code == 502
                assert "api error" in resp.json()["detail"].lower()
                mock_c.kill.assert_not_called()
                mock_client.close.assert_called_once()

        # Confirm no FAILURE_INJECTED event was saved
        events = get_events_by_run(run_id)
        assert len(events) == 0

    def test_reload_generic_failure_does_not_call_kill_502(self):
        """Unexpected exception during container.reload() must fail closed (502) and abort kill()."""
        run = client.post("/runs").json()
        run_id = UUID(run["run_id"])

        mock_c = _mock_container(status="running")
        mock_c.reload.side_effect = RuntimeError("Corrupted container json metadata")
        mock_client = MagicMock()
        mock_client.containers.list.return_value = [mock_c]

        with patch.dict("os.environ", {"ENABLE_FAILURE_INJECTION": "true"}):
            with patch("failure_injector.get_docker_client", return_value=mock_client):
                resp = client.post(f"/runs/{run_id}/failure", json={"target": "payment"})
                assert resp.status_code == 502
                assert "failed to verify" in resp.json()["detail"].lower()
                mock_c.kill.assert_not_called()
                mock_client.close.assert_called_once()

        # Confirm no FAILURE_INJECTED event was saved
        events = get_events_by_run(run_id)
        assert len(events) == 0

    def test_docker_client_cleanup_on_success_and_failure(self):
        """Docker client.close() must be called in both successful and failing flows."""
        run = client.post("/runs").json()
        run_id = run["run_id"]

        mock_c = _mock_container(status="running")
        mock_client = MagicMock()
        mock_client.containers.list.return_value = [mock_c]

        # Success case
        with patch.dict("os.environ", {"ENABLE_FAILURE_INJECTION": "true"}):
            with patch("failure_injector.get_docker_client", return_value=mock_client):
                resp = client.post(f"/runs/{run_id}/failure", json={"target": "payment"})
                assert resp.status_code == 200
                mock_client.close.assert_called_once()

        # Failure case (kill raises APIError)
        mock_client.reset_mock()
        mock_c.kill.side_effect = docker.errors.APIError("Kill failed")
        run2 = client.post("/runs").json()
        run_id2 = run2["run_id"]

        with patch.dict("os.environ", {"ENABLE_FAILURE_INJECTION": "true"}):
            with patch("failure_injector.get_docker_client", return_value=mock_client):
                resp = client.post(f"/runs/{run_id2}/failure", json={"target": "payment"})
                assert resp.status_code == 502
                mock_client.close.assert_called_once()

    def test_db_persistence_failure_after_successful_kill(self):
        """If database save_event fails after container.kill(), return 500 and log critical error."""
        run = client.post("/runs").json()
        run_id = run["run_id"]

        mock_c = _mock_container(status="running")
        mock_client = MagicMock()
        mock_client.containers.list.return_value = [mock_c]

        with patch.dict("os.environ", {"ENABLE_FAILURE_INJECTION": "true"}):
            with patch("failure_injector.get_docker_client", return_value=mock_client):
                with patch("failure_injector.save_event", side_effect=RuntimeError("DB write failed")):
                    resp = client.post(f"/runs/{run_id}/failure", json={"target": "payment"})
                    assert resp.status_code == 500
                    assert "persistence failed" in resp.json()["detail"].lower()
                    # Verify kill was called before the persistence failure
                    mock_c.kill.assert_called_once()
                    # Verify Docker client was still closed
                    mock_client.close.assert_called_once()


# ---------------------------------------------------------------------------
# 4. Successful Injection and Correlated Event Sequence
# ---------------------------------------------------------------------------

class TestCorrelatedFailureExperiment:
    """Tests for end-to-end failure injection and event correlation under a single run_id."""

    def test_successful_injection_kills_only_payment_and_persists_event(self):
        """Successful injection calls kill() on Payment and records FAILURE_INJECTED."""
        run = client.post("/runs").json()
        run_id = UUID(run["run_id"])

        mock_c = _mock_container(container_id="c_pay_1", name="01-http-basics-payment-1", status="running")
        mock_client = MagicMock()
        mock_client.containers.list.return_value = [mock_c]

        with patch.dict("os.environ", {"ENABLE_FAILURE_INJECTION": "true"}):
            with patch("failure_injector.get_docker_client", return_value=mock_client):
                resp = client.post(f"/runs/{run_id}/failure", json={"target": "payment"})
                assert resp.status_code == 200
                data = resp.json()
                assert data["status"] == "injected"
                assert data["target"] == "payment"
                assert data["action"] == "kill"
                # Public API response MUST NOT expose container_id
                assert "container_id" not in data
                mock_c.kill.assert_called_once()
                mock_client.close.assert_called_once()

        # Verify FAILURE_INJECTED is in database and retains internal container_id
        events = get_events_by_run(run_id)
        assert len(events) == 1
        evt = events[0]
        assert evt.event_type == "FAILURE_INJECTED"
        assert evt.run_id == run_id
        assert evt.service_id == "orders"
        assert evt.severity == "WARNING"
        assert evt.payload["target"] == "payment"
        assert evt.payload["action"] == "kill"
        assert evt.payload["container_id"] == "c_pay_1"
        assert evt.payload["container_name"] == "01-http-basics-payment-1"
        assert evt.payload["compose_project"] == "01-http-basics"

    def test_public_response_omits_container_id_but_event_retains_it(self):
        """Confirm public response omits container_id, while persisted event preserves it."""
        run = client.post("/runs").json()
        run_id = UUID(run["run_id"])

        mock_c = _mock_container(container_id="secret_container_abc", status="running")
        mock_client = MagicMock()
        mock_client.containers.list.return_value = [mock_c]

        with patch.dict("os.environ", {"ENABLE_FAILURE_INJECTION": "true"}):
            with patch("failure_injector.get_docker_client", return_value=mock_client):
                resp = client.post(f"/runs/{run_id}/failure", json={"target": "payment"})
                assert resp.status_code == 200
                body = resp.json()

                # Public JSON must only contain safe caller fields
                assert set(body.keys()) == {"status", "run_id", "target", "action"}
                assert "container_id" not in body

        # Database event payload MUST retain container_id for audit/debugging
        events = get_events_by_run(run_id)
        assert len(events) == 1
        assert events[0].payload["container_id"] == "secret_container_abc"

    def test_checkout_with_x_run_id_unknown_run_404(self):
        """Supplying unknown X-Run-ID to checkout returns 404."""
        fake_id = str(uuid4())
        resp = client.post("/orders/101/checkout", headers={"X-Run-ID": fake_id})
        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"].lower()

    def test_checkout_with_x_run_id_completed_run_409(self):
        """Supplying completed X-Run-ID to checkout returns 409."""
        run = client.post("/runs").json()
        run_id = UUID(run["run_id"])
        update_run_status(run_id, status="COMPLETED")

        resp = client.post("/orders/101/checkout", headers={"X-Run-ID": str(run_id)})
        assert resp.status_code == 409
        assert "not in progress" in resp.json()["detail"].lower()

    def test_full_failure_experiment_five_events_share_same_run_id(self):
        """
        Verify the complete failure experiment sequence:
        FAILURE_INJECTED -> REQUEST_START -> SERVICE_CALL -> SERVICE_ERROR -> REQUEST_END
        All five events must share the exact same run_id.
        """
        # Step 1: Create run
        run_resp = client.post("/runs")
        assert run_resp.status_code == 201
        run_id = UUID(run_resp.json()["run_id"])

        # Step 2: Inject failure
        mock_c = _mock_container(container_id="c_pay_42", status="running")
        mock_client = MagicMock()
        mock_client.containers.list.return_value = [mock_c]

        with patch.dict("os.environ", {"ENABLE_FAILURE_INJECTION": "true"}):
            with patch("failure_injector.get_docker_client", return_value=mock_client):
                inj_resp = client.post(f"/runs/{run_id}/failure", json={"target": "payment"})
                assert inj_resp.status_code == 200
                assert "container_id" not in inj_resp.json()

        # Step 3: Execute checkout with X-Run-ID header, simulating dead Payment container
        import requests.exceptions
        with patch("server_fastapi.requests.post", side_effect=requests.exceptions.ConnectionError("Connection refused")):
            checkout_resp = client.post("/orders/101/checkout", headers={"X-Run-ID": str(run_id)})
            assert checkout_resp.status_code == 503
            assert checkout_resp.headers.get("x-run-id") == str(run_id)

        # Step 4: Verify all 5 events share the same run_id in expected chronological order
        events_resp = client.get(f"/runs/{run_id}/events")
        assert events_resp.status_code == 200
        events = events_resp.json()

        assert len(events) == 5

        # Check sequence of event types
        event_types = [e["event_type"] for e in events]
        assert event_types == [
            "FAILURE_INJECTED",
            "REQUEST_START",
            "SERVICE_CALL",
            "SERVICE_ERROR",
            "REQUEST_END",
        ]

        # Check that all 5 events share the exact same run_id
        for e in events:
            assert e["run_id"] == str(run_id)

        # Check run status in DB is updated to FAILED
        db_run = get_run(run_id)
        assert db_run["status"] == "FAILED"
        assert db_run["completed_at"] is not None

    def test_ordinary_checkout_unaffected_when_no_x_run_id(self):
        """Ordinary checkout without X-Run-ID generates its own run and produces 4 standard events."""
        fake_response = MagicMock()
        fake_response.status_code = 200
        fake_response.json.return_value = {"order_id": 101, "payment_status": "approved"}
        fake_response.raise_for_status = MagicMock()

        with patch("server_fastapi.requests.post", return_value=fake_response):
            resp = client.post("/orders/101/checkout")
            assert resp.status_code == 200
            run_id = resp.headers.get("x-run-id")
            assert run_id is not None

        events = client.get(f"/runs/{run_id}/events").json()
        event_types = [e["event_type"] for e in events]
        # Standard checkout has 4 events, never FAILURE_INJECTED
        assert event_types == ["REQUEST_START", "SERVICE_CALL", "RESPONSE", "REQUEST_END"]
        for e in events:
            assert e["run_id"] == run_id
