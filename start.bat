@echo off
chcp 65001 >nul 2>&1
setlocal

echo.
echo ========================================
echo   OKX Volume Radar  RE0choice
echo ========================================
echo.

where python >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found.
    echo Install from https://www.python.org/downloads/
    goto FAIL
)

cd /d "%~dp0."
python start.py
if errorlevel 1 goto FAIL
goto END

:FAIL
pause
exit /b 1

:END
pause
