# /// script
# requires-python = ">=3.10"
# ///
"""
Serves output/ on localhost and opens the dashboard in your browser.
View-only — no dependencies, but the "Upload Hourly Data" button won't
work here since there's no backend to receive the file. Use
`uv run src/server.py` instead if you need to upload from the browser.

Usage: uv run src/serve.py [port]
"""
import http.server
import socketserver
import webbrowser
import os
import sys
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUTPUT_DIR = os.path.join(ROOT, "output")

def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    os.chdir(OUTPUT_DIR)
    handler = http.server.SimpleHTTPRequestHandler
    with socketserver.TCPServer(("", port), handler) as httpd:
        url = f"http://localhost:{port}/network_insight_app.html"
        print(f"Serving {OUTPUT_DIR} at {url}")
        print("Press Ctrl+C to stop.")
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")

if __name__ == "__main__":
    main()
