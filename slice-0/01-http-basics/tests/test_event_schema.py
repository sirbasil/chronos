from uuid import UUID
from event_schema import ChronosEvent
from datetime import datetime
from pydantic import ValidationError
import pytest

def test_event_defaults():
    event = ChronosEvent(
        run_id="123e4567-e89b-12d3-a456-426614174000",
        service_id="orders",
        event_type="REQUEST_START",
        source="orders-api",
        severity="INFO"
    )

    assert isinstance(event.event_id, UUID)
    assert event.trace_id is None
    assert event.payload == {}
    assert isinstance(event.timestamp, datetime)
    assert event.timestamp.utcoffset() is not None
    

def test_invalid_event_type():
    with pytest.raises(ValidationError):
        ChronosEvent(
            run_id="123e4567-e89b-12d3-a456-426614174000",
            service_id="orders",
            event_type="PAYMENT_STARTED",
            source="orders-api",
            severity="INFO"
        )

def test_incomplete_event_info():
    with pytest.raises(ValidationError):
        ChronosEvent(
            run_id="123e4567-e89b-12d3-a456-426614174000",
            event_type="REQUEST_START",
            source="orders-api",
            severity="INFO" 
        )
def test_invalid_severity_type():
    with pytest.raises(ValidationError):
        ChronosEvent(
            run_id="123e4567-e89b-12d3-a456-426614174000",
            service_id="orders",
            event_type="REQUEST_START",
            source="orders-api",
            severity="CRITICAL"
        )

def test_unique_event_ids():
    # Create event1
    # Create event2 using the same input fields
    # Check that their event IDs are different
    event1 = ChronosEvent(
    run_id="123e4567-e89b-12d3-a456-426614174000",
    service_id="orders",
    event_type="REQUEST_START",
    source="orders-api",
    severity="INFO"
    )

    event2 = ChronosEvent(
    run_id="123e4567-e89b-12d3-a456-426614174000",
    service_id="orders",
    event_type="REQUEST_START",
    source="orders-api",
    severity="INFO"
    )
    assert event1.event_id != event2.event_id