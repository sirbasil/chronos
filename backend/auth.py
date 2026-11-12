"""
Cognito JWT authentication and role-based authorization for CHRONOS.
Validates RS256 access tokens against Amazon Cognito User Pool JWKS.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import logging
import os
import threading
import time
from typing import Any, Optional

from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import jwt
from jwt.algorithms import RSAAlgorithm
from pydantic import BaseModel
import requests

logger = logging.getLogger(__name__)


def _load_env_file() -> None:
    """Load variables from .env file if present and not already set in os.environ."""
    candidates = [
        os.path.join(os.getcwd(), ".env"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"),
    ]
    for env_path in candidates:
        if os.path.exists(env_path):
            try:
                with open(env_path, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith("#") and "=" in line:
                            k, v = line.split("=", 1)
                            k = k.strip()
                            v = v.strip().strip("'\"")
                            if k not in os.environ:
                                os.environ[k] = v
                break
            except Exception:
                pass


_load_env_file()


@dataclass
class CognitoSettings:
    app_env: str = field(default_factory=lambda: os.environ.get("APP_ENV", "development").lower())
    region: str = field(default_factory=lambda: os.environ.get("COGNITO_REGION", "ap-south-1"))
    user_pool_id: str = field(default_factory=lambda: os.environ.get("COGNITO_USER_POOL_ID", ""))
    user_pool_client_id: str = field(default_factory=lambda: os.environ.get("COGNITO_USER_POOL_CLIENT_ID", ""))
    admin_group: str = field(default_factory=lambda: os.environ.get("COGNITO_ADMIN_GROUP", "chronos-admins"))
    operator_group: str = field(default_factory=lambda: os.environ.get("COGNITO_OPERATOR_GROUP", "chronos-operators"))

    @property
    def expected_issuer(self) -> str:
        return f"https://cognito-idp.{self.region}.amazonaws.com/{self.user_pool_id}"

    @property
    def jwks_url(self) -> str:
        return f"{self.expected_issuer}/.well-known/jwks.json"

    @property
    def is_configured(self) -> bool:
        return bool(self.user_pool_id and self.user_pool_client_id and self.region)


settings = CognitoSettings()


class AuthenticatedUser(BaseModel):
    sub: str
    username: str
    groups: list[str] = []
    client_id: str
    scope: str = ""
    raw_claims: dict[str, Any] = {}


# Thread-safe JWKS cache
_jwks_cache_lock = threading.Lock()
_cached_jwks_keys: dict[str, Any] = {}
_cached_jwks_timestamp: float = 0.0
JWKS_CACHE_TTL_SECONDS = 3600  # 1 hour


def validate_cognito_config() -> None:
    """
    Validate Cognito configuration on application startup.
    Fails startup in production if credentials/pool IDs are missing.
    In development, allows app to start but protected endpoints will fail closed.
    """
    if settings.app_env == "production":
        if not settings.is_configured:
            raise RuntimeError(
                "CRITICAL: Production environment requires COGNITO_USER_POOL_ID, "
                "COGNITO_USER_POOL_CLIENT_ID, and COGNITO_REGION to be configured."
            )
        logger.info("Cognito authentication configured for production pool: %s", settings.user_pool_id)
    else:
        if not settings.is_configured:
            logger.warning(
                "Cognito authentication is unconfigured in development. "
                "Protected endpoints will fail closed with HTTP 503."
            )
        else:
            logger.info("Cognito authentication configured for development pool: %s", settings.user_pool_id)


def fetch_jwks_keys(force_refresh: bool = False, custom_jwks_url: Optional[str] = None) -> dict[str, Any]:
    """
    Fetch and cache JWKS public keys from Cognito.
    Supports force_refresh for key rotation when an unknown kid is encountered.
    """
    global _cached_jwks_keys, _cached_jwks_timestamp

    now = time.time()
    url = custom_jwks_url or settings.jwks_url

    with _jwks_cache_lock:
        if not force_refresh and _cached_jwks_keys and (now - _cached_jwks_timestamp < JWKS_CACHE_TTL_SECONDS):
            return _cached_jwks_keys

        try:
            resp = requests.get(url, timeout=5)
            resp.raise_for_status()
            data = resp.json()
            keys_dict: dict[str, Any] = {}
            for key_data in data.get("keys", []):
                kid = key_data.get("kid")
                if kid:
                    keys_dict[kid] = key_data

            if not keys_dict:
                raise ValueError("JWKS response contained no valid keys")

            _cached_jwks_keys = keys_dict
            _cached_jwks_timestamp = now
            logger.info("Successfully fetched %d keys from JWKS (%s)", len(_cached_jwks_keys), url)
            return _cached_jwks_keys

        except Exception as err:
            logger.error("Failed to fetch JWKS keys from %s: %s", url, err)
            # If we already have cached keys, fallback to cached keys
            if _cached_jwks_keys:
                logger.warning("Using stale cached JWKS keys following fetch error")
                return _cached_jwks_keys
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Authentication service unavailable: Unable to fetch JWKS keys ({err})",
            )


def verify_cognito_access_token(
    token: str,
    override_jwks: Optional[dict[str, Any]] = None,
    override_issuer: Optional[str] = None,
    override_client_id: Optional[str] = None,
) -> AuthenticatedUser:
    """
    Cryptographically verify an Amazon Cognito access token.

    Validates:
    - RS256 algorithm
    - RSA signature matching kid in JWKS
    - Issuer (iss)
    - Expiration (exp) and Not-Before (nbf)
    - Subject (sub)
    - token_use == 'access' (rejects ID tokens)
    - client_id == configured client ID (note: access tokens use client_id, not aud)
    """
    if not token or not token.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or empty authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 1. Inspect unverified headers to identify algorithm and key id
    try:
        headers = jwt.get_unverified_header(token)
    except jwt.PyJWTError as err:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Malformed token header: {err}",
            headers={"WWW-Authenticate": "Bearer"},
        )

    alg = headers.get("alg")
    if alg != "RS256":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token algorithm '{alg}', expected RS256",
            headers={"WWW-Authenticate": "Bearer"},
        )

    kid = headers.get("kid")
    if not kid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token header missing 'kid' (key identifier)",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 2. Retrieve public key
    jwks_keys = override_jwks or fetch_jwks_keys()
    if kid not in jwks_keys:
        # Key rotation check: force refresh JWKS once
        if not override_jwks:
            jwks_keys = fetch_jwks_keys(force_refresh=True)

        if kid not in jwks_keys:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Invalid token: key id '{kid}' not found in JWKS",
                headers={"WWW-Authenticate": "Bearer"},
            )

    key_dict = jwks_keys[kid]
    try:
        public_key = RSAAlgorithm.from_jwk(key_dict)
    except Exception as err:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Failed to construct public key from JWK: {err}",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 3. Cryptographically verify signature, expiration, and issuer
    expected_issuer = override_issuer or settings.expected_issuer
    expected_client_id = override_client_id or settings.user_pool_client_id

    try:
        # Note: verify_aud=False because Cognito access tokens do NOT contain 'aud';
        # they contain 'client_id' which is verified explicitly below.
        payload = jwt.decode(
            token,
            public_key,
            algorithms=["RS256"],
            issuer=expected_issuer,
            options={
                "verify_signature": True,
                "verify_exp": True,
                "verify_nbf": True,
                "verify_iat": True,
                "verify_aud": False,
            },
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token has expired",
            headers={"WWW-Authenticate": "Bearer error=\"invalid_token\", error_description=\"token has expired\""},
        )
    except jwt.InvalidIssuerError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token issuer",
            headers={"WWW-Authenticate": "Bearer error=\"invalid_token\", error_description=\"invalid issuer\""},
        )
    except jwt.PyJWTError as err:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Token verification failed: {err}",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 4. Enforce access token requirements (reject ID tokens)
    token_use = payload.get("token_use")
    if token_use != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token_use '{token_use}': Cognito access token required",
            headers={"WWW-Authenticate": "Bearer error=\"invalid_token\", error_description=\"access token required\""},
        )

    # 5. Enforce client_id match
    token_client_id = payload.get("client_id")
    if not token_client_id or token_client_id != expected_client_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: client ID mismatch (got '{token_client_id}')",
            headers={"WWW-Authenticate": "Bearer error=\"invalid_token\", error_description=\"client id mismatch\""},
        )

    # 6. Verify sub claim
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing required 'sub' (subject) claim",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Extract user identity and groups
    username = payload.get("username") or payload.get("cognito:username") or str(sub)
    groups = payload.get("cognito:groups") or []
    if isinstance(groups, str):
        groups = [groups]

    scope = payload.get("scope", "")

    return AuthenticatedUser(
        sub=str(sub),
        username=str(username),
        groups=list(groups),
        client_id=str(token_client_id),
        scope=str(scope),
        raw_claims=payload,
    )


# FastAPI Security Bearer scheme
bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(bearer_scheme),
) -> AuthenticatedUser:
    """
    FastAPI dependency for endpoints requiring an authenticated user.
    Fails closed with 503 if Cognito is unconfigured in development.
    Fails closed with 401 if token is missing or invalid.
    """
    if not settings.is_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service unconfigured",
        )

    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return verify_cognito_access_token(credentials.credentials)


def _verify_group_membership(
    user: AuthenticatedUser,
    allowed_groups: list[str],
    action_label: str,
) -> AuthenticatedUser:
    """Enforce membership in at least one allowed Cognito group from verified token claims."""
    user_groups = set(user.groups)
    if not user_groups.intersection(allowed_groups):
        logger.warning(
            "User '%s' (sub: %s) denied access to %s. Groups: %s, Required: %s",
            user.username,
            user.sub,
            action_label,
            user.groups,
            allowed_groups,
        )
        required_desc = " or ".join(f"'{group}'" for group in allowed_groups)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Forbidden: Action requires membership in {required_desc}",
        )
    return user


async def require_operator_or_admin(
    user: AuthenticatedUser = Depends(get_current_user),
) -> AuthenticatedUser:
    """
    FastAPI dependency requiring membership in 'chronos-admins' or 'chronos-operators'.
    Reads groups exclusively from verified token claims.
    """
    return _verify_group_membership(
        user,
        [settings.admin_group, settings.operator_group],
        "operator action",
    )


async def require_admin(
    user: AuthenticatedUser = Depends(get_current_user),
) -> AuthenticatedUser:
    """
    FastAPI dependency requiring membership in 'chronos-admins'.
    Reads groups exclusively from verified Cognito JWT claims.
    """
    return _verify_group_membership(
        user,
        [settings.admin_group],
        "admin action",
    )
