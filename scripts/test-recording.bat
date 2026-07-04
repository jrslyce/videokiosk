@echo off
rem Records a 10-second test clip using the devices in config.json settings below.
rem Edit the two device names to match list-devices.bat output before running.
set VIDEO=Razer Kiyo
set AUDIO=Microphone (Razer Kiyo)
cd /d "%~dp0.."
if not exist recordings mkdir recordings
echo Recording 10-second test clip...
ffmpeg -hide_banner -y -f dshow -rtbufsize 512M -framerate 30 -video_size 1920x1080 -i "video=%VIDEO%:audio=%AUDIO%" -t 10 -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 192k recordings\test.mp4
echo.
echo Done. Check recordings\test.mp4 - verify picture AND sound.
pause
