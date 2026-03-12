(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const splash = document.getElementById("splash");
  const splashStartBtn = document.getElementById("splashStartBtn");
  const menu = document.getElementById("menu");
  const gameover = document.getElementById("gameover");
  const startBtn = document.getElementById("startBtn");
  const restartBtn = document.getElementById("restartBtn");
  const fullscreenBtn = document.getElementById("fullscreenBtn");
  const scoreEl = document.getElementById("score");
  const finalScoreEl = document.getElementById("finalScore");
  const bestScoreEl = document.getElementById("bestScore");

  function getWorldSize() {
    const targetWidth = Math.max(canvas.clientWidth || 0, 1);
    const targetHeight = Math.max(canvas.clientHeight || 0, 1);
    const portrait = targetHeight > targetWidth;
    const rawAspect = targetHeight / targetWidth;

    if (portrait) {
      const worldWidth = 720;
      return {
        width: worldWidth,
        height: Math.round(worldWidth * rawAspect),
      };
    }

    const landscapeAspect = 1 / Math.max(rawAspect, 0.01);
    const worldHeight = 720;
    return {
      width: Math.round(worldHeight * landscapeAspect),
      height: worldHeight,
    };
  }

  const initialWorld = getWorldSize();
  let W = initialWorld.width;
  let H = initialWorld.height;
  let GROUND_H = 0;

  const STORAGE_KEY = "jetpack_flamingo_best";

  const state = {
    mode: "menu",
    time: 0,
    score: 0,
    best: Number(localStorage.getItem(STORAGE_KEY) || 0),
    bird: {
      x: W * 0.28,
      y: H * 0.42,
      r: 15,
      vx: 0,
      vy: 0,
      rot: 0,
      wingPulse: 0,
      wingOpen: 0,
      jetTilt: 0,
    },
    pipes: [],
    lastPipeGapY: null,
    pipeTimer: 0,
    pipeCount: 0,
    camX: 0,
    ripples: [],
    rippleTimer: 0,
    lilyPads: [],
    currentFields: createCurrentFields(),
    jetTrail: [],
    thrustBoost: 0,
    thrustHeld: false,
  };

  const physics = {
    gravity: 1060,
    flapImpulse: -420,
    jetpackThrust: 980,
    scrollSpeed: 210,
    pipeGap: 190,
    pipeW: 94,
    spawnEvery: 1.08,
    pipeTopPadding: 88,
    pipeBottomPadding: 98,
    currentForceX: 90,
    currentForceY: 120,
    birdBaseX: W * 0.28,
    birdMinX: W * 0.2,
    birdMaxX: W * 0.39,
  };

  let audioCtx = null;
  let masterGain = null;
  let ambientNodes = null;

  let watercolorLayer = createWatercolorLayer(W, H);
  let paperLayer = createPaperTexture(W, H);
  let bloomLayer = createBloomLayer(W, H);
  let bgLayer = createBackgroundLayer(W, H);
  const viewport = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  };
  const fullscreenApi = {
    request: document.documentElement.requestFullscreen
      || document.documentElement.webkitRequestFullscreen
      || document.documentElement.msRequestFullscreen,
    exit: document.exitFullscreen
      || document.webkitExitFullscreen
      || document.msExitFullscreen,
    element: () => document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement,
  };
  let immersiveFallback = false;

  function isPortraitWorld() {
    return H > W;
  }

  function syncWorldTuning() {
    const portraitWorld = isPortraitWorld();
    const portraitAspect = H / Math.max(W, 1);
    const landscapeAspect = W / Math.max(H, 1);

    physics.flapImpulse = portraitWorld ? -360 : -346;
    physics.scrollSpeed = portraitWorld ? 162 : 182;
    physics.spawnEvery = portraitWorld ? 1.7 : 1.5;
    physics.pipeGap = portraitWorld
      ? Math.round(H * Math.min(0.33, Math.max(0.29, 0.28 + (portraitAspect - 1.7) * 0.05)))
      : Math.round(H * Math.min(0.4, Math.max(0.34, 0.32 + (landscapeAspect - 1.45) * 0.02)));
    physics.pipeW = portraitWorld ? 122 : 114;
    physics.pipeTopPadding = portraitWorld ? Math.round(H * 0.12) : Math.round(H * 0.14);
    physics.pipeBottomPadding = portraitWorld ? Math.round(H * 0.18) : Math.round(H * 0.16);
    physics.currentForceX = portraitWorld ? 120 : 210;
    physics.currentForceY = portraitWorld ? 170 : 260;
    physics.birdBaseX = W * 0.28;
    physics.birdMinX = W * 0.2;
    physics.birdMaxX = W * 0.39;
  }

  function rebuildPaintLayers() {
    watercolorLayer = createWatercolorLayer(W, H);
    paperLayer = createPaperTexture(W, H);
    bloomLayer = createBloomLayer(W, H);
    bgLayer = createBackgroundLayer(W, H);
  }

  function applyWorldOrientationIfNeeded() {
    const world = getWorldSize();
    const nextW = world.width;
    const nextH = world.height;
    if (nextW === W && nextH === H) {
      return;
    }

    W = nextW;
    H = nextH;
    GROUND_H = 0;
    syncWorldTuning();
    rebuildPaintLayers();

    state.bird.x = physics.birdBaseX;
    state.bird.y = H * 0.42;
    state.bird.vx = 0;
    state.bird.vy = 0;
    state.bird.rot = -0.08;

    state.pipes.length = 0;
    state.pipeTimer = 0;
    state.ripples.length = 0;
    state.lilyPads = [];
    state.currentFields = createCurrentFields();
  }

  function resizeCanvas() {
    applyWorldOrientationIfNeeded();
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    viewport.scale = Math.min(canvas.width / W, canvas.height / H);
    viewport.offsetX = (canvas.width - W * viewport.scale) * 0.5;
    viewport.offsetY = (canvas.height - H * viewport.scale) * 0.5;
  }

  function rand(min, max) {
    return Math.random() * (max - min) + min;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function noise2D(x, y, seed) {
    const v = Math.sin(x * 12.9898 + y * 78.233 + seed * 31.415) * 43758.5453123;
    return v - Math.floor(v);
  }

  function wrap(value, range) {
    return ((value % range) + range) % range;
  }

  function createLilyPads(count) {
    const pads = [];
    for (let i = 0; i < count; i += 1) {
      pads.push({
        worldX: rand(0, W * 2),
        y: rand(H * 0.66, H - GROUND_H - 14),
        size: rand(16, 34),
        phase: rand(0, Math.PI * 2),
        rot: rand(-0.3, 0.3),
        rotSpeed: rand(-0.15, 0.15),
        hue: rand(95, 132),
      });
    }
    return pads;
  }

  function createCurrentFields() {
    const fields = [];
    let nextX = W + 170;
    const yMin = isPortraitWorld() ? H * 0.28 : H * 0.24;
    const yMax = isPortraitWorld() ? H * 0.6 : H * 0.66;
    for (let i = 0; i < 5; i += 1) {
      fields.push({
        x: nextX,
        y: rand(yMin, yMax),
        rx: rand(90, 150),
        ry: rand(52, 94),
        pushX: rand(-1, 1) * rand(0.1, 0.28),
        pushY: rand(-1, 1) * rand(0.12, 0.35),
        hue: rand(195, 216),
        phase: rand(0, Math.PI * 2),
      });
      nextX += rand(260, 400);
    }
    return fields;
  }

  function createPaperTexture(width, height) {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const cctx = c.getContext("2d");

    cctx.fillStyle = "rgba(245,240,230,0.48)";
    cctx.fillRect(0, 0, width, height);

    for (let i = 0; i < 32000; i += 1) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const a = Math.random() * 0.05;
      cctx.fillStyle = `rgba(70,60,45,${a})`;
      cctx.fillRect(x, y, 1, 1);
    }

    return c;
  }

  function createBloomLayer(width, height) {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const cctx = c.getContext("2d");

    const grad = cctx.createRadialGradient(width * 0.35, height * 0.15, 10, width * 0.35, height * 0.15, width * 0.85);
    grad.addColorStop(0, "rgba(255, 241, 210, 0.35)");
    grad.addColorStop(0.35, "rgba(255, 220, 188, 0.16)");
    grad.addColorStop(1, "rgba(255, 255, 255, 0)");
    cctx.fillStyle = grad;
    cctx.fillRect(0, 0, width, height);

    return c;
  }

  function paintBlob(cctx, cx, cy, rx, ry, color, layers) {
    for (let i = 0; i < layers; i += 1) {
      const jitterX = rand(-8, 8);
      const jitterY = rand(-6, 6);
      const alpha = rand(0.06, 0.14);
      cctx.beginPath();
      cctx.ellipse(cx + jitterX, cy + jitterY, rx * rand(0.85, 1.15), ry * rand(0.85, 1.18), rand(-0.5, 0.5), 0, Math.PI * 2);
      cctx.fillStyle = color.replace("ALPHA", alpha.toFixed(3));
      cctx.fill();
    }
  }

  function paintMountainRange(cctx, width, horizonY, peaks, palette, fogStrength) {
    const profile = [];
    const step = width / peaks;
    let x = -step;
    let y = horizonY;
    profile.push({ x, y });

    for (let i = 0; i <= peaks + 1; i += 1) {
      x += step * rand(0.8, 1.18);
      const ridge = rand(0.2, 1);
      const peakDrop = Math.pow(ridge, 1.6) * palette.height;
      y = horizonY - peakDrop + Math.sin(i * 1.25 + rand(-0.25, 0.25)) * palette.roughness;
      profile.push({ x, y });
    }

    cctx.beginPath();
    cctx.moveTo(-80, horizonY + palette.baseLift);
    for (let i = 0; i < profile.length - 1; i += 1) {
      const p = profile[i];
      const n = profile[i + 1];
      const cx = (p.x + n.x) * 0.5;
      const cy = (p.y + n.y) * 0.5;
      cctx.quadraticCurveTo(p.x, p.y, cx, cy);
    }
    cctx.lineTo(width + 80, horizonY + palette.baseLift);
    cctx.closePath();

    const bodyGrad = cctx.createLinearGradient(0, horizonY - palette.height, 0, horizonY + palette.baseLift);
    bodyGrad.addColorStop(0, palette.top);
    bodyGrad.addColorStop(0.6, palette.mid);
    bodyGrad.addColorStop(1, palette.base);
    cctx.fillStyle = bodyGrad;
    cctx.fill();

    cctx.save();
    cctx.globalAlpha = fogStrength;
    cctx.fillStyle = "rgba(223, 236, 255, 0.4)";
    for (let i = 0; i < profile.length; i += 1) {
      const p = profile[i];
      paintBlob(cctx, p.x, p.y + palette.baseLift * 0.2, step * rand(0.5, 1.2), step * rand(0.12, 0.24), "rgba(220,232,255,ALPHA)", 3);
    }
    cctx.restore();

    cctx.save();
    cctx.globalCompositeOperation = "screen";
    cctx.strokeStyle = "rgba(244, 249, 255, 0.55)";
    cctx.lineWidth = 2;
    cctx.beginPath();
    for (let i = 1; i < profile.length - 1; i += 1) {
      const p = profile[i];
      if (Math.random() < 0.55) {
        cctx.moveTo(p.x - step * rand(0.16, 0.26), p.y + palette.height * rand(0.03, 0.08));
        cctx.lineTo(p.x + step * rand(0.12, 0.2), p.y + palette.height * rand(0.14, 0.2));
      }
    }
    cctx.stroke();
    cctx.restore();
  }

  function createBackgroundLayer(width, height) {
    const c = document.createElement("canvas");
    c.width = width * 3;
    c.height = height;
    const cctx = c.getContext("2d");

    const skyGrad = cctx.createLinearGradient(0, 0, 0, height);
    skyGrad.addColorStop(0, "#f7efe2");
    skyGrad.addColorStop(0.24, "#f3d7b8");
    skyGrad.addColorStop(0.52, "#b8cbec");
    skyGrad.addColorStop(1, "#89abd8");
    cctx.fillStyle = skyGrad;
    cctx.fillRect(0, 0, c.width, c.height);

    for (let i = 0; i < 130; i += 1) {
      paintBlob(cctx, rand(0, c.width), rand(height * 0.05, height * 0.6), rand(45, 160), rand(18, 74), "rgba(255,232,199,ALPHA)", 2);
    }

    const horizonY = height * 0.64;
    paintMountainRange(cctx, c.width, horizonY - height * 0.2, 16, {
      height: height * 0.24,
      roughness: 18,
      baseLift: height * 0.18,
      top: "rgba(214, 224, 243, 0.88)",
      mid: "rgba(151, 176, 208, 0.9)",
      base: "rgba(103, 130, 166, 0.95)",
    }, 0.32);
    paintMountainRange(cctx, c.width, horizonY - height * 0.08, 22, {
      height: height * 0.34,
      roughness: 26,
      baseLift: height * 0.24,
      top: "rgba(236, 241, 250, 0.95)",
      mid: "rgba(126, 158, 194, 0.92)",
      base: "rgba(83, 112, 151, 0.94)",
    }, 0.2);

    const waterY = height - GROUND_H;
    const waterGrad = cctx.createLinearGradient(0, waterY - height * 0.2, 0, height);
    waterGrad.addColorStop(0, "rgba(208, 227, 248, 0.42)");
    waterGrad.addColorStop(0.45, "rgba(150, 185, 221, 0.68)");
    waterGrad.addColorStop(1, "rgba(108, 146, 187, 0.8)");
    cctx.fillStyle = waterGrad;
    cctx.fillRect(0, waterY - 2, c.width, GROUND_H + 2);

    cctx.strokeStyle = "rgba(238, 248, 255, 0.26)";
    for (let i = 0; i < 60; i += 1) {
      const y = waterY + (i / 60) * GROUND_H;
      cctx.lineWidth = 1 + (i % 3) * 0.4;
      cctx.beginPath();
      cctx.moveTo(0, y);
      for (let x = 0; x <= c.width; x += 140) {
        cctx.quadraticCurveTo(x + 70, y + Math.sin(i * 0.6 + x * 0.008) * 2.8, x + 140, y);
      }
      cctx.stroke();
    }

    return c;
  }

  function createWatercolorLayer(width, height) {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const cctx = c.getContext("2d");

    for (let i = 0; i < 220; i += 1) {
      const x = rand(0, width);
      const y = rand(0, height);
      const radius = rand(24, 120);
      const alpha = rand(0.01, 0.04);
      const hue = rand(145, 210);
      cctx.beginPath();
      cctx.ellipse(x, y, radius, radius * rand(0.55, 1.2), rand(-0.7, 0.7), 0, Math.PI * 2);
      cctx.fillStyle = `hsla(${hue}, 35%, 73%, ${alpha})`;
      cctx.fill();
    }

    return c;
  }

  function initAudio() {
    if (audioCtx) {
      return;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return;
    }

    audioCtx = new AudioContextClass();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.2;
    masterGain.connect(audioCtx.destination);

    ambientNodes = createAmbientLoop(audioCtx, masterGain);
  }

  function resumeAudio() {
    if (!audioCtx) {
      initAudio();
    }
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume();
    }
  }

  function createNoiseBuffer(ctx, duration) {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * 0.45;
    }
    return buffer;
  }

  function createAmbientLoop(ctx, dest) {
    const source = ctx.createBufferSource();
    source.buffer = createNoiseBuffer(ctx, 2.4);
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 430;
    filter.Q.value = 0.7;

    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.07;

    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 120;

    const gain = ctx.createGain();
    gain.gain.value = 0.06;

    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(dest);

    source.start();
    lfo.start();

    return { source, filter, gain, lfo, lfoGain };
  }

  function scheduleEnvelope(param, now, points) {
    param.cancelScheduledValues(now);
    param.setValueAtTime(points[0][0], now);
    for (let i = 1; i < points.length; i += 1) {
      param.linearRampToValueAtTime(points[i][0], now + points[i][1]);
    }
  }

  function playFlapSound() {
    if (!audioCtx || !masterGain) {
      return;
    }
    const now = audioCtx.currentTime;

    const thrust = audioCtx.createOscillator();
    thrust.type = "sawtooth";
    thrust.frequency.setValueAtTime(180, now);
    thrust.frequency.exponentialRampToValueAtTime(110, now + 0.14);

    const thrustGain = audioCtx.createGain();
    scheduleEnvelope(thrustGain.gain, now, [
      [0.0001, 0],
      [0.14, 0.015],
      [0.0001, 0.16],
    ]);

    const hiss = audioCtx.createBufferSource();
    hiss.buffer = createNoiseBuffer(audioCtx, 0.2);
    const hissFilter = audioCtx.createBiquadFilter();
    hissFilter.type = "bandpass";
    hissFilter.frequency.value = 1600;
    const hissGain = audioCtx.createGain();
    scheduleEnvelope(hissGain.gain, now, [
      [0.0001, 0],
      [0.06, 0.01],
      [0.0001, 0.12],
    ]);

    thrust.connect(thrustGain);
    thrustGain.connect(masterGain);
    hiss.connect(hissFilter);
    hissFilter.connect(hissGain);
    hissGain.connect(masterGain);

    thrust.start(now);
    thrust.stop(now + 0.18);
    hiss.start(now);
    hiss.stop(now + 0.14);
  }

  function playScoreSound() {
    if (!audioCtx || !masterGain) {
      return;
    }
    const now = audioCtx.currentTime;
    [660, 880, 1108].forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, now + idx * 0.05);
      const gain = audioCtx.createGain();
      scheduleEnvelope(gain.gain, now + idx * 0.05, [
        [0.0001, 0],
        [0.11, 0.01],
        [0.0001, 0.15],
      ]);
      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(now + idx * 0.05);
      osc.stop(now + idx * 0.18);
    });
  }

  function playHitSound() {
    if (!audioCtx || !masterGain) {
      return;
    }
    const now = audioCtx.currentTime;

    const crack = audioCtx.createBufferSource();
    crack.buffer = createNoiseBuffer(audioCtx, 0.22);
    const crackFilter = audioCtx.createBiquadFilter();
    crackFilter.type = "highpass";
    crackFilter.frequency.value = 720;
    const crackGain = audioCtx.createGain();
    scheduleEnvelope(crackGain.gain, now, [
      [0.0001, 0],
      [0.2, 0.01],
      [0.0001, 0.2],
    ]);

    const low = audioCtx.createOscillator();
    low.type = "sine";
    low.frequency.setValueAtTime(130, now);
    low.frequency.exponentialRampToValueAtTime(70, now + 0.2);
    const lowGain = audioCtx.createGain();
    scheduleEnvelope(lowGain.gain, now, [
      [0.0001, 0],
      [0.16, 0.015],
      [0.0001, 0.24],
    ]);

    crack.connect(crackFilter);
    crackFilter.connect(crackGain);
    crackGain.connect(masterGain);
    low.connect(lowGain);
    lowGain.connect(masterGain);

    crack.start(now);
    crack.stop(now + 0.22);
    low.start(now);
    low.stop(now + 0.24);
  }

  function playGameOverSound() {
    if (!audioCtx || !masterGain) {
      return;
    }
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.52);

    const gain = audioCtx.createGain();
    scheduleEnvelope(gain.gain, now, [
      [0.0001, 0],
      [0.15, 0.03],
      [0.0001, 0.56],
    ]);

    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.58);
  }

  function resetGame() {
    state.mode = "playing";
    state.score = 0;
    state.pipes.length = 0;
    state.lastPipeGapY = null;
    state.pipeTimer = 0;
    state.pipeCount = 0;
    state.bird.y = H * 0.42;
    state.bird.x = physics.birdBaseX;
    state.bird.vx = 0;
    state.bird.vy = 0;
    state.bird.rot = -0.08;
    state.bird.wingPulse = 0;
    state.bird.wingOpen = 0.2;
    state.bird.jetTilt = 0;
    state.jetTrail.length = 0;
    state.thrustBoost = 0;
    state.thrustHeld = false;
    state.camX = 0;
    scoreEl.textContent = "0";

    menu.classList.remove("visible");
    gameover.classList.remove("visible");
  }

  function startFromSplash() {
    splash.classList.remove("visible");
    resumeAudio();
    resetGame();
    flap();
  }

  function setGameOver() {
    state.mode = "gameover";
    playHitSound();
    setTimeout(() => playGameOverSound(), 80);

    if (state.score > state.best) {
      state.best = state.score;
      localStorage.setItem(STORAGE_KEY, String(state.best));
    }

    finalScoreEl.textContent = `Score: ${state.score}`;
    bestScoreEl.textContent = `Best: ${state.best}`;
    gameover.classList.add("visible");
  }

  function flap() {
    resumeAudio();

    if (state.mode === "menu") {
      resetGame();
    }

    if (state.mode !== "playing") {
      return;
    }

    state.bird.vy = Math.min(state.bird.vy - physics.jetpackThrust * 0.28, physics.flapImpulse);
    state.thrustBoost = 1;
    state.thrustHeld = true;
    state.bird.jetTilt = -0.42;
    playFlapSound();
  }

  function spawnPipe() {
    const difficulty = getDifficulty();
    const topLimit = physics.pipeTopPadding;
    const bottomLimit = H - GROUND_H - physics.pipeBottomPadding;
    const dynamicGap = clamp(physics.pipeGap * (1 - difficulty * 0.14), 144, physics.pipeGap);
    const playableMin = topLimit + dynamicGap * 0.5;
    const playableMax = bottomLimit - dynamicGap * 0.5;
    let gapY = rand(playableMin, playableMax);

    if (typeof state.lastPipeGapY === "number") {
      const maxGapShift = dynamicGap * (0.26 - difficulty * 0.06) + H * 0.02;
      gapY = clamp(gapY, state.lastPipeGapY - maxGapShift, state.lastPipeGapY + maxGapShift);
    }

    state.lastPipeGapY = gapY;
    state.pipeCount += 1;

    const w = physics.pipeW * rand(0.94, 1.08);
    state.pipes.push({
      x: W + 40,
      w,
      gapY,
      gap: dynamicGap * rand(0.97, 1.04),
      passed: false,
      hue: rand(194, 220),
      frost: rand(0.28, 0.58),
    });
  }

  function getDifficulty() {
    const fromScore = clamp(state.score / 38, 0, 1);
    const fromTime = clamp(state.time / 85, 0, 1);
    return clamp(fromScore * 0.72 + fromTime * 0.28, 0, 1);
  }

  function update(dt) {
    state.time += dt;
    if (state.mode !== "playing") {
      return;
    }

    const difficulty = getDifficulty();
    const liveScrollSpeed = physics.scrollSpeed * (1 + difficulty * 0.2);
    const liveCurrentX = physics.currentForceX * (1 + difficulty * 0.25);
    const liveCurrentY = physics.currentForceY * (1 + difficulty * 0.2);
    const spawnEvery = physics.spawnEvery * (1 - difficulty * 0.1);

    state.camX += liveScrollSpeed * dt;

    const bird = state.bird;
    state.thrustBoost = Math.max(0, state.thrustBoost - dt * (state.thrustHeld ? 1.35 : 2.35));
    bird.jetTilt += ((state.thrustBoost > 0.02 ? -0.34 : 0.1) - bird.jetTilt) * 0.16;
    bird.vx += (physics.birdBaseX - bird.x) * dt * 6.5;
    if (state.thrustBoost > 0) {
      bird.vy -= physics.jetpackThrust * state.thrustBoost * dt;
      const burst = Math.floor(7 + state.thrustBoost * 7);
      for (let i = 0; i < burst; i += 1) {
        state.jetTrail.push({
          x: bird.x - 12 + rand(-3, 3),
          y: bird.y + rand(-2, 2),
          vx: -rand(110, 220),
          vy: rand(-44, 44),
          life: rand(0.18, 0.42),
          age: 0,
          hot: Math.random() < 0.38,
          size: rand(2.4, 5.8),
        });
      }
    }

    for (const field of state.currentFields) {
      field.x -= liveScrollSpeed * dt;
      if (field.x < -field.rx - 40) {
        const farthestX = Math.max(...state.currentFields.map((f) => f.x));
        field.x = farthestX + rand(240, 410);
        field.y = rand(isPortraitWorld() ? H * 0.25 : H * 0.2, isPortraitWorld() ? H * 0.52 : H * 0.58);
        field.rx = rand(90, 140);
        field.ry = rand(65, 110);
        field.pushX = rand(-1, 1) * rand(0.25, 0.65);
        field.pushY = rand(-1, 1) * rand(0.35, 0.85);
        field.phase = rand(0, Math.PI * 2);
      }

      const nx = (bird.x - field.x) / field.rx;
      const ny = (bird.y - field.y) / field.ry;
      const d2 = nx * nx + ny * ny;
      if (d2 < 1) {
        const influence = 1 - d2;
        bird.vx += field.pushX * influence * dt * liveCurrentX;
        bird.vy += field.pushY * influence * dt * liveCurrentY;
      }
    }

    bird.vx *= 0.92;
    bird.x += bird.vx * dt;
    bird.x = Math.max(physics.birdMinX, Math.min(physics.birdMaxX, bird.x));
    bird.vy += physics.gravity * dt;
    bird.y += bird.vy * dt;
    bird.rot += (Math.min(1.05, bird.vy / 470 + bird.vx / 260) - bird.rot) * 0.12;

    state.pipeTimer += dt;
    if (state.pipeTimer >= spawnEvery) {
      state.pipeTimer = 0;
      spawnPipe();
    }

    for (let i = state.pipes.length - 1; i >= 0; i -= 1) {
      const pipe = state.pipes[i];
      pipe.x -= liveScrollSpeed * dt;

      const pipeW = pipe.w || physics.pipeW;
      if (!pipe.passed && pipe.x + pipeW < bird.x) {
        pipe.passed = true;
        state.score += 1;
        scoreEl.textContent = String(state.score);
        playScoreSound();
      }

      if (pipe.x + pipeW < -20) {
        state.pipes.splice(i, 1);
      }

      const withinX = bird.x + bird.r > pipe.x && bird.x - bird.r < pipe.x + pipeW;
      if (withinX) {
        const gapHalf = pipe.gap * 0.5;
        const hitTop = bird.y - bird.r < pipe.gapY - gapHalf;
        const hitBottom = bird.y + bird.r > pipe.gapY + gapHalf;
        if (hitTop || hitBottom) {
          setGameOver();
          return;
        }
      }
    }

    for (let i = state.jetTrail.length - 1; i >= 0; i -= 1) {
      const p = state.jetTrail[i];
      p.age += dt;
      if (p.age >= p.life) {
        state.jetTrail.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94;
      p.vy *= 0.92;
    }

    if (bird.y - bird.r < 0 || bird.y + bird.r > H - GROUND_H) {
      setGameOver();
    }
  }

  function drawPaintedPipe(pipe, isTop) {
    const pipeW = pipe.w || physics.pipeW;
    const centerX = pipe.x + pipeW * 0.5;
    const gapHalf = pipe.gap * 0.5;
    const edge = isTop ? pipe.gapY - gapHalf : pipe.gapY + gapHalf;

    const y = isTop ? 0 : edge;
    const h = isTop ? edge : H - GROUND_H - edge;
    if (h <= 0) {
      return;
    }

    const segments = Math.max(3, Math.floor(h / 70));
    const segH = h / segments;
    for (let i = 0; i < segments; i += 1) {
      const jitter = (noise2D(centerX, i * 1.7 + state.time * 0.05, 0.4) - 0.5) * 12;
      const blockY = y + i * segH;
      const blockH = segH + (i === segments - 1 ? 0 : 2);
      const inset = (Math.sin(i * 2.1 + pipe.hue) * 0.5 + 0.5) * 9;

      const blockGrad = ctx.createLinearGradient(pipe.x, blockY, pipe.x + pipeW, blockY + blockH);
      blockGrad.addColorStop(0, `rgba(233,245,255,${0.9 - pipe.frost * 0.22})`);
      blockGrad.addColorStop(0.55, `rgba(184,216,245,${0.86 - pipe.frost * 0.18})`);
      blockGrad.addColorStop(1, "rgba(143,190,228,0.9)");

      ctx.beginPath();
      ctx.moveTo(pipe.x + inset * 0.35, blockY);
      ctx.lineTo(pipe.x + pipeW - inset, blockY + jitter * 0.1);
      ctx.lineTo(pipe.x + pipeW - inset * 0.45, blockY + blockH);
      ctx.lineTo(pipe.x + inset, blockY + blockH - jitter * 0.1);
      ctx.closePath();
      ctx.fillStyle = blockGrad;
      ctx.fill();

      ctx.strokeStyle = "rgba(114, 160, 205, 0.45)";
      ctx.lineWidth = 1.4;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(pipe.x + inset + 4, blockY + blockH * 0.18);
      ctx.lineTo(pipe.x + pipeW - inset - 7, blockY + blockH * 0.36);
      ctx.lineTo(pipe.x + inset + 10, blockY + blockH * 0.74);
      ctx.strokeStyle = "rgba(243, 251, 255, 0.3)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function drawJetTrail() {
    for (const p of state.jetTrail) {
      const lifeRatio = 1 - p.age / p.life;
      const alpha = lifeRatio * (p.hot ? 0.72 : 0.42);
      ctx.fillStyle = p.hot
        ? `rgba(255, ${Math.round(130 + 90 * lifeRatio)}, 62, ${alpha.toFixed(3)})`
        : `rgba(255, 218, 168, ${(alpha * 0.8).toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.size * lifeRatio + 1.1, p.size * 0.56 * lifeRatio + 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBird() {
    const b = state.bird;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.rot + b.jetTilt * 0.36);

    for (let i = 0; i < 5; i += 1) {
      ctx.beginPath();
      ctx.ellipse(rand(-2, 2), rand(-1.5, 1.5), b.r + rand(-1.8, 2.4), b.r * 0.74 + rand(-1.6, 1.8), rand(-0.2, 0.2), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(245, 166, 186, ${0.13 + i * 0.03})`;
      ctx.fill();
    }

    ctx.save();
    ctx.translate(-10, 2);
    ctx.rotate(-0.18);
    ctx.fillStyle = "rgba(88, 116, 150, 0.92)";
    ctx.fillRect(-4, -10, 8, 20);
    ctx.fillStyle = "rgba(64, 90, 124, 0.9)";
    ctx.fillRect(4, -8, 5, 16);
    const flame = 13 + state.thrustBoost * 28;
    const flicker = Math.sin(state.time * 35) * 4;
    ctx.beginPath();
    ctx.moveTo(8, -2);
    ctx.lineTo(20 + flame + flicker, 0);
    ctx.lineTo(8, 2);
    ctx.closePath();
    ctx.fillStyle = "rgba(255, 162, 74, 0.84)";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(9, -1);
    ctx.lineTo(16 + flame * 0.6 + flicker * 0.5, 0);
    ctx.lineTo(9, 1);
    ctx.closePath();
    ctx.fillStyle = "rgba(255, 235, 183, 0.9)";
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(-2, -2);
    ctx.rotate(-0.2 - state.thrustBoost * 0.18);
    ctx.beginPath();
    ctx.ellipse(-8, 2, b.r * 0.76, b.r * 0.5, -0.4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(230, 133, 165, 0.62)";
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = "rgba(233, 144, 171, 0.78)";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(4, -6);
    ctx.quadraticCurveTo(12, -20, 16, -7);
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(16, -7, 5.2, 4.6, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(247, 179, 199, 0.92)";
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(16, -9, 9.5, 8, -0.05, Math.PI * 1.1, Math.PI * 2.1);
    ctx.strokeStyle = "rgba(220, 241, 255, 0.95)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(16, -9, 9.2, 7.6, -0.05, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(119, 157, 199, 0.6)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(17, -8, 1.4, 1.4, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(44, 38, 34, 0.84)";
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(20, -6);
    ctx.lineTo(30, -4.5);
    ctx.lineTo(22, -2.5);
    ctx.closePath();
    ctx.fillStyle = "rgba(245, 224, 166, 0.84)";
    ctx.fill();

    ctx.restore();
  }

  function drawGround() {
    const y = H - GROUND_H;
    ctx.fillStyle = "rgba(224, 239, 255, 0.86)";
    ctx.fillRect(0, y, W, GROUND_H);

    for (let i = 0; i < 90; i += 1) {
      const x = ((i * 57) + state.camX * 0.34) % (W + 80) - 40;
      const h = 4 + ((i * 5) % 10);
      ctx.strokeStyle = "rgba(166, 198, 233, 0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y + 4);
      ctx.lineTo(x + 8, y + 4 + h);
      ctx.stroke();
    }
  }

  function drawWaterSurface() {
    // Bottom puddle removed to keep terrain clean and consistent.
  }

  function drawRipples() {
    for (const ripple of state.ripples) {
      const lifeRatio = 1 - ripple.age / ripple.life;
      if (lifeRatio <= 0) {
        continue;
      }
      const alpha = 0.22 * lifeRatio;
      ctx.strokeStyle = `rgba(236, 248, 242, ${alpha.toFixed(3)})`;
      ctx.lineWidth = 1.5 * lifeRatio + 0.4;
      ctx.beginPath();
      ctx.ellipse(ripple.x, ripple.y, ripple.r, ripple.r * 0.48, 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = `rgba(150, 184, 170, ${(alpha * 0.75).toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(ripple.x, ripple.y, ripple.r * 0.7, ripple.r * 0.28, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawLilyPads() {
    for (const pad of state.lilyPads) {
      const x = wrap(pad.worldX - state.camX * 0.32, W + 140) - 70;
      const y = pad.y + Math.sin(state.time * 1.05 + pad.phase) * 4.5;
      const rot = pad.rot + Math.sin(state.time * 0.9 + pad.phase) * 0.12 + pad.rotSpeed * 0.16;
      const size = pad.size + Math.sin(state.time * 1.4 + pad.phase) * 1.3;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);

      for (let i = 0; i < 4; i += 1) {
        ctx.beginPath();
        ctx.ellipse(rand(-1.2, 1.2), rand(-1.2, 1.2), size * rand(0.82, 1.12), size * rand(0.58, 0.84), rand(-0.35, 0.35), 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${pad.hue}, 35%, ${38 + i * 3}%, ${0.11 + i * 0.02})`;
        ctx.fill();
      }

      ctx.strokeStyle = "rgba(210, 233, 220, 0.2)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(size * 0.7, -size * 0.06);
      ctx.stroke();

      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.moveTo(-2, 0);
      ctx.lineTo(size * 0.45, -size * 0.2);
      ctx.lineTo(size * 0.18, size * 0.16);
      ctx.closePath();
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";

      ctx.restore();
    }
  }

  function drawBackground() {
    const layerW = bgLayer.width;
    const scroll = (state.camX * 0.2) % layerW;
    ctx.drawImage(bgLayer, -scroll, 0);
    ctx.drawImage(bgLayer, layerW - scroll, 0);
  }

  function drawCurrentFields() {
    for (const field of state.currentFields) {
      const swirl = Math.sin(state.time * 1.2 + field.phase);
      const alpha = 0.13 + (swirl + 1) * 0.03;

      ctx.save();
      ctx.translate(field.x, field.y);
      ctx.rotate(swirl * 0.2);

      ctx.fillStyle = `hsla(${field.hue}, 46%, 76%, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, field.rx, field.ry, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `rgba(224, 246, 239, ${(alpha * 1.35).toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, field.rx * 0.78, field.ry * 0.64, 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(-field.rx * 0.45, 0);
      ctx.quadraticCurveTo(-field.rx * 0.1, -field.ry * 0.3, field.rx * 0.36, field.ry * -field.pushY * 0.28);
      ctx.stroke();

      ctx.restore();
    }
  }

  function drawWatercolorPost() {
    ctx.save();
    ctx.globalAlpha = 0.55 + Math.sin(state.time * 0.25) * 0.04;
    ctx.globalCompositeOperation = "overlay";
    ctx.drawImage(watercolorLayer, 0, 0);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = "soft-light";
    ctx.globalAlpha = 0.55;
    ctx.drawImage(bloomLayer, 0, 0);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = 0.42;
    ctx.drawImage(paperLayer, 0, 0);
    ctx.restore();
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#d6e8fc";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(viewport.scale, 0, 0, viewport.scale, viewport.offsetX, viewport.offsetY);

    drawBackground();
    drawCurrentFields();

    for (const pipe of state.pipes) {
      drawPaintedPipe(pipe, true);
      drawPaintedPipe(pipe, false);
    }

    drawJetTrail();
    drawBird();
    drawGround();
    drawWatercolorPost();

    if (state.mode === "menu") {
      state.bird.y = H * 0.42;
      state.bird.rot = 0;
      state.bird.jetTilt *= 0.88;
    }
  }

  let last = performance.now();
  function tick(now) {
    const dt = Math.min((now - last) / 1000, 0.035);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(tick);
  }

  function onInteract(ev) {
    ev.preventDefault();
    if (splash.classList.contains("visible")) {
      startFromSplash();
      return;
    }
    flap();
  }

  splashStartBtn.addEventListener("click", startFromSplash);

  startBtn.addEventListener("click", () => {
    resumeAudio();
    resetGame();
    flap();
  });

  restartBtn.addEventListener("click", () => {
    resumeAudio();
    resetGame();
  });

  window.addEventListener("keydown", (ev) => {
    if (ev.code === "Space" || ev.code === "ArrowUp") {
      ev.preventDefault();
      if (splash.classList.contains("visible")) {
        startFromSplash();
        return;
      }
      flap();
    }
  });

  canvas.addEventListener("pointerdown", onInteract, { passive: false });
  canvas.addEventListener("pointerup", () => { state.thrustHeld = false; });
  canvas.addEventListener("pointercancel", () => { state.thrustHeld = false; });
  window.addEventListener("keyup", (ev) => {
    if (ev.code === "Space" || ev.code === "ArrowUp") {
      state.thrustHeld = false;
    }
  });

  function toggleFullscreen() {
    const root = document.querySelector(".game-wrap");
    const activeElement = fullscreenApi.element();
    if (activeElement) {
      if (fullscreenApi.exit) {
        try {
          const exitResult = fullscreenApi.exit.call(document);
          if (exitResult && typeof exitResult.catch === "function") {
            exitResult.catch(() => {});
          }
        } catch (_) {
          immersiveFallback = false;
          document.body.classList.remove("immersive");
          resizeCanvas();
        }
      } else {
        immersiveFallback = false;
        document.body.classList.remove("immersive");
        resizeCanvas();
      }
      return;
    }

    if (fullscreenApi.request && root) {
      try {
        const requestResult = fullscreenApi.request.call(root);
        if (requestResult && typeof requestResult.catch === "function") {
          requestResult.catch(() => {
            immersiveFallback = !immersiveFallback;
            document.body.classList.toggle("immersive", immersiveFallback);
            resizeCanvas();
          });
        }
      } catch (_) {
        immersiveFallback = !immersiveFallback;
        document.body.classList.toggle("immersive", immersiveFallback);
        resizeCanvas();
      }
    } else {
      immersiveFallback = !immersiveFallback;
      document.body.classList.toggle("immersive", immersiveFallback);
      resizeCanvas();
    }
  }

  function syncFullscreenButton() {
    const activeElement = fullscreenApi.element();
    const fullscreenActive = Boolean(activeElement || immersiveFallback);
    document.body.classList.toggle("fullscreen-active", fullscreenActive);

    if (!fullscreenBtn) {
      return;
    }

    fullscreenBtn.textContent = fullscreenActive ? "Exit Fullscreen" : "Fullscreen";
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      return;
    }
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }

  function enableMobileFullscreenGesture() {
    // Intentionally empty: keep page anchored to prevent accidental browser scrolling.
  }

  if (fullscreenBtn) {
    fullscreenBtn.addEventListener("click", () => {
      toggleFullscreen();
      enableMobileFullscreenGesture();
      syncFullscreenButton();
    });
    syncFullscreenButton();
  }

  document.addEventListener("fullscreenchange", syncFullscreenButton);
  document.addEventListener("webkitfullscreenchange", syncFullscreenButton);
  document.addEventListener("touchmove", (ev) => {
    ev.preventDefault();
  }, { passive: false });
  document.addEventListener("wheel", (ev) => {
    ev.preventDefault();
  }, { passive: false });
  document.addEventListener("gesturestart", (ev) => {
    ev.preventDefault();
  });
  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("orientationchange", () => {
    setTimeout(resizeCanvas, 80);
  });

  registerServiceWorker();

  syncWorldTuning();
  bestScoreEl.textContent = `Best: ${state.best}`;
  resizeCanvas();
  requestAnimationFrame(tick);
})();
