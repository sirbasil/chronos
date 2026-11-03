from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from _pytest.monkeypatch import MonkeyPatch
from fastapi.testclient import TestClient
import pytest

from database import (
    create_run,
    get_db_connection,
    get_events_by_run,
    get_run,
    init_db,
    save_event,
    update_run_status,
)
from event_schema import ChronosEvent
from server_fastapi import app


client = TestClient(app)


class FakePaymentSuccess:
    status_code = 200

    def raise_for_status(self):
        pass

    def json(self):
        return {
            "order_id": 101,
            "payment_status": "approved",
        }


class FakePaymentError:
    status_code = 500

    def raise_for_status(self):
        import requests
        raise requests.exceptions.HTTPError("Payment service 500")

    def json(self):
        return {}


def test_database_initialization():
    """Verify init_db creates runs and events tables and indexes."""
    init_db()

    with get_db_connection(autocommit=True) as conn:
        with conn.cursor() as cur:
            # Check runs table exists
            cur.execute(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name IN ('runs', 'events');
                """
            )
            tables = {row["table_name"] for row in cur.fetchall()}
            assert "runs" in tables
            assert "events" in tables

            # Check indexes on events table
            cur.execute(
                """
                SELECT indexname FROM pg_indexes
                WHERE tablename = 'events';
                """
            )
            indexes = {row["indexname"] for row in cur.fetchall()}
            assert "idx_events_run_id" in indexes
            assert "idx_events_timestamp" in indexes


def test_run_creation_and_update():
    """Verify run creation, status updates, and retrieval."""
    test_run_id = uuid4()
    started_at = datetime.now(timezone.utc)

    # Create run
    run = create_run(run_id=test_run_id, started_at=started_at, status="IN_PROGRESS")
    assert run["run_id"] == test_run_id
    assert run["status"] == "IN_PROGRESS"
    assert run["completed_at"] is None

    # Retrieve run
    fetched = get_run(test_run_id)
    assert fetched is not None
    assert fetched["run_id"] == test_run_id
    assert fetched["status"] == "IN_PROGRESS"

    # Update run status to COMPLETED
    completed_at = datetime.now(timezone.utc)
    updated = update_run_status(test_run_id, status="COMPLETED", completed_at=completed_at)
    assert updated["status"] == "COMPLETED"
    assert updated["completed_at"] is not None

    # Verify update persisted
    refetched = get_run(test_run_id)
    assert refetched["status"] == "COMPLETED"
    assert refetched["completed_at"] is not None


def test_event_insertion_and_retrieval_by_run_id():
    """Verify event insertion and querying by run_id."""
    test_run_id = uuid4()
    create_run(run_id=test_run_id, status="IN_PROGRESS")

    ev1 = ChronosEvent(
        run_id=test_run_id,
        service_id="orders",
        event_type="REQUEST_START",
        source="orders-api",
        payload={"order_id": 101},
        severity="INFO",
    )
    ev2 = ChronosEvent(
        run_id=test_run_id,
        service_id="orders",
        event_type="SERVICE_CALL",
        source="orders-api",
        payload={"destination_service": "payment", "order_id": 101},
        severity="INFO",
    )

    save_event(ev1)
    save_event(ev2)

    events = get_events_by_run(test_run_id)
    assert len(events) == 2
    assert events[0].event_id == ev1.event_id
    assert events[1].event_id == ev2.event_id
    assert events[0].payload == {"order_id": 101}
    assert events[1].payload == {"destination_service": "payment", "order_id": 101}


def test_chronological_ordering():
    """Verify events are strictly returned in ascending timestamp order even if inserted out of order."""
    test_run_id = uuid4()
    create_run(run_id=test_run_id, status="IN_PROGRESS")

    base_time = datetime(2026, 11, 3, 12, 0, 0, tzinfo=timezone.utc)
    t1 = base_time
    t2 = base_time + timedelta(seconds=10)
    t3 = base_time + timedelta(seconds=20)

    e1 = ChronosEvent(
        run_id=test_run_id,
        timestamp=t1,
        service_id="orders",
        event_type="REQUEST_START",
        source="orders-api",
        payload={"step": 1},
        severity="INFO",
    )
    e2 = ChronosEvent(
        run_id=test_run_id,
        timestamp=t2,
        service_id="orders",
        event_type="SERVICE_CALL",
        source="orders-api",
        payload={"step": 2},
        severity="INFO",
    )
    e3 = ChronosEvent(
        run_id=test_run_id,
        timestamp=t3,
        service_id="orders",
        event_type="RESPONSE",
        source="orders-api",
        payload={"step": 3},
        severity="INFO",
    )

    # Insert out of chronological order: e2, then e3, then e1
    save_event(e2)
    save_event(e3)
    save_event(e1)

    events = get_events_by_run(test_run_id)
    assert len(events) == 3
    assert events[0].event_id == e1.event_id
    assert events[1].event_id == e2.event_id
    assert events[2].event_id == e3.event_id
    assert events[0].payload["step"] == 1
    assert events[1].payload["step"] == 2
    assert events[2].payload["step"] == 3


def test_missing_run_handling():
    """Verify handling of nonexistent runs in database and API."""
    nonexistent_id = uuid4()

    # DB level
    assert get_run(nonexistent_id) is None
    assert get_events_by_run(nonexistent_id) == []

    # API level returns 404
    response = client.get(f"/runs/{nonexistent_id}/events")
    assert response.status_code == 404
    assert response.json()["detail"] == "Run not found"


def test_invalid_uuid_in_api():
    """Verify 422 returned for invalid UUID in GET /runs/{run_id}/events."""
    response = client.get("/runs/not-a-valid-uuid/events")
    assert response.status_code == 422


def test_checkout_endpoint_persists_run_and_events(monkeypatch: MonkeyPatch):
    """Verify checkout endpoint persists run record and events accessible via API."""
    monkeypatch.setattr("server_fastapi.requests.post", lambda *args, **kwargs: FakePaymentSuccess())

    response = client.post("/orders/101/checkout")
    assert response.status_code == 200
    assert response.json() == {"order_id": 101, "payment_status": "approved"}

    # Extract run_id from response header
    assert "x-run-id" in response.headers
    run_id = UUID(response.headers["x-run-id"])

    # Verify run record in PostgreSQL
    run = get_run(run_id)
    assert run is not None
    assert run["status"] == "COMPLETED"
    assert run["started_at"] is not None
    assert run["completed_at"] is not None

    # Fetch events via GET /runs/{run_id}/events
    events_res = client.get(f"/runs/{run_id}/events")
    assert events_res.status_code == 200
    events = events_res.json()
    assert len(events) == 4

    # Check event sequence: REQUEST_START -> SERVICE_CALL -> RESPONSE -> REQUEST_END
    assert events[0]["event_type"] == "REQUEST_START"
    assert events[1]["event_type"] == "SERVICE_CALL"
    assert events[2]["event_type"] == "RESPONSE"
    assert events[3]["event_type"] == "REQUEST_END"

    # Check that all events share the same run_id
    for ev in events:
        assert ev["run_id"] == str(run_id)


def test_checkout_http_error_persists_failure(monkeypatch: MonkeyPatch):
    """Verify that on checkout failure, run status is FAILED and SERVICE_ERROR event is persisted."""
    monkeypatch.setattr("server_fastapi.requests.post", lambda *args, **kwargs: FakePaymentError())

    response = client.post("/orders/101/checkout")
    assert response.status_code == 502

    assert "x-run-id" in response.headers
    run_id = UUID(response.headers["x-run-id"])

    # Verify run record marked FAILED
    run = get_run(run_id)
    assert run is not None
    assert run["status"] == "FAILED"

    # Fetch events via GET /runs/{run_id}/events
    events_res = client.get(f"/runs/{run_id}/events")
    assert events_res.status_code == 200
    events = events_res.json()
    assert len(events) == 4

    assert events[0]["event_type"] == "REQUEST_START"
    assert events[1]["event_type"] == "SERVICE_CALL"
    assert events[2]["event_type"] == "SERVICE_ERROR"
    assert events[2]["payload"]["error_type"] == "HTTPError"
    assert events[3]["event_type"] == "REQUEST_END"
    assert events[3]["payload"]["status"] == "FAILED"


def test_checkout_invalid_order_event_sequence():
    """Verify invalid order checkout produces REQUEST_START -> REQUEST_END sequence."""
    response = client.post("/orders/999/checkout")
    assert response.status_code == 404

    assert "x-run-id" in response.headers
    run_id = UUID(response.headers["x-run-id"])

    # Verify run record marked FAILED
    run = get_run(run_id)
    assert run is not None
    assert run["status"] == "FAILED"
    assert run["completed_at"] is not None

    # Fetch events via GET /runs/{run_id}/events
    events_res = client.get(f"/runs/{run_id}/events")
    assert events_res.status_code == 200
    events = events_res.json()
    assert len(events) == 2

    assert events[0]["event_type"] == "REQUEST_START"
    assert events[1]["event_type"] == "REQUEST_END"
    assert events[1]["payload"]["order_id"] == 999
    assert events[1]["payload"]["status"] == "FAILED"

    for ev in events:
        assert ev["run_id"] == str(run_id)


def test_checkout_payment_timeout_event_sequence(monkeypatch: MonkeyPatch):
    """Verify timeout checkout produces REQUEST_START -> SERVICE_CALL -> SERVICE_ERROR -> REQUEST_END."""
    import requests

    def fake_timeout(*args, **kwargs):
        raise requests.exceptions.Timeout("Payment timeout")

    monkeypatch.setattr("server_fastapi.requests.post", fake_timeout)

    response = client.post("/orders/101/checkout")
    assert response.status_code == 504

    run_id = UUID(response.headers["x-run-id"])
    run = get_run(run_id)
    assert run["status"] == "FAILED"
    assert run["completed_at"] is not None

    events_res = client.get(f"/runs/{run_id}/events")
    events = events_res.json()
    assert len(events) == 4

    assert [ev["event_type"] for ev in events] == [
        "REQUEST_START",
        "SERVICE_CALL",
        "SERVICE_ERROR",
        "REQUEST_END",
    ]
    assert events[2]["payload"]["error_type"] == "Timeout"
    assert events[3]["payload"]["status"] == "FAILED"


def test_checkout_payment_connection_error_event_sequence(monkeypatch: MonkeyPatch):
    """Verify connection error checkout produces REQUEST_START -> SERVICE_CALL -> SERVICE_ERROR -> REQUEST_END."""
    import requests

    def fake_conn_error(*args, **kwargs):
        raise requests.exceptions.ConnectionError("Payment unreachable")

    monkeypatch.setattr("server_fastapi.requests.post", fake_conn_error)

    response = client.post("/orders/101/checkout")
    assert response.status_code == 503

    run_id = UUID(response.headers["x-run-id"])
    run = get_run(run_id)
    assert run["status"] == "FAILED"

    events_res = client.get(f"/runs/{run_id}/events")
    events = events_res.json()
    assert len(events) == 4

    assert [ev["event_type"] for ev in events] == [
        "REQUEST_START",
        "SERVICE_CALL",
        "SERVICE_ERROR",
        "REQUEST_END",
    ]
    assert events[2]["payload"]["error_type"] == "ConnectionError"
    assert events[3]["payload"]["status"] == "FAILED"


def test_persistence_across_connection_close():
    """Verify data remains stored across separate database connections and client instances."""
    test_run_id = uuid4()
    with get_db_connection(autocommit=True) as conn1:
        with conn1.cursor() as cur1:
            cur1.execute(
                "INSERT INTO runs (run_id, started_at, status) VALUES (%s, %s, %s)",
                (test_run_id, datetime.now(timezone.utc), "COMPLETED"),
            )
    # conn1 is now closed. Open a completely new connection:
    with get_db_connection(autocommit=True) as conn2:
        with conn2.cursor() as cur2:
            cur2.execute("SELECT * FROM runs WHERE run_id = %s", (test_run_id,))
            row = cur2.fetchone()
            assert row is not None
            assert row["run_id"] == test_run_id
            assert row["status"] == "COMPLETED"

