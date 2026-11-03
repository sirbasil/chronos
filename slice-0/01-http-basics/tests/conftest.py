import pytest
from database import init_db


@pytest.fixture(scope="session", autouse=True)
def setup_database():
    """Ensure database schema is initialized before any tests run."""
    init_db()

