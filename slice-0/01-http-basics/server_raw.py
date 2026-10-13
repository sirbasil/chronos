import socket

s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)

s.bind(("127.0.0.1", 8000))
s.listen(1)

client_socket, address = s.accept()

data = client_socket.recv(1024)
message = data.decode()

print(message)

if "GET / HTTP/1.1" in message:

    body = '{"message": "Hello from server"}'
    body_bytes = body.encode()
    reply = (
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: application/json\r\n"
        f"Content-Length: {len(body_bytes)}\r\n"
        "\r\n"
    ).encode() + body_bytes
elif "GET /error HTTP/1.1" in message:
    body = '{"message": "Internal Server error"}'
    body_bytes = body.encode()
    reply = (
        "HTTP/1.1 500 Internal Server Error\r\n"
        "Content-Type: application/json\r\n"
        f"Content-Length: {len(body_bytes)}\r\n"
        "\r\n"
    ).encode() + body_bytes

else:

    body = '{"message": "Not Found"}'
    body_bytes = body.encode()

    reply = (
        "HTTP/1.1 404 Not Found\r\n"
        "Content-Type: application/json\r\n"
        f"Content-Length: {len(body_bytes)}\r\n"
        "\r\n"
    ).encode() + body_bytes

client_socket.sendall(reply)