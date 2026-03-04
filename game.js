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
    const portrait = window.innerHeight > window.innerWidth;
    const rawAspect = window.innerWidth > 0 ? window.innerHeight / window.innerWidth : 1;

    if (portrait) {
      // Keep gameplay tuned for common tall mobile ratios while still scaling cleanly to larger displays.
      const clampedAspect = Math.min(2.25, Math.max(1.6, rawAspect));
      const worldWidth = 720;
      return {
        width: worldWidth,
        height: Math.round(worldWidth * clampedAspect),
      };
    }

    // Landscape supports tablets/desktop through to 4K by preserving visible field width.
    const landscapeAspect = 1 / Math.max(rawAspect, 0.01);
    const clampedAspect = Math.min(2.25, Math.max(1.45, landscapeAspect));
    const worldHeight = 720;
    return {
      width: Math.round(worldHeight * clampedAspect),
      height: worldHeight,
    };
  }

  const initialWorld = getWorldSize();
  let W = initialWorld.width;
  let H = initialWorld.height;
  let GROUND_H = Math.round(H * 0.14);

  const STORAGE_KEY = "watercolor_flappy_best";

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
    },
    pipes: [],
    lastPipeGapY: null,
    pipeTimer: 0,
    camX: 0,
    ripples: [],
    rippleTimer: 0,
    lilyPads: createLilyPads(16),
    currentFields: createCurrentFields(),
  };

  const physics = {
    gravity: 980,
    flapImpulse: -370,
    scrollSpeed: 185,
    pipeGap: 180,
    pipeW: 90,
    spawnEvery: 1.22,
    pipeTopPadding: 90,
    pipeBottomPadding: 96,
    currentForceX: 210,
    currentForceY: 260,
    birdBaseX: W * 0.28,
    birdMinX: W * 0.2,
    birdMaxX: W * 0.39,
  };

  let audioCtx = null;
  let masterGain = null;
  let ambientNodes = null;
  let musicNodes = null;

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
    physics.scrollSpeed = portraitWorld ? 168 : 188;
    physics.spawnEvery = portraitWorld ? 1.42 : 1.28;
    physics.pipeGap = portraitWorld
      ? Math.round(H * Math.min(0.33, Math.max(0.29, 0.28 + (portraitAspect - 1.7) * 0.05)))
      : Math.round(H * Math.min(0.37, Math.max(0.32, 0.3 + (landscapeAspect - 1.45) * 0.02)));
    physics.pipeW = portraitWorld ? 100 : 96;
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
    GROUND_H = Math.round(H * 0.14);
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
    state.lilyPads = createLilyPads(16);
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
    const yMin = isPortraitWorld() ? H * 0.25 : H * 0.2;
    const yMax = isPortraitWorld() ? H * 0.52 : H * 0.58;
    for (let i = 0; i < 5; i += 1) {
      fields.push({
        x: nextX,
        y: rand(yMin, yMax),
        rx: rand(90, 140),
        ry: rand(65, 110),
        pushX: rand(-1, 1) * rand(0.25, 0.65),
        pushY: rand(-1, 1) * rand(0.35, 0.85),
        hue: rand(182, 214),
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

  function createBackgroundLayer(width, height) {
    const c = document.createElement("canvas");
    c.width = width * 3;
    c.height = height;
    const cctx = c.getContext("2d");

    const skyGrad = cctx.createLinearGradient(0, 0, 0, height);
    skyGrad.addColorStop(0, "#d2f0f8");
    skyGrad.addColorStop(0.5, "#bee7da");
    skyGrad.addColorStop(1, "#a8deb5");
    cctx.fillStyle = skyGrad;
    cctx.fillRect(0, 0, c.width, c.height);

    for (let i = 0; i < 24; i += 1) {
      const x = rand(0, c.width);
      const y = rand(height * 0.18, height * 0.55);
      paintBlob(cctx, x, y, rand(80, 170), rand(25, 55), "rgba(94, 168, 143, ALPHA)", 5);
      paintBlob(cctx, x + rand(-30, 30), y + rand(-14, 14), rand(60, 140), rand(22, 48), "rgba(164, 209, 171, ALPHA)", 4);
    }

    for (let i = 0; i < 45; i += 1) {
      const x = rand(0, c.width);
      const y = rand(height * 0.67, height - 20);
      paintBlob(cctx, x, y, rand(40, 90), rand(16, 36), "rgba(80, 153, 97, ALPHA)", 4);
    }

    cctx.globalCompositeOperation = "multiply";
    cctx.fillStyle = "rgba(58, 121, 92, 0.22)";
    cctx.fillRect(0, height - GROUND_H, c.width, GROUND_H);
    cctx.globalCompositeOperation = "source-over";

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
    musicNodes = createSoothingMusicLoop(audioCtx, masterGain);
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

  function hzFromSemitone(semitoneOffset) {
    return 220 * Math.pow(2, semitoneOffset / 12);
  }

  function playMusicNote(ctx, dest, frequency, now, duration, peakGain) {
    const voice = ctx.createGain();
    const bodyFilter = ctx.createBiquadFilter();
    bodyFilter.type = "lowpass";
    bodyFilter.frequency.setValueAtTime(2500, now);
    bodyFilter.frequency.exponentialRampToValueAtTime(1200, now + duration * 0.8);
    bodyFilter.Q.value = 0.7;

    const env = ctx.createGain();
    scheduleEnvelope(env.gain, now, [
      [0.0001, 0],
      [peakGain, 0.02],
      [peakGain * 0.58, 0.11],
      [0.0001, duration],
    ]);

    // Piano-ish harmonic stack: strong fundamental, softer overtones.
    const partials = [
      { ratio: 1, gain: 0.74, type: "triangle" },
      { ratio: 2, gain: 0.2, type: "sine" },
      { ratio: 3, gain: 0.1, type: "sine" },
      { ratio: 4, gain: 0.05, type: "sine" },
    ];

    for (const partial of partials) {
      const osc = ctx.createOscillator();
      const partialGain = ctx.createGain();
      osc.type = partial.type;
      osc.frequency.setValueAtTime(frequency * partial.ratio, now);
      osc.detune.value = (Math.random() - 0.5) * 6;
      partialGain.gain.value = partial.gain;
      osc.connect(partialGain);
      partialGain.connect(voice);
      osc.start(now);
      osc.stop(now + duration + 0.05);
    }

    // Very soft hammer transient.
    const hammerNoise = ctx.createBufferSource();
    hammerNoise.buffer = createNoiseBuffer(ctx, 0.05);
    const hammerFilter = ctx.createBiquadFilter();
    hammerFilter.type = "highpass";
    hammerFilter.frequency.value = 1600;
    const hammerGain = ctx.createGain();
    scheduleEnvelope(hammerGain.gain, now, [
      [0.0001, 0],
      [peakGain * 0.16, 0.005],
      [0.0001, 0.045],
    ]);
    hammerNoise.connect(hammerFilter);
    hammerFilter.connect(hammerGain);
    hammerGain.connect(voice);
    hammerNoise.start(now);
    hammerNoise.stop(now + 0.05);

    voice.connect(bodyFilter);
    bodyFilter.connect(env);
    env.connect(dest);
  }

  function createSoothingMusicLoop(ctx, dest) {
    const musicGain = ctx.createGain();
    musicGain.gain.value = 0.24;
    musicGain.connect(dest);

    const room = ctx.createBiquadFilter();
    room.type = "lowpass";
    room.frequency.value = 2100;
    room.Q.value = 0.6;
    room.connect(musicGain);

    const roomLfo = ctx.createOscillator();
    roomLfo.type = "sine";
    roomLfo.frequency.value = 0.05;
    const roomLfoGain = ctx.createGain();
    roomLfoGain.gain.value = 120;
    roomLfo.connect(roomLfoGain);
    roomLfoGain.connect(room.frequency);
    roomLfo.start();

    // Gentle major-leaning progression for a soothing piano tune.
    const progression = [
      [0, 4, 7],
      [2, 5, 9],
      [4, 7, 11],
      [5, 9, 12],
    ];
    const melody = [12, 14, 16, 19, 16, 14, 12, 11];
    const bassPattern = [0, 0, 7, 7, 4, 4, 7, 7];
    let chordIndex = 0;
    let melodyIndex = 0;
    let bassIndex = 0;
    let nextTime = ctx.currentTime + 0.25;
    let beatStep = 0;

    const scheduler = window.setInterval(() => {
      while (nextTime < ctx.currentTime + 0.8) {
        const chord = progression[chordIndex];
        const root = hzFromSemitone(chord[0]);

        if (beatStep % 2 === 0) {
          // Left hand bass note.
          const bassOffset = bassPattern[bassIndex % bassPattern.length] - 12;
          playMusicNote(ctx, room, hzFromSemitone(chord[0] + bassOffset), nextTime, 1.55, 0.028);
          bassIndex += 1;
        }

        // Right hand broken chord plus melody.
        playMusicNote(ctx, room, root, nextTime + 0.08, 1.0, 0.014);
        playMusicNote(ctx, room, hzFromSemitone(chord[1]), nextTime + 0.22, 0.95, 0.012);
        playMusicNote(ctx, room, hzFromSemitone(chord[2]), nextTime + 0.36, 0.9, 0.01);

        const melodyPitch = chord[0] + (melody[melodyIndex] - 5);
        playMusicNote(ctx, room, hzFromSemitone(melodyPitch), nextTime + 0.48, 1.05, 0.013);

        beatStep += 1;
        melodyIndex = (melodyIndex + 1) % melody.length;
        if (beatStep % 2 === 0) {
          chordIndex = (chordIndex + 1) % progression.length;
        }
        nextTime += 0.8;
      }
    }, 260);

    return {
      musicGain,
      room,
      roomLfo,
      roomLfoGain,
      scheduler,
    };
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

    const osc = audioCtx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.exponentialRampToValueAtTime(320, now + 0.11);

    const gain = audioCtx.createGain();
    scheduleEnvelope(gain.gain, now, [
      [0.0001, 0],
      [0.18, 0.01],
      [0.0001, 0.13],
    ]);

    const noise = audioCtx.createBufferSource();
    noise.buffer = createNoiseBuffer(audioCtx, 0.16);
    const noiseFilter = audioCtx.createBiquadFilter();
    noiseFilter.type = "highpass";
    noiseFilter.frequency.value = 1500;
    const noiseGain = audioCtx.createGain();
    scheduleEnvelope(noiseGain.gain, now, [
      [0.0001, 0],
      [0.08, 0.01],
      [0.0001, 0.08],
    ]);

    osc.connect(gain);
    gain.connect(masterGain);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(masterGain);

    osc.start(now);
    osc.stop(now + 0.15);
    noise.start(now);
    noise.stop(now + 0.12);
  }

  function playScoreSound() {
    if (!audioCtx || !masterGain) {
      return;
    }
    const now = audioCtx.currentTime;
    [740, 988].forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + idx * 0.06);

      const gain = audioCtx.createGain();
      scheduleEnvelope(gain.gain, now + idx * 0.06, [
        [0.0001, 0],
        [0.13, 0.01],
        [0.0001, 0.18],
      ]);

      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(now + idx * 0.06);
      osc.stop(now + idx * 0.23);
    });
  }

  function playHitSound() {
    if (!audioCtx || !masterGain) {
      return;
    }
    const now = audioCtx.currentTime;

    const osc = audioCtx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(78, now + 0.22);

    const oscGain = audioCtx.createGain();
    scheduleEnvelope(oscGain.gain, now, [
      [0.0001, 0],
      [0.2, 0.008],
      [0.0001, 0.24],
    ]);

    const noise = audioCtx.createBufferSource();
    noise.buffer = createNoiseBuffer(audioCtx, 0.24);
    const nFilter = audioCtx.createBiquadFilter();
    nFilter.type = "bandpass";
    nFilter.frequency.value = 420;
    nFilter.Q.value = 1.1;

    const nGain = audioCtx.createGain();
    scheduleEnvelope(nGain.gain, now, [
      [0.0001, 0],
      [0.12, 0.01],
      [0.0001, 0.21],
    ]);

    osc.connect(oscGain);
    oscGain.connect(masterGain);

    noise.connect(nFilter);
    nFilter.connect(nGain);
    nGain.connect(masterGain);

    osc.start(now);
    osc.stop(now + 0.26);
    noise.start(now);
    noise.stop(now + 0.22);
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
    state.bird.y = H * 0.42;
    state.bird.x = physics.birdBaseX;
    state.bird.vx = 0;
    state.bird.vy = 0;
    state.bird.rot = -0.08;
    state.bird.wingPulse = 0;
    state.bird.wingOpen = 0.2;
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

    state.bird.vy = physics.flapImpulse;
    state.bird.wingPulse = 1;
    state.bird.wingOpen = Math.max(state.bird.wingOpen, 0.64);
    state.bird.rot = -0.46;
    playFlapSound();
  }

  function spawnPipe() {
    const topLimit = physics.pipeTopPadding;
    const bottomLimit = H - GROUND_H - physics.pipeBottomPadding;
    const maxStep = Math.max(56, physics.pipeGap * 0.34);
    let minGapY = topLimit;
    let maxGapY = bottomLimit;

    if (typeof state.lastPipeGapY === "number") {
      minGapY = Math.max(topLimit, state.lastPipeGapY - maxStep);
      maxGapY = Math.min(bottomLimit, state.lastPipeGapY + maxStep);
    }

    if (minGapY > maxGapY) {
      minGapY = topLimit;
      maxGapY = bottomLimit;
    }

    const gapY = rand(minGapY, maxGapY);
    state.lastPipeGapY = gapY;

    state.pipes.push({
      x: W + 40,
      gapY,
      passed: false,
      hue: rand(108, 156),
    });
  }

  function update(dt) {
    state.time += dt;
    if (state.mode !== "playing") {
      return;
    }

    state.camX += physics.scrollSpeed * dt;

    const bird = state.bird;
    bird.wingPulse = Math.max(0, bird.wingPulse - dt * 2.9);
    bird.wingOpen += (0.14 - bird.wingOpen) * 0.12;
    bird.wingOpen *= 0.985;
    bird.vx += (physics.birdBaseX - bird.x) * dt * 6.5;

    for (const field of state.currentFields) {
      field.x -= physics.scrollSpeed * dt;
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
        bird.vx += field.pushX * influence * dt * physics.currentForceX;
        bird.vy += field.pushY * influence * dt * physics.currentForceY;
        bird.wingOpen = Math.min(1, bird.wingOpen + influence * 0.02);
      }
    }

    bird.vx *= 0.92;
    bird.x += bird.vx * dt;
    bird.x = Math.max(physics.birdMinX, Math.min(physics.birdMaxX, bird.x));
    bird.vy += physics.gravity * dt;
    bird.y += bird.vy * dt;
    bird.rot += (Math.min(1.05, bird.vy / 470 + bird.vx / 260) - bird.rot) * 0.12;

    state.pipeTimer += dt;
    if (state.pipeTimer >= physics.spawnEvery) {
      state.pipeTimer = 0;
      spawnPipe();
    }

    for (let i = state.pipes.length - 1; i >= 0; i -= 1) {
      const pipe = state.pipes[i];
      pipe.x -= physics.scrollSpeed * dt;

      if (!pipe.passed && pipe.x + physics.pipeW < bird.x) {
        pipe.passed = true;
        state.score += 1;
        scoreEl.textContent = String(state.score);
        playScoreSound();
      }

      if (pipe.x + physics.pipeW < -20) {
        state.pipes.splice(i, 1);
      }

      const withinX = bird.x + bird.r > pipe.x && bird.x - bird.r < pipe.x + physics.pipeW;
      if (withinX) {
        const hitTop = bird.y - bird.r < pipe.gapY - physics.pipeGap * 0.5;
        const hitBottom = bird.y + bird.r > pipe.gapY + physics.pipeGap * 0.5;
        if (hitTop || hitBottom) {
          setGameOver();
          return;
        }
      }
    }

    if (bird.y - bird.r < 0 || bird.y + bird.r > H - GROUND_H) {
      setGameOver();
    }
  }

  function drawPaintedPipe(pipe, isTop) {
    const pipeX = pipe.x;
    const gapHalf = physics.pipeGap * 0.5;
    const edge = isTop ? pipe.gapY - gapHalf : pipe.gapY + gapHalf;

    const y = isTop ? 0 : edge;
    const h = isTop ? edge : H - GROUND_H - edge;
    if (h <= 0) {
      return;
    }

    const worldTop = -10;
    const worldBottom = H - GROUND_H + 10;

    for (let i = 0; i < 4; i += 1) {
      const bleed = rand(-8, 8);
      const alpha = 0.12 + i * 0.03;
      ctx.fillStyle = `hsla(${pipe.hue}, 30%, ${44 + i * 2}%, ${alpha})`;
      const headY = isTop ? worldTop : y + rand(-2, 2);
      const tailY = isTop ? y + h + rand(-2, 2) : worldBottom;
      ctx.beginPath();
      ctx.moveTo(pipeX + bleed, headY);
      ctx.lineTo(pipeX + physics.pipeW + rand(-6, 6), headY + rand(-1.5, 1.5));
      ctx.lineTo(pipeX + physics.pipeW + rand(-8, 8), tailY + rand(-1.5, 1.5));
      ctx.lineTo(pipeX + rand(-8, 8), tailY);
      ctx.closePath();
      ctx.fill();
    }

    for (let i = 0; i < 28; i += 1) {
      const nx = pipeX + rand(8, physics.pipeW - 8);
      const ny = y + rand(6, h - 6);
      const n = noise2D(nx * 0.03, ny * 0.04, i);
      ctx.fillStyle = `rgba(45, 66, 57, ${0.03 + n * 0.09})`;
      ctx.fillRect(nx, ny, rand(1, 3), rand(1, 3));
    }

    ctx.strokeStyle = "rgba(36, 58, 48, 0.22)";
    ctx.lineWidth = 2;
    ctx.strokeRect(pipeX + 3, y + 3, physics.pipeW - 6, h - 6);
  }

  function drawBird() {
    const b = state.bird;
    const wingSpread = 0.35 + b.wingOpen * 0.75 + Math.sin(state.time * 8.5) * 0.06 * b.wingPulse;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.rot);

    // Flamingo body wash.
    for (let i = 0; i < 5; i += 1) {
      ctx.beginPath();
      ctx.ellipse(rand(-2, 2), rand(-1.5, 1.5), b.r + rand(-1.8, 2.4), b.r * 0.74 + rand(-1.6, 1.8), rand(-0.2, 0.2), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(240, 153, 176, ${0.13 + i * 0.03})`;
      ctx.fill();
    }

    // Wing opens wider when flapping/charging.
    ctx.save();
    ctx.translate(-2, -2);
    ctx.rotate(-0.22 - wingSpread * 0.28);
    ctx.beginPath();
    ctx.ellipse(-8, 2, b.r * (0.72 + wingSpread * 0.24), b.r * (0.44 + wingSpread * 0.18), -0.4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(228, 126, 156, 0.62)";
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-6, 2, b.r * 0.5, b.r * 0.28, -0.35, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(245, 178, 198, 0.45)";
    ctx.fill();
    ctx.restore();

    // Neck + head.
    ctx.strokeStyle = "rgba(232, 133, 163, 0.78)";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(4, -6);
    ctx.quadraticCurveTo(12, -20, 16, -7);
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(16, -7, 5.2, 4.6, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(245, 170, 191, 0.9)";
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(17, -8, 1.4, 1.4, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(44, 38, 34, 0.84)";
    ctx.fill();

    // Flamingo beak with dark tip.
    ctx.beginPath();
    ctx.moveTo(20, -6);
    ctx.lineTo(30, -4.5);
    ctx.lineTo(22, -2.5);
    ctx.closePath();
    ctx.fillStyle = "rgba(245, 224, 166, 0.84)";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(24, -4.9);
    ctx.lineTo(30, -4.4);
    ctx.lineTo(25.5, -3.2);
    ctx.closePath();
    ctx.fillStyle = "rgba(36, 34, 34, 0.84)";
    ctx.fill();

    ctx.restore();
  }

  function drawGround() {
    const y = H - GROUND_H;
    ctx.fillStyle = "rgba(107, 130, 104, 0.5)";
    ctx.fillRect(0, y, W, GROUND_H);

    for (let i = 0; i < 160; i += 1) {
      const x = ((i * 39) + state.camX * 0.5) % (W + 80) - 40;
      const h = 10 + ((i * 7) % 16);
      ctx.strokeStyle = "rgba(70, 102, 75, 0.23)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, H - 8);
      ctx.quadraticCurveTo(x + 3, H - 8 - h, x + 1.5, H - 8 - h * 0.2);
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
    ctx.fillStyle = "#d5e5de";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(viewport.scale, 0, 0, viewport.scale, viewport.offsetX, viewport.offsetY);

    drawBackground();
    drawCurrentFields();

    for (const pipe of state.pipes) {
      drawPaintedPipe(pipe, true);
      drawPaintedPipe(pipe, false);
    }

    drawBird();
    drawGround();
    drawWatercolorPost();

    if (state.mode === "menu") {
      const bob = Math.sin(state.time * 2.2) * 8;
      state.bird.y = H * 0.42 + bob;
      state.bird.rot = Math.sin(state.time * 1.9) * 0.08;
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
