from _pytest.monkeypatch import MonkeyPatch
from fastapi.testclient import TestClient
from server_fastapi import app
import requests

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

class FakeResponse:
    def raise_for_status(self):
        pass

    def json(self):
        return {
            "order_id": 101,
            "payment_status": "approved"
        }

    


def test_checkout_success(monkeypatch: MonkeyPatch):
    
    fake_response = FakeResponse()
    def fake_post(*args, **kwargs):
            return fake_response
    
    
    monkeypatch.setattr("server_fastapi.requests.post",fake_post)

    orders = client.post("/orders/101/checkout")    
    assert orders.status_code == 200
    assert orders.json() == {
                            "order_id": 101,
                            "payment_status": "approved"
                            }


def test_checkout_payment_unavailable(monkeypatch: MonkeyPatch):
    def fake_post(*args,**kwargs):
        raise requests.exceptions.ConnectionError("Payment offline")
     
    monkeypatch.setattr("server_fastapi.requests.post",fake_post)
    
    response = client.post("/orders/101/checkout")

    assert response.status_code == 503
    assert response.json()["detail"] == "Payment service Unavailable"    


def test_checkout_payment_timeout(monkeypatch: MonkeyPatch):
    
    def fake_post(*args,**kwargs):
        raise requests.exceptions.Timeout("Payment Timed Out")   

    monkeypatch.setattr("server_fastapi.requests.post",fake_post)

    response = client.post("/orders/101/checkout")
    
    assert response.status_code == 504
    assert response.json()["detail"] == "Payment service timed out"

class FakeErrorResponse:
    def raise_for_status(self):
        raise requests.exceptions.HTTPError("Payment returned 500")

    def json(self):
        return {}

def test_checkout_payment_http_error(monkeypatch: MonkeyPatch):

    fake_response = FakeErrorResponse()

    def fake_post(*args,**kwargs):
        return fake_response   

        
    
    monkeypatch.setattr("server_fastapi.requests.post",fake_post)

    response = client.post("/orders/101/checkout")
    
    assert response.status_code == 502
    assert response.json()["detail"] == "Payment service returned an error"