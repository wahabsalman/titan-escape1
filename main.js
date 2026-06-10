const THREE = window.THREE;
if (!THREE) {
  throw new Error('Three.js failed to load');
}

const canvas = document.getElementById('game');
const scoreEl = document.getElementById('score');
const distanceEl = document.getElementById('distance');
const fuelEl = document.getElementById('fuel');
const highScoreEl = document.getElementById('high-score');
const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('game-over');
const finalScoreEl = document.getElementById('final-score');
const finalDistanceEl = document.getElementById('final-distance');
const finalHighScoreEl = document.getElementById('final-high-score');

const laneCount = 5;
const laneSpacing = 8;
const middleLaneIndex = Math.floor(laneCount / 2);
const lanes = Array.from({ length: laneCount }, (_, index) => (index - middleLaneIndex) * laneSpacing);
const chunkLength = 28;
const chunkCount = 12;
const roadWidth = laneSpacing * (laneCount - 1) + 8;
const maxFuel = 100;
const highScoreKey = 'titan_escape_high_score';
const clock = new THREE.Clock();
const fixedStep = 1 / 60;
let accumulator = 0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04070b);
scene.fog = new THREE.Fog(0x04070b, 24, 180);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 400);
camera.position.set(0, 5.2, -16);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.setClearColor(0x04070b, 1);

const ambient = new THREE.AmbientLight(0x86b7ff, 1.25);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xffefd6, 2.2);
keyLight.position.set(10, 18, -8);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x4fdcff, 0.95);
rimLight.position.set(-12, 10, 16);
scene.add(rimLight);

const fillLight = new THREE.PointLight(0xf97316, 1.15, 80, 2);
fillLight.position.set(0, 2, 24);
scene.add(fillLight);

const world = new THREE.Group();
scene.add(world);

const roadMaterial = new THREE.MeshStandardMaterial({
  color: 0x101824,
  roughness: 0.95,
  metalness: 0.05,
});

const roadEdgeMaterial = new THREE.MeshStandardMaterial({
  color: 0x0a1f2f,
  roughness: 0.86,
  metalness: 0.08,
  emissive: 0x09131e,
  emissiveIntensity: 0.35,
});

const laneLineMaterial = new THREE.MeshStandardMaterial({
  color: 0x86e8ff,
  emissive: 0x36d5ff,
  emissiveIntensity: 0.45,
  roughness: 0.35,
  metalness: 0.18,
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(from, to, alpha) {
  return from + (to - from) * alpha;
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function randomLane(exclude = []) {
  const available = [];
  for (let index = 0; index < lanes.length; index += 1) {
    if (!exclude.includes(index)) {
      available.push(index);
    }
  }
  return available[Math.floor(Math.random() * available.length)];
}

function syncOverlayStrings(title, message, buttonText) {
  startScreen.querySelector('h1').textContent = title;
  startScreen.querySelector('p').textContent = message;
  startScreen.querySelector('button').textContent = buttonText;
}

const audioState = { ctx: null };
function getAudioContext() {
  if (!audioState.ctx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    audioState.ctx = new AudioContextClass();
  }
  return audioState.ctx;
}

function tone(startFreq, endFreq, duration, type, gain) {
  const ctx = getAudioContext();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(startFreq, ctx.currentTime);
  if (endFreq) {
    osc.frequency.exponentialRampToValueAtTime(endFreq, ctx.currentTime + duration * 0.95);
  }
  amp.gain.setValueAtTime(gain, ctx.currentTime);
  amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  osc.connect(amp);
  amp.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

function playJumpSound() { tone(320, 540, 0.09, 'triangle', 0.02); }
function playCoinSound() { tone(760, 1220, 0.08, 'sine', 0.025); }
function playHitSound() { tone(160, 60, 0.16, 'sawtooth', 0.04); }
function playBoostSound() { tone(420, 840, 0.11, 'square', 0.022); }
function playGameOverSound() { tone(120, 40, 0.34, 'square', 0.036); }

function makeRoadChunk() {
  const group = new THREE.Group();

  const road = new THREE.Mesh(new THREE.BoxGeometry(roadWidth, 0.45, chunkLength), roadMaterial);
  road.position.y = -0.25;
  group.add(road);

  const leftRail = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.35, chunkLength), roadEdgeMaterial);
  leftRail.position.set(-roadWidth / 2 + 0.3, 0.05, 0);
  group.add(leftRail);

  const rightRail = leftRail.clone();
  rightRail.position.x = roadWidth / 2 - 0.3;
  group.add(rightRail);

  for (const x of lanes) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, chunkLength), laneLineMaterial);
    line.position.set(x, 0.02, 0);
    group.add(line);
  }

  for (let i = 0; i < 3; i += 1) {
    const debris = new THREE.Mesh(
      new THREE.BoxGeometry(rand(0.8, 1.6), rand(1.2, 3.8), rand(0.4, 1.0)),
      new THREE.MeshStandardMaterial({
        color: 0x16202b,
        roughness: 0.95,
        metalness: 0.04,
        emissive: 0x07111a,
        emissiveIntensity: 0.15,
      })
    );
    debris.position.set((Math.random() < 0.5 ? -1 : 1) * rand(roadWidth * 0.42, roadWidth * 0.64), debris.geometry.parameters.height / 2 - 0.1, rand(-chunkLength * 0.42, chunkLength * 0.42));
    group.add(debris);
  }

  return group;
}

function makeObstacle(type) {
  const group = new THREE.Group();
  group.userData.kind = 'obstacle';
  group.userData.type = type;

  if (type === 'crate') {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 1.6, 2.2),
      new THREE.MeshStandardMaterial({
        color: 0xf97316,
        roughness: 0.72,
        metalness: 0.08,
        emissive: 0x321206,
        emissiveIntensity: 0.28,
      })
    );
    body.position.y = 0.8;
    group.add(body);

    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(2.48, 0.16, 2.3),
      new THREE.MeshStandardMaterial({
        color: 0xffd08a,
        emissive: 0xffb14d,
        emissiveIntensity: 0.45,
        roughness: 0.4,
      })
    );
    cap.position.y = 1.52;
    group.add(cap);
  } else if (type === 'bar') {
    const postMaterial = new THREE.MeshStandardMaterial({
      color: 0x30485b,
      roughness: 0.76,
      metalness: 0.12,
    });
    const postGeometry = new THREE.BoxGeometry(0.26, 2.0, 0.26);
    const leftPost = new THREE.Mesh(postGeometry, postMaterial);
    leftPost.position.set(-1.0, 1.0, 0);
    group.add(leftPost);
    const rightPost = leftPost.clone();
    rightPost.position.x = 1.0;
    group.add(rightPost);

    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.3, 1.0),
      new THREE.MeshStandardMaterial({
        color: 0x7dd3fc,
        emissive: 0x3ad6ff,
        emissiveIntensity: 0.7,
        roughness: 0.35,
        metalness: 0.22,
      })
    );
    beam.position.y = 2.0;
    group.add(beam);
  } else {
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 4.2, 2.2),
      new THREE.MeshStandardMaterial({
        color: 0x1f2937,
        roughness: 0.9,
        metalness: 0.04,
        emissive: 0x0b1220,
        emissiveIntensity: 0.25,
      })
    );
    wall.position.y = 2.1;
    group.add(wall);

    const glow = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.35, 2.24),
      new THREE.MeshStandardMaterial({
        color: 0xfbbf24,
        emissive: 0xf97316,
        emissiveIntensity: 1.0,
        roughness: 0.14,
      })
    );
    glow.position.set(0, 3.0, 0.02);
    group.add(glow);
  }

  return group;
}

function makeCoin() {
  const group = new THREE.Group();
  group.userData.kind = 'coin';
  group.userData.type = 'coin';

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.45, 0.14, 10, 18),
    new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      emissive: 0xffb703,
      emissiveIntensity: 0.8,
      metalness: 0.25,
      roughness: 0.25,
    })
  );
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 12, 12),
    new THREE.MeshStandardMaterial({
      color: 0xfff7c7,
      emissive: 0xffd34d,
      emissiveIntensity: 1.1,
    })
  );
  group.add(core);

  return group;
}

function makePowerup(type) {
  const group = new THREE.Group();
  group.userData.kind = 'powerup';
  group.userData.type = type;

  const baseColor = type === 'speed' ? 0x7dd3fc : 0x22c55e;
  const emissiveColor = type === 'speed' ? 0x22d3ee : 0x86efac;

  const shell = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.6, 0),
    new THREE.MeshStandardMaterial({
      color: baseColor,
      emissive: emissiveColor,
      emissiveIntensity: 0.8,
      roughness: 0.28,
      metalness: 0.18,
    })
  );
  group.add(shell);

  const inner = new THREE.Mesh(
    new THREE.TorusGeometry(0.28, 0.08, 8, 18),
    new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      emissive: emissiveColor,
      emissiveIntensity: 1.0,
    })
  );
  inner.rotation.x = Math.PI / 2;
  group.add(inner);

  return group;
}

const pools = {
  obstacle: { crate: [], bar: [], wall: [] },
  coin: [],
  powerup: { speed: [], shield: [] },
};

const state = {
  running: false,
  over: false,
  score: 0,
  distance: 0,
  fuel: 100,
  highScore: Number.parseInt(localStorage.getItem(highScoreKey) || '0', 10) || 0,
  speed: 30,
  laneIndex: middleLaneIndex,
  targetLaneIndex: middleLaneIndex,
  playerX: 0,
  playerY: 0,
  playerVy: 0,
  slideTime: 0,
  shield: 0,
  speedBoostTime: 0,
  titanGap: 10,
  shake: 0,
  time: 0,
  coinPoints: 0,
};

function takeObstacle(type) {
  return pools.obstacle[type].pop() || makeObstacle(type);
}

function takeCoin() {
  return pools.coin.pop() || makeCoin();
}

function takePowerup(type) {
  return pools.powerup[type].pop() || makePowerup(type);
}

function releaseEntity(mesh) {
  if (!mesh) return;
  mesh.visible = false;
  mesh.removeFromParent();
  if (mesh.userData.kind === 'obstacle') {
    pools.obstacle[mesh.userData.type].push(mesh);
  } else if (mesh.userData.kind === 'coin') {
    pools.coin.push(mesh);
  } else if (mesh.userData.kind === 'powerup') {
    pools.powerup[mesh.userData.type].push(mesh);
  }
}

function makePlayer() {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 1.6, 0.9),
    new THREE.MeshStandardMaterial({
      color: 0x7dd3fc,
      roughness: 0.45,
      metalness: 0.18,
      emissive: 0x102f40,
      emissiveIntensity: 0.5,
    })
  );
  body.position.y = 1.25;
  group.add(body);

  const chest = new THREE.Mesh(
    new THREE.BoxGeometry(1.15, 0.65, 0.92),
    new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.32,
      metalness: 0.08,
    })
  );
  chest.position.y = 1.52;
  group.add(chest);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.38, 16, 16),
    new THREE.MeshStandardMaterial({
      color: 0xffd4b3,
      roughness: 0.78,
      metalness: 0.02,
    })
  );
  head.position.y = 2.2;
  group.add(head);

  const backpack = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.84, 0.34),
    new THREE.MeshStandardMaterial({
      color: 0xf97316,
      roughness: 0.45,
      metalness: 0.14,
      emissive: 0x241206,
      emissiveIntensity: 0.25,
    })
  );
  backpack.position.set(-0.55, 1.4, -0.06);
  group.add(backpack);

  group.userData = { body, chest, head, backpack };
  return group;
}

function makeTitan() {
  const group = new THREE.Group();

  const core = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 2.8, 1.45),
    new THREE.MeshStandardMaterial({
      color: 0x272b4f,
      roughness: 0.72,
      metalness: 0.08,
      emissive: 0x150a18,
      emissiveIntensity: 0.25,
    })
  );
  core.position.y = 1.8;
  group.add(core);

  const shoulders = new THREE.Mesh(
    new THREE.BoxGeometry(2.6, 0.8, 1.7),
    new THREE.MeshStandardMaterial({
      color: 0x4c1d95,
      roughness: 0.82,
      metalness: 0.08,
      emissive: 0x180c2a,
      emissiveIntensity: 0.16,
    })
  );
  shoulders.position.y = 2.72;
  group.add(shoulders);

  const head = new THREE.Mesh(
    new THREE.BoxGeometry(1.15, 1.1, 1.0),
    new THREE.MeshStandardMaterial({
      color: 0x1f2937,
      roughness: 0.6,
      metalness: 0.08,
      emissive: 0x090909,
      emissiveIntensity: 0.16,
    })
  );
  head.position.y = 3.35;
  group.add(head);

  const eyes = new THREE.Mesh(
    new THREE.BoxGeometry(0.56, 0.14, 0.12),
    new THREE.MeshStandardMaterial({
      color: 0xfb7185,
      emissive: 0xfb7185,
      emissiveIntensity: 2.2,
      roughness: 0.2,
    })
  );
  eyes.position.set(0, 3.33, 0.54);
  group.add(eyes);

  const fists = new THREE.Mesh(
    new THREE.BoxGeometry(2.3, 0.7, 0.95),
    new THREE.MeshStandardMaterial({
      color: 0x374151,
      roughness: 0.82,
      metalness: 0.08,
    })
  );
  fists.position.set(0, 1.15, 0.15);
  group.add(fists);

  const aura = new THREE.PointLight(0xfb7185, 2.2, 18, 2);
  aura.position.set(0, 2.2, 0.8);
  group.add(aura);

  group.scale.setScalar(0.68);
  group.position.y = -0.2;

  return group;
}

function makeChunk(z) {
  const group = new THREE.Group();
  group.position.z = z;
  group.add(makeRoadChunk());
  const decor = new THREE.Group();
  const entities = new THREE.Group();
  group.add(decor);
  group.add(entities);
  return { group, decor, entities, items: [], index: 0 };
}

function decorateChunk(chunk) {
  while (chunk.decor.children.length > 0) {
    chunk.decor.remove(chunk.decor.children[0]);
  }

  const material = new THREE.MeshStandardMaterial({
    color: 0x16202b,
    roughness: 0.94,
    metalness: 0.04,
    emissive: 0x07111a,
    emissiveIntensity: 0.16,
  });

  const count = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < count; i += 1) {
    const pillarHeight = rand(3.5, 7.5);
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(rand(0.8, 1.4), pillarHeight, rand(0.6, 1.2)), material);
    pillar.position.set((Math.random() < 0.5 ? -1 : 1) * rand(roadWidth * 0.42, roadWidth * 0.65), pillarHeight / 2 - 0.1, rand(-chunkLength * 0.42, chunkLength * 0.42));
    chunk.decor.add(pillar);
  }
}

function clearChunk(chunk) {
  for (const item of chunk.items) {
    releaseEntity(item.mesh);
  }
  chunk.items.length = 0;
}

function addEntity(chunk, mesh, laneIndex, localZ, localY) {
  mesh.position.set(lanes[laneIndex], localY, localZ);
  mesh.userData.laneIndex = laneIndex;
  mesh.userData.localZ = localZ;
  mesh.userData.localY = localY;
  chunk.entities.add(mesh);
  chunk.items.push({
    mesh,
    kind: mesh.userData.kind,
    type: mesh.userData.type,
    laneIndex,
    localZ,
    localY,
    passed: false,
    spin: Math.random() * Math.PI * 2,
  });
}

function addCoinLine(chunk, laneIndex, startZ, count) {
  for (let i = 0; i < count; i += 1) {
    const coin = takeCoin();
    coin.visible = true;
    addEntity(chunk, coin, laneIndex, startZ + i * 2.1, 1.35);
  }
}

function addObstacle(chunk, type, laneIndex, localZ) {
  const obstacle = takeObstacle(type);
  obstacle.visible = true;
  addEntity(chunk, obstacle, laneIndex, localZ, 0);
}

function addPowerup(chunk, type, laneIndex, localZ) {
  const powerup = takePowerup(type);
  powerup.visible = true;
  addEntity(chunk, powerup, laneIndex, localZ, 1.15);
}

function populateChunk(chunk, firstPass = false) {
  clearChunk(chunk);
  if (!firstPass) {
    decorateChunk(chunk);
  }

  const difficulty = clamp(state.distance / 900, 0, 1);
  const pattern = Math.floor(Math.random() * 8);
  const laneA = randomLane();
  const laneB = randomLane([laneA]);
  const laneC = randomLane([laneA, laneB]);
  const laneD = randomLane([laneA, laneB, laneC]);
  const laneE = randomLane([laneA, laneB, laneC, laneD]);
  const z1 = 8 + Math.random() * (7 - difficulty * 1.5);
  const z2 = 16 + Math.random() * (7 - difficulty * 2);

  if (pattern === 0) {
    addObstacle(chunk, 'crate', laneA, z1);
    addCoinLine(chunk, laneB, z1 + 2.4, 4);
    addObstacle(chunk, 'bar', laneD, z2);
  } else if (pattern === 1) {
    addObstacle(chunk, 'bar', laneA, z1);
    addCoinLine(chunk, laneB, z1 + 1.8, 5);
    addPowerup(chunk, 'shield', laneC, z2);
  } else if (pattern === 2) {
    addObstacle(chunk, 'wall', laneA, z1);
    addObstacle(chunk, 'crate', laneC, z2);
    addCoinLine(chunk, laneB, z1 + 1.8, 3);
  } else if (pattern === 3) {
    addCoinLine(chunk, laneA, z1, 5);
    addObstacle(chunk, 'crate', laneB, z2);
    addPowerup(chunk, 'speed', laneC, z2 + 1.8);
  } else if (pattern === 4) {
    addObstacle(chunk, 'crate', laneA, z1);
    addObstacle(chunk, 'bar', laneC, z2);
    addCoinLine(chunk, laneB, z1 + 1.3, 4);
  } else if (pattern === 5) {
    addCoinLine(chunk, laneA, z1, 6);
    addPowerup(chunk, pick(['speed', 'shield']), laneB, z2);
    if (Math.random() < 0.5) addObstacle(chunk, 'wall', laneC, z2 + 4);
  } else if (pattern === 6) {
    addObstacle(chunk, 'crate', laneA, z1);
    addCoinLine(chunk, laneC, z1 + 1.5, 4);
    addObstacle(chunk, 'bar', laneE, z2);
    addPowerup(chunk, 'shield', laneB, z2 + 2.4);
  } else {
    addCoinLine(chunk, laneD, z1, 5);
    addObstacle(chunk, 'wall', laneB, z2);
    addObstacle(chunk, 'crate', laneE, z2 + 3);
    addPowerup(chunk, pick(['speed', 'shield']), laneA, z2 + 1.4);
  }

  if (Math.random() < 0.33) {
    const powerupChance = Math.max(0.12, 0.33 - difficulty * 0.18);
    if (Math.random() < powerupChance) {
      addPowerup(chunk, Math.random() < 0.5 ? 'speed' : 'shield', randomLane([laneA, laneB, laneC]), 20 + Math.random() * 4);
    }
  }

  if (difficulty > 0.3 && Math.random() < 0.55) {
    addObstacle(chunk, Math.random() < 0.5 ? 'crate' : 'bar', randomLane([laneA, laneB]), 11 + Math.random() * 8);
  }

  if (difficulty > 0.62 && Math.random() < 0.42) {
    addObstacle(chunk, 'crate', randomLane([laneC, laneD]), 18 + Math.random() * 5);
  }
}

const chunks = [];
for (let i = 0; i < chunkCount; i += 1) {
  const chunk = makeChunk(i * chunkLength);
  chunk.index = i;
  world.add(chunk.group);
  chunks.push(chunk);
  populateChunk(chunk, true);
}

const player = makePlayer();
scene.add(player);

const titan = makeTitan();
scene.add(titan);

const dustGeometry = new THREE.BufferGeometry();
const dustCount = 180;
const dustPositions = new Float32Array(dustCount * 3);
for (let i = 0; i < dustCount; i += 1) {
  dustPositions[i * 3] = (Math.random() - 0.5) * 90;
  dustPositions[i * 3 + 1] = Math.random() * 30 + 1;
  dustPositions[i * 3 + 2] = (Math.random() - 0.5) * 220;
}
dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
const dust = new THREE.Points(
  dustGeometry,
  new THREE.PointsMaterial({
    color: 0x93d8ff,
    size: 0.12,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
  })
);
scene.add(dust);

function updateHUD() {
  scoreEl.textContent = String(Math.floor(state.score));
  distanceEl.textContent = String(Math.floor(state.distance));
  fuelEl.textContent = String(Math.floor(state.fuel));
  highScoreEl.textContent = String(Math.floor(state.highScore));
}

function setStartState() {
  startScreen.style.display = 'flex';
  gameOverScreen.style.display = 'none';
  syncOverlayStrings('TITAN ESCAPE', 'Escape the Giant Titan', 'PLAY');
}

function setGameOverState() {
  startScreen.style.display = 'none';
  gameOverScreen.style.display = 'flex';
  finalScoreEl.textContent = String(Math.floor(state.score));
  finalDistanceEl.textContent = String(Math.floor(state.distance));
  finalHighScoreEl.textContent = String(Math.floor(state.highScore));
}

function resetGame() {
  state.running = false;
  state.over = false;
  state.score = 0;
  state.distance = 0;
  state.fuel = 100;
  state.speed = 30;
  state.laneIndex = middleLaneIndex;
  state.targetLaneIndex = middleLaneIndex;
  state.playerX = 0;
  state.playerY = 0;
  state.playerVy = 0;
  state.slideTime = 0;
  state.shield = 0;
  state.speedBoostTime = 0;
  state.titanGap = 10;
  state.shake = 0;
  state.time = 0;
  state.coinPoints = 0;

  player.position.set(0, 0, 0);
  player.scale.set(1, 1, 1);
  player.rotation.set(0, 0, 0);
  titan.position.set(0, 0, -10);

  for (let i = 0; i < chunks.length; i += 1) {
    chunks[i].group.position.z = i * chunkLength;
    populateChunk(chunks[i], i === 0);
  }

  updateHUD();
  setStartState();
}

function startGame() {
  if (state.over) {
    resetGame();
  }
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume();
  }
  state.running = true;
  state.over = false;
  startScreen.style.display = 'none';
  gameOverScreen.style.display = 'none';
  updateHUD();
}

function restartGame() {
  resetGame();
  startGame();
}

window.startGame = startGame;
window.restartGame = restartGame;

function endGame(reason) {
  if (state.over) return;
  state.running = false;
  state.over = true;
  state.highScore = Math.max(state.highScore, Math.floor(state.score));
  localStorage.setItem(highScoreKey, String(state.highScore));
  playGameOverSound();
  setGameOverState();
  if (reason) {
    gameOverScreen.querySelector('h1').textContent = 'GAME OVER';
  }
  updateHUD();
}

function queueLane(delta) {
  if (!state.running || state.over) return;
  state.targetLaneIndex = clamp(state.targetLaneIndex + delta, 0, lanes.length - 1);
}

function queueJump() {
  if (!state.running || state.over) return;
  if (state.playerY <= 0.02) {
    state.playerVy = 8.8;
    playJumpSound();
  }
}

function queueSlide() {
  if (!state.running || state.over) return;
  if (state.playerY <= 0.02) {
    state.slideTime = 0.58;
  }
}

function handleInput(action) {
  if (action === 'left') queueLane(1);
  if (action === 'right') queueLane(-1);
  if (action === 'jump') queueJump();
  if (action === 'slide') queueSlide();
}

window.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  const key = event.key.toLowerCase();
  if (key === 'arrowleft' || key === 'a') handleInput('left');
  else if (key === 'arrowright' || key === 'd') handleInput('right');
  else if (key === 'arrowup' || key === 'w' || key === ' ') handleInput('jump');
  else if (key === 'arrowdown' || key === 's') handleInput('slide');
  else if (key === 'r') restartGame();
});

let swipeStartX = 0;
let swipeStartY = 0;
let swipeActive = false;

window.addEventListener('pointerdown', (event) => {
  swipeStartX = event.clientX;
  swipeStartY = event.clientY;
  swipeActive = true;
});

window.addEventListener('pointerup', (event) => {
  if (!swipeActive) return;
  swipeActive = false;
  const dx = event.clientX - swipeStartX;
  const dy = event.clientY - swipeStartY;
  if (Math.abs(dx) > Math.abs(dy)) {
    if (dx > 28) handleInput('right');
    else if (dx < -28) handleInput('left');
  } else {
    if (dy < -28) handleInput('jump');
    else if (dy > 28) handleInput('slide');
  }
});

document.querySelectorAll('#mobile-controls button').forEach((button) => {
  button.addEventListener('click', () => {
    handleInput(button.dataset.action);
  });
});

function updatePlayer(dt) {
  const targetX = lanes[state.targetLaneIndex];
  state.playerX = lerp(state.playerX, targetX, clamp(dt * 12, 0, 1));
  if (Math.abs(state.playerX - targetX) < 0.03) {
    state.laneIndex = state.targetLaneIndex;
  }

  if (state.slideTime > 0) {
    state.slideTime -= dt;
    if (state.slideTime < 0) state.slideTime = 0;
  }

  if (state.playerY > 0 || state.playerVy > 0) {
    state.playerVy -= 24 * dt;
    state.playerY += state.playerVy * dt;
    if (state.playerY <= 0) {
      state.playerY = 0;
      state.playerVy = 0;
    }
  }

  const sliding = state.slideTime > 0;
  player.position.x = state.playerX;
  player.position.y = 0.16 + state.playerY + (sliding ? -0.32 : 0);
  player.scale.y = lerp(player.scale.y, sliding ? 0.62 : 1, clamp(dt * 14, 0, 1));
  player.scale.x = lerp(player.scale.x, sliding ? 1.08 : 1, clamp(dt * 14, 0, 1));
  player.rotation.z = lerp(player.rotation.z, clamp((targetX - state.playerX) * -0.01, -0.08, 0.08), clamp(dt * 10, 0, 1));

  const refs = player.userData;
  refs.chest.visible = !sliding;
  refs.head.position.y = sliding ? 1.52 : 2.2;
  refs.backpack.position.y = sliding ? 1.05 : 1.4;
}

function updateRoad(dt) {
  for (const chunk of chunks) {
    chunk.group.position.z -= state.speed * dt;
  }

  let farthest = -Infinity;
  for (const chunk of chunks) {
    if (chunk.group.position.z > farthest) farthest = chunk.group.position.z;
  }

  for (const chunk of chunks) {
    if (chunk.group.position.z < -chunkLength) {
      chunk.group.position.z = farthest + chunkLength;
      populateChunk(chunk, false);
      farthest = chunk.group.position.z;
    }
  }
}

function updateDust(dt) {
  const positions = dustGeometry.attributes.position.array;
  for (let i = 0; i < dustCount; i += 1) {
    positions[i * 3 + 2] -= state.speed * dt * 0.35;
    positions[i * 3 + 1] += Math.sin(state.time * 0.4 + i) * 0.0008;
    if (positions[i * 3 + 2] < -50) {
      positions[i * 3 + 2] = 120 + Math.random() * 120;
      positions[i * 3 + 0] = (Math.random() - 0.5) * 90;
      positions[i * 3 + 1] = Math.random() * 30 + 1;
    }
  }
  dustGeometry.attributes.position.needsUpdate = true;
}

function matchesLane(item) {
  return Math.abs(state.playerX - lanes[item.laneIndex]) < 3.8;
}

function collectCoin(mesh, chunk, index) {
  state.coinPoints += 100;
  state.fuel = clamp(state.fuel + 8, 0, maxFuel);
  state.titanGap = Math.min(14, state.titanGap + 0.18);
  playCoinSound();
  releaseEntity(mesh);
  chunk.items.splice(index, 1);
}

function collectPowerup(mesh, chunk, index) {
  if (mesh.userData.type === 'speed') {
    state.speedBoostTime = Math.max(state.speedBoostTime, 5.2);
    state.fuel = clamp(state.fuel + 15, 0, maxFuel);
    state.titanGap = Math.min(14, state.titanGap + 0.5);
    playBoostSound();
  } else {
    state.shield = 1;
    state.fuel = clamp(state.fuel + 12, 0, maxFuel);
    playBoostSound();
  }
  releaseEntity(mesh);
  chunk.items.splice(index, 1);
}

function obstacleCollision(item) {
  const sliding = state.slideTime > 0;
  if (item.type === 'crate') {
    return state.playerY < 1.18;
  }
  if (item.type === 'bar') {
    return !sliding;
  }
  return true;
}

function updateChunkEntities(dt) {
  for (const chunk of chunks) {
    for (let i = chunk.items.length - 1; i >= 0; i -= 1) {
      const item = chunk.items[i];
      const mesh = item.mesh;
      mesh.rotation.y += dt * (item.kind === 'coin' ? 2.2 : 0.7);
      if (item.kind === 'coin') {
        mesh.position.y = item.localY + Math.sin(state.time * 5 + item.spin) * 0.08;
      }

      const worldZ = chunk.group.position.z + item.localZ;
      const closeEnough = Math.abs(worldZ) < 1.35;

      if (item.kind === 'coin') {
        if (closeEnough && matchesLane(item)) {
          collectCoin(mesh, chunk, i);
        }
        continue;
      }

      if (item.kind === 'powerup') {
        if (closeEnough && matchesLane(item)) {
          collectPowerup(mesh, chunk, i);
        }
        continue;
      }

      if (item.kind === 'obstacle') {
        if (!item.passed && worldZ < -1.8) {
          item.passed = true;
          state.score += 25;
          state.fuel = clamp(state.fuel + 4, 0, maxFuel);
          state.titanGap = Math.min(14, state.titanGap + 0.4);
        }

        if (closeEnough && matchesLane(item)) {
          if (state.shield > 0) {
            state.shield = 0;
            state.shake = Math.max(state.shake, 0.22);
            state.titanGap = Math.max(2.5, state.titanGap - 0.25);
            playHitSound();
            releaseEntity(mesh);
            chunk.items.splice(i, 1);
          } else if (obstacleCollision(item)) {
            state.shake = Math.max(state.shake, 0.34);
            playHitSound();
            endGame('An obstacle hit ended the escape.');
            return;
          }
        }
      }
    }
  }
}

function updateTitan(dt) {
  const stagePressure = clamp(state.distance / 1600, 0, 0.45);
  const closingRate = 0.34 + state.speed * 0.012 + stagePressure;
  state.titanGap -= closingRate * dt;

  if (state.speedBoostTime > 0) {
    state.titanGap += 0.2 * dt;
  }

  if (state.fuel < 20) {
    state.titanGap -= (20 - state.fuel) * 0.004 * dt;
  }

  state.titanGap = clamp(state.titanGap, 1.45, 14);
  titan.position.x = lerp(titan.position.x, state.playerX - 0.6, clamp(dt * 8, 0, 1));
  titan.position.z = -state.titanGap;
  titan.position.y = 0.02 + Math.sin(state.time * 4.5) * 0.08;
  titan.rotation.y = Math.sin(state.time * 1.8) * 0.05;

  if (state.titanGap <= 1.5) {
    state.shake = Math.max(state.shake, 0.28);
    endGame('The Titan caught the runner.');
  }
}

function updateCamera(dt) {
  const shakeX = state.shake > 0 ? (Math.random() - 0.5) * state.shake : 0;
  const shakeY = state.shake > 0 ? (Math.random() - 0.5) * state.shake * 0.6 : 0;
  camera.position.x = lerp(camera.position.x, state.playerX * 0.1 + shakeX, clamp(dt * 4, 0, 1));
  camera.position.y = lerp(camera.position.y, 5.2 + state.playerY * 0.45 + shakeY, clamp(dt * 5, 0, 1));
  camera.position.z = lerp(camera.position.z, -16, clamp(dt * 5, 0, 1));
  camera.lookAt(state.playerX * 0.12, 1.6 + state.playerY * 0.25, 6);
  if (state.shake > 0) {
    state.shake = Math.max(0, state.shake - dt * 0.9);
  }
}

function step(dt) {
  if (!state.running || state.over) {
    renderer.render(scene, camera);
    return;
  }

  state.time += dt;
  state.distance += state.speed * dt;

  const baseSpeed = 30;
  const fuelPenalty = state.fuel < 25 ? (25 - state.fuel) * 0.12 : 0;
  const boost = state.speedBoostTime > 0 ? 7 : 0;
  state.speed = clamp(baseSpeed + boost - fuelPenalty, 25, 58);

  if (state.speedBoostTime > 0) {
    state.speedBoostTime = Math.max(0, state.speedBoostTime - dt);
  }

  state.fuel -= (1.7 + state.speed * 0.05) * dt;
  state.fuel = clamp(state.fuel, 0, maxFuel);

  if (state.fuel <= 0) {
    state.fuel = 0;
    state.titanGap -= 0.15 * dt;
  }

  updateRoad(dt);
  updatePlayer(dt);
  updateChunkEntities(dt);
  if (!state.over) {
    updateTitan(dt);
  }
  updateCamera(dt);
  updateDust(dt);

  state.score = Math.floor(state.distance * 12 + state.coinPoints);
  if (state.score > state.highScore) {
    state.highScore = state.score;
    localStorage.setItem(highScoreKey, String(state.highScore));
  }

  updateHUD();
}

function animate() {
  accumulator += Math.min(clock.getDelta(), 0.05);
  while (accumulator >= fixedStep) {
    step(fixedStep);
    accumulator -= fixedStep;
  }
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
});

setStartState();
updateHUD();
animate();
