@echo off
REM Double-click this file to start POI Map for phone + PC.
cd /d "%~dp0"

if not exist venv (
    echo First run: setting things up, please wait...
    python -m venv venv
    if errorlevel 1 (
        echo Python was not found. Install it from python.org and tick "Add Python to PATH".
        pause
        exit /b 1
    )
)

call venv\Scripts\activate
pip install -q -r requirements.txt
python run_mobile.py
