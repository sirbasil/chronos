import requests
from fastapi import FastAPI,HTTPException
from uuid import uuid4
from event_schema import ChronosEvent
app = FastAPI()


orders_db = {101: {
    "item": "Keyboard",
    "status": "Pending"
    },
    205:{
    "item" : "Mouse",
    "status" : "shipped"}
    }

@app.get("/")
def home():
    return {"message": "Hello from CHRONOS"}

@app.get("/orders")
def orders():
    return {
  "message": "Orders service"
}
@app.get("/orders/{order_id}")
def get_orders(order_id: int):
  if order_id not in orders_db:
    raise HTTPException(status_code=404, detail="order not found")
 
  order = orders_db[order_id]
  return {
    "order_id": order_id,
    "item" : order["item"], 
    "status" : order["status"] 
  }

@app.post("/orders/{order_id}/checkout")
def checkout_order(order_id: int):
    run_id = uuid4()

    request_stat = ChronosEvent(
       run_id = run_id,
       service_id = "orders",
       event_type = "REQUEST_START",
       source = "orders-api",
       payload = {"order_id": order_id},
       severity = "INFO"
    )
    print(request_stat.model_dump_json())

    service_call = ChronosEvent(
       run_id = run_id,
       service_id = "orders",
       event_type = "SERVICE_CALL",
       source = "orders-api",
       payload = {
          "destination_service" : "payment",
          "order_id" : order_id
       },
       severity = "INFO"
    )
    print(service_call.model_dump_json())
    payment_response.raise_for_status()
    if order_id not in orders_db:
        raise HTTPException(status_code=404, detail="order not found")
    try:

      payment_response = requests.post(
      "http://127.0.0.1:8001/payments",
      json={"order_id": order_id },
      timeout=3 
      )
      payment_response.raise_for_status()

    except requests.exceptions.Timeout:
      raise HTTPException(
        status_code=504,
        detail="Payment service timed out"
        )
    
    except requests.exceptions.ConnectionError:
      raise HTTPException(
        status_code=503,
        detail="Payment service Unavailable"
        )

    except requests.exceptions.HTTPError:
      raise HTTPException(
        status_code=502,
        detail="Payment service returned an error"
        )
    
    return payment_response.json()

