import socket

cs = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
cs.connect(("127.0.0.1", 8000))

request = (
    "GET /error HTTP/1.1\r\n"
    "Host: localhost:8000\r\n"
    "\r\n"
)

cs.sendall(request.encode())

response = b""

while b"\r\n\r\n" not in response:
    chunk = cs.recv(16)
    if not chunk:
        break
    response += chunk


headers, body = response.split(b"\r\n\r\n", 1)

headers_text = headers.decode()

content_length = None

for line in headers_text.split("\r\n"):
    print("HEADER LINE:", repr(line))

    if line.lower().startswith("content-length:"):
        content_length = int(line.split(":", 1)[1].strip())
        break

if content_length is None:
    raise ValueError("Content-Length header not found")

while len(body) < content_length:
    chunk = cs.recv(16)
    if not chunk:
        raise ConnectionError("Connection closed before complete body arrived")
    
    body += chunk

print("HEADERS:")
print(headers.decode())

print("BODY SO FAR:")
print(body.decode())

cs.close()
