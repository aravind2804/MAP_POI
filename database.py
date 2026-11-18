import os
import sqlite3
import sys

# Where the database file (poi.db) is kept:
# - python run.py / python app.py : next to this script
# - packaged POIMap.exe           : C:\Users\<you>\AppData\Roaming\POIMap
#   (so your saved locations stay after you close the app)
if getattr(sys, "frozen", False):
    DATA_DIR = os.path.join(
        os.environ.get("APPDATA", os.path.expanduser("~")), "POIMap"
    )
    os.makedirs(DATA_DIR, exist_ok=True)
else:
    DATA_DIR = os.path.dirname(os.path.abspath(__file__))

DB_PATH = os.path.join(DATA_DIR, "poi.db")


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row  # read rows like dictionaries
    return conn


def init_db():
    """Create the table the first time the app starts.

    Older databases (without the address column) are upgraded automatically,
    so your saved locations are kept.
    """
    conn = get_connection()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS points_of_interest (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            category    TEXT,
            latitude    REAL NOT NULL,
            longitude   REAL NOT NULL,
            description TEXT,
            address     TEXT
        )
        """
    )
    columns = [row["name"] for row in conn.execute("PRAGMA table_info(points_of_interest)")]
    if "address" not in columns:
        conn.execute("ALTER TABLE points_of_interest ADD COLUMN address TEXT")
    conn.commit()
    conn.close()
