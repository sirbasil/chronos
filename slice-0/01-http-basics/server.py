from http.server import BaseHTTPRequestHandler, HTTPServer
import json


class ChronosHandler(BaseHTTPRequestHandler):

    def do_GET(self):
        if self.path == "/":
            status = 200
            data = {"message": "Hello from server"}

        elif self.path == "/error":
            status = 500
            data = {"message": "Internal server error"}

        else:
            status = 404
            data = {"message": "Not Found"}

        body = json.dumps(data).encode("utf-8")

        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()

        self.wfile.write(body)


if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", 8000), ChronosHandler)

    print("Server listening on http://127.0.0.1:8000")

    server.serve_forever()