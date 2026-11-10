import os
import sys
import pytest

# ---------------------------------------------------------------------------
# CRITICAL TEST ISOLATION GUARD: Force tests exclusively to chronos_test
# ---------------------------------------------------------------------------
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

os.environ["POSTGRES_DB"] = "chronos_test"
if "DATABASE_URL" in os.environ:
    db_url = os.environ["DATABASE_URL"]
    if "chronos_test" not in db_url:
        parts = db_url.rsplit("/", 1)
        os.environ["DATABASE_URL"] = f"{parts[0]}/chronos_test"

from database import get_db_connection, get_db_connection_params, init_db


def pytest_configure(config):
    """
    Fail-closed guard: Verify that the test suite is strictly bound to 'chronos_test'.
    Aborts test execution immediately if any other database (such as development or production) is targeted.
    """
    params = get_db_connection_params()
    dbname = params.get("dbname") if isinstance(params, dict) else str(params)
    if "chronos_test" not in str(dbname):
        raise RuntimeError(
            f"CRITICAL TEST GUARD VIOLATION: pytest is configured to connect to '{dbname}', NOT 'chronos_test'! "
            "Tests are strictly forbidden from connecting to development or production databases."
        )


@pytest.fixture(scope="session", autouse=True)
def setup_database():
    """Ensure database schema is initialized on chronos_test before any tests run."""
    # Ensure chronos_test DB exists (create if needed via maintenance connection)
    params = get_db_connection_params()
    if isinstance(params, dict):
        import psycopg
        maint_params = dict(params)
        maint_params["dbname"] = "chronos"
        try:
            with psycopg.connect(**maint_params, autocommit=True) as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1 FROM pg_database WHERE datname = 'chronos_test'")
                    if not cur.fetchone():
                        cur.execute("CREATE DATABASE chronos_test")
        except Exception:
            pass

    init_db()


@pytest.fixture(autouse=True)
def clean_test_database():
    """Isolate tests by truncating runs and cascade events before each test runs."""
    try:
        with get_db_connection(autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute("TRUNCATE TABLE runs CASCADE;")
    except Exception:
        pass
    yield


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

