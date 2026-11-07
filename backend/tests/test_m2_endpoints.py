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


def test_parse_cors_origins_defaults():
    assert parse_cors_origins(None) == DEFAULT_ALLOWED_ORIGINS
    assert parse_cors_origins("") == DEFAULT_ALLOWED_ORIGINS
    assert parse_cors_origins("   ") == DEFAULT_ALLOWED_ORIGINS


def test_parse_cors_origins_custom_and_whitespace():
    raw = " https://main.d12345.amplifyapp.com, http://localhost:1420/ , , https://chronos.example.com "
    parsed = parse_cors_origins(raw)
    assert parsed == [
        "https://main.d12345.amplifyapp.com",
        "http://localhost:1420",
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
    """Verify preflight with all explicit permitted headers."""
    response = client.options(
        "/runs",
        headers={
            "Origin": "http://localhost:1420",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Authorization, Content-Type, Accept, X-Run-ID",
        },
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:1420"
    allow_headers = response.headers.get("access-control-allow-headers", "").lower()
    for h in ["authorization", "content-type", "accept", "x-run-id"]:
        assert h in allow_headers


def test_cors_with_configured_amplify_origin():
    """Verify that a dynamically configured Amplify origin permits CORS requests."""
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware

    amplify_origin = "https://main.d123456.amplifyapp.com"
    test_origins = parse_cors_origins(f"http://localhost:1420, {amplify_origin}")

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
