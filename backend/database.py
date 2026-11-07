"""
Database persistence module for CHRONOS runs and normalized events.
Connects to PostgreSQL using psycopg.
"""

from contextlib import contextmanager
from datetime import datetime, timezone
import os
from typing import Any
from uuid import UUID

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from event_schema import ChronosEvent


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


def get_db_connection_params() -> dict[str, Any] | str:
    """Return database connection parameters or connection string from environment."""
    _load_env_file()
    if "DATABASE_URL" in os.environ:
        return os.environ["DATABASE_URL"]

    return {
        "host": os.environ.get("POSTGRES_HOST", "127.0.0.1"),
        "port": int(os.environ.get("POSTGRES_PORT", "5432")),
        "user": os.environ.get("POSTGRES_USER", "chronos"),
        "password": os.environ.get("POSTGRES_PASSWORD", "changeme"),
        "dbname": os.environ.get("POSTGRES_DB", "chronos"),
    }


@contextmanager
def get_db_connection(autocommit: bool = True):
    """Context manager for obtaining a database connection with dict_row factory."""
    params = get_db_connection_params()
    if isinstance(params, str):
        conn = psycopg.connect(params, row_factory=dict_row, autocommit=autocommit)
    else:
        conn = psycopg.connect(**params, row_factory=dict_row, autocommit=autocommit)
    try:
        yield conn
    finally:
        conn.close()


CREATE_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS runs (
    run_id UUID PRIMARY KEY,
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    status VARCHAR(50) NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
    event_id UUID PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ NOT NULL,
    service_id VARCHAR(100) NOT NULL,
    trace_id VARCHAR(100),
    event_type VARCHAR(100) NOT NULL,
    source VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    severity VARCHAR(50) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_run_id ON events (run_id);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events (timestamp);
CREATE INDEX IF NOT EXISTS idx_events_run_id_timestamp ON events (run_id, timestamp);
"""


def init_db() -> None:
    """Initialize database tables and indexes."""
    with get_db_connection(autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(CREATE_TABLES_SQL)


def create_run(
    run_id: UUID | str,
    started_at: datetime | None = None,
    status: str = "IN_PROGRESS"
) -> dict[str, Any]:
    """Create a new run record in PostgreSQL."""
    if isinstance(run_id, str):
        run_id = UUID(run_id)
    if started_at is None:
        started_at = datetime.now(timezone.utc)
    with get_db_connection(autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO runs (run_id, started_at, status)
                VALUES (%s, %s, %s)
                RETURNING run_id, started_at, completed_at, status;
                """,
                (run_id, started_at, status),
            )
            return cur.fetchone()


def update_run_status(
    run_id: UUID | str,
    status: str,
    completed_at: datetime | None = None
) -> dict[str, Any] | None:
    """Update status and completion time of a run record."""
    if isinstance(run_id, str):
        run_id = UUID(run_id)
    if completed_at is None:
        completed_at = datetime.now(timezone.utc)
    with get_db_connection(autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE runs
                SET status = %s, completed_at = %s
                WHERE run_id = %s
                RETURNING run_id, started_at, completed_at, status;
                """,
                (status, completed_at, run_id),
            )
            return cur.fetchone()


def get_run(run_id: UUID | str) -> dict[str, Any] | None:
    """Retrieve run record by run_id."""
    if isinstance(run_id, str):
        run_id = UUID(run_id)
    with get_db_connection(autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT run_id, started_at, completed_at, status FROM runs WHERE run_id = %s;",
                (run_id,),
            )
            return cur.fetchone()


def list_runs(limit: int = 50) -> list[dict[str, Any]]:
    """Retrieve recent runs ordered by started_at DESC."""
    with get_db_connection(autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT run_id, started_at, completed_at, status
                FROM runs
                ORDER BY started_at DESC
                LIMIT %s;
                """,
                (limit,),
            )
            return cur.fetchall()



def save_event(event: ChronosEvent) -> None:
    """Persist a single ChronosEvent in PostgreSQL."""
    with get_db_connection(autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO events (
                    event_id, run_id, timestamp, service_id, trace_id, event_type, source, payload, severity
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s
                );
                """,
                (
                    event.event_id,
                    event.run_id,
                    event.timestamp,
                    event.service_id,
                    event.trace_id,
                    event.event_type,
                    event.source,
                    Jsonb(event.payload),
                    event.severity,
                ),
            )


def get_events_by_run(run_id: UUID | str) -> list[ChronosEvent]:
    """Retrieve all events for a run ordered chronologically."""
    if isinstance(run_id, str):
        run_id = UUID(run_id)
    with get_db_connection(autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT event_id, run_id, timestamp, service_id, trace_id, event_type, source, payload, severity
                FROM events
                WHERE run_id = %s
                ORDER BY timestamp ASC, event_id ASC;
                """,
                (run_id,),
            )
            rows = cur.fetchall()
            return [ChronosEvent(**row) for row in rows]

