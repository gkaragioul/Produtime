@echo off
echo ========================================
echo ProduTime Licensing Server - Redeploy
echo ========================================
echo.

cd /d "%~dp0"

echo [1/3] Checking Railway CLI login...
railway whoami
if errorlevel 1 (
    echo.
    echo You need to login to Railway first.
    echo Running: railway login
    echo.
    railway login
)

echo.
echo [2/3] Linking Railway project...
railway link --project 925b1b9c-6fc0-4a19-8f80-aefca92f4ca7

echo.
echo [3/3] Deploying to Railway...
railway up --service produtime-licensing-server-production

echo.
echo ========================================
echo Deployment Complete!
echo ========================================
echo.
echo Admin Dashboard: https://produtime-licensing-server-production.up.railway.app/admin/
echo.

pause
