/* ============================================================
 * VOLTWING GP — neon hovercar circuit racer.
 * Pseudo-3D projected track floating above a dusk city: curves,
 * hills, orbit boost gates, five rival drones, attract-mode.
 * All art is drawn with canvas paths each frame; all audio is
 * synthesized. No image or sound assets.
 * ============================================================ */
(function () {
  'use strict';

  /* ---------------- tuning ---------------- */
  const SEG = 200;                  // world units per segment
  const ROADW = 2200;               // road half width, world units
  const CAMH = 1150;                // camera height above road
  const DRAW = 88;                  // segments drawn per frame
  const N = 620;                    // segments in the circuit
  const TRACKLEN = N * SEG;
  const MAXS = 11800;               // units / second
  const LAPS = 3;
  const FOVD = 1 / Math.tan(50 * Math.PI / 180);   // 100 deg vertical fov

  const RIVAL_DEFS = [
    { name: 'KESTREL', color: '#FF6EC7', pace: 0.965 },
    { name: 'VOLT-7',  color: '#7EE8FF', pace: 0.945 },
    { name: 'HALO',    color: '#B08CFF', pace: 0.925 },
    { name: 'DUSKRUN', color: '#FFD166', pace: 0.90 },
    { name: 'MOTH',    color: '#8AFFC1', pace: 0.875 }
  ];

  /* ---------------- world state ---------------- */
  let segs = [];
  let gates = [];
  let rivals = [];
  let skyOffset = 0;
  let camZ = 0, playerX = 0, speed = 0, energy = 70;
  let boosting = false, boostLerp = 0;
  let lap = 1, lapStart = 0, raceTime = 0, lastLap = 0, bestLap = Infinity;
  let topSpeed = 0, position = 6, state = 'attract';
  let cdTimer = 0, cdValue = 3, offroadT = 0;
  let particles = Kit.particles();
  let totalDist = 0, prevSegIdx = 0;
  let steerSm = 0;

  const W = { w: 0, h: 0 };
  let skyGrad = null, groundGrad = null, vignette = null;
  let stars = [], skylineFar = [], skylineNear = [];
  const segSX = new Float32Array(DRAW + 2), segSY = new Float32Array(DRAW + 2),
        segSW = new Float32Array(DRAW + 2), segSC = new Float32Array(DRAW + 2);

  /* ---------------- track ---------------- */
  function elevation(z) {           // periodic -> the lap loops seamlessly
    const k = (z / TRACKLEN) * Math.PI * 2;
    return 1150 * Math.sin(k) + 430 * Math.sin(k * 3 + 1.4);
  }

  function buildTrack() {
    segs = [];
    const sections = [
      [0, 46], [2.6, 44], [-3.4, 40], [4.6, 30], [-1.6, 34],
      [0, 36], [3.2, 42], [-4.8, 34], [1.2, 40], [-2.4, 44], [0, 30],
      [4.2, 26], [-2.8, 38], [0, 46], [-3.6, 36], [2.2, 44]
    ];
    for (const [curve, len] of sections) {
      for (let i = 0; i < len; i++) segs.push({ curve, y1: 0, y2: 0, gate: false, pylon: 0 });
    }
    while (segs.length < N) segs.push({ curve: 0, y1: 0, y2: 0, gate: false, pylon: 0 });
    segs.length = N;
    for (let i = 0; i < N; i++) {
      segs[i].y1 = elevation(i * SEG);
      segs[i].y2 = elevation((i + 1) * SEG);
    }
    gates = [];
    for (let s = 40; s < N - 10; s += 52) {
      segs[s].gate = true;
      gates.push({ seg: s, hit: false });
    }
    for (let s = 6; s < N; s += 14) segs[s].pylon = (s / 14) % 2 === 0 ? -1.22 : 1.22;
  }

  function buildScenery() {
    stars = [];
    for (let i = 0; i < 110; i++) stars.push({ x: Math.random(), y: Math.random() * 0.4, r: Math.random() * 1.3 + 0.4, p: Math.random() * 6.28 });
    skylineFar = []; skylineNear = [];
    let x = 0;
    while (x < 2.2) {
      skylineFar.push({ x, w: 0.03 + Math.random() * 0.07, h: 0.05 + Math.random() * 0.15, lit: Math.random() });
      x += 0.045 + Math.random() * 0.04;
    }
    x = -0.1;
    while (x < 2.2) {
      skylineNear.push({ x, w: 0.05 + Math.random() * 0.1, h: 0.09 + Math.random() * 0.24, lit: Math.random() });
      x += 0.07 + Math.random() * 0.05;
    }
  }

  function resetRivals() {
    rivals = RIVAL_DEFS.map((d, i) => ({
      ...d,
      z: 1400 + i * 620,
      x: [-0.55, 0.2, -0.15, 0.55, -0.4][i],
      total: 0, wobble: Math.random() * 6.28
    }));
  }

  /* ---------------- race control ---------------- */
  let G = null;                     // assigned at boot

  function startRace() {
    buildTrack(); resetRivals();
    camZ = 0; playerX = 0; speed = 0; energy = 70;
    lap = 1; lapStart = 0; raceTime = 0; lastLap = 0; bestLap = Infinity;
    topSpeed = 0; totalDist = 0; prevSegIdx = 0; offroadT = 0;
    particles.clear();
    state = 'countdown'; cdTimer = 0; cdValue = 3;
    showCountdown('3');
    Audio.playSong('race');
    Audio.loop('engine', { wave: 'sawtooth', freq: 52, maxFreq: 210, cutoff: 340, gain: 0.09 });
    Mascot.react('start');
  }

  function toAttract() {
    state = 'attract';
    speed = MAXS * 0.42;
    playerX = 0; energy = 70;
    Audio.stopLoop('engine');
    Audio.playSong('menu');
    resetRivals();
  }

  function finishRace() {
    state = 'done';
    Audio.stopLoop('engine');
    Audio.stopSong();
    G.pause();
    const pos = position;
    Kit.showResults({
      medal: pos === 1 ? '🏆' : pos <= 3 ? '🥈' : '🔧',
      kicker: pos === 1 ? 'Circuit champion' : `Finished P${pos}`,
      title: pos === 1 ? 'Clean sweep, pilot' : pos <= 3 ? 'On the podium' : 'The drones got lucky',
      stats: [
        { label: 'Total', value: fmtTime(raceTime) },
        { label: 'Best lap', value: fmtTime(bestLap) },
        { label: 'Top speed', value: Math.round(topSpeed / MAXS * 322) + ' km/h' }
      ],
      best: { value: raceTime, lowerBetter: true },
      mascotLine: pos === 1 ? 'The drones want a rematch already.' : 'Grid is still hot — she wants another run.'
    });
    Mascot.react(pos === 1 ? 'win' : 'fail');
  }

  /* ---------------- update ---------------- */
  function update(dt) {
    const input = Kit.input;
    if (state === 'race') raceTime += dt;

    if (state === 'countdown') {
      cdTimer += dt;
      const next = 3 - Math.floor(cdTimer);
      if (next !== cdValue && next >= 0) {
        cdValue = next;
        showCountdown(next === 0 ? 'GO' : String(next));
        Audio.sfx(next === 0 ? 'chime' : 'select');
        if (next === 0) {
          state = 'race'; lapStart = raceTime;
          setTimeout(hideCountdown, 850);
        }
      }
    }

    const racing = state === 'race';
    const attract = state === 'attract';
    const speedRatio = speed / MAXS;

    /* throttle */
    if (racing) {
      const wantBoost = (input.down('boost') || input.down('action')) && energy > 1;
      boosting = wantBoost && speed > MAXS * 0.3;
      if (boosting) {
        energy = Math.max(0, energy - 26 * dt);
        boostLerp = Math.min(1, boostLerp + dt * 3);
      } else {
        energy = Math.min(100, energy + 6.5 * dt);
        boostLerp = Math.max(0, boostLerp - dt * 2.2);
      }
      const cap = MAXS * (1 + 0.32 * boostLerp);
      speed += (cap - speed) * dt * (speed < cap ? 1.15 : 0.6);
      topSpeed = Math.max(topSpeed, speed);
    } else if (attract) {
      boosting = false; boostLerp = Math.max(0, boostLerp - dt * 2);
      speed += (MAXS * 0.42 - speed) * dt * 0.8;
    } else if (state === 'done') {
      boosting = false;
      speed *= 1 - 1.8 * dt;
    } else speed = 0;

    /* steering */
    steerSm += (input.axis().x - steerSm) * Math.min(1, dt * 12);
    if (racing) {
      playerX += steerSm * dt * 2.1 * (0.35 + 0.75 * speedRatio);
      playerX -= segAt(camZ).curve * speedRatio * dt * 2.1;
      playerX = Kit.clamp(playerX, -2.4, 2.4);
    } else if (attract) {
      playerX += (-segAt(camZ).curve * 0.8 - playerX) * dt * 1.2;
    }

    /* off the energy strip */
    if (racing && Math.abs(playerX) > 1.02 && speed > 800) {
      offroadT += dt;
      speed *= 1 - 1.5 * dt;
      G.shake(2.2);
      if (Math.random() < 0.4) particles.spawn(W.w / 2 + playerX * W.w * 0.1, W.h * 0.88, { count: 3, color: '#FFB35C', spread: 90, vy: -60, grav: 140, decay: 2.4, size: 2.4 });
      if (offroadT > 2.2) { offroadT = 0; Mascot.react('crash'); }
    } else offroadT = Math.max(0, offroadT - dt);

    /* advance */
    camZ += speed * dt;
    while (camZ >= TRACKLEN) camZ -= TRACKLEN;
    totalDist += speed * dt;
    skyOffset += segAt(camZ).curve * speedRatio * dt * 9;

    /* lap crossing */
    if (racing) {
      const segIdx = Math.floor(camZ / SEG);
      if (prevSegIdx > N - 40 && segIdx < 40) {
        lastLap = raceTime - lapStart;
        lapStart = raceTime;
        bestLap = Math.min(bestLap, lastLap);
        if (lap >= LAPS) { finishRace(); return; }
        lap++;
        Audio.sfx('checkpoint');
        Mascot.react('lap');
        Kit.toast(`Lap ${lap} / ${LAPS}`);
        /* pit board: a Git concept while the lap runs — correct read patches the cell */
        if (window.Learn && window.LEARN_DATA) {
          const card = Learn.nextCard();
          if (card) {
            Learn.show(card, { timer: 16 }).then(ok => {
              if (ok && state === 'race') {
                energy = Math.min(100, energy + 30);
                Audio.sfx('powerup');
                particles.spawn(W.w / 2, W.h * 0.3, { count: 12, color: '#FFD166', spread: 220, decay: 2.2, size: 2.6, glow: true });
                Kit.toast('+30 boost cell — clean read');
              }
            });
          }
        }
      }
      prevSegIdx = segIdx;
    }

    /* rivals (grid-locked until the lights go out) */
    const rivalsMove = racing || attract || state === 'done';
    for (const r of rivals) {
      if (!rivalsMove) continue;
      r.wobble += dt;
      const pace = Math.min(1.06, r.pace + Math.sin(r.wobble * 0.9) * 0.05 + (racing ? lap * 0.012 : 0));
      const rs = MAXS * pace;
      r.z += rs * dt; r.total += rs * dt;
      while (r.z >= TRACKLEN) r.z -= TRACKLEN;
      r.x = Kit.clamp(r.x + Math.sin(r.wobble * 0.5) * dt * 0.14, -0.85, 0.85);
      if (racing) {
        let dz = r.z - camZ; if (dz < 0) dz += TRACKLEN;
        if (dz < SEG * 1.6 && Math.abs(r.x - playerX) < 0.34 && speed > rs * 0.75) {
          speed = Math.min(speed, rs * 0.55);
          G.shake(7);
          Audio.sfx('hit');
          Kit.buzz(60);
          particles.spawn(W.w / 2, W.h * 0.8, { count: 14, color: '#FFD166', spread: 260, decay: 2, size: 2.6, glow: true });
          Mascot.react('crash');
        }
      }
    }
    if (racing) {
      let ahead = 0;
      for (const r of rivals) if (r.total > totalDist) ahead++;
      position = ahead + 1;
    }

    /* orbit gates */
    if (racing) {
      const segIdx = Math.floor(camZ / SEG);
      for (const g of gates) {
        if (g.seg === segIdx && Math.abs(playerX) < 0.62) {
          energy = Math.min(100, energy + 20);
          speed += 650;
          Audio.sfx('powerup');
          Kit.buzz(25);
          particles.spawn(W.w / 2 + playerX * W.w * 0.1, W.h * 0.5, { count: 10, color: '#7EE8FF', spread: 200, decay: 2.2, size: 2.6, glow: true });
          Mascot.react('gate');
        }
      }
      if (energy < 22) Mascot.react('low');
    }

    /* audio follows the race */
    Audio.setLoop('engine', 'pitch', speedRatio * (1 + 0.25 * boostLerp));
    Audio.setLoop('engine', 'gain', racing ? 0.09 : 0);
    Audio.setIntensity(racing ? 0.35 + 0.65 * speedRatio : 0.15);

    particles.update(dt);
  }

  /* ---------------- projection ---------------- */
  function segAt(z) { return segs[Math.floor(z / SEG) % N]; }

  /* projects a point on the road plane to screen space.
     curveX = accumulated lateral road offset (world units) */
  function proj(curveX, worldY, absZ, camY, horizon) {
    const dz = Math.max(0.001, absZ - camZ);
    const k = FOVD * (W.w / 2) / dz;      // px per world unit
    return {
      x: W.w / 2 + k * (curveX - playerX * ROADW),
      y: horizon + k * (camY - worldY),
      w: k * ROADW,
      k
    };
  }

  /* ---------------- render ---------------- */
  function render(ctx, gg) {
    const { w, h } = W;
    const horizon = h * 0.42;
    const camY = CAMH + segAt(camZ).y1;

    /* sky */
    if (!skyGrad) {
      skyGrad = ctx.createLinearGradient(0, 0, 0, horizon * 1.05);
      skyGrad.addColorStop(0, '#0B0F1C');
      skyGrad.addColorStop(0.45, '#2A1B4E');
      skyGrad.addColorStop(0.78, '#83305E');
      skyGrad.addColorStop(1, '#FF8A5C');
    }
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, horizon + 2);

    /* stars */
    ctx.fillStyle = '#EAF1FF';
    for (const s of stars) {
      ctx.globalAlpha = (0.35 + 0.6 * Math.abs(Math.sin(gg.t * 1.4 + s.p))) * 0.8;
      ctx.fillRect(((s.x + skyOffset * 0.012) % 1 + 1) % 1 * w, s.y * horizon, s.r, s.r);
    }
    ctx.globalAlpha = 1;

    /* dusk sun with scan bands */
    const sunX = ((0.6 - skyOffset * 0.02) % 1.2 + 1.2) % 1.2 * w - w * 0.1;
    const sunY = horizon - h * 0.1;
    const sunR = Math.min(w, h) * 0.17;
    const sg = ctx.createLinearGradient(0, sunY - sunR, 0, sunY + sunR);
    sg.addColorStop(0, '#FFE08B'); sg.addColorStop(0.55, '#FF9E6E'); sg.addColorStop(1, '#FF5E8A');
    ctx.save();
    ctx.beginPath(); ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = sg; ctx.fillRect(sunX - sunR, sunY - sunR, sunR * 2, sunR * 2);
    ctx.fillStyle = 'rgba(11,15,28,0.5)';
    for (let i = 0; i < 5; i++) ctx.fillRect(sunX - sunR, sunY + sunR * (0.05 + i * 0.2), sunR * 2, 2 + i * 1.6);
    ctx.restore();

    drawSkyline(ctx, skylineFar, horizon, skyOffset * 0.045, h * 0.3, '#241B45', '#8A6CD8', w, h);
    drawSkyline(ctx, skylineNear, horizon, skyOffset * 0.1 + 0.35, h * 0.2, '#171230', '#B476E8', w, h);

    /* haze floor */
    if (!groundGrad) {
      groundGrad = ctx.createLinearGradient(0, horizon, 0, h);
      groundGrad.addColorStop(0, '#43204E');
      groundGrad.addColorStop(1, '#120D20');
    }
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, horizon, w, h - horizon);

    /* road: accumulate curve the classic way */
    const base = Math.floor(camZ / SEG);
    const frac = (camZ % SEG) / SEG;
    let x = 0, dx = -(segs[base].curve * frac);
    let maxy = h + 60;

    for (let n = 0; n < DRAW; n++) {
      const idx = (base + n) % N;
      const seg = segs[idx];
      const x1 = x;
      x += dx; dx += seg.curve;
      const p1 = proj(x1, seg.y1, (base + n) * SEG, camY, horizon);
      const p2 = proj(x, seg.y2, (base + n + 1) * SEG, camY, horizon);
      segSX[n] = p1.x; segSY[n] = p1.y; segSW[n] = p1.w; segSC[n] = p1.k;
      if (p2.y >= maxy) continue;         // behind a hill crest
      maxy = p2.y;
      const alt = Math.floor(idx / 3) % 2 === 0;
      ctx.fillStyle = alt ? '#181D30' : '#141827';
      quad(ctx, p1.x, p1.y, p1.w, p2.x, p2.y, p2.w);
      const edge = Math.floor(idx / 6) % 2 === 0 ? '#7EE8FF' : '#FF6EC7';
      edgeLine(ctx, p1.x, p1.y, p1.w, p2.x, p2.y, p2.w, -1, edge);
      edgeLine(ctx, p1.x, p1.y, p1.w, p2.x, p2.y, p2.w, 1, edge);
      if (idx % 8 < 3) edgeLine(ctx, p1.x, p1.y, p1.w, p2.x, p2.y, p2.w, 0, 'rgba(234,241,255,0.4)');
    }

    /* sprites far -> near */
    for (let n = DRAW - 1; n > 0; n--) {
      const idx = (base + n) % N;
      if (segs[idx].pylon && segSC[n] > 0.0004) drawPylon(ctx, n, segs[idx].pylon);
      if (segs[idx].gate) drawGate(ctx, n);
    }
    for (const r of rivals) drawRival(ctx, r);

    particles.render(ctx);
    drawPlayer(ctx, gg);

    /* boost streaks */
    if (boostLerp > 0.25) {
      ctx.strokeStyle = 'rgba(126,232,255,0.22)';
      ctx.lineWidth = 2;
      const cx = w / 2, cy = h * 0.55;
      for (let i = 0; i < 8 * boostLerp; i++) {
        const a = Math.random() * Math.PI * 2;
        const r0 = Math.min(w, h) * 0.3, r1 = r0 + 100 * boostLerp;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 0.6);
        ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1 * 0.6);
        ctx.stroke();
      }
    }

    if (!vignette || vignette.w !== w) {
      vignette = { w, g: ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.max(w, h) * 0.74) };
      vignette.g.addColorStop(0, 'rgba(0,0,0,0)'); vignette.g.addColorStop(1, 'rgba(4,6,14,0.5)');
    }
    ctx.fillStyle = vignette.g;
    ctx.fillRect(0, 0, w, h);

    updateHUD();
  }

  function quad(ctx, x1, y1, w1, x2, y2, w2) {
    ctx.beginPath();
    ctx.moveTo(x1 - w1, y1); ctx.lineTo(x1 + w1, y1);
    ctx.lineTo(x2 + w2, y2); ctx.lineTo(x2 - w2, y2);
    ctx.closePath(); ctx.fill();
  }

  function edgeLine(ctx, x1, y1, w1, x2, y2, w2, side, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = side === 0 ? Math.max(1, w1 * 0.008) : Math.max(1, w1 * 0.02);
    ctx.beginPath();
    ctx.moveTo(x1 + w1 * side, y1);
    ctx.lineTo(x2 + w2 * side, y2);
    ctx.stroke();
  }

  function drawSkyline(ctx, layer, horizon, off, maxH, dark, lit, w, h) {
    for (const b of layer) {
      const bx = (((b.x + off) % 2.2) + 2.2) % 2.2 * w - w * 0.1;
      const bw = b.w * w, bh = b.h * h;
      if (bx + bw < -40 || bx > w + 40) continue;
      ctx.fillStyle = dark;
      ctx.fillRect(bx, horizon - bh, bw, bh);
      ctx.fillStyle = lit;
      ctx.globalAlpha = 0.28 + 0.35 * b.lit;
      const cols = Math.max(1, Math.floor(bw / 9)), rows = Math.max(1, Math.floor(bh / 12));
      for (let c = 0; c < cols; c += 2) {
        for (let r = 0; r < rows; r += 2) {
          if ((c * 7 + r * 13 + b.lit * 97) % 5 < 2.2) ctx.fillRect(bx + 3 + c * 9, horizon - bh + 5 + r * 12, 3, 4.5);
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawPylon(ctx, n, side) {
    const x = segSX[n] + segSW[n] * side, y = segSY[n];
    const hh = segSW[n] * 0.5;
    if (hh < 2) return;
    ctx.strokeStyle = 'rgba(159,178,212,0.7)';
    ctx.lineWidth = Math.max(1, hh * 0.05);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - hh); ctx.stroke();
    ctx.fillStyle = side < 0 ? '#7EE8FF' : '#FF6EC7';
    ctx.beginPath(); ctx.arc(x, y - hh, Math.max(1.4, hh * 0.05), 0, Math.PI * 2); ctx.fill();
  }

  function drawGate(ctx, n) {
    const cx = segSX[n], y = segSY[n], hw = segSW[n] * 0.66, hh = segSW[n] * 0.42;
    if (hh < 3) return;
    const pulse = 0.75 + 0.25 * Math.sin(performance.now() / 250);
    ctx.strokeStyle = `rgba(126,232,255,${0.9 * pulse})`;
    ctx.lineWidth = Math.max(2, hh * 0.09);
    ctx.beginPath();
    ctx.moveTo(cx - hw, y);
    ctx.lineTo(cx - hw, y - hh);
    ctx.quadraticCurveTo(cx, y - hh * 1.35, cx + hw, y - hh);
    ctx.lineTo(cx + hw, y);
    ctx.stroke();
    ctx.fillStyle = `rgba(126,232,255,${0.14 * pulse})`;
    ctx.beginPath();
    ctx.moveTo(cx - hw, y);
    ctx.lineTo(cx - hw, y - hh);
    ctx.quadraticCurveTo(cx, y - hh * 1.35, cx + hw, y - hh);
    ctx.lineTo(cx + hw, y);
    ctx.closePath();
    ctx.fill();
  }

  function drawRival(ctx, r) {
    let dz = r.z - camZ; if (dz < 0) dz += TRACKLEN;
    const n = Math.floor(dz / SEG);
    if (n < 1 || n >= DRAW - 1) return;
    const t = (dz % SEG) / SEG;
    const cx = Kit.lerp(segSX[n], segSX[n + 1], t) + Kit.lerp(segSW[n], segSW[n + 1], t) * r.x;
    const cy = Kit.lerp(segSY[n], segSY[n + 1], t);
    const cw = Kit.lerp(segSW[n], segSW[n + 1], t) * 0.42;
    if (cw < 2.5 || cy > W.h) return;
    const bob = Math.sin(performance.now() / 110 + r.wobble * 9) * cw * 0.04;
    ctx.fillStyle = 'rgba(126,232,255,0.14)';
    ctx.beginPath(); ctx.ellipse(cx, cy + cw * 0.1, cw * 0.75, cw * 0.16, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = r.color;
    roundedPath(ctx, cx - cw / 2, cy - cw * 0.34 + bob, cw, cw * 0.3, cw * 0.12); ctx.fill();
    ctx.fillStyle = 'rgba(10,14,26,0.85)';
    roundedPath(ctx, cx - cw * 0.26, cy - cw * 0.3 + bob, cw * 0.52, cw * 0.16, cw * 0.07); ctx.fill();
    ctx.fillStyle = '#FFE08B';
    ctx.fillRect(cx - cw * 0.4, cy - cw * 0.06 + bob, cw * 0.14, cw * 0.08);
    ctx.fillRect(cx + cw * 0.26, cy - cw * 0.06 + bob, cw * 0.14, cw * 0.08);
  }

  function drawPlayer(ctx, gg) {
    const { w, h } = W;
    const cx = w / 2 + steerSm * w * 0.012;
    const cy = h * 0.86 + Math.sin(gg.t * 11) * (1.5 + 2.5 * boostLerp);
    const cw = Math.min(w, h) * 0.34;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(steerSm * 0.08);

    const ug = ctx.createRadialGradient(0, cw * 0.1, 2, 0, cw * 0.1, cw * 0.6);
    ug.addColorStop(0, 'rgba(126,232,255,0.4)'); ug.addColorStop(1, 'rgba(126,232,255,0)');
    ctx.fillStyle = ug;
    ctx.beginPath(); ctx.ellipse(0, cw * 0.12, cw * 0.62, cw * 0.14, 0, 0, Math.PI * 2); ctx.fill();

    /* hull */
    ctx.fillStyle = '#1B2340';
    ctx.beginPath();
    ctx.moveTo(-cw * 0.5, -cw * 0.02);
    ctx.quadraticCurveTo(-cw * 0.2, -cw * 0.2, 0, -cw * 0.22);
    ctx.quadraticCurveTo(cw * 0.22, -cw * 0.2, cw * 0.5, -cw * 0.04);
    ctx.quadraticCurveTo(cw * 0.42, cw * 0.16, 0, cw * 0.18);
    ctx.quadraticCurveTo(-cw * 0.44, cw * 0.16, -cw * 0.5, -cw * 0.02);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#7EE8FF'; ctx.lineWidth = Math.max(1, cw * 0.012);
    ctx.stroke();
    /* canopy: slim and forward, reads as glass not an eye */
    ctx.fillStyle = 'rgba(126,232,255,0.28)';
    ctx.beginPath(); ctx.ellipse(0, -cw * 0.13, cw * 0.2, cw * 0.05, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(126,232,255,0.5)'; ctx.lineWidth = Math.max(1, cw * 0.008);
    ctx.stroke();
    /* center spine */
    ctx.strokeStyle = 'rgba(126,232,255,0.35)'; ctx.lineWidth = Math.max(1, cw * 0.01);
    ctx.beginPath(); ctx.moveTo(0, -cw * 0.02); ctx.lineTo(0, cw * 0.16); ctx.stroke();
    /* fins */
    ctx.fillStyle = '#FF6EC7';
    ctx.beginPath(); ctx.moveTo(-cw * 0.5, -cw * 0.02); ctx.lineTo(-cw * 0.64, -cw * 0.13); ctx.lineTo(-cw * 0.46, cw * 0.07); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cw * 0.5, -cw * 0.04); ctx.lineTo(cw * 0.64, -cw * 0.15); ctx.lineTo(cw * 0.46, cw * 0.05); ctx.closePath(); ctx.fill();
    /* twin thrusters sunk into the rear edge */
    const flick = Math.min(1, 0.7 + Math.random() * 0.3 + boostLerp * 0.7);
    const glow = boosting ? '#FFE08B' : '#FF8A5C';
    for (const side of [-1, 1]) {
      const tx = side * cw * 0.3, ty = cw * 0.15;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#0A0E1A';
      ctx.beginPath(); ctx.ellipse(tx, ty, cw * 0.1, cw * 0.045, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = flick;
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.ellipse(tx, ty + cw * 0.012, cw * 0.075, cw * 0.03 * flick + cw * 0.008, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function roundedPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------------- HUD ---------------- */
  let hudEls = null;
  function buildHUD() {
    const hud = document.getElementById('hud');
    hud.innerHTML = `
      <div class="hud-top">
        <div class="chip speed-chip"><small>Velocity</small><b id="hw-speed">0</b> km/h</div>
        <div class="chip"><small>Lap</small><span id="hw-lap">1/3</span> · Pos <span class="acc" id="hw-pos">6</span></div>
        <div class="chip" style="min-width:140px"><small>Boost cell</small><div class="meter"><i id="hw-boost" style="width:70%"></i></div></div>
      </div>
      <div class="hud-bottom"><div class="chip"><small>Lap time</small><span id="hw-time">0:00.0</span></div></div>`;
    hudEls = {
      speed: document.getElementById('hw-speed'),
      lap: document.getElementById('hw-lap'),
      pos: document.getElementById('hw-pos'),
      boost: document.getElementById('hw-boost'),
      time: document.getElementById('hw-time')
    };
  }
  function updateHUD() {
    if (!hudEls || state === 'attract') return;
    hudEls.speed.textContent = Math.round(speed / MAXS * 322);
    hudEls.lap.textContent = `${lap}/${LAPS}`;
    hudEls.pos.textContent = position;
    hudEls.boost.style.width = energy + '%';
    hudEls.time.textContent = fmtTime(state === 'race' ? raceTime - lapStart : lastLap || 0);
  }

  function fmtTime(t) {
    const m = Math.floor(t / 60), s = t - m * 60;
    return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
  }

  let cdEl = null;
  function showCountdown(txt) {
    if (!cdEl) {
      cdEl = document.createElement('div');
      cdEl.className = 'countdown';
      document.querySelector('.game-root').appendChild(cdEl);
    }
    cdEl.innerHTML = `<span>${txt}</span>`;
  }
  function hideCountdown() { if (cdEl) cdEl.innerHTML = ''; }

  /* ---------------- songs ---------------- */
  Audio.defineSong('menu', {
    bpm: 96,
    layers: [
      { type: 'pad', wave: 'sawtooth', steps: 'A2 - - - - - - - - - - - - - - - F2 - - - - - - - - - - - - - - -', gain: 0.15, cutoff: 850, attack: 0.4, release: 1.6 },
      { type: 'bass', wave: 'triangle', steps: 'A1 . . . A1 . . . C2 . . . E2 . . . F1 . . . F1 . . . A1 . . . C2 . . .', gain: 0.3 },
      { type: 'lead', wave: 'square', steps: '. . . . . . . . . . . . . . . . E4 . G4 . A4 . . . G4 . E4 . . . . .', gain: 0.1, cutoff: 2200, intensity: true },
      { type: 'hat', steps: '. . a . . . a . . . a . . . a a', gain: 0.1 }
    ]
  });
  Audio.defineSong('race', {
    bpm: 124,
    layers: [
      { type: 'bass', wave: 'sawtooth', steps: 'A1 A1 . A1 . A1 A1 . G1 G1 . G1 . G1 G1 . F1 F1 . F1 . F1 F1 . G1 G1 . G1 G1 G1 . .', gain: 0.24, cutoff: 700 },
      { type: 'kick', steps: 'a . . . a . . . a . . . a . . . a . . . a . . . a . . . a . a .', gain: 0.7 },
      { type: 'hat', steps: '. . a . . . a . . . a . . . a a . . a . . . a . . . a . a . a a', gain: 0.13 },
      { type: 'arp', wave: 'square', steps: 'A3 . C4 . E4 . C4 . A3 . C4 . E4 . G4 . F3 . A3 . C4 . A3 . G3 . B3 . D4 . B3 .', gain: 0.12, cutoff: 2600 },
      { type: 'lead', wave: 'sawtooth', steps: '. . . . . . . . . . . . . . . . A4 . . G4 . E4 . . C4 . D4 . E4 . .', gain: 0.15, cutoff: 2400, intensity: true }
    ]
  });

  /* ---------------- shell wiring ---------------- */
  window.GAME = {
    id: 'voltwing-gp',
    brand: 'VOLTWING GP',
    kicker: 'Hovertech Grand Circuit',
    title: 'VOLTWING <em>GP</em>',
    tagline: 'One rebuilt electric hypercar. Five rival drones. A floating dusk circuit that rewards clean lines and brave boost timing.',
    best: { key: 'voltwing.best', display: v => fmtTime(v) },
    controls: [
      { key: 'A / D', text: '<b>Bank left / right.</b> Bends pull the car outward — ease off and settle before you boost.' },
      { key: 'Shift / Space', text: '<b>Boost.</b> Burns the boost cell for a serious surge. Clean racing and orbit gates recharge it.' },
      { key: 'Gates', text: '<b>Fly through the glowing arches.</b> Each one adds charge and a burst of speed.' },
      { key: 'Drones', text: '<b>Five AI racers</b> hold their lines and punish contact — overtake in the bends, not on their nose.' },
      { key: 'Edge', text: '<b>Off the energy strip</b> bleeds speed and kicks up plasma dust. The light pylons mark the safe edge.' },
      { key: 'Race', text: '<b>Three laps</b> against the field. Best total time is saved on this device.' }
    ],
    touch: {
      joy: true,
      buttons: [{ name: 'boost', label: 'BOOST', primary: true }]
    },
    mascot: {
      name: 'Nova — pit chief',
      accent: '#7EE8FF',
      lines: {
        welcome: [
          'Nova here, pit chief. I rebuilt this Voltwing GT from salvage — bring it back in one piece.',
          'Welcome to the dusk circuit, pilot. Orbit gates charge your boost cell. Thread them.'
        ],
        return: [
          'Back for another lap? She is charged and waiting.',
          'The drones have been talking trash in the paddock. Your call, pilot.'
        ],
        start: ['Eyes up — grid drops in three!', 'Clean launch. Let the car do the talking.'],
        gate: ['Gate threaded — cell is climbing.', 'That is how you charge a boost cell.'],
        crash: ['Easy! That drone dented my paintwork.', 'You are fine. Breathe, line it up, go again.'],
        lap: ['Lap down. The field is sweating.', 'Smooth lap. Keep that line.'],
        low: ['Boost cell is nearly dry — hunt a gate!', 'Energy is low. Clean lines recharge it.'],
        win: ['Chequered light! What a lap sheet.', 'The drones are eating static. Beautiful.'],
        fail: ['They took this one. Rematch, pilot?', 'Every champion eats a loss. Grid is still hot.']
      },
      cooldowns: { gate: 5000, crash: 6000, low: 12000 }
    },
    learn: {
      intro: window.LEARN_DATA.intro,
      banks: window.LEARN_DATA.banks
    },
    menuSong: 'menu',
    gameSong: 'race',
    onStart() { hideCountdown(); buildHUD(); startRace(); G.resume(); Kit.showScreen('hud'); },
    onRestart() { hideCountdown(); buildHUD(); startRace(); G.resume(); },
    onPause() { G.pause(); Audio.stopLoop('engine'); },
    onResume() { if (state === 'race' || state === 'countdown') { G.resume(); Audio.loop('engine', { wave: 'sawtooth', freq: 52, maxFreq: 210, cutoff: 340, gain: 0.09 }); } },
    onQuit() { G.stop(); hideCountdown(); toAttract(); G.start(); }
  };

  /* ---------------- boot ---------------- */
  const canvas = document.getElementById('stage');
  G = Kit.game({
    canvas,
    onResize(dim) {
      W.w = dim.w; W.h = dim.h;
      skyGrad = null; groundGrad = null; vignette = null;
    },
    update,
    render
  });

  buildTrack();
  buildScenery();
  resetRivals();
  toAttract();
  G.start();

})();
