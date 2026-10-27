from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
import signal
import threading

parser = argparse.ArgumentParser(description='Serve the three independent IMF static surfaces')
parser.add_argument('--root', default='dist', help='Build output containing website/, docs/ and app/')
parser.add_argument('--port-base', type=int, default=5180, help='Website port; docs and app use the next two ports')
args = parser.parse_args()
root = Path(args.root).resolve()
servers = []
for index, surface in enumerate(['website', 'docs', 'app']):
    directory = root / surface
    port = args.port_base + index
    if not (directory / 'index.html').is_file():
        raise SystemExit(f'Missing {directory}; run the matching frontend build first')
    handler = partial(SimpleHTTPRequestHandler, directory=str(directory))
    server = ThreadingHTTPServer(('127.0.0.1', port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    servers.append(server)
    print(f'{surface}: http://127.0.0.1:{port}/', flush=True)

def stop(*_):
    for server in servers:
        server.shutdown()
        server.server_close()
    raise SystemExit(0)

signal.signal(signal.SIGINT, stop)
signal.signal(signal.SIGTERM, stop)
signal.pause()
