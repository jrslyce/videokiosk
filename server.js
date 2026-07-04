/*
 * Video Kiosk server — runs on the Windows PC with the Razer Kiyo attached.
 * Zero npm dependencies: just Node.js (18+) and FFmpeg on the PATH.
 *
 * Serves the tablet UI from ./public, records 1080p video+audio to
 * ./recordings via FFmpeg (DirectShow), and exposes a live MJPEG preview
 * so the tablet shows what the camera sees while recording.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;
const CONFIG_PATH = path.join(ROOT, 'config.json');

function loadConfig() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  return {
    port: 8080,
    videoDevice: 'Razer Kiyo',
    audioDevice: '',
    resolution: '1920x1080',
    framerate: 30,
    recordingsDir: 'recordings',
    filenamePrefix: 'memory',
    preview: true,
    previewFps: 15,
    previewWidth: 768,
    photoPosition: 20,
    ...cfg,
  };
}

let config = loadConfig();

const RECORDINGS_DIR = path.isAbsolute(config.recordingsDir)
  ? config.recordingsDir
  : path.join(ROOT, config.recordingsDir);
fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Recording state
// ---------------------------------------------------------------------------

const state = {
  recording: false,
  proc: null,
  file: null,
  startedAt: null,
  lastError: null,
  stopping: false,
};

const previewClients = new Set(); // http responses receiving MJPEG frames
let previewBuffer = Buffer.alloc(0);

function timestampName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${config.filenamePrefix}_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.mp4`
  );
}

function buildFfmpegArgs(outFile) {
  const hasAudio = Boolean(config.audioDevice && config.audioDevice.trim());
  const input = hasAudio
    ? `video=${config.videoDevice}:audio=${config.audioDevice}`
    : `video=${config.videoDevice}`;

  const args = [
    '-hide_banner',
    '-loglevel', 'warning',
    '-y',
    '-fflags', 'nobuffer',
    '-f', 'dshow',
    '-rtbufsize', '512M',
    '-framerate', String(config.framerate),
    '-video_size', config.resolution,
    '-i', input,
    // --- output 1: the 1080p recording ---
    '-map', '0:v',
  ];
  if (hasAudio) args.push('-map', '0:a');
  args.push(
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-pix_fmt', 'yuv420p'
  );
  if (hasAudio) args.push('-c:a', 'aac', '-b:a', '192k');
  args.push(outFile);

  // --- output 2: low-res MJPEG preview on stdout for the tablet ---
  if (config.preview) {
    args.push(
      '-map', '0:v',
      '-vf', `fps=${config.previewFps},scale=${config.previewWidth}:-2`,
      '-c:v', 'mjpeg',
      '-q:v', '10',
      '-f', 'mjpeg',
      'pipe:1'
    );
  }
  return args;
}

function broadcastPreviewChunk(chunk) {
  // Split the MJPEG byte stream into individual JPEG frames (FFD8 ... FFD9)
  previewBuffer = Buffer.concat([previewBuffer, chunk]);
  let start;
  while ((start = previewBuffer.indexOf(Buffer.from([0xff, 0xd8]))) !== -1) {
    const end = previewBuffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
    if (end === -1) {
      if (start > 0) previewBuffer = previewBuffer.subarray(start);
      return;
    }
    const frame = previewBuffer.subarray(start, end + 2);
    previewBuffer = previewBuffer.subarray(end + 2);
    for (const res of previewClients) {
      res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
      res.write(frame);
      res.write('\r\n');
    }
  }
}

function startRecording() {
  if (state.recording) return { ok: false, error: 'Already recording' };

  config = loadConfig(); // pick up config edits without restarting
  const outFile = path.join(RECORDINGS_DIR, timestampName());
  const args = buildFfmpegArgs(outFile);

  console.log('[kiosk] starting ffmpeg:', 'ffmpeg', args.join(' '));
  const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

  state.recording = true;
  state.proc = proc;
  state.file = outFile;
  state.startedAt = Date.now();
  state.lastError = null;
  state.stopping = false;
  previewBuffer = Buffer.alloc(0);

  let stderrTail = '';
  proc.stderr.on('data', (d) => {
    stderrTail = (stderrTail + d.toString()).slice(-2000);
  });
  proc.stdout.on('data', broadcastPreviewChunk);

  proc.on('exit', (code) => {
    const wasStopping = state.stopping;
    state.recording = false;
    state.proc = null;
    state.stopping = false;
    if (!wasStopping && code !== 0) {
      state.lastError = `FFmpeg exited unexpectedly (code ${code}). ${stderrTail.trim().split('\n').pop() || ''}`;
      console.error('[kiosk] ' + state.lastError);
    } else {
      console.log(`[kiosk] recording saved: ${state.file}`);
    }
    for (const res of previewClients) res.end();
    previewClients.clear();
  });

  proc.on('error', (err) => {
    state.recording = false;
    state.proc = null;
    state.lastError = `Could not start FFmpeg: ${err.message}. Is FFmpeg installed and on the PATH?`;
    console.error('[kiosk] ' + state.lastError);
  });

  return { ok: true, file: path.basename(outFile) };
}

function stopRecording() {
  if (!state.recording || !state.proc) return { ok: false, error: 'Not recording' };
  const proc = state.proc;
  state.stopping = true;
  try {
    proc.stdin.write('q'); // graceful quit → mp4 is finalized properly
  } catch (_) {
    proc.kill('SIGINT');
  }
  // Safety net: force kill if ffmpeg hasn't exited in 8s
  const killer = setTimeout(() => {
    if (state.proc === proc) {
      console.warn('[kiosk] ffmpeg did not exit gracefully, killing');
      proc.kill('SIGKILL');
    }
  }, 8000);
  proc.once('exit', () => clearTimeout(killer));
  return { ok: true, file: state.file ? path.basename(state.file) : null };
}

function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (d) => {
      size += d.length;
      if (size > limitBytes) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(d);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Settings the admin portal is allowed to change
const ADMIN_KEYS = [
  'eventTitle', 'dateBanner', 'promptIdle', 'promptRecording',
  'videoDevice', 'audioDevice', 'resolution', 'framerate',
  'filenamePrefix', 'preview', 'photoPosition', 'previewFps', 'previewWidth',
];

function photoVersion() {
  try {
    return Math.floor(fs.statSync(path.join(ROOT, 'public', 'photo.jpg')).mtimeMs);
  } catch (_) {
    return 0;
  }
}

function listDevices(cb) {
  const proc = spawn('ffmpeg', ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], {
    windowsHide: true,
  });
  let out = '';
  proc.stderr.on('data', (d) => (out += d.toString()));
  proc.on('exit', () => {
    const video = [];
    const audio = [];
    for (const line of out.split('\n')) {
      const m = line.match(/"([^"]+)"\s*\((video|audio)\)/);
      if (m) (m[2] === 'video' ? video : audio).push(m[1]);
    }
    cb({ video, audio, raw: out });
  });
  proc.on('error', (err) => cb({ video: [], audio: [], error: err.message }));
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  if (urlPath === '/admin') urlPath = '/admin.html';
  const filePath = path.join(ROOT, 'public', path.normalize(urlPath));
  if (!filePath.startsWith(path.join(ROOT, 'public'))) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (url === '/api/config' && req.method === 'GET') {
    config = loadConfig();
    return sendJson(res, 200, {
      eventTitle: config.eventTitle,
      dateBanner: config.dateBanner,
      promptIdle: config.promptIdle,
      promptRecording: config.promptRecording,
      preview: config.preview,
      photoPosition: config.photoPosition,
      photoVersion: photoVersion(),
    });
  }

  if (url === '/api/admin/config' && req.method === 'GET') {
    config = loadConfig();
    const out = {};
    for (const k of ADMIN_KEYS) out[k] = config[k];
    return sendJson(res, 200, out);
  }

  if (url === '/api/admin/config' && req.method === 'POST') {
    return readBody(req, 1024 * 1024)
      .then((body) => {
        const incoming = JSON.parse(body.toString('utf8'));
        const current = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        for (const k of ADMIN_KEYS) {
          if (k in incoming) current[k] = incoming[k];
        }
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(current, null, 2) + '\n');
        config = loadConfig();
        console.log('[kiosk] settings updated via admin portal');
        sendJson(res, 200, { ok: true });
      })
      .catch((err) => sendJson(res, 400, { ok: false, error: err.message }));
  }

  if (url === '/api/admin/photo' && req.method === 'POST') {
    return readBody(req, 30 * 1024 * 1024)
      .then((body) => {
        const isJpeg = body[0] === 0xff && body[1] === 0xd8;
        const isPng = body[0] === 0x89 && body[1] === 0x50;
        if (!isJpeg && !isPng) {
          return sendJson(res, 400, { ok: false, error: 'Please upload a JPEG or PNG image' });
        }
        fs.writeFileSync(path.join(ROOT, 'public', 'photo.jpg'), body);
        console.log('[kiosk] photo updated via admin portal');
        sendJson(res, 200, { ok: true, photoVersion: photoVersion() });
      })
      .catch((err) => sendJson(res, 400, { ok: false, error: err.message }));
  }

  if (url === '/api/status' && req.method === 'GET') {
    return sendJson(res, 200, {
      recording: state.recording,
      file: state.file ? path.basename(state.file) : null,
      startedAt: state.startedAt,
      elapsed: state.recording ? Math.floor((Date.now() - state.startedAt) / 1000) : 0,
      error: state.lastError,
    });
  }

  if (url === '/api/record/start' && req.method === 'POST') {
    const result = startRecording();
    return sendJson(res, result.ok ? 200 : 409, result);
  }

  if (url === '/api/record/stop' && req.method === 'POST') {
    const result = stopRecording();
    return sendJson(res, result.ok ? 200 : 409, result);
  }

  if (url === '/api/devices' && req.method === 'GET') {
    return listDevices((devices) => sendJson(res, 200, devices));
  }

  if (url === '/api/recordings' && req.method === 'GET') {
    return fs.readdir(RECORDINGS_DIR, (err, files) => {
      sendJson(res, 200, { files: err ? [] : files.filter((f) => f.endsWith('.mp4')).sort() });
    });
  }

  if (url === '/preview.mjpg' && req.method === 'GET') {
    if (!state.recording) {
      res.writeHead(503);
      return res.end('Not recording');
    }
    res.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
      'Cache-Control': 'no-store',
      Connection: 'close',
    });
    previewClients.add(res);
    req.on('close', () => previewClients.delete(res));
    return;
  }

  return serveStatic(req, res);
});

server.listen(config.port, () => {
  console.log('');
  console.log('  Video Kiosk running.');
  console.log(`  On this PC:      http://localhost:${config.port}`);
  console.log(`  On the tablet:   http://<this-PC's-LAN-IP>:${config.port}`);
  console.log(`  Recordings dir:  ${RECORDINGS_DIR}`);
  console.log('');
  console.log('  Tip: run scripts\\list-devices.bat to see camera/mic names for config.json');
  console.log('');
});
