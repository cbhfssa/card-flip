@echo off
chcp 65001 >nul
cd /d "%~dp0"
start "카드뒤집기 서버" /min python -m http.server 8765
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:8765/"
