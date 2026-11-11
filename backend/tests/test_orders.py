from _pytest.monkeypatch import MonkeyPatch
from fastapi.testclient import TestClient
from server_fastapi import app
import requests

client = TestClient(app)

def test_home():

    response = client.get("/")
    assert response.status_code == 200 

def test_order():
    
    order = client.get("/orders/101")
    assert order.status_code == 200
    assert order.json()["item"] == "Keyboard"

def test_order_not_found():
    order = client.get("/orders/999")

    assert order.status_code == 404

class FakeResponse:
    status_code = 200

    def raise_for_status(self):
        pass

    def json(self):
        return {
            "order_id": 101,
            "payment_status": "approved"
        }


class FakeErrorResponse:
    status_code = 500

    def raise_for_status(self):
        raise requests.exceptions.HTTPError("Payment returned 500")

    def json(self):
        return {}
    


def test_checkout_success(monkeypatch: MonkeyPatch):
    
    fake_response = FakeResponse()
    def fake_post(*args, **kwargs):
            return fake_response
    
    
    monkeypatch.setattr("server_fastapi.requests.post",fake_post)

    orders = client.post("/orders/101/checkout")    
    assert orders.status_code == 200
    assert orders.json() == {
                            "order_id": 101,
                            "payment_status": "approved"
                            }


def test_checkout_payment_unavailable(monkeypatch: MonkeyPatch):
    def fake_post(*args,**kwargs):
        raise requests.exceptions.ConnectionError("Payment offline")
     
    monkeypatch.setattr("server_fastapi.requests.post",fake_post)
    
    response = client.post("/orders/101/checkout")

    assert response.status_code == 503
    assert response.json()["detail"] == "Payment service Unavailable"    


def test_checkout_payment_timeout(monkeypatch: MonkeyPatch):
    
    def fake_post(*args,**kwargs):
        raise requests.exceptions.Timeout("Payment Timed Out")   

    monkeypatch.setattr("server_fastapi.requests.post",fake_post)

    response = client.post("/orders/101/checkout")
    
    assert response.status_code == 504
    assert response.json()["detail"] == "Payment service timed out"



def test_checkout_payment_http_error(monkeypatch: MonkeyPatch):

    fake_response = FakeErrorResponse()

    def fake_post(*args,**kwargs):
        return fake_response   

    monkeypatch.setattr("server_fastapi.requests.post",fake_post)

    response = client.post("/orders/101/checkout")
    
    assert response.status_code == 502
    assert response.json()["detail"] == "Payment service returned an error"


def test_checkout_with_explicit_x_run_id(monkeypatch: MonkeyPatch):
    """Verify normal experiment workflow: POST /runs -> POST /orders/101/checkout -> COMPLETED with 4 events."""
    from database import get_events_by_run, get_run
    from uuid import UUID

    fake_response = FakeResponse()
    monkeypatch.setattr("server_fastapi.requests.post", lambda *a, **kw: fake_response)

    # 1. Create run
    run_res = client.post("/runs")
    assert run_res.status_code == 201
    run_id_str = run_res.json()["run_id"]
    run_id = UUID(run_id_str)

    # 2. Checkout with X-Run-ID
    checkout_res = client.post("/orders/101/checkout", headers={"X-Run-ID": run_id_str})
    assert checkout_res.status_code == 200
    assert checkout_res.headers.get("X-Run-ID") == run_id_str

    # 3. Verify database state
    run_record = get_run(run_id)
    assert run_record is not None
    assert run_record["status"] == "COMPLETED"
    assert run_record["completed_at"] is not None

    events = get_events_by_run(run_id)
    assert len(events) == 4
    event_types = [e.event_type for e in events]
    assert event_types == ["REQUEST_START", "SERVICE_CALL", "RESPONSE", "REQUEST_END"]


def test_checkout_duplicate_on_same_run_rejected(monkeypatch: MonkeyPatch):
    """Verify that a run can contain exactly one checkout attempt (409 Conflict on retry)."""
    fake_response = FakeResponse()
    monkeypatch.setattr("server_fastapi.requests.post", lambda *a, **kw: fake_response)

    run_res = client.post("/runs")
    run_id = run_res.json()["run_id"]

    # First checkout succeeds
    res1 = client.post("/orders/101/checkout", headers={"X-Run-ID": run_id})
    assert res1.status_code == 200

    # Second checkout on completed run fails with 409 Conflict
    res2 = client.post("/orders/101/checkout", headers={"X-Run-ID": run_id})
    assert res2.status_code == 409
    assert "not in progress" in res2.json()["detail"].lower()


def test_checkout_unknown_x_run_id_returns_404():
    """Verify that checking out with a nonexistent X-Run-ID returns 404."""
    from uuid import uuid4
    unknown_id = str(uuid4())
    res = client.post("/orders/101/checkout", headers={"X-Run-ID": unknown_id})
    assert res.status_code == 404
    assert res.json()["detail"] == "Run not found"


def test_checkout_finally_block_hardened_against_event_save_failure(monkeypatch: MonkeyPatch):
    """Verify that if saving REQUEST_END fails, run status is STILL finalized and exceptions are not masked."""
    from database import get_run
    from uuid import UUID
    import server_fastapi

    fake_response = FakeResponse()
    monkeypatch.setattr("server_fastapi.requests.post", lambda *a, **kw: fake_response)

    run_res = client.post("/runs")
    run_id_str = run_res.json()["run_id"]
    run_id = UUID(run_id_str)

    # Monkeypatch save_event to raise when saving REQUEST_END
    original_save_event = server_fastapi.save_event

    def failing_save_event(event):
        if event.event_type == "REQUEST_END":
            raise RuntimeError("Database error saving REQUEST_END")
        return original_save_event(event)

    monkeypatch.setattr("server_fastapi.save_event", failing_save_event)

    # Checkout should still succeed and return 200 (not masked by the REQUEST_END failure)
    checkout_res = client.post("/orders/101/checkout", headers={"X-Run-ID": run_id_str})
    assert checkout_res.status_code == 200

    # Run status MUST still be updated to COMPLETED!
    run_record = get_run(run_id)
    assert run_record is not None
    assert run_record["status"] == "COMPLETED"


def test_checkout_with_x_run_id_failed_run_409(monkeypatch: MonkeyPatch):
    """Verify FAILED terminal runs reject subsequent checkout attempts with 409 without calling Payment."""
    from database import get_events_by_run, update_run_status
    from uuid import UUID

    called = False

    def fake_post(*args, **kwargs):
        nonlocal called
        called = True
        return FakeResponse()

    monkeypatch.setattr("server_fastapi.requests.post", fake_post)

    run_res = client.post("/runs")
    run_id_str = run_res.json()["run_id"]
    run_id = UUID(run_id_str)
    update_run_status(run_id, status="FAILED")

    res = client.post("/orders/101/checkout", headers={"X-Run-ID": run_id_str})
    assert res.status_code == 409
    assert "not in progress" in res.json()["detail"].lower()
    assert called is False
    assert get_events_by_run(run_id) == []


def test_checkout_concurrent_claims_db_level():
    """Verify two separate DB connections racing claim_run_checkout allow only one winner."""
    from concurrent.futures import ThreadPoolExecutor
    import threading
    from uuid import UUID
    from database import claim_run_checkout, get_events_by_run
    from event_schema import ChronosEvent

    run_res = client.post("/runs")
    run_id = UUID(run_res.json()["run_id"])

    barrier = threading.Barrier(2)

    def attempt_claim(order_num: int):
        evt = ChronosEvent(
            run_id=run_id,
            service_id="orders",
            event_type="REQUEST_START",
            source="orders-api",
            payload={"order_id": order_num},
            severity="INFO",
        )
        barrier.wait(timeout=5.0)
        status_code, _ = claim_run_checkout(run_id, evt)
        return status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        f1 = pool.submit(attempt_claim, 101)
        f2 = pool.submit(attempt_claim, 101)
        results = [f1.result(timeout=5.0), f2.result(timeout=5.0)]

    assert sorted(results) == ["ALREADY_CLAIMED", "CLAIMED"]
    events = get_events_by_run(run_id)
    assert len(events) == 1
    assert events[0].event_type == "REQUEST_START"


def test_checkout_concurrent_api_requests_only_call_payment_once(monkeypatch: MonkeyPatch):
    """Verify competing concurrent checkout API call gets 409 without blocking on or calling Payment."""
    from concurrent.futures import ThreadPoolExecutor
    import threading
    from uuid import UUID
    from database import get_events_by_run, get_run

    payment_entered = threading.Event()
    allow_payment_return = threading.Event()
    payment_calls = 0
    call_lock = threading.Lock()

    def slow_post(*args, **kwargs):
        nonlocal payment_calls
        with call_lock:
            payment_calls += 1
        payment_entered.set()
        assert allow_payment_return.wait(timeout=5.0)
        return FakeResponse()

    monkeypatch.setattr("server_fastapi.requests.post", slow_post)

    run_res = client.post("/runs")
    run_id_str = run_res.json()["run_id"]
    run_id = UUID(run_id_str)

    with ThreadPoolExecutor(max_workers=2) as pool:
        future_first = pool.submit(
            client.post, "/orders/101/checkout", headers={"X-Run-ID": run_id_str}
        )
        assert payment_entered.wait(timeout=5.0), "First request did not reach Payment HTTP call"

        # While first request is mid-Payment HTTP (no DB lock held), send competing request
        res_second = client.post("/orders/101/checkout", headers={"X-Run-ID": run_id_str})
        allow_payment_return.set()
        res_first = future_first.result(timeout=5.0)

    assert res_first.status_code == 200
    assert res_second.status_code == 409
    assert payment_calls == 1

    run_record = get_run(run_id)
    assert run_record is not None
    assert run_record["status"] == "COMPLETED"
    events = get_events_by_run(run_id)
    assert [e.event_type for e in events] == [
        "REQUEST_START",
        "SERVICE_CALL",
        "RESPONSE",
        "REQUEST_END",
    ]


def test_checkout_failed_claim_does_not_corrupt_run_state(monkeypatch: MonkeyPatch):
    """Verify DB error during checkout claim rolls back cleanly and never invokes Payment."""
    from uuid import UUID
    from database import get_events_by_run, get_run

    payment_called = False

    def fake_post(*args, **kwargs):
        nonlocal payment_called
        payment_called = True
        return FakeResponse()

    def broken_claim(*args, **kwargs):
        raise RuntimeError("Simulated DB failure claiming run")

    monkeypatch.setattr("server_fastapi.requests.post", fake_post)
    monkeypatch.setattr("server_fastapi.claim_run_checkout", broken_claim)

    run_res = client.post("/runs")
    run_id_str = run_res.json()["run_id"]
    run_id = UUID(run_id_str)

    with TestClient(app, raise_server_exceptions=False) as safe_client:
        res = safe_client.post("/orders/101/checkout", headers={"X-Run-ID": run_id_str})
    assert res.status_code == 500
    assert payment_called is False
    assert get_events_by_run(run_id) == []
    assert get_run(run_id)["status"] == "IN_PROGRESS"


def test_checkout_unexpected_request_exception_fails_cleanly(monkeypatch: MonkeyPatch):
    """Verify unexpected requests.RequestException subclasses persist SERVICE_ERROR + REQUEST_END and FAILED."""
    from uuid import UUID
    from database import get_events_by_run, get_run

    def fake_post(*args, **kwargs):
        raise requests.exceptions.TooManyRedirects("Redirect loop from payment")

    monkeypatch.setattr("server_fastapi.requests.post", fake_post)

    res = client.post("/orders/101/checkout")
    assert res.status_code == 502
    assert "TooManyRedirects" in res.json()["detail"]
    run_id = UUID(res.headers["x-run-id"])

    run_record = get_run(run_id)
    assert run_record is not None
    assert run_record["status"] == "FAILED"

    events = get_events_by_run(run_id)
    assert [e.event_type for e in events] == [
        "REQUEST_START",
        "SERVICE_CALL",
        "SERVICE_ERROR",
        "REQUEST_END",
    ]
    assert events[2].payload["error_type"] == "TooManyRedirects"
    assert events[3].payload["status"] == "FAILED"


def test_checkout_malformed_payment_json_fails_cleanly(monkeypatch: MonkeyPatch):
    """Verify malformed JSON in HTTP 200 Payment response marks run FAILED without emitting RESPONSE."""
    from uuid import UUID
    from database import get_events_by_run, get_run

    class MalformedJsonResponse:
        status_code = 200

        def raise_for_status(self):
            pass

        def json(self):
            raise requests.exceptions.JSONDecodeError("Expecting value", "<html>", 0)

    monkeypatch.setattr("server_fastapi.requests.post", lambda *a, **kw: MalformedJsonResponse())

    res = client.post("/orders/101/checkout")
    assert res.status_code == 502
    assert "malformed json" in res.json()["detail"].lower()
    run_id = UUID(res.headers["x-run-id"])

    assert get_run(run_id)["status"] == "FAILED"
    events = get_events_by_run(run_id)
    assert [e.event_type for e in events] == [
        "REQUEST_START",
        "SERVICE_CALL",
        "SERVICE_ERROR",
        "REQUEST_END",
    ]
    assert events[2].payload["error_type"] == "InvalidPaymentResponse"


def test_checkout_invalid_payment_response_structure_fails_cleanly(monkeypatch: MonkeyPatch):
    """Verify non-dict or missing-status Payment payloads fail with 502 and persist SERVICE_ERROR + FAILED."""
    from uuid import UUID
    from database import get_events_by_run, get_run

    for bad_body in [["not", "a", "dict"], {"unexpected": "field"}]:
        class BadStructureResponse:
            status_code = 200

            def raise_for_status(self):
                pass

            def json(self):
                return bad_body

        monkeypatch.setattr("server_fastapi.requests.post", lambda *a, **kw: BadStructureResponse())

        res = client.post("/orders/101/checkout")
        assert res.status_code == 502
        assert "invalid response structure" in res.json()["detail"].lower()
        run_id = UUID(res.headers["x-run-id"])

        assert get_run(run_id)["status"] == "FAILED"
        events = get_events_by_run(run_id)
        assert [e.event_type for e in events] == [
            "REQUEST_START",
            "SERVICE_CALL",
            "SERVICE_ERROR",
            "REQUEST_END",
        ]
        assert events[2].payload["error_type"] == "InvalidPaymentResponse"


def test_checkout_service_error_persistence_failure_does_not_mask_upstream_error(
    monkeypatch: MonkeyPatch,
):
    """Verify DB failure when writing SERVICE_ERROR does not mask original 504/502 upstream error."""
    from uuid import UUID
    from database import get_run
    import server_fastapi

    def fake_timeout(*args, **kwargs):
        raise requests.exceptions.Timeout("Payment timeout")

    original_save_event = server_fastapi.save_event

    def broken_error_save(event):
        if event.event_type == "SERVICE_ERROR":
            raise RuntimeError("DB failure saving SERVICE_ERROR")
        return original_save_event(event)

    monkeypatch.setattr("server_fastapi.requests.post", fake_timeout)
    monkeypatch.setattr("server_fastapi.save_event", broken_error_save)

    run_res = client.post("/runs")
    run_id_str = run_res.json()["run_id"]
    run_id = UUID(run_id_str)

    res = client.post("/orders/101/checkout", headers={"X-Run-ID": run_id_str})
    assert res.status_code == 504
    assert res.json()["detail"] == "Payment service timed out"
    assert get_run(run_id)["status"] == "FAILED"


def test_checkout_completed_and_failed_event_payloads_stay_consistent(monkeypatch: MonkeyPatch):
    """Verify approved checkout persists RESPONSE(200)+REQUEST_END(COMPLETED) and failure persists SERVICE_ERROR+FAILED."""
    from uuid import UUID
    from database import get_events_by_run, get_run

    # 1. Approved checkout path
    monkeypatch.setattr("server_fastapi.requests.post", lambda *a, **kw: FakeResponse())
    ok_run_id_str = client.post("/runs").json()["run_id"]
    ok_res = client.post("/orders/101/checkout", headers={"X-Run-ID": ok_run_id_str})
    assert ok_res.status_code == 200
    assert ok_res.json()["payment_status"] == "approved"

    ok_run = get_run(UUID(ok_run_id_str))
    assert ok_run["status"] == "COMPLETED"
    ok_events = get_events_by_run(UUID(ok_run_id_str))
    assert [e.event_type for e in ok_events] == [
        "REQUEST_START",
        "SERVICE_CALL",
        "RESPONSE",
        "REQUEST_END",
    ]
    assert ok_events[2].payload["status_code"] == 200
    assert ok_events[2].payload["responding_service"] == "payment"
    assert ok_events[3].payload["status"] == "COMPLETED"
    assert ok_events[3].severity == "INFO"

    # 2. Failed payment path never persists RESPONSE or COMPLETED
    monkeypatch.setattr("server_fastapi.requests.post", lambda *a, **kw: FakeErrorResponse())
    fail_run_id_str = client.post("/runs").json()["run_id"]
    fail_res = client.post("/orders/101/checkout", headers={"X-Run-ID": fail_run_id_str})
    assert fail_res.status_code == 502

    fail_run = get_run(UUID(fail_run_id_str))
    assert fail_run["status"] == "FAILED"
    fail_events = get_events_by_run(UUID(fail_run_id_str))
    assert [e.event_type for e in fail_events] == [
        "REQUEST_START",
        "SERVICE_CALL",
        "SERVICE_ERROR",
        "REQUEST_END",
    ]
    assert fail_events[2].severity == "ERROR"
    assert fail_events[3].payload["status"] == "FAILED"
    assert fail_events[3].severity == "ERROR"
