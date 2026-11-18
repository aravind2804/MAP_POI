import json
import os
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from flask import Flask, render_template, request, jsonify
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


if __name__ == "__main__":
    app.run(debug=True)
