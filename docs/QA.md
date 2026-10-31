# QA notes — Voltwing GP

## What was tested

**Environment:** Windows 10 desktop, ZCode in-app Chromium (devicePixelRatio 1.25), 1280×720. Local testing served via `python -m http.server`.

- Menu renders over a live attract-mode flythrough (auto-driving scene confirmed animated via canvas pixel probes).
- Full race flow: Play → 3-2-1-GO countdown → throttle, steering, boost → gate threading (charge + speed burst verified) → HUD updates (speed, lap, position, boost meter, lap timer).
- Pause / resume / restart / quit-to-menu all cycle correctly; pause freezes the simulation and drops the engine hum.
- Off-track: slowdown + dust particles + camera shake fire as expected.
- Mascot: welcome/return wave, start alert, gate cheer, crash reaction, lap cheer, sleep-on-pause all observed in screenshots.
- Touch UI renders (joystick + BOOST) when pointer:coarse is forced in a 390×844 and 844×390 iframe frame; layouts wrap correctly, safe-area padding present.
- Reduced-motion CSS path verified by inspection (breathe/sway loops disabled, blinks slowed).
- Personal best: time-based PB comparison (lower-is-better) verified in code and via the results screen logic.

## What was NOT tested (honest gaps)

- Physical mobile devices — touch layout verified in emulated-size frames only, not on real hardware.
- Audio output was verified by code inspection and no-error console runs; no human listened to the synthesized soundtrack in this pass.
- Firefox / Safari untested (Canvas2D + WebAudio APIs used are broadly standard).
- A full 3-lap race end-to-end was verified by simulation logic review; the finish path (results screen with PB) was exercised via the code path, not a timed full playthrough in this pass.
- Performance profiling beyond "runs at 60fps in dev tools on desktop" was not done. Low-tier mobile numbers are targets, not measurements.

## Known limitations

- The pseudo-3D road uses flat-shaded segments — the alternating band look at hill crests is a deliberate retro choice, not a rendering bug.
- Speech synthesis is intentionally not used; Nova communicates via authored text bubbles and music-free moments so the game works fully muted.
