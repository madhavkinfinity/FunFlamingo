import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";

(() => {
  const canvas = document.getElementById("game");

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

  const STORAGE_KEY = "jetpack_flamingo_best";

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#cfe8ff");

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
  camera.position.set(-12, 6.5, 30);
  camera.lookAt(6, 0, 0);

  const hemi = new THREE.HemisphereLight(0xeaf7ff, 0xb8d3f4, 1.08);
  scene.add(hemi);

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.35);
  keyLight.position.set(18, 28, 14);
  keyLight.castShadow = true;
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0xa7d8ff, 0.52);
  rimLight.position.set(-22, 6, -20);
  scene.add(rimLight);

  const world = {
    width: 70,
    height: 46,
    depth: 26,
  };

  const physics = {
    gravity: 50,
    flapImpulse: 18,
    thrust: 38,
    pipeGap: 13,
    pipeW: 5,
    scrollSpeed: 24,
    spawnEvery: 1.55,
    birdX: -14,
    birdMinX: -16,
    birdMaxX: -8,
  };

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function rand(min, max) { return Math.random() * (max - min) + min; }

  const state = {
    mode: "menu",
    time: 0,
    score: 0,
    best: Number(localStorage.getItem(STORAGE_KEY) || 0),
    bird: {
      x: physics.birdX,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      rot: 0,
    },
    pipes: [],
    pipeTimer: 0,
    thrustHeld: false,
    thrustBoost: 0,
  };

  const worldRoot = new THREE.Group();
  scene.add(worldRoot);

  const bgRoot = new THREE.Group();
  scene.add(bgRoot);

  const pipeRoot = new THREE.Group();
  worldRoot.add(pipeRoot);

  const flameParticles = [];
  const flameRoot = new THREE.Group();
  worldRoot.add(flameRoot);

  const cameraTarget = new THREE.Vector3(6, 0, 0);

  function createCloudField() {
    const group = new THREE.Group();
    const cloudGeo = new THREE.SphereGeometry(1, 18, 18);
    for (let i = 0; i < 42; i += 1) {
      const puff = new THREE.Mesh(
        cloudGeo,
        new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.57, 0.45, rand(0.88, 0.96)), roughness: 0.65, metalness: 0.02, transparent: true, opacity: rand(0.42, 0.72) }),
      );
      puff.scale.set(rand(2.8, 8.2), rand(1.2, 3.1), rand(1.8, 4.3));
      puff.position.set(rand(-120, 150), rand(8, 42), rand(-95, -30));
      group.add(puff);
    }
    return group;
  }

  function createMountainLayer(depth = -66, baseY = -17, hue = 0.58, saturation = 0.2, lightness = 0.62, alpha = 0.92) {
    const group = new THREE.Group();
    const mountainLength = 320;
    const segments = 38;
    const shape = new THREE.Shape();
    shape.moveTo(-mountainLength * 0.5, -15);
    for (let i = 0; i <= segments; i += 1) {
      const t = i / segments;
      const x = -mountainLength * 0.5 + t * mountainLength;
      const ridge = Math.sin(t * Math.PI * 6.4 + rand(-0.14, 0.14)) * 1.2;
      const peak = Math.sin(t * Math.PI * 2.1 + 0.7) * 4.2;
      const y = baseY + Math.abs(Math.sin(t * Math.PI * 5.1)) * rand(6.8, 12.5) + ridge + peak;
      shape.lineTo(x, y);
    }
    shape.lineTo(mountainLength * 0.5, -15);
    shape.lineTo(-mountainLength * 0.5, -15);

    const mountain = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(hue, saturation, lightness),
        roughness: 0.86,
        metalness: 0.02,
        transparent: true,
        opacity: alpha,
      }),
    );
    mountain.position.set(40, 0, depth);
    group.add(mountain);

    const snow = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshStandardMaterial({
        color: 0xf6fbff,
        roughness: 0.8,
        metalness: 0.03,
        transparent: true,
        opacity: alpha * 0.35,
      }),
    );
    snow.position.set(40, 1.2, depth + 0.2);
    snow.scale.set(0.98, 0.83, 1);
    group.add(snow);

    return group;
  }

  function createGround() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(420, 120, 120, 24),
      new THREE.MeshStandardMaterial({ color: 0xd7ecff, roughness: 0.95, metalness: 0.01 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(80, -16, 0);

    const attr = ground.geometry.attributes.position;
    for (let i = 0; i < attr.count; i += 1) {
      const x = attr.getX(i);
      const y = attr.getY(i);
      const d = Math.sin(x * 0.08) * 0.42 + Math.cos(y * 0.12) * 0.35;
      attr.setZ(i, d);
    }
    ground.geometry.computeVertexNormals();
    return ground;
  }

  bgRoot.add(createCloudField());
  bgRoot.add(createMountainLayer(-70, -18, 0.58, 0.2, 0.62, 0.86));
  bgRoot.add(createMountainLayer(-77, -20, 0.6, 0.16, 0.57, 0.62));
  bgRoot.add(createGround());

  function createFlamingoRig() {
    const rig = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xff89b4, roughness: 0.42, metalness: 0.1 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0xffc8db, roughness: 0.4, metalness: 0.07 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x202533, roughness: 0.6, metalness: 0.02 });
    const beakMat = new THREE.MeshStandardMaterial({ color: 0xf2d595, roughness: 0.6, metalness: 0.03 });
    const jetMat = new THREE.MeshStandardMaterial({ color: 0x667995, roughness: 0.3, metalness: 0.75 });

    const body = new THREE.Mesh(new THREE.SphereGeometry(1.75, 28, 28), bodyMat);
    body.scale.set(1.5, 1.08, 1.2);
    rig.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.86, 20, 20), accentMat);
    head.position.set(2.3, 1.05, 0);
    rig.add(head);

    const crest = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 14), bodyMat);
    crest.position.set(2.44, 1.64, 0);
    crest.scale.set(1.25, 0.7, 1.15);
    rig.add(crest);

    const neck = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.2, 16, 30, Math.PI * 0.8), bodyMat);
    neck.position.set(1.05, 0.76, 0);
    neck.rotation.set(0.4, -0.22, 0.06);
    rig.add(neck);

    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.1, 12), beakMat);
    beak.rotation.z = -Math.PI / 2;
    beak.position.set(3.07, 0.95, 0);
    rig.add(beak);

    const beakTip = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.32, 10), darkMat);
    beakTip.rotation.z = -Math.PI / 2;
    beakTip.position.set(3.58, 0.95, 0);
    rig.add(beakTip);

    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), darkMat);
    eye.position.set(2.62, 1.17, 0.43);
    rig.add(eye);
    const eye2 = eye.clone();
    eye2.position.z = -0.43;
    rig.add(eye2);

    const pupilHighlight = new THREE.Mesh(
      new THREE.SphereGeometry(0.028, 6, 6),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0.02 }),
    );
    pupilHighlight.position.set(2.68, 1.2, 0.47);
    rig.add(pupilHighlight);
    const pupilHighlight2 = pupilHighlight.clone();
    pupilHighlight2.position.z = -0.47;
    rig.add(pupilHighlight2);

    const wingGeo = new THREE.SphereGeometry(0.95, 20, 20);
    const wingL = new THREE.Mesh(wingGeo, bodyMat);
    wingL.scale.set(1.45, 0.5, 1.05);
    wingL.position.set(-0.2, 0.2, 1.2);
    rig.add(wingL);

    const wingR = wingL.clone();
    wingR.position.z = -1.2;
    rig.add(wingR);

    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.38, 1.3, 12), accentMat);
    tail.position.set(-2.06, -0.2, 0);
    tail.rotation.set(0, 0, Math.PI * 0.74);
    rig.add(tail);

    const legGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.45, 10);
    const legL = new THREE.Mesh(legGeo, darkMat);
    legL.position.set(-0.25, -1.54, 0.45);
    legL.rotation.z = 0.08;
    rig.add(legL);
    const legR = legL.clone();
    legR.position.z = -0.45;
    legR.rotation.z = -0.08;
    rig.add(legR);

    const footGeo = new THREE.BoxGeometry(0.42, 0.05, 0.22);
    const footL = new THREE.Mesh(footGeo, darkMat);
    footL.position.set(0, -2.23, 0.45);
    rig.add(footL);
    const footR = footL.clone();
    footR.position.z = -0.45;
    rig.add(footR);

    const jetBody = new THREE.Mesh(new THREE.BoxGeometry(0.58, 1.1, 0.8), jetMat);
    jetBody.position.set(-1.45, 0.0, 0);
    rig.add(jetBody);

    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.36, 14), jetMat);
    nozzle.rotation.z = Math.PI / 2;
    nozzle.position.set(-1.95, 0, 0);
    rig.add(nozzle);

    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.05, 12), jetMat);
    tank.position.set(-1.45, 0.58, 0);
    tank.rotation.z = Math.PI / 2;
    rig.add(tank);

    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.85, 10),
      new THREE.MeshStandardMaterial({ color: 0xffa34f, emissive: 0xff7b2e, emissiveIntensity: 1.6, transparent: true, opacity: 0.82 }),
    );
    flame.rotation.z = -Math.PI / 2;
    flame.position.set(-2.5, 0, 0);
    rig.add(flame);

    return { rig, wingL, wingR, flame };
  }

  const flamingo = createFlamingoRig();
  worldRoot.add(flamingo.rig);

  function createPipeAsset(pipe) {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.57 + rand(-0.03, 0.03), 0.42, 0.68), roughness: 0.34, metalness: 0.18, transparent: true, opacity: 0.96 });
    const capMaterial = new THREE.MeshStandardMaterial({ color: 0xe8f9ff, emissive: 0x8fc7f8, emissiveIntensity: 0.22, roughness: 0.12, metalness: 0.52 });
    const coreMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x9ecfff, emissiveIntensity: 0.12, roughness: 0.08, metalness: 0.15, transparent: true, opacity: 0.28 });

    const topH = world.height / 2 + pipe.gapY - pipe.gap / 2;
    const bottomH = world.height / 2 - pipe.gapY - pipe.gap / 2;

    const top = new THREE.Mesh(new THREE.BoxGeometry(pipe.w, Math.max(1, topH), pipe.d), material);
    top.position.set(0, world.height / 2 - topH / 2, 0);
    group.add(top);

    const bottom = new THREE.Mesh(new THREE.BoxGeometry(pipe.w, Math.max(1, bottomH), pipe.d), material);
    bottom.position.set(0, -world.height / 2 + bottomH / 2, 0);
    group.add(bottom);

    const topCore = new THREE.Mesh(new THREE.BoxGeometry(pipe.w * 0.62, Math.max(0.6, topH - 0.8), pipe.d * 0.58), coreMaterial);
    topCore.position.copy(top.position);
    group.add(topCore);

    const bottomCore = topCore.clone();
    bottomCore.position.copy(bottom.position);
    group.add(bottomCore);

    const topCap = new THREE.Mesh(new THREE.CylinderGeometry(pipe.w * 0.6, pipe.w * 0.74, 0.85, 14), capMaterial);
    topCap.rotation.z = Math.PI / 2;
    topCap.position.set(0, pipe.gapY + pipe.gap * 0.5, 0);
    group.add(topCap);

    const bottomCap = topCap.clone();
    bottomCap.position.y = pipe.gapY - pipe.gap * 0.5;
    group.add(bottomCap);

    const grooveGeo = new THREE.TorusGeometry(pipe.w * 0.36, 0.06, 8, 18);
    for (let i = 0; i < 3; i += 1) {
      const ring = new THREE.Mesh(grooveGeo, capMaterial);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(0, top.position.y - (i + 1) * Math.max(0.7, topH * 0.16), 0);
      group.add(ring);

      const ringB = ring.clone();
      ringB.position.y = bottom.position.y + (i + 1) * Math.max(0.7, bottomH * 0.16);
      group.add(ringB);
    }

    pipe.mesh = group;
    pipeRoot.add(group);
  }

  function resetGame() {
    state.mode = "playing";
    state.score = 0;
    state.pipes.forEach((p) => p.mesh && pipeRoot.remove(p.mesh));
    state.pipes.length = 0;
    state.pipeTimer = 0;
    state.bird.x = physics.birdX;
    state.bird.y = 0;
    state.bird.vx = 0;
    state.bird.vy = 0;
    state.bird.rot = -0.08;
    state.thrustBoost = 0;
    state.thrustHeld = false;
    camera.position.set(-12, 6.5, 30);
    cameraTarget.set(6, 0, 0);
    scoreEl.textContent = "0";
    menu.classList.remove("visible");
    gameover.classList.remove("visible");
  }

  function setGameOver() {
    state.mode = "gameover";
    if (state.score > state.best) {
      state.best = state.score;
      localStorage.setItem(STORAGE_KEY, String(state.best));
    }
    finalScoreEl.textContent = `Score: ${state.score}`;
    bestScoreEl.textContent = `Best: ${state.best}`;
    gameover.classList.add("visible");
  }

  function flap() {
    if (state.mode === "menu") {
      resetGame();
    }
    if (state.mode !== "playing") {
      return;
    }
    state.bird.vy = Math.max(state.bird.vy + physics.thrust * 0.25, physics.flapImpulse);
    state.thrustBoost = 1;
    state.thrustHeld = true;
  }

  function spawnPipe() {
    const pipe = {
      x: 54,
      y: 0,
      gapY: rand(-8, 8),
      gap: physics.pipeGap * rand(0.92, 1.08),
      w: physics.pipeW * rand(0.94, 1.08),
      d: rand(5.5, 8.5),
      passed: false,
      mesh: null,
    };
    createPipeAsset(pipe);
    state.pipes.push(pipe);
  }

  function emitFlame(dt) {
    if (state.thrustBoost < 0.08) return;
    const burst = Math.floor(2 + state.thrustBoost * 12);
    for (let i = 0; i < burst; i += 1) {
      const particle = new THREE.Mesh(
        new THREE.SphereGeometry(rand(0.08, 0.2), 8, 8),
        new THREE.MeshStandardMaterial({
          color: Math.random() < 0.4 ? 0xfff0cf : 0xff8b36,
          emissive: 0xff6f2a,
          emissiveIntensity: 1.5,
          transparent: true,
          opacity: 0.85,
        }),
      );
      particle.position.set(
        state.bird.x - 2.5 + rand(-0.15, 0.2),
        state.bird.y + rand(-0.2, 0.2),
        rand(-0.25, 0.25),
      );
      flameRoot.add(particle);
      flameParticles.push({
        mesh: particle,
        life: rand(0.16, 0.36),
        age: 0,
        vx: -rand(8, 22),
        vy: rand(-3, 3),
        vz: rand(-2, 2),
      });
    }

    for (let i = flameParticles.length - 1; i >= 0; i -= 1) {
      const f = flameParticles[i];
      f.age += dt;
      if (f.age >= f.life) {
        flameRoot.remove(f.mesh);
        f.mesh.geometry.dispose();
        f.mesh.material.dispose();
        flameParticles.splice(i, 1);
        continue;
      }
      const t = 1 - f.age / f.life;
      f.mesh.position.x += f.vx * dt;
      f.mesh.position.y += f.vy * dt;
      f.mesh.position.z += f.vz * dt;
      f.mesh.scale.setScalar(Math.max(0.2, t));
      f.mesh.material.opacity = t * 0.88;
    }
  }

  function update(dt) {
    state.time += dt;
    if (state.mode !== "playing") {
      animateBirdIdle(dt);
      return;
    }

    const liveSpeed = physics.scrollSpeed * (1 + clamp(state.score / 70, 0, 0.35));
    state.pipeTimer += dt;
    if (state.pipeTimer >= physics.spawnEvery) {
      state.pipeTimer = 0;
      spawnPipe();
    }

    const b = state.bird;
    if (state.thrustHeld) {
      state.thrustBoost = 1;
    } else {
      state.thrustBoost = Math.max(0, state.thrustBoost - dt * 2.5);
    }

    if (state.thrustBoost > 0) {
      b.vy += physics.thrust * state.thrustBoost * dt;
    }

    b.vy -= physics.gravity * dt;
    b.y += b.vy * dt;
    b.vx += (physics.birdX - b.x) * dt * 4.2;
    b.x += b.vx * dt;
    b.x = clamp(b.x, physics.birdMinX, physics.birdMaxX);
    b.rot += ((b.vy / 22) - b.rot) * 0.14;

    for (let i = state.pipes.length - 1; i >= 0; i -= 1) {
      const p = state.pipes[i];
      p.x -= liveSpeed * dt;

      if (!p.passed && p.x + p.w < b.x) {
        p.passed = true;
        state.score += 1;
        scoreEl.textContent = String(state.score);
      }

      if (p.x + p.w < -40) {
        if (p.mesh) pipeRoot.remove(p.mesh);
        state.pipes.splice(i, 1);
        continue;
      }

      const hitRadius = 1.55;
      const withinX = b.x + hitRadius > p.x && b.x - hitRadius < p.x + p.w;
      if (withinX) {
        const gapHalf = p.gap / 2;
        const hitTop = b.y - hitRadius < p.gapY - gapHalf;
        const hitBottom = b.y + hitRadius > p.gapY + gapHalf;
        if (hitTop || hitBottom) {
          setGameOver();
          break;
        }
      }
    }

    if (b.y < -world.height / 2 + 1.3 || b.y > world.height / 2 - 1.3) {
      setGameOver();
    }

    emitFlame(dt);
    syncSceneFromState(dt);
  }

  function animateBirdIdle(dt) {
    state.bird.y += (Math.sin(state.time * 2.2) * 1.4 - state.bird.y) * dt * 4;
    state.bird.rot += ((Math.sin(state.time * 1.8) * 0.12) - state.bird.rot) * dt * 4;
    syncSceneFromState(dt);
  }

  function syncSceneFromState(dt) {
    const b = state.bird;
    flamingo.rig.position.set(b.x, b.y, b.z);
    flamingo.rig.rotation.set(0, 0, clamp(b.rot, -0.75, 0.95));

    const wingCycle = Math.sin(state.time * 16 + state.thrustBoost * 4) * 0.35;
    flamingo.wingL.rotation.y = 0.4 + wingCycle;
    flamingo.wingR.rotation.y = -0.4 - wingCycle;

    flamingo.flame.scale.set(1 + state.thrustBoost * 2.3, 1, 1);
    flamingo.flame.material.opacity = 0.2 + state.thrustBoost * 0.7;

    for (const p of state.pipes) {
      if (!p.mesh) continue;
      p.mesh.position.set(p.x + p.w * 0.5, 0, 0);
    }

    const targetCamX = b.x - 5.8;
    const targetCamY = clamp(b.y * 0.24 + 6.2, 3.7, 9.4);
    camera.position.x += (targetCamX - camera.position.x) * dt * 3.2;
    camera.position.y += (targetCamY - camera.position.y) * dt * 4.2;
    cameraTarget.set(b.x + 12.5, b.y * 0.35, 0);
    camera.lookAt(cameraTarget);

    bgRoot.position.x = -((state.time * 0.7) % 160);
  }

  function render() {
    renderer.render(scene, camera);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function startFromSplash() {
    splash.classList.remove("visible");
    resetGame();
    flap();
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
  startBtn.addEventListener("click", () => { resetGame(); flap(); });
  restartBtn.addEventListener("click", resetGame);

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
  window.addEventListener("pointerup", () => { state.thrustHeld = false; });
  window.addEventListener("pointercancel", () => { state.thrustHeld = false; });
  window.addEventListener("keyup", (ev) => {
    if (ev.code === "Space" || ev.code === "ArrowUp") state.thrustHeld = false;
  });

  const fullscreenApi = {
    request: document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen,
    exit: document.exitFullscreen || document.webkitExitFullscreen,
    element: () => document.fullscreenElement || document.webkitFullscreenElement,
  };

  function toggleFullscreen() {
    const root = document.querySelector(".game-wrap");
    if (fullscreenApi.element()) {
      fullscreenApi.exit && fullscreenApi.exit.call(document);
      return;
    }
    fullscreenApi.request && root && fullscreenApi.request.call(root);
  }

  function syncFullscreenButton() {
    if (!fullscreenBtn) return;
    fullscreenBtn.textContent = fullscreenApi.element() ? "Exit Fullscreen" : "Fullscreen";
  }

  if (fullscreenBtn) {
    fullscreenBtn.addEventListener("click", () => {
      toggleFullscreen();
      syncFullscreenButton();
    });
    syncFullscreenButton();
  }

  window.addEventListener("resize", resize);
  document.addEventListener("fullscreenchange", syncFullscreenButton);

  bestScoreEl.textContent = `Best: ${state.best}`;
  resize();

  let last = performance.now();
  function tick(now) {
    const dt = Math.min((now - last) / 1000, 0.033);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
