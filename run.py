"""Opens the POI Map app in its own desktop window.

If the desktop window cannot start on your PC, it falls back to opening the
app in your normal browser, so you always get something that works.
"""
import socket
import threading
import time
import webbrowser

from app import app

try:
    import webview  # pip install pywebview
except Exception:  # not installed or not supported on this PC
    webview = None


def find_free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_server(port):
    app.run(host="127.0.0.1", port=port, debug=False, use_reloader=False)


def wait_for_server(port, timeout=10):
    end = time.time() + timeout
    while time.time() < end:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return
        except OSError:
            time.sleep(0.1)


def open_in_browser(url):
    print(f"Opening {url} in your browser. Close this window to stop the app.")
    webbrowser.open(url)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    port = find_free_port()
    url = f"http://127.0.0.1:{port}"

    threading.Thread(target=start_server, args=(port,), daemon=True).start()
    wait_for_server(port)

    if webview is None:
        open_in_browser(url)
    else:
        try:
            webview.create_window("POI Map", url, width=1200, height=780)
            webview.start()
        except Exception as error:
            print("Desktop window failed:", error)
            open_in_browser(url)
