@echo off
REM Double-click this file to build dist\POIMap.exe (a standalone desktop app).
cd /d "%~dp0"

if not exist venv (
    python -m venv venv
)

call venv\Scripts\activate
pip install -q -r requirements.txt pyinstaller

pyinstaller --noconfirm --clean --onefile --windowed --name POIMap ^
  --icon "static\icons\app.ico" ^
  --add-data "templates;templates" ^
  --add-data "static;static" ^
  --add-data "phone_url.txt;." ^
  --hidden-import qrcode.image.svg ^
  --collect-all webview ^
  --collect-all pythonnet ^
  --collect-all clr_loader ^
  run.py

echo.
echo Done. Your app is in the dist folder: dist\POIMap.exe
echo Saved places are kept in %%APPDATA%%\POIMap\poi.db
pause
