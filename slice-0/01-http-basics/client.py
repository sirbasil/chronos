import requests

url = "http://127.0.0.1:8000/"

try:
    response = requests.get(url, timeout=3)

    print("Status:", response.status_code)
    print("Success:", response.ok)
    print("Message:", response.json()["message"])

    response.raise_for_status()

except requests.exceptions.Timeout:
    print("The request timed out.")

except requests.exceptions.ConnectionError:
    print("Could not connect to the server.")

except requests.exceptions.HTTPError as error:
    print("The server returned an HTTP error:", error)

except requests.exceptions.RequestException as error:
    print("Request failed:", error)