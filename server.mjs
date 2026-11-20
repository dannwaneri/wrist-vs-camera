// Local server: owns the camera and the SmartSpectra SDK, serves the UI on 127.0.0.1 only.
// Camera frames never leave this process except as a small preview sent to your own browser tab.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
  SmartSpectraSDK, CameraSelection, ValidationCode, SmartSpectraErrorCode, PixelFormat,
  breathingMetrics, cardioMetrics,
} = require('@smartspectra/node-sdk');
const { decodeMetrics, Metrics } = require('@smartspectra/node-sdk/messages');

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(DIR, 'public');
const SESSIONS = path.join(DIR, 'sessions');
const KEY_FILE = path.join(DIR, '.presage-key');
const PORT = Number(process.env.PORT ?? 4317);
const HOST = '127.0.0.1';

// Upload rule, fixed before any test run (see README): extra upload under 1 MB/min = no video stream.
const LOCAL_MAX_MB_PER_MIN = 1;
const UPLOAD_MIN_MB_PER_MIN = 10;

const nameOf = (table, v) => Object.keys(table).find(k => table[k] === v) ?? String(v);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- API key (never sent to the browser) ----------
function readKey() {
  if (process.env.PHYSIOLOGY_API_KEY) return process.env.PHYSIOLOGY_API_KEY.trim();
  try { return fs.readFileSync(KEY_FILE, 'utf8').trim() || null; } catch { return null; }
}

// ---------- Server-sent events to the page ----------
const clients = new Set();
function send(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
  if (session?.record && type !== 'frame') session.record.push({ t: Date.now(), type, data }); // no images recorded
}

// ---------- Upload meter: bytes sent by all network adapters (loopback excluded) ----------
function sentBytes() {
  return new Promise(resolve => {
    if (process.platform === 'win32') {
      execFile('powershell', ['-NoProfile', '-Command',
        '(Get-NetAdapterStatistics | Measure-Object -Property SentBytes -Sum).Sum'],
        { windowsHide: true }, (err, out) => resolve(err ? null : Number(String(out).trim()) || null));
    } else if (process.platform === 'darwin') {
      execFile('netstat', ['-ib'], (err, out) => {
        if (err) return resolve(null);
        const seen = new Set(); let sum = 0;
        for (const line of String(out).split('\n').slice(1)) {
          const c = line.trim().split(/\s+/);
          if (c.length < 10 || c[0].startsWith('lo') || seen.has(c[0])) continue;
          seen.add(c[0]); sum += Number(c[c.length - 2]) || 0; // Obytes column
        }
        resolve(sum);
      });
    } else {
      fs.readFile('/proc/net/dev', 'utf8', (err, txt) => {
        if (err) return resolve(null);
        let sum = 0;
        for (const line of txt.split('\n').slice(2)) {
          const [name, rest] = line.split(':'); if (!rest || name.trim() === 'lo') continue;
          sum += Number(rest.trim().split(/\s+/)[8]) || 0;
        }
        resolve(sum);
      });
    }
  });
}
const meter = { samples: [] }; // { t, bytes }
async function meterTick() {
  const b = await sentBytes();
  if (b == null) return;
  meter.samples.push({ t: Date.now(), bytes: b });
  if (meter.samples.length > 400) meter.samples.shift();
  const s = meter.samples; if (s.length < 2) return;
  const a = s[Math.max(0, s.length - 3)], z = s[s.length - 1];
  const nowMBmin = (z.bytes - a.bytes) / 1e6 / ((z.t - a.t) / 60000);
  send('upload', { nowMBmin: round(nowMBmin, 2), ...uploadVerdict() });
}
function rateBetween(t0, t1) {
  const s = meter.samples.filter(x => x.t >= t0 && x.t <= t1);
  if (s.length < 2) return null;
  const a = s[0], z = s[s.length - 1];
  return (z.bytes - a.bytes) / 1e6 / ((z.t - a.t) / 60000);
}
function uploadVerdict(s = session) {
  if (s?.baseline == null || !s.startedAt) return { verdict: null };
  const sess = rateBetween(s.startedAt, Date.now());
  if (sess == null || Date.now() - s.startedAt < 30000) return { verdict: 'measuring', baselineMBmin: round(s.baseline, 2) };
  const extra = Math.max(0, sess - s.baseline);
  const verdict = extra < LOCAL_MAX_MB_PER_MIN ? 'no video stream uploaded'
    : extra > UPLOAD_MIN_MB_PER_MIN ? 'video likely uploaded' : 'unclear';
  return { verdict, baselineMBmin: round(s.baseline, 2), sessionMBmin: round(sess, 2), extraMBmin: round(extra, 2) };
}
setInterval(meterTick, 3000);
meterTick();

const round = (v, d = 1) => v == null ? null : Math.round(v * 10 ** d) / 10 ** d;

// ---------- SDK session ----------
let session = null; // { sdk, phase, cameraName, record, startedAt, baseline, ... }

function makeSdk() {
  return new SmartSpectraSDK({
    apiKey: readKey(),
    requestedMetrics: [...breathingMetrics, ...cardioMetrics],
    enableTelemetry: false,
  });
}

function wire(sdk) {
  let lastFrameAt = 0, frames = [], lastPreview = 0, lastStatus = null;
  sdk.on('validationStatus', (code, _ts, hint) => {
    if (code === lastStatus) return; // the SDK repeats it on every frame; send changes only
    lastStatus = code;
    send('status', { code: nameOf(ValidationCode, code), ok: code === ValidationCode.kOk, hint });
  });
  sdk.on('error', (code, message, retryable) => {
    send('sdkError', { code: nameOf(SmartSpectraErrorCode, code), message, retryable });
    if (!retryable) stopSession('error');
  });
  sdk.on('frameSentThrough', () => {
    const now = Date.now(); lastFrameAt = now; frames.push(now);
    while (frames.length && now - frames[0] > 5000) frames.shift();
  });
  sdk.on('metrics', buf => {
    const m = Metrics.toObject(decodeMetrics(buf), { longs: Number });
    const last = a => (a && a.length ? a[a.length - 1] : null);
    const p = last(m.cardio?.pulseRate), b = last(m.breathing?.rate);
    if (!p && !b) return;
    send('metrics', {
      t: Date.now(),
      pulse: p ? { value: round(p.value), conf: round(p.confidence), stable: !!p.stable } : null,
      breath: b ? { value: round(b.value), conf: round(b.confidence), stable: !!b.stable } : null,
    });
  });
  sdk.on('videoOutput', (buf, w, h, stride, fmt) => {
    const now = Date.now();
    if (now - lastPreview < 150 || !clients.size) return; // about 6 previews per second
    lastPreview = now;
    const px = { [PixelFormat.kRGB]: [3, 0, 2], [PixelFormat.kBGR]: [3, 2, 0], [PixelFormat.kRGBA]: [4, 0, 2], [PixelFormat.kBGRA]: [4, 2, 0] }[fmt];
    if (!px) return;
    const [bpp, ri, bi] = px, W = 192, H = Math.round(h * W / w), out = Buffer.alloc(W * H * 3);
    for (let y = 0; y < H; y++) {
      const row = Math.floor(y * h / H) * stride;
      for (let x = 0; x < W; x++) {
        const i = row + Math.floor(x * w / W) * bpp, o = (y * W + x) * 3;
        out[o] = buf[i + ri]; out[o + 1] = buf[i + 1]; out[o + 2] = buf[i + bi];
      }
    }
    send('frame', { w: W, h: H, rgb: out.toString('base64') });
  });
  const tick = setInterval(() => {
    if (!session || session.phase !== 'measuring') return;
    const fps = frames.length > 1 ? (frames.length - 1) / ((frames[frames.length - 1] - frames[0]) / 1000) : 0;
    send('fps', { fps: round(fps) });
    if (Date.now() - (lastFrameAt || session.startedAt) > 8000) {
      send('sdkError', { code: 'cameraLost', message: 'No camera frames for 8 s. Check the cable or camera, then start again.', retryable: false });
      stopSession('camera lost');
    }
  }, 1000);
  return () => clearInterval(tick);
}

async function startSession(cameraIndex) {
  if (session) throw new Error('A session is already running.');
  if (!readKey()) throw new Error('No API key saved.');
  const cams = SmartSpectraSDK.availableCameras();
  const cam = cams[cameraIndex];
  if (!cam) throw new Error('Camera not found. Refresh the camera list.');
  const sdk = makeSdk();
  session = { sdk, phase: 'readiness', cameraName: cam.name, record: [], stamp: new Date().toISOString().replace(/[:.]/g, '-') };
  session.unwire = wire(sdk);
  // Idle upload baseline first, with the camera still closed.
  // Then Device Readiness, then start at once: the USB phone webcam dropped
  // 3 times when the camera reopened 20 s after the readiness check.
  session.phase = 'baseline';
  send('phase', { phase: 'baseline', seconds: 20, camera: cam.name });
  const t0 = Date.now();
  await sleep(20000);
  if (!session) return;
  session.baseline = rateBetween(t0, Date.now()) ?? 0;

  session.phase = 'readiness';
  send('phase', { phase: 'readiness', camera: cam.name });
  sdk.useCamera(CameraSelection.byId(cam.id), { width: 1280, height: 720 });
  let readiness;
  try { readiness = await sdk.checkDeviceReadiness(); }
  catch (e) { readiness = { verdict: 'inconclusive', reason: e.message }; }
  send('readiness', { verdict: readiness.verdict, reason: readiness.reason });
  if (!session) return;
  if (readiness.verdict === 'blocked') { await stopSession('blocked by Device Readiness'); return; }

  session.phase = 'measuring';
  session.startedAt = Date.now();
  send('phase', { phase: 'measuring', baselineMBmin: round(session.baseline, 2) });
  try { sdk.start(); }
  catch (e) { send('sdkError', { code: 'startFailed', message: e.message, retryable: false }); await stopSession('start failed'); }
}

// Save the session record every 5 s, so a closed window loses at most 5 s of numbers.
function saveRecord(s) {
  try { fs.writeFileSync(path.join(SESSIONS, `${s.stamp}.json`), JSON.stringify({ camera: s.cameraName, events: s.record })); } catch {}
}
setInterval(() => { if (session) saveRecord(session); }, 5000);
process.on('SIGHUP', () => { if (session) saveRecord(session); process.exit(0); }); // console window closed
for (const ev of ['uncaughtException', 'unhandledRejection']) {
  process.on(ev, err => {
    const msg = `${new Date().toISOString()} ${ev}: ${err?.stack ?? err}\n`;
    console.error('\nThe app hit an error:\n' + msg);
    try { fs.appendFileSync(path.join(SESSIONS, 'errors.log'), msg); } catch {}
    if (session) { session.record.push({ t: Date.now(), type: 'crash', data: { message: String(err?.message ?? err) } }); saveRecord(session); }
    process.exit(1);
  });
}
process.on('exit', code => { if (session) saveRecord(session); if (code) console.error(`App stopped (exit code ${code}).`); });

async function stopSession(reason = 'stopped') {
  const s = session; if (!s) return;
  session = null;
  s.unwire?.();
  try { await s.sdk.stopAsync(); } catch {}
  try { await s.sdk.destroy(); } catch {}
  const summary = { reason, camera: s.cameraName, upload: uploadVerdict(s) };
  s.record.push({ t: Date.now(), type: 'phase', data: { phase: 'done', ...summary } });
  for (const res of clients) res.write(`event: phase\ndata: ${JSON.stringify({ phase: 'done', ...summary })}\n\n`);
  saveRecord(s);
}

// ---------- HTTP ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const body = req => new Promise(r => { let d = ''; req.on('data', c => { d += c; if (d.length > 1e5) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch { r({}); } }); });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}`);
  // Only answer requests addressed to this machine's loopback name (blocks DNS-rebinding pages).
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? '')) { res.writeHead(403); return res.end(); }
  try {
    if (url.pathname === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': ok\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return;
    }
    if (url.pathname === '/api/state') return json(res, 200, { hasKey: !!readKey(), keyFromEnv: !!process.env.PHYSIOLOGY_API_KEY, running: !!session, phase: session?.phase ?? null, platform: process.platform });
    if (url.pathname === '/api/cameras') return json(res, 200, SmartSpectraSDK.availableCameras().map((c, i) => ({ index: i, name: c.name })));
    if (req.method === 'POST' && url.pathname === '/api/key') {
      const { key } = await body(req);
      if (!key || typeof key !== 'string' || key.trim().length < 10) return json(res, 400, { error: 'That does not look like a key.' });
      fs.writeFileSync(KEY_FILE, key.trim(), { mode: 0o600 });
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/key/delete') { try { fs.unlinkSync(KEY_FILE); } catch {} return json(res, 200, { ok: true }); }
    if (req.method === 'POST' && url.pathname === '/api/start') {
      const { camera } = await body(req);
      startSession(Number(camera ?? 0)).catch(e => { send('sdkError', { code: 'startFailed', message: e.message }); stopSession('start failed'); });
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/stop') { await stopSession('stopped by user'); return json(res, 200, { ok: true }); }
    if (req.method === 'POST' && url.pathname === '/api/count') { // tap-count result, kept in the local session record
      const r = await body(req); if (session) session.record.push({ t: Date.now(), type: 'count', data: r });
      return json(res, 200, { ok: true });
    }
    // Static files
    let file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
      res.end(data);
    });
  } catch (e) { json(res, 500, { error: e.message }); }
});

server.listen(PORT, HOST, () => {
  console.log(`\nOpen http://localhost:${PORT} in your browser.`);
  console.log('The camera and the SDK run here. Ctrl+C to quit.\n');
});
process.on('SIGINT', async () => { await stopSession('app closed'); process.exit(0); });
