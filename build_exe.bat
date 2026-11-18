@echo off
REM Double-click this file to build dist\POIMap.exe
cd /d "%~dp0"

if not exist venv (
    python -m venv venv
)

call venv\Scripts\activate
pip install -q -r requirements.txt pyinstaller

pyinstaller --noconfirm --onefile --windowed --name POIMap ^
  --add-data "templates;templates" ^
  --add-data "static;static" ^
  run.py

echo.
echo Done. Your app is in the dist folder: dist\POIMap.exe
pause
