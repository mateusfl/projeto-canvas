import logging
import os
from socketserver import ThreadingMixIn
from wsgiref.simple_server import WSGIServer, make_server

from spyne.server.wsgi import WsgiApplication

import store
from service import application

HOST = os.environ.get("COSMETICS_API_HOST", "127.0.0.1")
PORT = int(os.environ.get("COSMETICS_API_PORT", "3003"))


class ThreadingWSGIServer(ThreadingMixIn, WSGIServer):
    daemon_threads = True


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    logging.getLogger("spyne.application.client").setLevel(logging.CRITICAL)

    store.init()
    server = make_server(
        HOST, PORT, WsgiApplication(application), server_class=ThreadingWSGIServer
    )
    print(f"API de customização (SOAP) em http://{HOST}:{PORT}", flush=True)
    print(f"WSDL em http://{HOST}:{PORT}/?wsdl", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
