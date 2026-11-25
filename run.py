"""Opens POI Map as a desktop app AND lets your phone use it on the same Wi-Fi.

- Desktop: a separate "POI Map" window (falls back to your browser if needed).
- Phone:   open the address printed below (or click "Phone" in the app for a QR code).
Both use the same saved places.
"""
import socket
import threading
import time
import webbrowser

from app import app, lan_ip

try:
    import webview  # pip install pywebview
except Exception:  # not installed or not supported on this PC
    webview = None

PREFERRED_PORT = 5055  # not 5000, so an old copy of the app can't get in the way


def pick_port():
    """Use a fixed port so the phone address stays the same; otherwise any free port."""
    for port in (PREFERRED_PORT, 0):
        if port and socket.socket().connect_ex(("127.0.0.1", port)) == 0:
            continue  # something is already running there
        with socket.socket() as s:
            try:
                s.bind(("0.0.0.0", port))
                return s.getsockname()[1]
            except OSError:
                continue
    return PREFERRED_PORT


def start_server(port):
    # 0.0.0.0 = reachable from the phone as well as this PC
    app.run(host="0.0.0.0", port=port, debug=False, use_reloader=False)


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
    port = pick_port()
    url = f"http://127.0.0.1:{port}"

    threading.Thread(target=start_server, args=(port,), daemon=True).start()
    wait_for_server(port)
    print(f"\n  POI Map is running.\n  On this PC:  {url}\n  On your phone (same Wi-Fi):  http://{lan_ip()}:{port}\n")

    if webview is None:
        open_in_browser(url)
    else:
        try:
            title = f"POI Map  -  phone: http://{lan_ip()}:{port}"
            webview.create_window(title, url, width=1200, height=780)
            webview.start()
        except Exception as error:
            print("Desktop window failed:", error)
            open_in_browser(url)
