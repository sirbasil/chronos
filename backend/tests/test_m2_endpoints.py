from uuid import uuid4
from fastapi.testclient import TestClient
from server_fastapi import DEFAULT_ALLOWED_ORIGINS, app, parse_cors_origins
from database import create_run

client = TestClient(app)


def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "timestamp" in data
    assert data["database"] == "connected"
    assert data["payment"] in ("healthy", "unreachable")


def test_health_endpoint_reports_payment_reachability(monkeypatch):
    import requests
    from unittest.mock import MagicMock

    healthy_resp = MagicMock()
    healthy_resp.status_code = 200
    monkeypatch.setattr("server_fastapi.requests.get", lambda *a, **kw: healthy_resp)
    res_ok = client.get("/health")
    assert res_ok.status_code == 200
    assert res_ok.json()["database"] == "connected"
    assert res_ok.json()["payment"] == "healthy"

    def raise_conn_err(*args, **kwargs):
        raise requests.exceptions.ConnectionError("Payment container stopped")

    monkeypatch.setattr("server_fastapi.requests.get", raise_conn_err)
    res_down = client.get("/health")
    assert res_down.status_code == 200
    assert res_down.json()["status"] == "ok"
    assert res_down.json()["database"] == "connected"
    assert res_down.json()["payment"] == "unreachable"


def test_list_runs_endpoint():
    # Create two unique runs
    r1_id = uuid4()
    r2_id = uuid4()
    create_run(r1_id, status="IN_PROGRESS")
    create_run(r2_id, status="COMPLETED")

    response = client.get("/runs?limit=10")
    assert response.status_code == 200
    runs = response.json()
    assert isinstance(runs, list)
    assert len(runs) >= 2
    run_ids = [r["run_id"] for r in runs]
    assert str(r1_id) in run_ids
    assert str(r2_id) in run_ids

    # Validate structure
    for r in runs:
        assert "run_id" in r
        assert "started_at" in r
        assert "status" in r


def test_get_run_by_id():
    run_id = uuid4()
    create_run(run_id, status="IN_PROGRESS")

    response = client.get(f"/runs/{run_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["run_id"] == str(run_id)
    assert data["status"] == "IN_PROGRESS"

    # Non-existent run returns 404
    missing_id = uuid4()
    resp_404 = client.get(f"/runs/{missing_id}")
    assert resp_404.status_code == 404
    assert resp_404.json()["detail"] == "Run not found"


def test_cors_headers_development():
    for dev_origin in ["http://localhost:5173", "http://127.0.0.1:5173"]:
        response = client.options(
            "/runs",
            headers={
                "Origin": dev_origin,
                "Access-Control-Request-Method": "GET",
            },
        )
        assert response.status_code == 200
        assert response.headers.get("access-control-allow-origin") == dev_origin


def test_cors_disallows_stale_tauri_and_untrusted_origins():
    """Verify default CORS rejects stale Tauri origins (1420, tauri.localhost) and untrusted domains."""
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware

    default_app = FastAPI()
    default_app.add_middleware(
        CORSMiddleware,
        allow_origins=DEFAULT_ALLOWED_ORIGINS,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept", "X-Run-ID"],
    )
    default_client = TestClient(default_app)

    for disallowed_origin in [
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "http://tauri.localhost",
        "tauri://localhost",
        "http://malicious-site.example.com",
    ]:
        assert disallowed_origin not in DEFAULT_ALLOWED_ORIGINS
        for target_client in (default_client, client):
            response = target_client.options(
                "/" if target_client is default_client else "/runs",
                headers={
                    "Origin": disallowed_origin,
                    "Access-Control-Request-Method": "GET",
                },
            )
            # FastAPI CORSMiddleware does not return Access-Control-Allow-Origin for disallowed origins
            assert response.headers.get("access-control-allow-origin") is None


def test_parse_cors_origins_defaults():
    assert DEFAULT_ALLOWED_ORIGINS == ["http://localhost:5173", "http://127.0.0.1:5173"]
    assert parse_cors_origins(None) == DEFAULT_ALLOWED_ORIGINS
    assert parse_cors_origins("") == DEFAULT_ALLOWED_ORIGINS
    assert parse_cors_origins("   ") == DEFAULT_ALLOWED_ORIGINS


def test_parse_cors_origins_custom_and_whitespace():
    raw = " https://main.d12345.amplifyapp.com, http://localhost:5173/ , , https://chronos.example.com "
    parsed = parse_cors_origins(raw)
    assert parsed == [
        "https://main.d12345.amplifyapp.com",
        "http://localhost:5173",
        "https://chronos.example.com",
    ]


def test_parse_cors_origins_rejects_wildcard():
    # Solo wildcard falls back to safe defaults
    assert parse_cors_origins("*") == DEFAULT_ALLOWED_ORIGINS
    assert parse_cors_origins(" * ") == DEFAULT_ALLOWED_ORIGINS
    # Wildcard in a list is strictly dropped
    assert parse_cors_origins("*, https://main.example.amplifyapp.com") == [
        "https://main.example.amplifyapp.com"
    ]


def test_cors_preflight_permitted_headers():
    """Verify preflight with all explicit permitted headers from Vite browser origin."""
    response = client.options(
        "/runs",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Authorization, Content-Type, Accept, X-Run-ID",
        },
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert response.headers.get("access-control-allow-credentials") is None
    allow_headers = response.headers.get("access-control-allow-headers", "").lower()
    for h in ["authorization", "content-type", "accept", "x-run-id"]:
        assert h in allow_headers


def test_cors_with_configured_amplify_origin():
    """Verify that a dynamically configured Amplify origin permits CORS requests."""
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware

    amplify_origin = "https://main.d123456.amplifyapp.com"
    test_origins = parse_cors_origins(f"http://localhost:5173, {amplify_origin}")

    test_app = FastAPI()
    test_app.add_middleware(
        CORSMiddleware,
        allow_origins=test_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept", "X-Run-ID"],
    )

    @test_app.get("/test")
    def sample():
        return {"ok": True}

    test_client = TestClient(test_app)

    # OPTIONS preflight
    options_res = test_client.options(
        "/test",
        headers={
            "Origin": amplify_origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Authorization, Accept",
        },
    )
    assert options_res.status_code == 200
    assert options_res.headers.get("access-control-allow-origin") == amplify_origin

    # GET request
    get_res = test_client.get("/test", headers={"Origin": amplify_origin})
    assert get_res.status_code == 200
    assert get_res.headers.get("access-control-allow-origin") == amplify_origin

    # Disallowed origin is rejected
    untrusted_res = test_client.options(
        "/test",
        headers={
            "Origin": "https://untrusted-attacker.com",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert untrusted_res.headers.get("access-control-allow-origin") is None


def test_events_endpoint_returns_utc_timestamps_and_chronological_order():
    """Verify run/event endpoints serialize UTC timestamps and preserve exact deltas across gaps."""
    from datetime import datetime, timezone
    from database import save_event, update_run_status
    from event_schema import ChronosEvent

    run_id = uuid4()
    t_run_start = datetime(2026, 11, 10, 4, 48, 27, 297710, tzinfo=timezone.utc)
    t_kill = datetime(2026, 11, 10, 4, 48, 30, 479994, tzinfo=timezone.utc)
    t_req_start = datetime(2026, 11, 11, 8, 35, 56, 901108, tzinfo=timezone.utc)
    t_req_end = datetime(2026, 11, 11, 8, 35, 56, 934938, tzinfo=timezone.utc)

    create_run(run_id, started_at=t_run_start, status="IN_PROGRESS")

    # Save events intentionally out of chronological insert order to test DB ORDER BY
    save_event(
        ChronosEvent(
            run_id=run_id,
            timestamp=t_req_end,
            service_id="orders",
            event_type="REQUEST_END",
            source="orders-api",
            payload={"order_id": 101, "status": "COMPLETED"},
            severity="INFO",
        )
    )
    save_event(
        ChronosEvent(
            run_id=run_id,
            timestamp=t_kill,
            service_id="orders",
            event_type="FAILURE_INJECTED",
            source="chronos-control",
            payload={"action": "kill", "target": "payment"},
            severity="WARNING",
        )
    )
    save_event(
        ChronosEvent(
            run_id=run_id,
            timestamp=t_req_start,
            service_id="orders",
            event_type="REQUEST_START",
            source="orders-api",
            payload={"order_id": 101},
            severity="INFO",
        )
    )
    update_run_status(run_id, status="COMPLETED", completed_at=t_req_end)

    run_res = client.get(f"/runs/{run_id}")
    assert run_res.status_code == 200
    run_data = run_res.json()
    assert run_data["started_at"].endswith(("Z", "+00:00"))
    assert run_data["completed_at"].endswith(("Z", "+00:00"))

    events_res = client.get(f"/runs/{run_id}/events")
    assert events_res.status_code == 200
    events_data = events_res.json()
    assert [e["event_type"] for e in events_data] == [
        "FAILURE_INJECTED",
        "REQUEST_START",
        "REQUEST_END",
    ]
    for evt in events_data:
        assert evt["timestamp"].endswith(("Z", "+00:00"))

    parsed_start = datetime.fromisoformat(events_data[1]["timestamp"].replace("Z", "+00:00"))
    parsed_end = datetime.fromisoformat(events_data[2]["timestamp"].replace("Z", "+00:00"))
    assert round((parsed_end - parsed_start).total_seconds() * 1000) == 34


def test_compose_configs_use_payment_health_and_safe_restart_policy():
    """Verify both local and production Compose configs probe Payment /health and keep payment restart='no'."""
    from pathlib import Path
    import re

    backend_dir = Path(__file__).resolve().parents[1]
    compose_files = [
        backend_dir / "docker-compose.yml",
        backend_dir / "deploy" / "compose.prod.yml",
    ]
    for compose_path in compose_files:
        text = compose_path.read_text(encoding="utf-8")
        payment_match = re.search(
            r"(?ms)^  payment:\n(.*?)(?=^  [a-zA-Z0-9_-]+:|\Z)", text
        )
        assert payment_match is not None, f"Missing payment service block in {compose_path}"
        payment_block = payment_match.group(1)
        assert "http://localhost:8001/health" in payment_block
        assert "http://localhost:8001/docs" not in payment_block

    prod_text = (backend_dir / "deploy" / "compose.prod.yml").read_text(encoding="utf-8")
    prod_payment = re.search(
        r"(?ms)^  payment:\n(.*?)(?=^  [a-zA-Z0-9_-]+:|\Z)", prod_text
    ).group(1)
    assert 'restart: "no"' in prod_payment
    for resilient_svc in ("postgres", "orders", "failure-controller"):
        svc_block = re.search(
            rf"(?ms)^  {resilient_svc}:\n(.*?)(?=^  [a-zA-Z0-9_-]+:|\Z)", prod_text
        ).group(1)
        assert "restart: unless-stopped" in svc_block
