// UI for Wrist vs Camera. Live mode reads server events; replay mode plays a saved session file.
const $ = id => document.getElementById(id);
const show = (...ids) => ['keyStep', 'setupStep', 'liveStep', 'doneStep'].forEach(s => { $(s).hidden = !ids.includes(s); });
const COUNT_MS = 60000, AGREE_BPM = 5;

const READINESS_TEXT = {
  ready: ['Ready', 'good'],
  limited: ['Limited: readings may be weak', 'warn'],
  blocked: ['Blocked: this setup cannot measure', 'bad'],
  inconclusive: ['Could not decide', 'warn'],
};
const PHASE_TEXT = {
  readiness: 'Step 1 of 3: Device Readiness check (about 10 s). Face the camera.',
  baseline: 'Step 2 of 3: measuring idle upload for 20 s. Sit still, do not use the computer.',
  measuring: 'Step 3 of 3: measuring. Sit still and face the camera.',
};

let mode = 'live';           // 'live' | 'replay'
let state = freshState();
function freshState() {
  return { pulses: [], breaths: [], fps: [], readiness: null, upload: null, counts: [], count: null, camera: null, endReason: null };
}

// ---------- shared event handling (live and replay) ----------
function handle(type, d) {
  switch (type) {
    case 'phase':
      if (d.phase === 'done') return finish(d);
      show('liveStep');
      $('phaseText').textContent = PHASE_TEXT[d.phase] ?? '';
      if (d.camera) state.camera = d.camera;
      if (d.phase === 'baseline') countdownText('phaseText', PHASE_TEXT.baseline, d.seconds);
      break;
    case 'readiness': {
      state.readiness = d;
      const [txt, cls] = READINESS_TEXT[d.verdict] ?? [d.verdict, 'warn'];
      $('readiness').textContent = txt; $('readiness').className = cls;
      $('readinessReason').textContent = d.reason ?? '';
      break;
    }
    case 'status':
      $('hint').textContent = d.ok ? '' : (d.hint || d.code);
      break;
    case 'fps':
      state.fps.push(d.fps);
      $('fps').textContent = `${d.fps} fps`; $('fps').className = d.fps >= 25 ? 'good' : 'bad';
      break;
    case 'upload':
      state.upload = d;
      $('uploadNow').textContent = d.nowMBmin != null ? `${d.nowMBmin} MB/min` : '-';
      $('uploadVerdict').textContent = d.verdict ? (d.verdict === 'measuring' ? 'measuring...' : `${d.verdict} (extra ${d.extraMBmin} MB/min)`) : 'starts with the session';
      $('uploadVerdict').className = d.verdict === 'no video stream uploaded' ? 'good' : d.verdict === 'video likely uploaded' ? 'bad' : '';
      break;
    case 'metrics':
      if (d.pulse) {
        state.pulses.push({ t: d.t, ...d.pulse });
        $('pulse').textContent = Math.round(d.pulse.value);
        $('pulseLabel').textContent = d.pulse.stable ? `Stable (confidence ${Math.round(d.pulse.conf ?? 0)}; Presage's standard is ±3 bpm)` : 'Not stable: low confidence, ignore this value';
        $('pulseLabel').className = 'label ' + (d.pulse.stable ? 'good' : 'warn');
      }
      if (d.breath) { state.breaths.push({ t: d.t, ...d.breath }); $('breath').textContent = d.breath.value.toFixed(1); }
      break;
    case 'frame': drawFrame(d); break;
    case 'sdkError':
      $('hint').textContent = `Error: ${d.message}`;
      break;
    case 'countStart': beginCount(d.t); break;
    case 'tap': tap(d.t); break;
    case 'count': if (mode === 'replay') endCount(d); break;
  }
}

function countdownText(id, base, seconds) {
  let left = seconds;
  const iv = setInterval(() => {
    left -= 1;
    if (!$('phaseText').textContent.startsWith(base.slice(0, 10)) || left < 0) return clearInterval(iv);
    $(id).textContent = `${base} ${left} s left.`;
  }, mode === 'replay' ? 1000 / replaySpeed : 1000);
}

function drawFrame({ w, h, rgb }) {
  const c = $('preview'); if (c.width !== w) { c.width = w; c.height = h; }
  const ctx = c.getContext('2d'), img = ctx.createImageData(w, h), src = atob(rgb);
  for (let i = 0, j = 0; i < src.length; i += 3, j += 4) {
    img.data[j] = src.charCodeAt(i); img.data[j + 1] = src.charCodeAt(i + 1); img.data[j + 2] = src.charCodeAt(i + 2); img.data[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

// ---------- the 60 s hand count ----------
let timerIv = null;
function now() { return mode === 'replay' ? replayClock() : Date.now(); }

function beginCount(t = now()) {
  state.count = { start: t, taps: [] };
  $('countStart').disabled = true; $('beat').disabled = mode === 'replay';
  $('taps').textContent = '0'; $('countResult').textContent = '';
  clearInterval(timerIv);
  timerIv = setInterval(() => {
    if (!state.count) return clearInterval(timerIv);
    const left = Math.max(0, Math.ceil((state.count.start + COUNT_MS - now()) / 1000));
    $('countTimer').textContent = left;
    if (left === 0 && mode === 'live') askCount();
  }, 200);
}
// After 60 s: ask for the number. Taps (if any) fill the box; the person can correct it.
function askCount() {
  clearInterval(timerIv);
  if (!state.count || state.count.asked) return;
  state.count.asked = true; $('beat').disabled = true;
  $('countInput').value = state.count.taps.length || '';
  $('countForm').hidden = false; $('countInput').focus();
}
$('countForm').onsubmit = e => {
  e.preventDefault();
  const n = Number($('countInput').value);
  if (!state.count || !(n >= 20 && n <= 250)) return;
  $('countForm').hidden = true;
  endCount(null, n);
};
function tap(t = now()) {
  if (!state.count) return;
  if (t - state.count.start > COUNT_MS) return;
  state.count.taps.push(t);
  $('taps').textContent = state.count.taps.length;
  $('beat').classList.add('flash'); setTimeout(() => $('beat').classList.remove('flash'), 90);
}
function median(a) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

function endCount(recorded, typed) {
  clearInterval(timerIv);
  const c = state.count; state.count = null;
  if (!c && !recorded) return;
  $('countForm').hidden = true;
  $('countStart').disabled = mode === 'replay'; $('beat').disabled = true; $('countTimer').textContent = '60';
  let r = recorded;
  if (!r) {
    const inWin = state.pulses.filter(p => p.t >= c.start && p.t <= c.start + COUNT_MS);
    const cam = median(inWin.map(p => p.value));
    const count = typed ?? c.taps.length;
    r = {
      count, method: c.taps.length && count === c.taps.length ? 'tapped' : c.taps.length ? 'typed (taps were ' + c.taps.length + ')' : 'counted in head',
      cameraMedian: cam == null ? null : Math.round(cam * 10) / 10,
      n: inWin.length, nStable: inWin.filter(p => p.stable).length,
      tapTimes: c.taps.map(t => t - c.start), start: c.start,
    };
    r.diff = r.cameraMedian == null ? null : Math.round((r.cameraMedian - r.count) * 10) / 10;
    r.agree = r.diff == null ? null : Math.abs(r.diff) <= AGREE_BPM;
    fetch('/api/count', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(r) }).catch(() => {});
  }
  state.counts.push(r);
  const res = r.agree == null ? ['No camera pulse in this minute. Not judged.', 'warn']
    : r.agree ? [`Agree: ${Math.abs(r.diff)} bpm apart (limit ±${AGREE_BPM}).`, 'good']
      : [`Disagree: ${Math.abs(r.diff)} bpm apart (limit ±${AGREE_BPM}).`, 'bad'];
  $('countResult').textContent = res[0]; $('countResult').className = res[1];
  const tr = document.createElement('tr');
  tr.innerHTML = `<td>${r.count} <span class="small">(${r.method ?? 'tapped'})</span></td><td>${r.cameraMedian ?? '-'} <span class="small">(${r.nStable}/${r.n} stable)</span></td><td>${r.diff ?? '-'}</td><td class="${res[1]}">${r.agree == null ? 'not judged' : r.agree ? 'agree' : 'disagree'}</td>`;
  $('history').querySelector('tbody').appendChild(tr);
}

$('countStart').onclick = () => { if (mode === 'live') beginCount(); };
$('beat').onclick = () => { if (mode === 'live') tap(); };
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && state.count && mode === 'live') { e.preventDefault(); if (!e.repeat) tap(); }
});

// ---------- end of session ----------
function finish(d) {
  state.endReason = d.reason;
  if (d.upload) state.upload = { ...state.upload, ...d.upload };
  if (state.count && mode === 'live') endCount();
  const pm = median(state.pulses.map(p => p.value)), bm = median(state.breaths.map(b => b.value));
  const stablePct = state.pulses.length ? Math.round(100 * state.pulses.filter(p => p.stable).length / state.pulses.length) : null;
  const u = state.upload ?? {};
  const rows = [
    ['Camera', state.camera ?? '-'],
    ['Device Readiness', state.readiness ? `${state.readiness.verdict}: ${state.readiness.reason}` : '-'],
    ['Median frame rate', state.fps.length ? `${median(state.fps)} fps` : '-'],
    ['Camera pulse median (whole session)', pm == null ? '-' : `${pm.toFixed(1)} bpm, ${stablePct}% of values stable`],
    ['Breathing median', bm == null ? '-' : `${bm.toFixed(1)} per min`],
    ['Upload', u.verdict && u.verdict !== 'measuring' ? `${u.verdict}: idle ${u.baselineMBmin}, session ${u.sessionMBmin}, extra ${u.extraMBmin} MB/min` : 'not judged (session under 30 s)'],
    ['Your counts', state.counts.length ? state.counts.map(c => `${c.count} vs ${c.cameraMedian ?? '-'} (${c.agree == null ? 'not judged' : c.agree ? 'agree' : 'disagree'})`).join('; ') : 'none'],
    ['Ended', d.reason],
  ];
  $('summary').innerHTML = '<table>' + rows.map(([k, v]) => `<tr><th>${k}</th><td>${escapeHtml(String(v))}</td></tr>`).join('') + '</table>';
  $('saveBtn').hidden = mode === 'replay';
  show('doneStep');
}
const escapeHtml = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

$('saveBtn').onclick = () => {
  const out = { savedAt: new Date().toISOString(), note: 'Numbers only. No images.', ...state };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
  a.download = `wrist-vs-camera-${out.savedAt.replace(/[:.]/g, '-')}.json`; a.click();
};
$('againBtn').onclick = () => location.reload();
$('stopBtn').onclick = () => mode === 'live' ? fetch('/api/stop', { method: 'POST' }) : location.reload();

// ---------- live mode ----------
async function initLive() {
  const st = await fetch('/api/state').then(r => r.json());
  const es = new EventSource('/events');
  for (const t of ['phase', 'readiness', 'status', 'fps', 'upload', 'metrics', 'frame', 'sdkError']) {
    es.addEventListener(t, e => { if (mode === 'live') handle(t, JSON.parse(e.data)); });
  }
  es.onerror = () => {
    if (mode !== 'live') return;
    $('replayBanner').hidden = false;
    $('replayBanner').textContent = 'The app is not running. Your browser lost contact with it. Start it again with "npm start", then reload this page.';
  };
  es.onopen = () => { if (mode === 'live') $('replayBanner').hidden = true; };
  if (!st.hasKey) return show('keyStep');
  await loadCameras();
  show('setupStep');
}
async function loadCameras() {
  const cams = await fetch('/api/cameras').then(r => r.json());
  $('cameraSel').innerHTML = cams.map(c => `<option value="${c.index}">${escapeHtml(c.name)}</option>`).join('');
  const best = cams.find(c => /android webcam|usb/i.test(c.name)); if (best) $('cameraSel').value = best.index;
}
$('refreshCams').onclick = loadCameras;
$('keyForm').onsubmit = async e => {
  e.preventDefault();
  const r = await fetch('/api/key', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: $('keyInput').value }) });
  $('keyInput').value = '';
  if (!r.ok) { $('keyErr').textContent = (await r.json()).error; return; }
  await loadCameras(); show('setupStep');
};
$('forgetKey').onclick = async () => { await fetch('/api/key/delete', { method: 'POST' }); location.reload(); };
$('startBtn').onclick = async () => {
  state = freshState();
  $('readiness').textContent = 'checking...'; $('readiness').className = '';
  await fetch('/api/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ camera: $('cameraSel').value }) });
  show('liveStep'); $('phaseText').textContent = PHASE_TEXT.readiness;
};

// ---------- replay mode ----------
let replaySpeed = Number(new URLSearchParams(location.search).get('speed')) || 4, replayT0 = 0, replayWall0 = 0;
const replayClock = () => replayT0 + (Date.now() - replayWall0) * replaySpeed;
async function startReplay() {
  const file = await fetch('replay/sample.json').then(r => r.ok ? r.json() : null).catch(() => null);
  if (!file) { alert('No recorded session is bundled yet.'); return; }
  mode = 'replay'; state = freshState(); state.camera = file.camera;
  $('replayBanner').hidden = false;
  $('replayBanner').textContent = `Recorded session, not live (${replaySpeed}x speed). Saved numbers from a real run on ${file.recordedOn ?? 'a test day'}. No camera is in use and no key is needed.`;
  $('stopBtn').textContent = 'Leave replay';
  for (const id of ['readiness', 'fps', 'uploadNow', 'uploadVerdict', 'hint', 'readinessReason']) { $(id).textContent = '-'; $(id).className = ''; }
  $('hint').textContent = '';
  $('countStart').hidden = true; $('beat').hidden = true;
  $('countHelp').textContent = file.events.some(e => e.type === 'count')
    ? 'In this recording, each tap on the wrist pulse appears below as it happened.'
    : 'This recording has no hand count. Run the app with your own key to try the count.';
  const c = $('preview').getContext('2d');
  c.fillStyle = '#000'; c.fillRect(0, 0, 192, 108); c.fillStyle = '#bbb'; c.font = '11px system-ui'; c.textAlign = 'center';
  c.fillText('No video in a replay.', 96, 50); c.fillText('Images are never saved.', 96, 66);
  // Expand each saved count into its start and tap events so the count can be watched.
  const ev = [];
  for (const e of file.events) {
    if (e.type === 'count' && e.data.start != null) {
      ev.push({ t: e.data.start, type: 'countStart', data: { t: e.data.start } });
      for (const dt of e.data.tapTimes ?? []) ev.push({ t: e.data.start + dt, type: 'tap', data: { t: e.data.start + dt } });
    }
    ev.push(e);
  }
  ev.sort((a, b) => a.t - b.t);
  replayT0 = ev[0].t; replayWall0 = Date.now();
  let i = 0;
  (function step() {
    while (i < ev.length && ev[i].t <= replayClock()) {
      const e = ev[i++];
      const d = e.type === 'metrics' || e.type === 'countStart' || e.type === 'tap' ? { ...e.data, t: e.data.t ?? e.t } : e.data;
      handle(e.type, d);
    }
    if (i < ev.length && mode === 'replay') setTimeout(step, 50);
  })();
}
$('replayBtn1').onclick = startReplay;
$('replayBtn2').onclick = startReplay;

if (new URLSearchParams(location.search).has('replay')) startReplay(); else initLive();
