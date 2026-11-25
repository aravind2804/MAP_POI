@echo off
REM Rebuilds the phone app (docs\ folder) and uploads it to GitHub so your phone can install it.
cd /d "%~dp0"
call venv\Scripts\activate
python build_mobile.py
git add -A
git commit -m "Update phone app"
git push
echo.
echo Done. First time only: on GitHub open your repo, Settings, Pages, Branch main, folder /docs, Save.
echo Your phone app address (put it in phone_url.txt):  https://aravind2804.github.io/MAP_POI/
pause
