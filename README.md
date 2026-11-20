# Wrist vs Camera

Count your own pulse on your wrist. See if the camera agrees. See what leaves your computer.

Built for the DEV Presage SmartSpectra SDK Challenge with `@smartspectra/node-sdk` 3.5.0.

## How to test

**1 minute, no install, no key:** open **https://dannwaneri.github.io/wrist-vs-camera/?replay**
It plays saved numbers from a real session, labelled "Recorded session, not live". Use the 16x button to see the whole session in about 20 seconds.

**Measure yourself (about 5 minutes).** You need Node.js 20+, a free Presage key, and a camera that gives 25+ fps. The SDK runs as native code, so live mode runs on your own computer:

```bash
git clone https://github.com/dannwaneri/wrist-vs-camera.git
cd wrist-vs-camera
npm install
npm start
```

1. Open http://localhost:4317 and paste your key from https://physiology.presagetech.com/auth/register.
2. Choose a camera and press **Check and start**. A 20 s idle upload measurement runs first (camera off), then Device Readiness.
3. When a pulse shows, press **Start 60 s count**. Put two fingers on your wrist and count the beats in your head. Keep still. At 0, type your number and press **Compare**. (Option: press the Space bar on each beat.)
4. Read the result: your count vs the camera median for the same 60 s.

Platforms: Windows x64, macOS Apple Silicon, Linux x64 (the platforms the SDK supports). I tested only on Windows 11.

## What it does

1. **Setup check.** Calls the SDK's `checkDeviceReadiness()` (new in 3.5.0) and shows the verdict in plain words, plus the live frame rate (the SDK needs 25+ fps).
2. **Camera reading.** Live pulse and breathing. Each pulse value shows whether the SDK marks it *stable*. Presage's own documentation says *stable* means confidence 40 or more, which equals their ±3 bpm standard.
3. **Your count.** You count your own pulse for 60 s. The app compares your count with the median of every camera pulse value in the same 60 s. Rule, fixed before testing: within ±5 bpm = agree.
4. **Upload meter.** Measures how many bytes all network adapters send while idle (20 s), then during the session. Rule, fixed before testing: extra upload under 1 MB/min = no video stream uploaded; over 10 MB/min = video likely uploaded; between = unclear.

Heart rate variability is not shown. In my tests its confidence never passed 10 of 100.

## My test results (one person, at home in Nigeria, November 2026)

| Date | Camera | Light / power | Result |
|---|---|---|---|
| Nov 13 | Laptop webcam | Fluorescent / generator | 10 fps. Device Readiness: limited. No vitals |
| Nov 14 | Laptop webcam | Window / grid | Still 10 fps (ffmpeg too). Driver has no exposure lock |
| Nov 14 | Pixel 6 Pro via Phone Link | Window / grid | 30 fps. Pulse and breathing. No HRV. Extra upload 0.04 MB/min |
| Nov 16 | Pixel 6 Pro as USB webcam | Window / grid | 30 fps. HRV appears, but confidence never above 10 |
| Nov 16 | Pixel 6 Pro as USB webcam, 300 s | Window | Camera median 74.4 bpm. My 60 s hand counts: 70 before, 65 after (average 67.5). **6.9 bpm apart: fails my ±5 rule** |
| Nov 18 | This app, USB webcam | Window | Ready, 30.1 fps, extra upload 0.08 MB/min. I tapped each beat: 53 vs camera 79.2. **Disagree.** Only 7 of 32 camera values were stable while I tapped, so the default is now "count in your head" |
| Nov 18 | This app, USB webcam | Window | Counted in my head: 63. Not compared: a bug in my code crashed the app before it saved the count. Fixed |
| Nov 20 | This app, USB webcam, 5 tries | Afternoon | Device Readiness: limited, 5 of 5 ("reduce the requested workload or contention"). Frame rate fell from 30 to 15-20 after 25-65 s and the SDK stopped. No count could finish. This session is the hosted replay |

Every run, including the failed ones, is in `results/runs.csv`.

## Consent and data handling

- **The camera runs only after you press Check and start**, and stops when you press Stop or close the app.
- **Processing is on this computer.** The SDK processes video locally. The app turns SDK telemetry off (`enableTelemetry: false`).
- **What goes to Presage:** the SDK checks your API key and reports usage to Presage's servers. It does not send video (measured: see the upload meter and my results above).
- **Your vital numbers also go to Presage.** Presage's [LLM Insights page](https://smartspectra.presagetech.com/docs/llm-insights) says the SDK "automatically dispatches vitals snapshots" (pulse rate, HRV and breathing rate) during a session: one at the first stable reading of each, then one every 60 seconds. It says raw video and face images are never sent. This app does not request HRV, so only pulse and breathing are measured. I found no setting to turn the snapshots off. The upload meter cannot see something this small.
- **What the app stores:** your API key in a file named `.presage-key` in the app folder (delete it with "Remove saved key"). A session record with numbers only (no images) in `sessions/`, plus `sessions/errors.log` if the app hits an error. Nothing else, unless you press "Save results".
- **The preview** is a small, low-resolution image sent from the local server to your own browser tab on 127.0.0.1. It never leaves your computer.
- **The server listens only on 127.0.0.1** and refuses requests for other host names.
- **Not a medical device.** It does not diagnose or treat anything. If a reading worries you, see a health worker.

## Limits

- One person tested it, with one skin tone, one phone and one laptop.
- The hand count is itself a rough reference. A missed beat changes it.
- The upload meter counts all traffic from the computer. Other apps can push it up. Close cloud sync and video before a session.
- The macOS and Linux upload meters are written but not tested.

## License

MIT for this app's code (see `LICENSE`). The SmartSpectra SDK is installed from npm and has its own license from Presage Technologies.
