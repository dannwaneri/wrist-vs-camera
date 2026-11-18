# Field test runs

`runs.csv` holds every run of my test probe, including failed and stopped runs. One row per run.
The probe did not log the camera, so this table adds it, plus notes I took outside the probe.

| Run (UTC) | Camera | Notes |
|---|---|---|
| 2026-11-13T03-42-56 | Laptop webcam | Night. 10 fps. Readiness "limited". No vitals |
| 2026-11-13T04-01-43 | Laptop webcam | Pulse only. kFrameRateTooLow for 77 s |
| 2026-11-14T12-50-00 to 13-13-55 | Laptop webcam, then first phone tries | Daylight tests while finding a camera that gives 25+ fps |
| 2026-11-14T13-16-26 | Pixel 6 Pro via Phone Link | 6% OK frames. Breathing only |
| 2026-11-14T13-26-53 | Pixel 6 Pro via Phone Link | First good run. 120 s |
| 2026-11-16T09-29-26 | Pixel 6 Pro via Phone Link | 180 s. No HRV. Pharmacist hand counts 180 / 130 were not used (50 bpm apart) |
| 2026-11-16T10-10-02 | Pixel 6 Pro as USB webcam | 180 s. First HRV, at 177 s |
| 2026-11-16T10-27-00 | Pixel 6 Pro as USB webcam | Camera lost at start. No data |
| 2026-11-16T10-38-40 | Pixel 6 Pro as USB webcam | 300 s. My 60 s hand counts: 70 before, 65 after. Camera median 74.4. Fails ±5 |
| 2026-11-16T10-59-14 | Pixel 6 Pro as USB webcam | 300 s. HRV confidence never above 10 |

Frame rate checks (separate tool, 12 s per mode): laptop webcam 10 fps in all modes (15-17 fps with a phone torch); Pixel 6 Pro via Phone Link 30.3 fps; Pixel 6 Pro as USB webcam 29.5-30 fps.

## App sessions (Wrist vs Camera, 2026-11-18)

Saved records from the app, numbers only, in `app-sessions/` (UTC times in the file names).

| Session | Notes |
|---|---|
| 2026-11-18T09-49-00 | Camera lost (USB webcam dropped). The app stopped the session |
| 2026-11-18T09-51-17 | Short session, closed with Ctrl+C |
| (not saved) | Tapped count 53 vs camera 79.2, disagree, 7/32 stable. The window closed before Stop, so no file. Numbers from my screenshot |
| 2026-11-18T10-03-12 | Counted in my head: 63. The app stopped before the count was saved, so it is not compared |
