#!/usr/bin/env python3
"""Local test server for the Print File Text Remover (no Netlify needed).
Serves this folder at http://localhost:8765 with the right file types for
JavaScript modules and WebAssembly, then opens the page."""
import http.server, os, socketserver, subprocess, sys, threading, webbrowser

PORT = 8765
os.chdir(os.path.dirname(os.path.abspath(__file__)))

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.mjs': 'text/javascript', '.js': 'text/javascript',
                      '.wasm': 'application/wasm', '.json': 'application/json',
                      '.jsx': 'text/plain', '.traineddata': 'application/octet-stream'}
    def log_message(self, *a): pass
    def end_headers(self):
        # never let Chrome reuse an older copy of the site's code
        if not self.path.startswith('/vendor/'):
            self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

def open_page():
    url = f'http://localhost:{PORT}/'
    if sys.platform == 'darwin':
        r = subprocess.run(['open', '-a', 'Google Chrome', url])
        if r.returncode == 0: return
    webbrowser.open(url)

socketserver.TCPServer.allow_reuse_address = True
try:
    httpd = socketserver.TCPServer(('127.0.0.1', PORT), Handler)
except OSError:
    print(f'Port {PORT} is busy, so the page is probably already running. Opening it.')
    open_page(); sys.exit(0)
print(f'Print File Text Remover running at http://localhost:{PORT}/')
print('Leave this window open while you use it. Close it (or press Ctrl+C) to stop.')
threading.Timer(0.8, open_page).start()
try:
    httpd.serve_forever()
except KeyboardInterrupt:
    pass
