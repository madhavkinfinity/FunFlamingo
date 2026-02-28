(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const menu = document.getElementById("menu");
  const gameover = document.getElementById("gameover");
  const startBtn = document.getElementById("startBtn");
  const restartBtn = document.getElementById("restartBtn");
  const scoreEl = document.getElementById("score");
  const finalScoreEl = document.getElementById("finalScore");
  const bestScoreEl = document.getElementById("bestScore");

  const W = canvas.width;
  const H = canvas.height;
  const GROUND_H = 84;

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
      vy: 0,
      rot: 0,
    },
    pipes: [],
    pipeTimer: 0,
    camX: 0,
  };

  const physics = {
    gravity: 980,
    flapImpulse: -320,
    scrollSpeed: 185,
    pipeGap: 180,
    pipeW: 90,
    spawnEvery: 1.22,
  };

  let audioCtx = null;
  let masterGain = null;
  let ambientNodes = null;

  const watercolorLayer = createWatercolorLayer(W, H);
  const paperLayer = createPaperTexture(W, H);
  const bloomLayer = createBloomLayer(W, H);
  const bgLayer = createBackgroundLayer(W, H);

  function rand(min, max) {
    return Math.random() * (max - min) + min;
  }

  function noise2D(x, y, seed) {
    const v = Math.sin(x * 12.9898 + y * 78.233 + seed * 31.415) * 43758.5453123;
    return v - Math.floor(v);
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
    c.width = width * 2;
    c.height = height;
    const cctx = c.getContext("2d");

    const skyGrad = cctx.createLinearGradient(0, 0, 0, height);
    skyGrad.addColorStop(0, "#d3e8ec");
    skyGrad.addColorStop(0.5, "#c8dfd5");
    skyGrad.addColorStop(1, "#b4cfba");
    cctx.fillStyle = skyGrad;
    cctx.fillRect(0, 0, c.width, c.height);

    for (let i = 0; i < 24; i += 1) {
      const x = rand(0, c.width);
      const y = rand(height * 0.18, height * 0.55);
      paintBlob(cctx, x, y, rand(80, 170), rand(25, 55), "rgba(117, 149, 132, ALPHA)", 5);
      paintBlob(cctx, x + rand(-30, 30), y + rand(-14, 14), rand(60, 140), rand(22, 48), "rgba(151, 176, 155, ALPHA)", 4);
    }

    for (let i = 0; i < 45; i += 1) {
      const x = rand(0, c.width);
      const y = rand(height * 0.67, height - 20);
      paintBlob(cctx, x, y, rand(40, 90), rand(16, 36), "rgba(100, 133, 100, ALPHA)", 4);
    }

    cctx.globalCompositeOperation = "multiply";
    cctx.fillStyle = "rgba(79, 103, 92, 0.2)";
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
    state.pipeTimer = 0;
    state.bird.y = H * 0.42;
    state.bird.vy = 0;
    state.bird.rot = -0.08;
    state.camX = 0;
    scoreEl.textContent = "0";

    menu.classList.remove("visible");
    gameover.classList.remove("visible");
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
    state.bird.rot = -0.42;
    playFlapSound();
  }

  function spawnPipe() {
    const margin = 96;
    const topLimit = 90;
    const bottomLimit = H - GROUND_H - margin;
    const gapY = rand(topLimit, bottomLimit);

    state.pipes.push({
      x: W + 40,
      gapY,
      passed: false,
      hue: rand(95, 145),
    });
  }

  function update(dt) {
    state.time += dt;

    if (state.mode !== "playing") {
      return;
    }

    state.camX += physics.scrollSpeed * dt;

    const bird = state.bird;
    bird.vy += physics.gravity * dt;
    bird.y += bird.vy * dt;
    bird.rot += (Math.min(1.15, bird.vy / 460) - bird.rot) * 0.12;

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

    for (let i = 0; i < 4; i += 1) {
      const bleed = rand(-8, 8);
      const alpha = 0.12 + i * 0.03;
      ctx.fillStyle = `hsla(${pipe.hue}, 30%, ${44 + i * 2}%, ${alpha})`;
      ctx.beginPath();
      ctx.moveTo(pipeX + bleed, y);
      ctx.lineTo(pipeX + physics.pipeW + rand(-6, 6), y + rand(-4, 4));
      ctx.lineTo(pipeX + physics.pipeW + rand(-8, 8), y + h + rand(-5, 5));
      ctx.lineTo(pipeX + rand(-8, 8), y + h + rand(-5, 5));
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
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.rot);

    for (let i = 0; i < 5; i += 1) {
      ctx.beginPath();
      ctx.ellipse(rand(-2, 2), rand(-1.5, 1.5), b.r + rand(-1.8, 2.4), b.r * 0.78 + rand(-1.6, 1.8), rand(-0.2, 0.2), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(231, 165, 101, ${0.13 + i * 0.03})`;
      ctx.fill();
    }

    ctx.beginPath();
    ctx.ellipse(3, 0, b.r * 0.62, b.r * 0.45, -0.18, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(197, 127, 78, 0.28)";
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(8, -2, 2.7, 2.7, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(44, 38, 34, 0.84)";
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(11, 3);
    ctx.lineTo(22, 6);
    ctx.lineTo(11, 9);
    ctx.closePath();
    ctx.fillStyle = "rgba(221, 152, 72, 0.8)";
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

  function drawBackground() {
    const scroll = (state.camX * 0.23) % W;
    ctx.drawImage(bgLayer, -scroll, 0);
    ctx.drawImage(bgLayer, W - scroll, 0);
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
    ctx.clearRect(0, 0, W, H);

    drawBackground();

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
    flap();
  }

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
      flap();
    }
  });

  canvas.addEventListener("pointerdown", onInteract, { passive: false });
  canvas.addEventListener("touchstart", onInteract, { passive: false });

  bestScoreEl.textContent = `Best: ${state.best}`;
  requestAnimationFrame(tick);
})();
