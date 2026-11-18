"""Run POI Map so your phone can use it over the same Wi-Fi.

1. Start this on your PC (double-click run_mobile.bat).
2. On your phone (same Wi-Fi) open the address it prints, e.g. http://192.168.1.20:5000
Places you save are stored in the PC's poi.db, so PC and phone share the same data.
"""
import socket

from app import app


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))  # no data is sent; just finds your network address
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


if __name__ == "__main__":
    port = 5000
    print("\n  POI Map is running.")
    print(f"  On this PC:   http://127.0.0.1:{port}")
    print(f"  On your phone (same Wi-Fi):   http://{lan_ip()}:{port}")
    print("  Press Ctrl+C to stop.\n")
    app.run(host="0.0.0.0", port=port, debug=False, use_reloader=False)
