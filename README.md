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

## Use it on your phone
There are two ways. Pick one.

**A) Install it as an app on the phone (works anywhere, even away from your PC)**
1. Run `python build_mobile.py` (already done; the `docs/` folder is the phone version).
2. Host the `docs/` folder on any https site. Easiest is GitHub Pages:
   push this project to GitHub, then Settings > Pages > Branch `main`, folder `/docs`.
3. Open the page link on your phone. Android Chrome: menu > "Install app".
   iPhone Safari: Share > "Add to Home Screen".
Places are saved on the phone. Use "Export backup" / "Import backup" in the Saved tab
to move places between phone and PC.

**B) Use the PC's app from your phone (same Wi-Fi)**
1. Double-click `run_mobile.bat`. It prints an address like `http://192.168.1.20:5000`.
2. Open that address on the phone. Allow Python through the Windows firewall if asked.
Places are saved in the PC's `poi.db`. (The "my location" button needs https, so it
works in option A but not here.)

## Notes
- Map pictures, search and addresses need an internet connection
  (OpenStreetMap and Nominatim). Saving and viewing saved places work offline.
- If the desktop window cannot start, the app opens in your browser instead.
