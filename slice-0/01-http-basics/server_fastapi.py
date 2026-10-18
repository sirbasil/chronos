
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

