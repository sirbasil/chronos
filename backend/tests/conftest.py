import pytest
from database import init_db


@pytest.fixture(scope="session", autouse=True)
def setup_database():
    """Ensure database schema is initialized before any tests run."""
    init_db()


@pytest.fixture(autouse=True)
def auth_dependency_override(request):
    """
    For non-authentication test suites, override get_current_user and require_operator_or_admin
    with a test operator user so business-logic tests (orders, runs, topology, failure injection)
    continue to execute seamlessly without weakening production security.
    Authentication-specific tests in test_cognito_jwt.py bypass this override.
    """
    if "test_cognito_jwt" not in request.node.nodeid:
        from server_fastapi import app
        from auth import get_current_user, require_operator_or_admin, AuthenticatedUser

        test_user = AuthenticatedUser(
            sub="test-sub-1234",
            username="test-operator@chronos.local",
            groups=["chronos-admins", "chronos-operators"],
            client_id="test-client-id",
            scope="openid email profile",
            raw_claims={"sub": "test-sub-1234"},
        )
        app.dependency_overrides[get_current_user] = lambda: test_user
        app.dependency_overrides[require_operator_or_admin] = lambda: test_user
        try:
            yield
        finally:
            app.dependency_overrides.pop(get_current_user, None)
            app.dependency_overrides.pop(require_operator_or_admin, None)
    else:
        yield

