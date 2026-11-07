from contextlib import asynccontextmanager
from datetime import datetime, timezone
import os
from uuid import UUID, uuid4

from fastapi import FastAPI, Header, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import requests

from database import (
    create_run,
    get_events_by_run,
    get_run,
    init_db,
    list_runs,
    save_event,
    update_run_status,
)
from event_schema import ChronosEvent
from failure_injector import inject_failure


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize database tables and indexes on application startup
    init_db()
    yield


app = FastAPI(lifespan=lifespan)

ALLOWED_ORIGINS = [
    "http://localhost:1420",
    "http://127.0.0.1:1420",
    "http://tauri.localhost",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# Inside Docker Compose this is overridden to http://payment:8001 via the
# PAYMENT_SERVICE_URL environment variable. The default keeps local dev and
# the existing pytest suite working without any environment setup.
PAYMENT_SERVICE_URL = os.environ.get("PAYMENT_SERVICE_URL", "http://127.0.0.1:8001")


orders_db = {
    101: {
        "item": "Keyboard",
        "status": "Pending",
    },
    205: {
        "item": "Mouse",
        "status": "shipped",
    },
}


@app.get("/")
def home():
    return {"message": "Hello from CHRONOS"}


class HealthResponse(BaseModel):
    status: str
    timestamp: datetime
    database: str


@app.get("/health", response_model=HealthResponse)
def health_check():
    """Health check endpoint confirming API and DB connectivity."""
    db_status = "connected"
    try:
        # Lightweight probe of DB connection
        get_run(UUID("00000000-0000-0000-0000-000000000000"))
    except Exception:
        db_status = "disconnected"

    return HealthResponse(
        status="ok" if db_status == "connected" else "degraded",
        timestamp=datetime.now(timezone.utc),
        database=db_status,
    )


@app.get("/orders")
def orders():
    return {
        "message": "Orders service",
    }


@app.get("/orders/{order_id}")
def get_orders(order_id: int):
    if order_id not in orders_db:
        raise HTTPException(status_code=404, detail="order not found")

    order = orders_db[order_id]
    return {
        "order_id": order_id,
        "item": order["item"],
        "status": order["status"],
    }


class RunResponse(BaseModel):
    run_id: UUID
    started_at: datetime
    status: str


class RunSummaryResponse(BaseModel):
    run_id: UUID
    started_at: datetime
    completed_at: datetime | None = None
    status: str


@app.get("/runs", response_model=list[RunSummaryResponse])
def get_runs(limit: int = 50):
    """List recent runs in reverse chronological order."""
    runs = list_runs(limit=limit)
    return [
        RunSummaryResponse(
            run_id=r["run_id"],
            started_at=r["started_at"],
            completed_at=r.get("completed_at"),
            status=r["status"],
        )
        for r in runs
    ]


@app.get("/runs/{run_id}", response_model=RunSummaryResponse)
def get_run_by_id(run_id: UUID):
    """Get single run record by ID."""
    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return RunSummaryResponse(
        run_id=run["run_id"],
        started_at=run["started_at"],
        completed_at=run.get("completed_at"),
        status=run["status"],
    )


@app.post("/runs", response_model=RunResponse, status_code=201)
def create_new_run():
    """Create a new run record. The run_id is generated server-side using uuid4()."""
    run_id = uuid4()
    started_at = datetime.now(timezone.utc)
    run = create_run(run_id=run_id, started_at=started_at, status="IN_PROGRESS")
    return RunResponse(
        run_id=run["run_id"],
        started_at=run["started_at"],
        status=run["status"],
    )


class FailureInjectionRequest(BaseModel):
    target: str


class FailureInjectionResponse(BaseModel):
    status: str
    run_id: UUID
    target: str
    action: str


@app.post("/runs/{run_id}/failure", response_model=FailureInjectionResponse)
def inject_run_failure(run_id: UUID, req: FailureInjectionRequest):
    """Inject a controlled failure into an active run."""
    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run["status"] != "IN_PROGRESS":
        raise HTTPException(
            status_code=409,
            detail=f"Run {run_id} is not in progress (status: {run['status']})",
        )

    result = inject_failure(target=req.target, run_id=run_id)
    return FailureInjectionResponse(
        status=result["status"],
        run_id=run_id,
        target=result["target"],
        action=result["action"],
    )


@app.post("/orders/{order_id}/checkout")
def checkout_order(
    order_id: int,
    response: Response,
    x_run_id: UUID | None = Header(default=None, alias="X-Run-ID"),
):
    if x_run_id is not None:
        run = get_run(x_run_id)
        if not run:
            raise HTTPException(
                status_code=404,
                detail="Run not found",
                headers={"X-Run-ID": str(x_run_id)},
            )
        if run["status"] != "IN_PROGRESS":
            raise HTTPException(
                status_code=409,
                detail=f"Run {x_run_id} is not in progress (status: {run['status']})",
                headers={"X-Run-ID": str(x_run_id)},
            )
        run_id = x_run_id
    else:
        run_id = uuid4()
        create_run(run_id=run_id, started_at=datetime.now(timezone.utc), status="IN_PROGRESS")

    response.headers["X-Run-ID"] = str(run_id)

    # 2. REQUEST_START event
    request_start = ChronosEvent(
        run_id=run_id,
        service_id="orders",
        event_type="REQUEST_START",
        source="orders-api",
        payload={"order_id": order_id},
        severity="INFO",
    )
    save_event(request_start)
    print(request_start.model_dump_json())

    run_status = "FAILED"
    try:
        if order_id not in orders_db:
            raise HTTPException(
                status_code=404,
                detail="order not found",
                headers={"X-Run-ID": str(run_id)},
            )

        # 3. SERVICE_CALL event
        service_call = ChronosEvent(
            run_id=run_id,
            service_id="orders",
            event_type="SERVICE_CALL",
            source="orders-api",
            payload={
                "destination_service": "payment",
                "order_id": order_id,
            },
            severity="INFO",
        )
        save_event(service_call)
        print(service_call.model_dump_json())

        try:
            payment_response = requests.post(
                f"{PAYMENT_SERVICE_URL}/payments",
                json={"order_id": order_id},
                timeout=3,
            )

            payment_response.raise_for_status()

            # 4. RESPONSE event
            response_event = ChronosEvent(
                run_id=run_id,
                service_id="orders",
                event_type="RESPONSE",
                source="orders-api",
                payload={
                    "responding_service": "payment",
                    "order_id": order_id,
                    "status_code": payment_response.status_code,
                },
                severity="INFO",
            )
            save_event(response_event)
            print(response_event.model_dump_json())

            run_status = "COMPLETED"
            return payment_response.json()

        except requests.exceptions.Timeout:
            error_event = ChronosEvent(
                run_id=run_id,
                service_id="orders",
                event_type="SERVICE_ERROR",
                source="orders-api",
                payload={
                    "destination_service": "payment",
                    "order_id": order_id,
                    "error_type": "Timeout",
                },
                severity="ERROR",
            )
            save_event(error_event)
            print(error_event.model_dump_json())

            raise HTTPException(
                status_code=504,
                detail="Payment service timed out",
                headers={"X-Run-ID": str(run_id)},
            )

        except requests.exceptions.ConnectionError:
            error_event = ChronosEvent(
                run_id=run_id,
                service_id="orders",
                event_type="SERVICE_ERROR",
                source="orders-api",
                payload={
                    "destination_service": "payment",
                    "order_id": order_id,
                    "error_type": "ConnectionError",
                },
                severity="ERROR",
            )
            save_event(error_event)
            print(error_event.model_dump_json())

            raise HTTPException(
                status_code=503,
                detail="Payment service Unavailable",
                headers={"X-Run-ID": str(run_id)},
            )

        except requests.exceptions.HTTPError:
            error_event = ChronosEvent(
                run_id=run_id,
                service_id="orders",
                event_type="SERVICE_ERROR",
                source="orders-api",
                payload={
                    "destination_service": "payment",
                    "order_id": order_id,
                    "error_type": "HTTPError",
                    "status_code": payment_response.status_code,
                },
                severity="ERROR",
            )
            save_event(error_event)
            print(error_event.model_dump_json())

            raise HTTPException(
                status_code=502,
                detail="Payment service returned an error",
                headers={"X-Run-ID": str(run_id)},
            )

    finally:
        # 5. REQUEST_END event & run completion logic
        now = datetime.now(timezone.utc)
        request_end = ChronosEvent(
            run_id=run_id,
            service_id="orders",
            event_type="REQUEST_END",
            source="orders-api",
            payload={"order_id": order_id, "status": run_status},
            severity="INFO" if run_status == "COMPLETED" else "ERROR",
        )
        save_event(request_end)
        print(request_end.model_dump_json())

        update_run_status(run_id=run_id, status=run_status, completed_at=now)


@app.get("/runs/{run_id}/events", response_model=list[ChronosEvent])
def get_run_events(run_id: UUID):
    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return get_events_by_run(run_id)


# ---------------------------------------------------------------------------
# Topology models
# ---------------------------------------------------------------------------

class TopologyNode(BaseModel):
    id: str
    service_id: str


class TopologyEdge(BaseModel):
    source: str
    target: str
    event_type: str


class TopologyResponse(BaseModel):
    run_id: UUID
    nodes: list[TopologyNode]
    edges: list[TopologyEdge]


@app.get("/runs/{run_id}/topology", response_model=TopologyResponse)
def get_run_topology(run_id: UUID):
    """Reconstruct the observed service topology for a given run from its events."""
    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    events = get_events_by_run(run_id)

    seen_nodes: set[str] = set()
    nodes: list[TopologyNode] = []
    seen_edges: set[tuple[str, str]] = set()
    edges: list[TopologyEdge] = []

    for event in events:
        # Track every service that produced an event
        if event.service_id not in seen_nodes:
            seen_nodes.add(event.service_id)
            nodes.append(TopologyNode(id=event.service_id, service_id=event.service_id))

        # Build directed edges from SERVICE_CALL events only
        if event.event_type == "SERVICE_CALL":
            dest = event.payload.get("destination_service")
            if dest:
                # Ensure the destination service appears as a node
                if dest not in seen_nodes:
                    seen_nodes.add(dest)
                    nodes.append(TopologyNode(id=dest, service_id=dest))

                # Deduplicate edges (same source → target pair)
                edge_key = (event.service_id, dest)
                if edge_key not in seen_edges:
                    seen_edges.add(edge_key)
                    edges.append(TopologyEdge(
                        source=event.service_id,
                        target=dest,
                        event_type="SERVICE_CALL",
                    ))

    return TopologyResponse(run_id=run_id, nodes=nodes, edges=edges)
