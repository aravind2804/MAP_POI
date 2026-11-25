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

## Build POIMap.exe (a real desktop app)
Double-click `build_exe.bat`. The app is created at `dist\POIMap.exe`.
Then double-click `make_shortcut.bat` to put a "POI Map" icon on your Desktop.
Saved locations are kept in `%APPDATA%\POIMap\poi.db`.

## Install on your phone as a real app (scan the QR)
1. Double-click `publish_phone.bat` (uploads the phone app to GitHub).
2. First time only, on GitHub: your repo > Settings > Pages > Branch `main`, folder `/docs` > Save.
   Your address is then `https://<your-name>.github.io/<repo>/` - put it in `phone_url.txt`.
3. In the PC app click **Phone** and scan the first QR code. On Android tap **Install POI Map**;
   on iPhone use Share > Add to Home Screen. It then runs as its own app, no PC needed.

## One app for desktop AND phone
`python run.py` (or `POIMap.exe`) opens the desktop window and also lets your phone
use the same app over Wi-Fi. Click **Phone** in the top bar for a QR code, or use the
address printed in the terminal. If Windows asks, click "Allow access".

Note: `python app.py` only starts the Flask server (opens in a browser tab).
Use `python run.py` to get the separate desktop window.

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

## Current location
When the app opens and device location is on, the map jumps to where you are (blue dot) and the
address fills in. The round button on the map does it again; if location is off it shows an
approximate (city-level) spot instead. On desktop, turn on Windows Settings > Privacy > Location.
On the phone it works in the installed https app.

## Directions
Tap a saved place (in the list or its pin on the map) and the app draws the route from your current
location, with distance, time and turn-by-turn steps. Switch between Car / Bike / Walk, or press
"Open in Google Maps" for voice navigation. Works on the desktop app and the phone app (needs internet).

## Notes
- Map pictures, search and addresses need an internet connection
  (OpenStreetMap and Nominatim). Saving and viewing saved places work offline.
- If the desktop window cannot start, the app opens in your browser instead.
