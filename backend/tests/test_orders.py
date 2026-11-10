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
