@echo off
REM Builds a portable test copy of the app from this folder and starts it. Nothing is uploaded or released.
cd /d "%~dp0"
where npm >nul 2>nul || (echo Node.js is needed to build. Get the LTS version from https://nodejs.org && pause && exit /b 1)
echo Quitting any running PoE Upgrade Checker (only one copy can run at a time)...
taskkill /im "PoE Upgrade Checker.exe" /f >nul 2>nul
taskkill /im "PoE2 Upgrade Checker.exe" /f >nul 2>nul
taskkill /im "PoE-Upgrade-Checker-TEST.exe" /f >nul 2>nul
taskkill /im "PoE2-Upgrade-Checker-TEST.exe" /f >nul 2>nul
echo Installing build tools (first time takes a few minutes)...
call npm install --no-audit --no-fund || (echo npm install failed. & pause & exit /b 1)
echo Getting the Path of Building engine (first time downloads about 180 MB)...
call node tools\get-pob.js || (echo Could not get Path of Building - see the messages above. & pause & exit /b 1)
echo Checking the Path of Building engine...
call node tools\pob-smoke.js || echo WARNING: the Path of Building engine did not start - the app will use the gear score instead. Send the messages above to fix it.
REM The tests need Node 18.1 or newer; on older Node they are skipped (GitHub runs them on release anyway)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>18||(a===18&&b>=1)?0:1)"
if errorlevel 1 (
  echo Skipping tests: they need Node.js 18 or newer ^(you have one older^). Get the LTS from nodejs.org to run them.
  if exist test-results.txt del test-results.txt
) else (
  echo Running tests...
  call npm test >test-results.txt 2>&1 || (echo Some tests failed - see test-results.txt & pause & exit /b 1)
)
echo Building the test .exe...
call npx --yes electron-builder@26.18.0 --win portable --publish never -c.portable.artifactName=PoE-Upgrade-Checker-TEST.exe || (echo Build failed - see the messages above. & pause & exit /b 1)
echo.
echo Done: dist\PoE-Upgrade-Checker-TEST.exe - starting it now.
start "" "dist\PoE-Upgrade-Checker-TEST.exe"
