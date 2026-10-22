import requests
from fastapi import FastAPI,HTTPException
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

