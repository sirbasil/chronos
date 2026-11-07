"""
Comprehensive security unit and integration tests for CHRONOS Amazon Cognito JWT verification
and role-based route protection.

Tests:
- Valid access token decoding and claim extraction
- Missing token (HTTP 401)
- Malformed token (HTTP 401)
- Invalid signature (HTTP 401)
- Expired token (HTTP 401)
- Incorrect issuer (HTTP 401)
- Incorrect client ID (HTTP 401)
- ID token rejected (token_use == 'id') (HTTP 401)
- Missing required claims ('sub') (HTTP 401)
- Correct group authorization (chronos-admins / chronos-operators allowed on failure endpoint)
- Unauthorized group rejected (HTTP 403 on failure endpoint)
- Protected routes reject unauthenticated requests (HTTP 401)
- Public routes allow unauthenticated requests (HTTP 200)
- Production startup failure when unconfigured
- Development unconfigured fail-closed behavior (HTTP 503)
- JWKS failure behavior (HTTP 503 when JWKS unavailable)
"""

import json
import time
from unittest.mock import MagicMock, patch
from uuid import uuid4
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
import jwt
from jwt.algorithms import RSAAlgorithm

from auth import (
    AuthenticatedUser,
    CognitoSettings,
    settings,
    validate_cognito_config,
    verify_cognito_access_token,
)
from database import create_run
from server_fastapi import app

client = TestClient(app)

TEST_REGION = "ap-south-1"
TEST_USER_POOL_ID = "ap-south-1_tDVeeHq0g"
TEST_CLIENT_ID = "4268fo6vpodgv8dt37tim2aec3"
TEST_KID = "chronos-mock-key-01"
TEST_ISSUER = f"https://cognito-idp.{TEST_REGION}.amazonaws.com/{TEST_USER_POOL_ID}"


@pytest.fixture(scope="module")
def rsa_keys():
    """Generate RSA 2048-bit keypair for mocking Cognito JWKS."""
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_key = private_key.public_key()
    jwk_dict = json.loads(RSAAlgorithm.to_jwk(public_key))
    jwk_dict["kid"] = TEST_KID
    jwk_dict["use"] = "sig"
    jwk_dict["alg"] = "RS256"

    # Also generate an unrelated keypair to test signature mismatch
    wrong_private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    return {
        "private_key": private_key,
        "public_key": public_key,
        "jwk_dict": jwk_dict,
        "wrong_private_key": wrong_private_key,
    }


@pytest.fixture(scope="module")
def mock_jwks(rsa_keys):
    return {TEST_KID: rsa_keys["jwk_dict"]}


@pytest.fixture(autouse=True)
def configure_test_cognito_settings():
    """Ensure settings are configured with valid test parameters during test execution."""
    orig_env = settings.app_env
    orig_region = settings.region
    orig_pool = settings.user_pool_id
    orig_client = settings.user_pool_client_id

    settings.app_env = "test"
    settings.region = TEST_REGION
    settings.user_pool_id = TEST_USER_POOL_ID
    settings.user_pool_client_id = TEST_CLIENT_ID

    yield

    settings.app_env = orig_env
    settings.region = orig_region
    settings.user_pool_id = orig_pool
    settings.user_pool_client_id = orig_client


def make_token(
    rsa_keys,
    sub: str = "3a08891d-5561-70f9-a29d-47817eb23d0c",
    username: str = "operator@chronos.local",
    client_id: str = TEST_CLIENT_ID,
    issuer: str = TEST_ISSUER,
    token_use: str = "access",
    groups: list[str] | None = None,
    scope: str = "openid email profile",
    expires_in: int = 3600,
    kid: str = TEST_KID,
    use_wrong_key: bool = False,
    extra_claims: dict | None = None,
) -> str:
    """Helper to generate RS256 signed Cognito access tokens."""
    now = int(time.time())
    payload = {
        "sub": sub,
        "cognito:username": username,
        "client_id": client_id,
        "iss": issuer,
        "token_use": token_use,
        "scope": scope,
        "auth_time": now,
        "iat": now,
        "exp": now + expires_in,
        "jti": str(uuid4()),
    }
    if groups is not None:
        payload["cognito:groups"] = groups
    if extra_claims:
        payload.update(extra_claims)

    key = rsa_keys["wrong_private_key"] if use_wrong_key else rsa_keys["private_key"]
    return jwt.encode(payload, key, algorithm="RS256", headers={"kid": kid})


# ===========================================================================
# 1. Direct Token Verification Tests
# ===========================================================================

def test_verify_valid_access_token(rsa_keys, mock_jwks):
    """A well-formed, unexpired Cognito access token verifies successfully."""
    token = make_token(rsa_keys, groups=["chronos-operators"])
    user = verify_cognito_access_token(token, override_jwks=mock_jwks)

    assert user.sub == "3a08891d-5561-70f9-a29d-47817eb23d0c"
    assert user.username == "operator@chronos.local"
    assert user.groups == ["chronos-operators"]
    assert user.client_id == TEST_CLIENT_ID


def test_verify_missing_token_raises_401():
    """Empty or None token raises HTTP 401."""
    with pytest.raises(Exception) as excinfo:
        verify_cognito_access_token("")
    assert excinfo.value.status_code == 401
    assert "Missing or empty" in excinfo.value.detail


def test_verify_malformed_token_raises_401(mock_jwks):
    """Nonsense token string raises HTTP 401."""
    with pytest.raises(Exception) as excinfo:
        verify_cognito_access_token("this.is.not.a.valid.jwt", override_jwks=mock_jwks)
    assert excinfo.value.status_code == 401


def test_verify_invalid_signature_raises_401(rsa_keys, mock_jwks):
    """Token signed with wrong key raises HTTP 401."""
    token = make_token(rsa_keys, use_wrong_key=True)
    with pytest.raises(Exception) as excinfo:
        verify_cognito_access_token(token, override_jwks=mock_jwks)
    assert excinfo.value.status_code == 401
    assert "verification failed" in excinfo.value.detail.lower()


def test_verify_expired_token_raises_401(rsa_keys, mock_jwks):
    """Expired token raises HTTP 401."""
    token = make_token(rsa_keys, expires_in=-120)
    with pytest.raises(Exception) as excinfo:
        verify_cognito_access_token(token, override_jwks=mock_jwks)
    assert excinfo.value.status_code == 401
    assert "expired" in excinfo.value.detail.lower()


def test_verify_incorrect_issuer_raises_401(rsa_keys, mock_jwks):
    """Token with invalid issuer raises HTTP 401."""
    token = make_token(rsa_keys, issuer="https://cognito-idp.us-east-1.amazonaws.com/us-east-1_wrong")
    with pytest.raises(Exception) as excinfo:
        verify_cognito_access_token(token, override_jwks=mock_jwks)
    assert excinfo.value.status_code == 401
    assert "issuer" in excinfo.value.detail.lower()


def test_verify_incorrect_client_id_raises_401(rsa_keys, mock_jwks):
    """Token issued for a different client ID raises HTTP 401."""
    token = make_token(rsa_keys, client_id="unauthorized-client-id-12345")
    with pytest.raises(Exception) as excinfo:
        verify_cognito_access_token(token, override_jwks=mock_jwks)
    assert excinfo.value.status_code == 401
    assert "client id mismatch" in excinfo.value.detail.lower()


def test_verify_id_token_rejected_raises_401(rsa_keys, mock_jwks):
    """ID token with token_use='id' is strictly rejected with HTTP 401."""
    token = make_token(rsa_keys, token_use="id")
    with pytest.raises(Exception) as excinfo:
        verify_cognito_access_token(token, override_jwks=mock_jwks)
    assert excinfo.value.status_code == 401
    assert "access token required" in excinfo.value.detail.lower()


def test_verify_missing_sub_claim_raises_401(rsa_keys, mock_jwks):
    """Token missing 'sub' claim raises HTTP 401."""
    now = int(time.time())
    payload = {
        "cognito:username": "operator",
        "client_id": TEST_CLIENT_ID,
        "iss": TEST_ISSUER,
        "token_use": "access",
        "exp": now + 3600,
        "iat": now,
    }
    token = jwt.encode(payload, rsa_keys["private_key"], algorithm="RS256", headers={"kid": TEST_KID})
    with pytest.raises(Exception) as excinfo:
        verify_cognito_access_token(token, override_jwks=mock_jwks)
    assert excinfo.value.status_code == 401
    assert "missing required 'sub'" in excinfo.value.detail.lower()


def test_verify_unknown_kid_triggers_refresh_and_fails_if_still_unknown(rsa_keys):
    """When a token has an unknown kid, fetch_jwks_keys is refreshed; if not found, 401 is raised."""
    token = make_token(rsa_keys, kid="unknown-key-999")
    with patch("auth.fetch_jwks_keys", return_value={TEST_KID: rsa_keys["jwk_dict"]}) as mock_fetch:
        with pytest.raises(Exception) as excinfo:
            verify_cognito_access_token(token)
        assert excinfo.value.status_code == 401
        assert "not found in jwks" in excinfo.value.detail.lower()


# ===========================================================================
# 2. Public vs Protected Route Policy Tests
# ===========================================================================

def test_public_routes_allow_unauthenticated():
    """GET / and GET /health must allow unauthenticated requests."""
    resp_root = client.get("/")
    assert resp_root.status_code == 200

    resp_health = client.get("/health")
    assert resp_health.status_code == 200
    assert resp_health.json()["status"] in ["ok", "degraded"]


def test_protected_routes_reject_unauthenticated():
    """Endpoints requiring authentication return HTTP 401 when no token is supplied."""
    run_id = uuid4()
    protected_endpoints = [
        ("GET", "/orders"),
        ("GET", "/orders/101"),
        ("POST", "/orders/101/checkout"),
        ("GET", "/runs"),
        ("POST", "/runs"),
        ("GET", f"/runs/{run_id}"),
        ("GET", f"/runs/{run_id}/events"),
        ("GET", f"/runs/{run_id}/topology"),
        ("POST", f"/runs/{run_id}/failure"),
    ]

    for method, path in protected_endpoints:
        if method == "GET":
            res = client.get(path)
        else:
            res = client.post(path, json={"target": "payment"})
        assert res.status_code == 401, f"Expected 401 for unauthenticated {method} {path}, got {res.status_code}"
        assert "WWW-Authenticate" in res.headers


# ===========================================================================
# 3. Authenticated Route Access Tests
# ===========================================================================

def test_protected_route_succeeds_with_valid_token(rsa_keys, mock_jwks):
    """Authenticated user with valid access token can read protected endpoints."""
    token = make_token(rsa_keys, groups=[])
    with patch("auth.fetch_jwks_keys", return_value=mock_jwks):
        resp = client.get("/orders", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        assert resp.json()["message"] == "Orders service"


# ===========================================================================
# 4. Role-Based Authorization Tests for Failure Injection Endpoint
# ===========================================================================

def test_failure_endpoint_rejects_user_without_operator_or_admin_group(rsa_keys, mock_jwks):
    """Authenticated user without chronos-admins or chronos-operators gets HTTP 403 on failure injection."""
    token = make_token(rsa_keys, groups=["chronos-viewers"])
    run_id = uuid4()
    create_run(run_id, status="IN_PROGRESS")

    with patch("auth.fetch_jwks_keys", return_value=mock_jwks):
        resp = client.post(
            f"/runs/{run_id}/failure",
            headers={"Authorization": f"Bearer {token}"},
            json={"target": "payment"},
        )
        assert resp.status_code == 403
        assert "Forbidden" in resp.json()["detail"]
        assert "chronos-operators" in resp.json()["detail"]


def test_failure_endpoint_rejects_user_with_empty_groups(rsa_keys, mock_jwks):
    """Authenticated user with no groups gets HTTP 403 on failure injection."""
    token = make_token(rsa_keys, groups=[])
    run_id = uuid4()
    create_run(run_id, status="IN_PROGRESS")

    with patch("auth.fetch_jwks_keys", return_value=mock_jwks):
        resp = client.post(
            f"/runs/{run_id}/failure",
            headers={"Authorization": f"Bearer {token}"},
            json={"target": "payment"},
        )
        assert resp.status_code == 403


def test_failure_endpoint_permits_operator_group(rsa_keys, mock_jwks):
    """User in chronos-operators passes auth dependency on failure injection."""
    token = make_token(rsa_keys, groups=["chronos-operators"])
    run_id = uuid4()
    create_run(run_id, status="IN_PROGRESS")

    with patch("auth.fetch_jwks_keys", return_value=mock_jwks):
        # Mock inject_failure so we don't attempt live Docker manipulation
        with patch("server_fastapi.inject_failure", return_value={"status": "SIMULATED", "target": "payment", "action": "SIGKILL"}):
            resp = client.post(
                f"/runs/{run_id}/failure",
                headers={"Authorization": f"Bearer {token}"},
                json={"target": "payment"},
            )
            assert resp.status_code == 200
            assert resp.json()["status"] == "SIMULATED"


def test_failure_endpoint_permits_admin_group(rsa_keys, mock_jwks):
    """User in chronos-admins passes auth dependency on failure injection."""
    token = make_token(rsa_keys, groups=["chronos-admins"])
    run_id = uuid4()
    create_run(run_id, status="IN_PROGRESS")

    with patch("auth.fetch_jwks_keys", return_value=mock_jwks):
        with patch("server_fastapi.inject_failure", return_value={"status": "SIMULATED", "target": "payment", "action": "SIGKILL"}):
            resp = client.post(
                f"/runs/{run_id}/failure",
                headers={"Authorization": f"Bearer {token}"},
                json={"target": "payment"},
            )
            assert resp.status_code == 200
            assert resp.json()["status"] == "SIMULATED"


# ===========================================================================
# 5. Configuration & JWKS Availability Failure Tests
# ===========================================================================

def test_production_startup_fails_without_cognito_config():
    """In production, missing Cognito configuration raises RuntimeError during startup."""
    unconfigured_settings = CognitoSettings(
        app_env="production",
        region="ap-south-1",
        user_pool_id="",
        user_pool_client_id="",
    )
    with patch("auth.settings", unconfigured_settings):
        with pytest.raises(RuntimeError) as excinfo:
            validate_cognito_config()
        assert "CRITICAL: Production environment requires" in str(excinfo.value)


def test_development_unconfigured_fails_closed_with_503():
    """In development, if Cognito is unconfigured, protected endpoints fail closed with HTTP 503."""
    unconfigured_settings = CognitoSettings(
        app_env="development",
        region="ap-south-1",
        user_pool_id="",
        user_pool_client_id="",
    )
    with patch("auth.settings", unconfigured_settings):
        resp = client.get("/orders", headers={"Authorization": "Bearer some-token"})
        assert resp.status_code == 503
        assert "Authentication service unconfigured" in resp.json()["detail"]


def test_jwks_unavailable_returns_503(rsa_keys):
    """When Cognito JWKS is unreachable and no cached keys exist, return HTTP 503."""
    import requests
    token = make_token(rsa_keys)

    with patch("requests.get", side_effect=requests.RequestException("Connection refused")):
        with patch("auth._cached_jwks_keys", {}):
            resp = client.get("/orders", headers={"Authorization": f"Bearer {token}"})
            assert resp.status_code == 503
            assert "Unable to fetch JWKS keys" in resp.json()["detail"]
