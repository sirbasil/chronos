from fastapi import FastAPI
from pydantic import BaseModel   

app = FastAPI()

class PaymentRequest(BaseModel):
    order_id : int

@app.post("/payments")
def create_payment(payment : PaymentRequest):
    return {
        "order_id" : payment.order_id,
        "payment_status" : "approved"
    }

