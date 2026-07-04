@echo off
rem Lists every DirectShow camera and microphone FFmpeg can see.
rem Copy the exact names (in quotes) into config.json.
echo.
echo ==== Cameras and microphones visible to FFmpeg ====
echo.
ffmpeg -hide_banner -list_devices true -f dshow -i dummy 2>&1 | findstr /C:"(video)" /C:"(audio)"
echo.
echo Copy the exact device name into config.json:
echo   "videoDevice": camera name   (e.g. Razer Kiyo)
echo   "audioDevice": microphone name (e.g. Microphone (Razer Kiyo))
echo.
pause
