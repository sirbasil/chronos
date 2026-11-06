from datetime import datetime, timezone
from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class ChronosEvent(BaseModel):
    # Generates a new UUID4 automatically if one isn't provided
    event_id: UUID = Field(default_factory=uuid4)
    
    # Required field
    run_id: UUID
    
    # Defaults to current UTC time dynamically using a lambda
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    
    # Required string
    service_id: str
    
    # Optional string, defaulting to None
    trace_id: str | None = None
    
    # Restricted to specific literal values
    event_type: Literal[
        "REQUEST_START", 
        "REQUEST_END", 
        "SERVICE_CALL", 
        "SERVICE_ERROR", 
        "RESPONSE", 
        "FAILURE_INJECTED"
    ]
    
    # Required string
    source: str
    
    # Dictionary with string keys and arbitrary values, defaults to an empty dict
    payload: dict[str, Any] = Field(default_factory=dict)
    
    # Restricted to specific literal values
    severity: Literal["INFO", "WARNING", "ERROR"]