@echo off
chcp 65001 > nul
title Аманат Маркет — Локальный сервер
echo ====================================================
echo   Запуск сайта Аманат Маркет (modern-site)
echo ====================================================
echo.
cd /d "%~dp0"
start http://localhost:3000
node server.js
pause
