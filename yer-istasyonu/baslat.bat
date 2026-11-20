@echo off
rem AKANA Yer Istasyonu - Windows baslatici (cift tiklayin)
cd /d "%~dp0"
where python >nul 2>nul || (echo Python 3.11+ kurulu degil: https://www.python.org/downloads/ & pause & exit /b 1)
if not exist .venv (
  echo Ilk kurulum yapiliyor, birkac dakika surebilir...
  python -m venv .venv || (pause & exit /b 1)
  .venv\Scripts\python -m pip install -q -r requirements.txt || (pause & exit /b 1)
)
if not exist ui\openmct\openmct.js (echo ui\openmct eksik. README'deki "npm run kur" adimini yapin. & pause & exit /b 1)
echo Yer istasyonu aciliyor: http://127.0.0.1:8000
.venv\Scripts\python -m yi_core --open %*
pause
