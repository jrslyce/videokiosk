@echo off
rem Records a 10-second test clip using the SAME devices the kiosk will use.
rem Device names are read from config.json - edit that file, not this one.
cd /d "%~dp0.."

for /f "usebackq delims=" %%i in (`node -e "process.stdout.write(require('./config.json').videoDevice)"`) do set "VIDEO=%%i"
for /f "usebackq delims=" %%i in (`node -e "process.stdout.write(require('./config.json').audioDevice||'')"`) do set "AUDIO=%%i"
for /f "usebackq delims=" %%i in (`node -e "process.stdout.write(require('./config.json').resolution||'1920x1080')"`) do set "RES=%%i"
for /f "usebackq delims=" %%i in (`node -e "process.stdout.write(String(require('./config.json').framerate||30))"`) do set "FPS=%%i"

echo Camera:     %VIDEO%
echo Microphone: %AUDIO%
echo.
if not exist recordings mkdir recordings
echo Recording 10-second test clip...

if "%AUDIO%"=="" (
  ffmpeg -hide_banner -y -f dshow -rtbufsize 512M -framerate %FPS% -video_size %RES% -i "video=%VIDEO%" -t 10 -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p recordings\test.mp4
) else (
  ffmpeg -hide_banner -y -f dshow -rtbufsize 512M -framerate %FPS% -video_size %RES% -i "video=%VIDEO%:audio=%AUDIO%" -t 10 -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 192k recordings\test.mp4
)

echo.
echo Done. Check recordings\test.mp4 - verify picture AND sound.
pause
