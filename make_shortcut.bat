@echo off
REM Creates a "POI Map" shortcut on your Desktop that opens dist\POIMap.exe
cd /d "%~dp0"
if not exist dist\POIMap.exe (
    echo dist\POIMap.exe not found. Run build_exe.bat first.
    pause
    exit /b 1
)
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\POI Map.lnk'); $s.TargetPath='%~dp0dist\POIMap.exe'; $s.WorkingDirectory='%~dp0dist'; $s.IconLocation='%~dp0dist\POIMap.exe'; $s.Save()"
echo Shortcut created on your Desktop.
pause
