# Video Kiosk — Jack & Linda's Golden 50th Anniversary

A video message kiosk. Guests use an Android tablet as the interface: they press **RECORD**, a big **3, 2, 1, Start!** countdown appears with the prompt *"Introduce yourselves and share your favorite Jack & Linda memory with them! Press Stop when you are done."*, and a Windows PC records them at 1080p through a Razer Kiyo camera. Every clip is saved as an `.mp4` in a folder on the PC.

## How it works

```
Android tablet (Chrome, fullscreen)          Windows PC
┌──────────────────────────────┐    Wi-Fi    ┌─────────────────────────────┐
│  Kiosk web page              │ ──────────▶ │  Node.js server (server.js) │
│  RECORD / countdown / STOP   │   HTTP      │    └─ FFmpeg (DirectShow)   │
│  live preview while recording│ ◀────────── │        └─ Razer Kiyo +  mic │
└──────────────────────────────┘  MJPEG      │  recordings\*.mp4           │
                                             └─────────────────────────────┘
```

The tablet never records anything itself — it is purely a remote control. FFmpeg on the PC captures the Kiyo at 1920×1080 with whichever microphone is set in `config.json`, so the video quality does not depend on the tablet at all.

## PC setup (Windows)

1. **Install Node.js 18+** — https://nodejs.org (LTS), or `winget install OpenJS.NodeJS.LTS`
2. **Install FFmpeg** — `winget install Gyan.FFmpeg` (then open a new terminal so PATH updates)
3. **Get this repo** — `git clone https://github.com/jrslyce/videokiosk.git` (or download the ZIP)
4. **Plug in the Razer Kiyo**, then run `scripts\list-devices.bat`. It prints the exact camera and microphone names FFmpeg sees.
5. **Edit `config.json`** so `videoDevice` and `audioDevice` match those names exactly, for example:

   ```json
   "videoDevice": "Razer Kiyo",
   "audioDevice": "Microphone (Razer Kiyo)"
   ```

6. **Test** — run `scripts\test-recording.bat` and check `recordings\test.mp4` has good picture *and* sound.
7. **Add the photo** — copy the wedding photo to `public\photo.jpg` (shown on the left side of the kiosk while idle).
8. **Start the kiosk** — run `scripts\start-kiosk.bat`. The window prints the URL for the tablet. Windows will ask to allow Node.js through the firewall the first time — allow it on **Private networks**.

Recordings land in `recordings\memory_YYYY-MM-DD_HH-MM-SS.mp4`, one file per guest.

## Switching to the handheld microphone

If the Kiyo's built-in mic sounds bad on the test clip:

1. Plug in the handheld mic (USB, or via the PC's mic jack / audio interface).
2. Run `scripts\list-devices.bat` again and find its name in the audio list.
3. Change `audioDevice` in `config.json` to that name.
4. No restart needed — the server re-reads `config.json` at the start of every recording.

Tip: record a test with each mic (`scripts\test-recording.bat`, editing the `AUDIO` line) and compare before the event.

## Tablet setup (Android)

### Option A — USB-C cable (recommended)

If the tablet is plugged into the PC via USB-C, use **USB tethering** for a rock-solid connection that doesn't depend on venue Wi-Fi at all (it also keeps the tablet charged):

1. Plug the tablet into the PC with the USB-C cable.
2. On the tablet: **Settings → Network & internet → Hotspot & tethering → USB tethering → On** (the toggle only appears while the cable is connected; the tablet does *not* need internet for this).
3. On the PC, run `ipconfig` and find the new adapter (usually **"Ethernet adapter … Remote NDIS"**). Note its IPv4 address, e.g. `192.168.42.79`.
4. On the tablet, open Chrome and go to `http://<that-IP>:8080`, e.g. `http://192.168.42.79:8080`.
5. When Windows asks, allow Node.js through the firewall for this network. If the page won't load, the tether network may be flagged Public — either allow Node on Public too, or set the network to Private.

The tether IP can change between reconnects, so plug in and verify the address before the event starts.

### Option B — Wi-Fi

1. Connect the tablet to the **same Wi-Fi network** as the PC.
2. Find the PC's LAN IP: run `ipconfig` on the PC (e.g. `192.168.1.50`).
3. Open Chrome on the tablet and go to `http://192.168.1.50:8080`.
4. Give the PC a static IP or a DHCP reservation on your router so the address doesn't change mid-event.

### Either way — make it kiosk-like

1. Kiosk mode:
   - Chrome menu → **Add to Home screen** → open from the icon (fullscreen), or
   - use the free **Fully Kiosk Browser** app for true locked-down kiosk mode (recommended for events — it blocks the home button and keeps the screen awake).
2. Set the tablet display timeout to *never* (the page also requests a wake lock).

## Guest flow

1. Guest taps the big red **RECORD** button.
2. Fullscreen countdown: **3 … 2 … 1 … Start!** with the instruction text. (FFmpeg actually starts during the "1", so nothing is clipped.)
3. While recording: live camera preview with a pulsing **REC** badge, the prompt, a **STOP RECORDING** button, and a running timer.
4. Guest taps **STOP RECORDING** → "Thank you!" screen → kiosk resets for the next guest.

## Configuration reference (`config.json`)

| Key | Meaning |
|---|---|
| `port` | HTTP port the server listens on (default 8080) |
| `videoDevice` | Exact DirectShow camera name |
| `audioDevice` | Exact DirectShow microphone name (empty string = video only) |
| `resolution` | Capture size, default `1920x1080` |
| `framerate` | Capture FPS, default 30 |
| `recordingsDir` | Where `.mp4` files are saved |
| `filenamePrefix` | Prefix for each file name |
| `eventTitle` / `dateBanner` | Text shown on the kiosk |
| `promptIdle` | Prompt shown before recording |
| `promptRecording` | Instruction shown during countdown & recording |
| `preview` | `true` = live MJPEG preview on the tablet while recording |
| `previewFps` / `previewWidth` | Preview stream quality (kept low to protect recording performance) |

## API (used by the tablet page)

- `GET  /api/config` — kiosk text + settings
- `GET  /api/status` — `{recording, file, elapsed, error}`
- `POST /api/record/start` — begin a recording
- `POST /api/record/stop` — stop & finalize the current recording
- `GET  /api/devices` — cameras/mics FFmpeg can see
- `GET  /api/recordings` — list of saved files
- `GET  /preview.mjpg` — live MJPEG preview (only while recording)

## Troubleshooting

- **"Could not start FFmpeg"** — FFmpeg isn't on the PATH. Reinstall (`winget install Gyan.FFmpeg`) and open a new terminal.
- **"I/O error" / device name errors** — a device name in `config.json` doesn't exactly match `list-devices.bat` output (names must match character-for-character, including things like `Microphone (Razer Kiyo)`).
- **Device busy** — close any app using the Kiyo (Zoom, Teams, Camera app, Razer Synapse preview).
- **Tablet can't reach the page** — PC and tablet must be on the same network; allow Node through the Windows firewall (Private); check the IP with `ipconfig`.
- **Choppy 1080p** — the Kiyo outputs 1080p@30 max. If the PC is weak, change `-preset veryfast` to `ultrafast` in `server.js`, or drop `framerate` to 24.
- **No preview but recording works** — that's cosmetic; the file is still fine. Set `"preview": false` to hide it.

## Auto-start on boot (optional)

Task Scheduler → Create Basic Task → *When the computer starts* → Start a program → `scripts\start-kiosk.bat`. Or put a shortcut to it in `shell:startup`.
