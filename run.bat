@echo off
setlocal enabledelayedexpansion

:: ============================================================
::  OrderAPITest - Unified Test Runner
::
::  Usage:
::    run.bat                  Run tests -> HTML report
::    run.bat --push           Run + push failures to TAPD
::    run.bat --server         Start mock server + run tests
::    run.bat --push --server  Full pipeline
::    run.bat --help           Show this help
:: ============================================================

cd /d "%~dp0"

set COLLECTION=postman\order_api_collection.json
set ENVIRONMENT=postman\dev.environment.json
set REPORT_DIR=newman
set MOCK_DIR=mock-server
set MOCK_PORT=3000

:: ---- Parse flags -----------------------------------------------
set DO_PUSH=0
set DO_SERVER=0
set DO_HELP=0

:parse
if "%~1"=="" goto :parsed
if /i "%~1"=="--push"   set DO_PUSH=1
if /i "%~1"=="--server" set DO_SERVER=1
if /i "%~1"=="--help"   set DO_HELP=1
shift
goto :parse
:parsed

if %DO_HELP% equ 1 (
    echo.
    echo   OrderAPITest - Unified Test Runner
    echo   ========================================
    echo.
    echo   Usage:
    echo     run.bat                  Run tests -^> HTML report
    echo     run.bat --push           Run + push failures to TAPD
    echo     run.bat --server         Start mock server + run tests
    echo     run.bat --push --server  Full pipeline
    echo     run.bat --help           Show this help
    echo.
    echo   Prerequisites:
    echo     - Node.js ^>= 16
    echo     - Newman: npm install -g newman
    echo     - TAPD push: tapd-config.json required
    echo.
    exit /b 0
)

echo.
echo ============================================
echo   OrderAPITest - Automation Test Runner
echo ============================================
echo   Time     : %date% %time%
echo   Push TAPD: %DO_PUSH%
echo   Auto Mock: %DO_SERVER%
echo ============================================
echo.

:: ---- Check prerequisites --------------------------------------
where newman >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Newman not installed. Run: npm install -g newman
    exit /b 1
)

if not exist "%COLLECTION%" (
    echo [ERROR] Collection not found: %COLLECTION%
    exit /b 1
)
if not exist "%ENVIRONMENT%" (
    echo [ERROR] Environment not found: %ENVIRONMENT%
    exit /b 1
)

if not exist "%REPORT_DIR%" mkdir "%REPORT_DIR%"

:: ---- Start mock server if --server flag set ------------------
if %DO_SERVER% equ 1 (
    echo [INIT] Starting mock server...
    if not exist "%MOCK_DIR%\node_modules" (
        echo [INIT] Installing mock-server dependencies...
        pushd "%MOCK_DIR%"
        call npm install
        if %errorlevel% neq 0 (
            echo [ERROR] npm install failed
            popd
            exit /b 1
        )
        popd
    )
    start "OrderAPI-Mock" cmd /c "cd /d %CD%\%MOCK_DIR% && node server.js"
    echo [INIT] Waiting for mock server port %MOCK_PORT%...
    for /L %%i in (1,1,30) do (
        curl -s http://localhost:%MOCK_PORT%/login -X POST -H "Content-Type: application/json" -d "{\"username\":\"testuser\",\"password\":\"Test@123456\"}" >nul 2>nul
        if not errorlevel 1 goto :server_ready
        >nul timeout /t 1 /nobreak
    )
    echo [WARN] Mock server may not be ready, continuing...
    :server_ready
    echo [INFO] Mock server should be running
    echo.
)

:: ---- Reset mock data ------------------------------------------
echo [INIT] Resetting test data...
curl -s -X POST http://localhost:%MOCK_PORT%/__reset >nul 2>nul
if %errorlevel% neq 0 (
    echo [WARN] Data reset failed - mock server may not be running
) else (
    echo [INFO] Data reset OK
)
echo.

:: ---- Run 1: JSON report for TAPD push if --push --------------
if %DO_PUSH% equ 1 (
    echo [Step 1/2] Running tests with JSON output...
    newman run "%COLLECTION%" -e "%ENVIRONMENT%" -r cli,json --reporter-json-export "%REPORT_DIR%\report.json" --delay-request 100 --timeout-request 10000 --color on
    set NEWMAN_JSON_EXIT=%errorlevel%
    echo.
    echo [Step 1/2] JSON run exit code: %NEWMAN_JSON_EXIT%
    echo.

    echo [Step 2/2] Pushing failures to TAPD...
    node auto-create-bugs.js
    set TAPD_EXIT=%errorlevel%
    echo.
    echo [Step 2/2] TAPD push exit code: %TAPD_EXIT%
    echo.
)

:: ---- Run: HTML report -----------------------------------------
echo [Report] Generating HTML report...
newman run "%COLLECTION%" -e "%ENVIRONMENT%" -r html,cli --reporter-html-export "%REPORT_DIR%\report.html" --delay-request 100 --timeout-request 10000 --color on
set NEWMAN_HTML_EXIT=%errorlevel%
echo.
echo [Report] HTML: %REPORT_DIR%\report.html
echo.

:: ---- Summary --------------------------------------------------
echo ============================================
echo   Test Run Complete
echo ============================================
echo   HTML report     : %REPORT_DIR%\report.html

if %DO_PUSH% equ 1 (
    echo   JSON report     : %REPORT_DIR%\report.json
    echo   Newman -JSON-   : exit %NEWMAN_JSON_EXIT%
    echo   TAPD push       : exit %TAPD_EXIT%
)
echo   Newman -HTML-   : exit %NEWMAN_HTML_EXIT%
echo ============================================

if %DO_PUSH% equ 1 (
    if %NEWMAN_JSON_EXIT% neq 0 exit /b %NEWMAN_JSON_EXIT%
    if %TAPD_EXIT% neq 0 exit /b %TAPD_EXIT%
)
exit /b %NEWMAN_HTML_EXIT%
