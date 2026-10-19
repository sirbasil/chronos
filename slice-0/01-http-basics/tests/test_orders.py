from fastapi.testclient import TestClient
from server_fastapi import app

client = TestClient(app)

def test_home():

    response = client.get("/")
    assert response.status_code == 200 

def test_order():
    
    order = client.get("/orders/101")
    assert order.status_code == 200
    assert order.json()["item"] == "Keyboard"

def test_order_not_found():
    order = client.get("/orders/999")

    assert order.status_code == 404