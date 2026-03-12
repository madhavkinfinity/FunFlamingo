#!/usr/bin/env node

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function getTuning({ portrait = true } = {}) {
  const W = 720;
  const H = portrait ? 1280 : 720;
  const pipeGapBase = portrait
    ? Math.round(H * Math.min(0.33, Math.max(0.29, 0.28 + ((H / W) - 1.7) * 0.05)))
    : Math.round(H * Math.min(0.4, Math.max(0.34, 0.32 + ((W / H) - 1.45) * 0.02)));

  return {
    H,
    scrollSpeed: portrait ? 162 : 182,
    spawnEvery: portrait ? 1.7 : 1.5,
    pipeTopPadding: portrait ? Math.round(H * 0.12) : Math.round(H * 0.14),
    pipeBottomPadding: portrait ? Math.round(H * 0.18) : Math.round(H * 0.16),
    pipeGapBase,
  };
}

function simulateRun(config, pipeCount = 220) {
  let lastGapY = null;
  let impossibleCount = 0;

  for (let i = 0; i < pipeCount; i += 1) {
    const difficulty = clamp(i / 150, 0, 1);
    const dynamicGap = clamp(config.pipeGapBase * (1 - difficulty * 0.14), 144, config.pipeGapBase);
    const playableMin = config.pipeTopPadding + dynamicGap * 0.5;
    const playableMax = config.H - config.pipeBottomPadding - dynamicGap * 0.5;

    let gapY = rand(playableMin, playableMax);
    if (lastGapY !== null) {
      const maxGapShift = dynamicGap * (0.26 - difficulty * 0.06) + config.H * 0.02;
      gapY = clamp(gapY, lastGapY - maxGapShift, lastGapY + maxGapShift);
    }

    if (lastGapY !== null) {
      const liveScrollSpeed = config.scrollSpeed * (1 + difficulty * 0.2);
      const liveSpawnEvery = config.spawnEvery * (1 - difficulty * 0.1);
      const horizontalDistance = liveScrollSpeed * liveSpawnEvery;

      // Conservative reachable center shift envelope per obstacle interval.
      const reachableVerticalShift = 0.58 * horizontalDistance;
      const requiredShift = Math.abs(gapY - lastGapY);

      if (requiredShift > reachableVerticalShift) {
        impossibleCount += 1;
      }
    }

    lastGapY = gapY;
  }

  return impossibleCount;
}

function runTrials({ portrait, trials = 600 }) {
  const config = getTuning({ portrait });
  let impossibleTransitions = 0;
  for (let i = 0; i < trials; i += 1) {
    impossibleTransitions += simulateRun(config);
  }
  return { impossibleTransitions, trials };
}

const portrait = runTrials({ portrait: true });
const landscape = runTrials({ portrait: false });

console.log(`Portrait impossible transitions: ${portrait.impossibleTransitions} across ${portrait.trials} runs`);
console.log(`Landscape impossible transitions: ${landscape.impossibleTransitions} across ${landscape.trials} runs`);

if (portrait.impossibleTransitions > 0 || landscape.impossibleTransitions > 0) {
  process.exitCode = 1;
}
