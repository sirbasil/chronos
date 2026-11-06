"""Tests for GET /runs/{run_id}/topology endpoint."""

import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient

from database import create_run, save_event
from event_schema import ChronosEvent
from server_fastapi import app

client = TestClient(app, raise_server_exceptions=True)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _do_checkout(order_id: int, mock_payment_ok: bool = True):
    """Perform a checkout and return (response, run_id)."""
    if mock_payment_ok:
        fake = MagicMock()
        fake.status_code = 200
        fake.json.return_value = {"status": "Payment Successful", "order_id": order_id}
        fake.raise_for_status = MagicMock()
        with patch("server_fastapi.requests.post", return_value=fake):
            resp = client.post(f"/orders/{order_id}/checkout")
    else:
        resp = client.post(f"/orders/{order_id}/checkout")
    run_id = resp.headers.get("x-run-id")
    return resp, run_id


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestTopologySuccessfulRun:
    """Topology from a successful checkout (orders → payment)."""

    def test_topology_returns_200(self):
        _, run_id = _do_checkout(101)
        assert run_id is not None
        resp = client.get(f"/runs/{run_id}/topology")
        assert resp.status_code == 200

    def test_topology_run_id_matches(self):
        _, run_id = _do_checkout(101)
        data = client.get(f"/runs/{run_id}/topology").json()
        assert data["run_id"] == run_id

    def test_topology_correct_nodes(self):
        _, run_id = _do_checkout(101)
        data = client.get(f"/runs/{run_id}/topology").json()
        # Exactly two nodes, exactly the right IDs — no extras, no duplicates
        assert len(data["nodes"]) == 2
        assert {n["id"] for n in data["nodes"]} == {"orders", "payment"}

    def test_topology_correct_edges(self):
        _, run_id = _do_checkout(101)
        data = client.get(f"/runs/{run_id}/topology").json()
        # Exactly one edge with the full expected shape
        assert len(data["edges"]) == 1
        assert data["edges"][0] == {
            "source": "orders",
            "target": "payment",
            "event_type": "SERVICE_CALL",
        }


class TestTopologyDeduplication:
    """Duplicate SERVICE_CALL events should not produce duplicate nodes or edges."""

    def test_duplicate_service_calls_produce_one_edge(self):
        """Insert two SERVICE_CALL events for the same source→destination pair;
        verify exactly one edge and exactly two nodes are returned."""
        run_id = uuid4()
        create_run(run_id=run_id, started_at=datetime.now(timezone.utc), status="IN_PROGRESS")

        # Insert two SERVICE_CALL events for the same source→destination pair
        for _ in range(2):
            evt = ChronosEvent(
                run_id=run_id,
                service_id="orders",
                event_type="SERVICE_CALL",
                source="orders-api",
                payload={"destination_service": "payment", "order_id": 101},
                severity="INFO",
            )
            save_event(evt)

        data = client.get(f"/runs/{run_id}/topology").json()

        # Exactly one edge despite two SERVICE_CALL events
        assert len(data["edges"]) == 1
        assert data["edges"][0]["source"] == "orders"
        assert data["edges"][0]["target"] == "payment"

        # Exactly two nodes — no duplicates
        assert len(data["nodes"]) == 2
        assert {n["id"] for n in data["nodes"]} == {"orders", "payment"}


class TestTopologyNoServiceCalls:
    """Topology for a run with no SERVICE_CALL events (invalid order checkout)."""

    def test_no_service_calls_has_no_edges(self):
        # Order 999 does not exist — only REQUEST_START + REQUEST_END are emitted
        resp, run_id = _do_checkout(999, mock_payment_ok=False)
        assert resp.status_code == 404
        assert run_id is not None

        data = client.get(f"/runs/{run_id}/topology").json()
        assert data["edges"] == []

    def test_no_service_calls_nodes_has_orders(self):
        resp, run_id = _do_checkout(999, mock_payment_ok=False)
        data = client.get(f"/runs/{run_id}/topology").json()
        node_ids = {n["id"] for n in data["nodes"]}
        assert "orders" in node_ids
        # Payment should NOT appear because it was never called
        assert "payment" not in node_ids


class TestTopologyNotFound:
    """Non-existent run should return 404."""

    def test_nonexistent_run_returns_404(self):
        fake_id = str(uuid.uuid4())
        resp = client.get(f"/runs/{fake_id}/topology")
        assert resp.status_code == 404

    def test_nonexistent_run_detail(self):
        fake_id = str(uuid.uuid4())
        data = client.get(f"/runs/{fake_id}/topology").json()
        assert "not found" in data["detail"].lower()
