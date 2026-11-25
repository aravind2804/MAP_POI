import io
import json
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from flask import Flask, render_template, render_template_string, request, jsonify, send_from_directory
from database import get_connection, init_db

# When packaged as an .exe, PyInstaller unpacks templates/static into a
# temporary folder (sys._MEIPASS). Point Flask there.
BASE_DIR = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))

app = Flask(
    __name__,
    template_folder=os.path.join(BASE_DIR, "templates"),
    static_folder=os.path.join(BASE_DIR, "static"),
)

# Make sure the table exists (also runs when a web host imports this file)
init_db()


# -----------------------------
# Address lookup (OpenStreetMap Nominatim)
# -----------------------------
# Free service. Its rules: identify your app, and send at most 1 request/second.
NOMINATIM_URL = "https://nominatim.openstreetmap.org"
USER_AGENT = "POIMapApp/1.0 (personal project; github.com/aravind2804/poi_map)"

_lookup_lock = threading.Lock()
_last_lookup = 0.0
_cache = {}


def nominatim_get(path, params):
    """Call Nominatim with a 1-request-per-second limit and a small cache."""
    global _last_lookup

    query = urllib.parse.urlencode(sorted(params.items()))
    key = f"{path}?{query}"
    if key in _cache:
        return _cache[key]

    with _lookup_lock:
        wait = 1.0 - (time.time() - _last_lookup)
        if wait > 0:
            time.sleep(wait)
        request_obj = urllib.request.Request(
            NOMINATIM_URL + key,
            headers={"User-Agent": USER_AGENT, "Accept-Language": "en"},
        )
        try:
            with urllib.request.urlopen(request_obj, timeout=8) as response:
                data = json.loads(response.read().decode("utf-8"))
        finally:
            _last_lookup = time.time()

    if len(_cache) > 200:
        _cache.clear()
    _cache[key] = data
    return data


LOOKUP_ERRORS = (urllib.error.URLError, TimeoutError, OSError, ValueError)
LOOKUP_FAILED = {"error": "Could not reach the map search service. Check your internet connection."}


@app.route("/api/search")
def api_search():
    """Place or address -> list of matching coordinates."""
    q = request.args.get("q", "").strip()
    if len(q) < 2:
        return jsonify({"error": "Type at least 2 characters to search."}), 400
    try:
        data = nominatim_get("/search", {"format": "jsonv2", "q": q, "limit": 6})
        results = [
            {
                "name": item.get("display_name", ""),
                "latitude": float(item["lat"]),
                "longitude": float(item["lon"]),
            }
            for item in data
        ]
    except LOOKUP_ERRORS:
        return jsonify(LOOKUP_FAILED), 502
    return jsonify({"results": results})


@app.route("/api/reverse")
def api_reverse():
    """Coordinates -> address."""
    try:
        lat = float(request.args["lat"])
        lng = float(request.args["lng"])
    except (KeyError, ValueError):
        return jsonify({"error": "Invalid coordinates."}), 400
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return jsonify({"error": "Coordinates are out of range."}), 400
    try:
        data = nominatim_get(
            "/reverse",
            {"format": "jsonv2", "lat": f"{lat:.5f}", "lon": f"{lng:.5f}", "zoom": 18},
        )
    except LOOKUP_ERRORS:
        return jsonify(LOOKUP_FAILED), 502
    address = "" if "error" in data else data.get("display_name", "")
    return jsonify({"address": address})


# -----------------------------
# Pages and saved locations
# -----------------------------
def fetch_all_locations():
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM points_of_interest ORDER BY id DESC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.route("/")
def home():
    return render_template("index.html", poi=fetch_all_locations())


@app.route("/manifest.webmanifest")
def manifest():
    """Lets phones install the app to the home screen."""
    return send_from_directory(
        app.static_folder, "manifest.webmanifest", mimetype="application/manifest+json"
    )


@app.route("/save", methods=["POST"])
def save():
    data = request.get_json(silent=True) or {}

    name = str(data.get("name", "")).strip()
    if not name:
        return jsonify({"error": "Name is required"}), 400

    try:
        latitude = float(data["latitude"])
        longitude = float(data["longitude"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "Latitude and longitude must be numbers"}), 400

    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return jsonify({"error": "Coordinates are out of range"}), 400

    category = str(data.get("category") or "Other").strip()
    description = str(data.get("description") or "").strip()
    address = str(data.get("address") or "").strip()

    conn = get_connection()
    conn.execute(
        """
        INSERT INTO points_of_interest
        (name, category, latitude, longitude, description, address)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (name, category, latitude, longitude, description, address),
    )
    conn.commit()
    conn.close()

    return jsonify({"message": "Location Saved Successfully"})


@app.route("/get_locations")
def get_locations():
    return jsonify(fetch_all_locations())


@app.route("/delete/<int:id>", methods=["DELETE"])
def delete_location(id):
    conn = get_connection()
    conn.execute("DELETE FROM points_of_interest WHERE id = ?", (id,))
    conn.commit()
    conn.close()

    return jsonify({"message": "Location Deleted Successfully"})


# -----------------------------
# "Use on phone": shows this PC's address + a QR code
# -----------------------------
def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))  # nothing is sent; just finds your network address
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def qr_svg(text):
    try:
        import qrcode
        import qrcode.image.svg
        img = qrcode.make(text, image_factory=qrcode.image.svg.SvgPathImage, box_size=10)
        buf = io.BytesIO()
        img.save(buf)
        return buf.getvalue().decode("utf-8")
    except Exception:
        return ""


PHONE_PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>POI Map on your phone</title>
<style>body{font-family:system-ui,sans-serif;max-width:620px;margin:40px auto;padding:0 20px;color:#16302f}
a{color:#0f766e}.qr{width:230px;height:230px;background:#fff;padding:8px;border-radius:12px;border:1px solid #dde8e6}
code{background:#eef3f2;padding:4px 8px;border-radius:6px;font-size:1rem;word-break:break-all}li{margin:6px 0}
.box{border:1px solid #dde8e6;border-radius:14px;padding:18px 20px;margin:18px 0}.muted{color:#5d7775;font-size:.92rem}</style></head><body>
<a href="/">&larr; Back to the map</a><h1>Get POI Map on your phone</h1>

<div class="box"><h2>1. Install it as a phone app</h2>
<p>Scan with your phone camera. It opens the app over <b>https</b>, which lets the phone install it and run it on its own, with no PC needed.</p>
<div class="qr">{{ qr_install|safe }}</div><p><code>{{ install_url }}</code></p>
<ul><li><b>Android (Chrome):</b> tap <b>Install POI Map</b> at the top of the page, or menu &#8942; &rarr; <b>Install app</b>.</li>
<li><b>iPhone (Safari):</b> Share &rarr; <b>Add to Home Screen</b>.</li></ul>
<p class="muted">Places saved in the phone app stay on the phone. Use Export backup / Import backup in the Saved section to move them to the PC.</p>
{% if not hosted %}<p class="muted"><b>This address is not online yet.</b> Run <code>publish_phone.bat</code> once, turn on GitHub Pages (see README), then put your https link in <code>phone_url.txt</code>.</p>{% endif %}</div>

<div class="box"><h2>2. Or use this PC's app (same Wi-Fi, PC must be running)</h2>
<div class="qr">{{ qr_lan|safe }}</div><p><code>{{ lan_url }}</code></p>
<p class="muted">This opens in the phone's browser and cannot be installed as a real app (phones only allow that over https). Places are shared with the PC.</p></div>
</body></html>"""


def read_install_url():
    """The https address of the phone app (see phone_url.txt)."""
    from database import DATA_DIR
    for folder in (DATA_DIR, BASE_DIR, os.path.dirname(os.path.abspath(__file__))):
        try:
            with open(os.path.join(folder, "phone_url.txt"), encoding="utf-8") as f:
                url = f.read().strip()
            if url.startswith("https://"):
                return url
        except OSError:
            continue
    return ""


@app.route("/api/open_external", methods=["POST"])
def open_external():
    """Desktop window only: open a Google Maps link in the PC's normal browser."""
    if request.remote_addr not in ("127.0.0.1", "::1"):
        return jsonify({"error": "Only available on this PC."}), 403
    url = str((request.get_json(silent=True) or {}).get("url", ""))
    if not url.startswith("https://www.google.com/maps/"):
        return jsonify({"error": "Link not allowed."}), 400
    import webbrowser
    webbrowser.open(url)
    return jsonify({"ok": True})


@app.route("/phone")
def phone():
    port = request.host.split(":")[-1] if ":" in request.host else "80"
    lan_url = f"http://{lan_ip()}:{port}"
    install_url = read_install_url()
    return render_template_string(
        PHONE_PAGE,
        lan_url=lan_url,
        qr_lan=qr_svg(lan_url),
        install_url=install_url or lan_url,
        qr_install=qr_svg(install_url or lan_url),
        hosted=bool(install_url),
    )


if __name__ == "__main__":
    app.run(debug=True)
