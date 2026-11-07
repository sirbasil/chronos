from uuid import uuid4
from fastapi.testclient import TestClient
from server_fastapi import app
from database import create_run

client = TestClient(app)


def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "timestamp" in data
    assert data["database"] == "connected"


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
    for dev_origin in ["http://localhost:1420", "http://127.0.0.1:1420"]:
        response = client.options(
            "/runs",
            headers={
                "Origin": dev_origin,
                "Access-Control-Request-Method": "GET",
            },
        )
        assert response.status_code == 200
        assert response.headers.get("access-control-allow-origin") == dev_origin


def test_cors_preflight_production_tauri_origin():
    """Verify that OPTIONS preflight succeeds for the production Windows Tauri origin with frontend headers."""
    prod_origin = "http://tauri.localhost"
    response = client.options(
        "/runs",
        headers={
            "Origin": prod_origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Accept",
        },
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == prod_origin
    assert "GET" in response.headers.get("access-control-allow-methods", "")
    # Verify uncredentialed requests: no allow-credentials header is sent when allow_credentials=False
    assert response.headers.get("access-control-allow-credentials") is None


def test_cors_get_production_tauri_origin():
    """Verify that actual GET requests are permitted from the production Tauri origin."""
    prod_origin = "http://tauri.localhost"
    response = client.get(
        "/health",
        headers={"Origin": prod_origin, "Accept": "application/json"},
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == prod_origin


def test_cors_disallows_untrusted_wildcard_origins():
    """Verify that untrusted origins are NOT permitted and wildcard CORS is not used."""
    for disallowed_origin in ["http://malicious-site.example.com", "tauri://localhost"]:
        response = client.options(
            "/runs",
            headers={
                "Origin": disallowed_origin,
                "Access-Control-Request-Method": "GET",
            },
        )
        # FastAPI CORSMiddleware does not return Access-Control-Allow-Origin for disallowed origins
        assert response.headers.get("access-control-allow-origin") is None
