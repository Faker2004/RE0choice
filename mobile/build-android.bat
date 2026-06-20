@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0."

echo.
echo ========================================
echo   RE0 Radar - Android Build
echo ========================================
echo.

where npm >nul 2>&1
if errorlevel 1 (
    echo ERROR: npm not found. Install Node.js first.
    pause
    exit /b 1
)

echo [1/4] npm install...
call npm install
if errorlevel 1 goto FAIL

echo [2/4] npm run build...
call npm run build
if errorlevel 1 goto FAIL

if not exist "android\" (
    echo [3/4] cap add android (first time)...
    call npx cap add android
    if errorlevel 1 goto FAIL
) else (
    echo [3/4] android folder exists, skip cap add
)

echo [4/4] cap sync android...
call npx cap sync android
if errorlevel 1 goto FAIL

echo.
echo Done! Opening Android Studio...
call npx cap open android
goto END

:FAIL
echo.
echo Build failed.
pause
exit /b 1

:END
echo.
echo In Android Studio: wait for Gradle sync, then click Run (green triangle).
pause
