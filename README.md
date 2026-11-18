# POI Map

A desktop app to find places, drop pins on a map and save them with their address.
Built with Python, Flask, SQLite and Leaflet.

## What it does
- Search any place or address from the top bar.
- Click the map: latitude, longitude and address fill in automatically.
- Type latitude and longitude: the pin moves there and the address fills in.
- Type an address and press "Find address on map": the pin and coordinates fill in.
- Drag the pin to fine-tune the spot.
- Save, filter, show and delete locations.

## Run it
1. Install Python from python.org (tick "Add Python to PATH").
2. Double-click `run_app.bat` (first run installs what it needs).

Or in a terminal:

    pip install -r requirements.txt
    python run.py

## Build POIMap.exe
Double-click `build_exe.bat`. The app is created at `dist\POIMap.exe`.
Saved locations are kept in `%APPDATA%\POIMap\poi.db`.

## Notes
- Map pictures, search and addresses need an internet connection
  (OpenStreetMap and Nominatim). Saving and viewing saved places work offline.
- If the desktop window cannot start, the app opens in your browser instead.
