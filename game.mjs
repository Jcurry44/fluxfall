import {
  NORTH,
  SOUTH,
  clamp,
  createSeededRandom,
  cycleCreatedByBond,
  lerp,
  pointInPolygon,
  polarityBag,
  scoreRing,
} from "./core.mjs";

const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
const scoreNode = document.querySelector("#score");
const promptNode = document.querySelector("#prompt");
const promptStep = document.querySelector("#prompt-step");
const promptTitle = document.querySelector("#prompt-title");
const promptDetail = document.querySelector("#prompt-detail");
const helpButton = document.querySelector("#help-toggle");
const rulesOverlay = document.querySelector("#rules-overlay");
const rulesDismiss = document.querySelector("#rules-dismiss");
const soundButton = document.querySelector("#sound-toggle");
const failureButton = document.querySelector("#failure");
const failureScore = document.querySelector("#failure-score");
const failureBest = document.querySelector("#failure-best");

const W = 390;
const H = 844;
const R = 19;
const FIXED_STEP = 1 / 120;
const MAX_STEPS = 8;
const JAR = {
  top: 130,
  danger: 184,
  leftTop: 45,
  rightTop: 345,
  leftFloor: 27,
  rightFloor: 363,
  curveY: 752,
  floor: 805,
  cornerRadius: 53,
};
const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;

const COLORS = {
  plus: "#ff744a",
  plusHot: "#ffc06a",
  minus: "#35cfff",
  minusHot: "#9af4ff",
  flux: "#edffd7",
  text: "#f3f7f4",
};

const random = createSeededRandom(0xf10f411);
let nextId = 1;
let accumulator = 0;
let lastFrame = performance.now();
let renderScale = 1;
let noisePattern = null;

const state = {
  time: 0,
  startedAt: 0,
  phase: "tutorial",
  score: 0,
  best: readBest(),
  combo: 1,
  lastRingAt: -99,
  dropCount: 0,
  particles: [],
  bonds: [],
  effects: [],
  motes: [],
  wallBlooms: [],
  currentPole: SOUTH,
  queue: [],
  polarityHistory: [],
  aimX: W / 2,
  aiming: false,
  waitingForNext: false,
  nextReadyAt: 0,
  tutorialTarget: { x: 220, y: 344 },
  tutorialDrop: null,
  learningStage: "demo",
  guidedTarget: { x: 195, y: 678 },
  guidedReleasedId: null,
  guidedRetryAt: 0,
  nextCoachUpdateAt: 0,
  coachSignature: "",
  helpOpen: false,
  danger: 0,
  shake: 0,
};

class SoundEngine {
  constructor() {
    this.enabled = true;
    this.context = null;
    this.master = null;
    this.wallAt = -1;
  }

  unlock() {
    if (!this.enabled) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!this.context) {
      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.master.gain.value = 0.62;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") this.context.resume();
  }

  tone(start, end, duration, volume = 0.035, type = "sine", delay = 0) {
    if (!this.enabled || !this.context || !this.master) return;
    const when = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(start, when);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, end), when + duration);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(volume, when + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(when);
    oscillator.stop(when + duration + 0.02);
  }

  pickup(pole) {
    const root = pole === NORTH ? 196 : 294;
    this.tone(root, root * 2, 0.065, 0.018, "triangle");
  }

  bond() {
    this.tone(240, 360, 0.085, 0.026, "sine");
  }

  wall() {
    if (state.time - this.wallAt < 0.12) return;
    this.wallAt = state.time;
    this.tone(130, 82, 0.045, 0.009, "triangle");
  }

  ring(size) {
    const notes = [261.63, 392, 329.63, 493.88, 392, 587.33];
    for (let index = 0; index < Math.min(size, notes.length); index += 1) {
      this.tone(notes[index], notes[index] * 1.01, 0.22, 0.016, "sine", 0.09 + index * 0.035);
    }
    for (const [index, note] of [523.25, 659.25, 783.99].entries()) {
      this.tone(note, note * 0.998, 0.82, 0.018, "sine", 0.56 + index * 0.012);
    }
  }

  fail() {
    this.tone(164, 82, 0.48, 0.035, "sine");
  }
}

const sound = new SoundEngine();

function haptic(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

function readBest() {
  try {
    return Number(localStorage.getItem("fluxfall-best")) || 0;
  } catch {
    return 0;
  }
}

function saveBest() {
  try {
    localStorage.setItem("fluxfall-best", String(state.best));
  } catch {
    // Storage is optional in embedded previews.
  }
}

function formatScore(value) {
  return String(Math.max(0, Math.round(value))).padStart(6, "0");
}

function updateScoreDisplay(bump = false) {
  scoreNode.textContent = formatScore(state.score);
  if (bump) {
    scoreNode.classList.remove("bump");
    void scoreNode.offsetWidth;
    scoreNode.classList.add("bump");
  }
}

function setCoach(step = "", title = "", detail = "") {
  const signature = `${step}|${title}|${detail}`;
  if (signature === state.coachSignature) return;
  state.coachSignature = signature;
  promptNode.hidden = !title;
  if (!title) return;
  promptStep.textContent = step;
  promptTitle.textContent = title;
  promptDetail.textContent = detail;
}

function setRulesOpen(open, focus = true) {
  state.helpOpen = open;
  rulesOverlay.hidden = !open;
  helpButton.setAttribute("aria-expanded", String(open));
  if (open && focus) rulesDismiss.focus({ preventScroll: true });
}

function updatePlayCoach() {
  if (state.learningStage === "guided-close") {
    setCoach("YOUR FIRST LOOP", "DROP + BETWEEN THE TWO GLOWING − ENDS", "One bead can bond to both ends and close the chain.");
    return;
  }
  if (state.learningStage !== "free") return;

  const opportunity = findBridgeOpportunity();
  const chains = getOpenChains();
  const longest = chains[0];
  const heldSign = state.currentPole === NORTH ? "+" : "−";

  if (opportunity) {
    setCoach("LOOP READY", `DROP ${heldSign} INTO THE GLOWING BRIDGE`, "It will connect both open ends and close this chain.");
  } else if (longest?.nodes.length >= 3) {
    setCoach(`CHAIN ${longest.nodes.length}`, "BUILD A U-SHAPED CHAIN", "Keep adding alternating beads to the glowing ends until one bead can bridge both.");
  } else if (longest?.nodes.length === 2) {
    setCoach("CHAIN STARTED", "ADD TO A GLOWING END", "Only opposite signs bond. Each chain has two open ends.");
  } else {
    setCoach("THE GOAL", "START AN ALTERNATING CHAIN", "Drop + beside −. Connected beads form a bright chain.");
  }
}

function updateTutorialAimCoach(keyboard = false) {
  const aligned = Math.abs(state.aimX - state.tutorialTarget.x) <= 42;
  if (keyboard) {
    setCoach("AIMING", aligned ? "PRESS SPACE TO CLOSE THE LOOP" : "USE ← → TO FIND THE GAP", "The blue − bead snaps to the two orange + beads.");
  } else {
    setCoach("AIMING", aligned ? "RELEASE TO CLOSE THE LOOP" : "DRAG OVER THE GLOWING GAP", "The blue − bead snaps to the two orange + beads.");
  }
}

function updateGuidedAimCoach(keyboard = false) {
  const aligned = Math.abs(state.aimX - state.guidedTarget.x) <= 18;
  if (keyboard) {
    setCoach("YOUR FIRST LOOP", aligned ? "PRESS SPACE TO BRIDGE BOTH ENDS" : "USE ← → TO FIND THE BRIDGE", "The + bead must touch both glowing − endpoints.");
  } else {
    setCoach("YOUR FIRST LOOP", aligned ? "RELEASE TO BRIDGE BOTH ENDS" : "DRAG + OVER THE GLOWING BRIDGE", "The + bead must touch both glowing − endpoints.");
  }
}

function addParticle({ x, y, pole, vx = 0, vy = 0, pinned = false }) {
  const particle = {
    id: nextId++,
    x,
    y,
    prevX: x,
    prevY: y,
    vx,
    vy,
    ax: 0,
    ay: 0,
    pole,
    r: R,
    links: new Set(),
    pinned,
    entered: y > JAR.top + R,
    dangerTime: 0,
    bornAt: state.time,
  };
  state.particles.push(particle);
  return particle;
}

function getParticle(id) {
  return state.particles.find((particle) => particle.id === id);
}

function getOpenChains() {
  const live = new Map(state.particles.map((particle) => [particle.id, particle]));
  const visited = new Set();
  const chains = [];

  for (const particle of state.particles) {
    if (visited.has(particle.id) || particle.links.size === 0) continue;
    const stack = [particle.id];
    const nodes = [];

    while (stack.length > 0) {
      const id = stack.pop();
      if (visited.has(id) || !live.has(id)) continue;
      visited.add(id);
      const node = live.get(id);
      nodes.push(node);
      for (const neighborId of node.links) if (!visited.has(neighborId) && live.has(neighborId)) stack.push(neighborId);
    }

    const endpoints = nodes.filter((node) => [...node.links].filter((id) => live.has(id)).length === 1);
    if (endpoints.length === 2) chains.push({ nodes, endpoints });
  }

  return chains.sort((first, second) => second.nodes.length - first.nodes.length);
}

function findBridgeOpportunity(pole = state.currentPole) {
  if (pole === null) return null;
  const reach = R * 2 + 4;

  for (const chain of getOpenChains()) {
    if (chain.nodes.length < 3) continue;
    const [first, second] = chain.endpoints;
    if (first.pole !== second.pole || first.pole === pole) continue;
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const distance = Math.hypot(dx, dy);
    if (distance < R * 1.55 || distance > reach * 1.92) continue;
    const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    const height = Math.sqrt(Math.max(0, reach * reach - (distance * distance) / 4));
    const perpendicular = { x: -dy / distance, y: dx / distance };
    const candidates = [
      { x: midpoint.x + perpendicular.x * height, y: midpoint.y + perpendicular.y * height },
      { x: midpoint.x - perpendicular.x * height, y: midpoint.y - perpendicular.y * height },
    ];
    const centroid = chain.nodes.reduce((total, node) => ({ x: total.x + node.x / chain.nodes.length, y: total.y + node.y / chain.nodes.length }), { x: 0, y: 0 });
    const valid = candidates.filter((candidate) => {
      const bounds = jarBoundsAt(candidate.y);
      return candidate.y > JAR.top + R * 2 && candidate.y < JAR.floor - R && candidate.x > bounds.left + R && candidate.x < bounds.right - R;
    });
    if (valid.length === 0) continue;
    valid.sort((a, b) => Math.hypot(b.x - centroid.x, b.y - centroid.y) - Math.hypot(a.x - centroid.x, a.y - centroid.y));
    return { target: valid[0], endpoints: [first, second], chain };
  }
  return null;
}

function activeLearningTarget() {
  if (state.phase === "tutorial" || state.phase === "tutorial-drop") return state.tutorialTarget;
  if (state.learningStage === "guided-close") return state.guidedTarget;
  return null;
}

function addBond(first, second, quiet = false) {
  if (!first || !second || first.links.has(second.id)) return false;
  first.links.add(second.id);
  second.links.add(first.id);
  const distance = Math.hypot(second.x - first.x, second.y - first.y);
  state.bonds.push({
    a: first.id,
    b: second.id,
    rest: Math.max(R * 2 + 2, distance),
    targetRest: R * 2 + 2,
  });
  if (!quiet) sound.bond();
  return true;
}

function seedTutorial() {
  const center = { x: 220, y: 388 };
  const radius = 46;
  const slots = [-150, -90, -30, 30, 90, 150].map((degrees, index) => {
    const radians = (degrees * Math.PI) / 180;
    return {
      x: center.x + Math.cos(radians) * radius,
      y: center.y + Math.sin(radians) * radius,
      pole: index % 2 === 0 ? NORTH : SOUTH,
      index,
    };
  });
  state.tutorialTarget = { x: slots[1].x, y: slots[1].y };
  const chainSlots = [slots[2], slots[3], slots[4], slots[5], slots[0]];
  const chain = chainSlots.map((slot) => addParticle({ ...slot, pinned: true }));
  for (let index = 0; index < chain.length - 1; index += 1) addBond(chain[index], chain[index + 1], true);
  state.tutorialOrder = [chain[4].id, null, chain[0].id, chain[1].id, chain[2].id, chain[3].id];
}

function seedGuidedClosure() {
  const left = addParticle({ x: 168, y: 710, pole: SOUTH, pinned: true });
  const middle = addParticle({ x: 195, y: 742, pole: NORTH, pinned: true });
  const right = addParticle({ x: 222, y: 710, pole: SOUTH, pinned: true });
  addBond(left, middle, true);
  addBond(middle, right, true);
  state.guidedTarget = { x: 195, y: 678 };
  state.guidedReleasedId = null;
  state.guidedRetryAt = 0;
  state.learningStage = "guided-close";
  state.currentPole = NORTH;
  state.queue = [SOUTH, NORTH];
  state.polarityHistory = [NORTH, SOUTH, NORTH];
  state.aimX = state.guidedTarget.x;
  state.aiming = false;
  state.waitingForNext = false;
  updatePlayCoach();
}

function fillQueue() {
  while (state.queue.length < 2) {
    let pole;
    if (state.dropCount < 6) {
      const last = state.polarityHistory.at(-1) ?? SOUTH;
      pole = -last;
    } else {
      pole = polarityBag(random, state.polarityHistory);
    }
    state.queue.push(pole);
    state.polarityHistory.push(pole);
  }
}

function advanceCurrent() {
  fillQueue();
  state.currentPole = state.queue.shift();
  fillQueue();
  state.waitingForNext = false;
  state.aimX = W / 2;
}

function resetGame() {
  nextId = 1;
  state.time = 0;
  state.startedAt = performance.now() / 1000;
  state.phase = "tutorial";
  state.score = 0;
  state.combo = 1;
  state.lastRingAt = -99;
  state.dropCount = 0;
  state.particles = [];
  state.bonds = [];
  state.effects = [];
  state.motes = [];
  state.wallBlooms = [];
  state.currentPole = SOUTH;
  state.queue = [];
  state.polarityHistory = [];
  state.aimX = W / 2;
  state.aiming = false;
  state.waitingForNext = false;
  state.tutorialDrop = null;
  state.learningStage = "demo";
  state.guidedReleasedId = null;
  state.guidedRetryAt = 0;
  state.nextCoachUpdateAt = 0;
  state.coachSignature = "";
  setRulesOpen(false, false);
  state.danger = 0;
  state.shake = 0;
  failureButton.hidden = true;
  setCoach("FIRST DROP", "DRAG THE BLUE − BEAD", "Slide left or right. Release to drop.");
  updateScoreDisplay();
  seedTutorial();
}

function jarBoundsAt(y) {
  const progress = clamp((y - JAR.top) / (JAR.curveY - JAR.top), 0, 1);
  return {
    left: lerp(JAR.leftTop, JAR.leftFloor, progress),
    right: lerp(JAR.rightTop, JAR.rightFloor, progress),
  };
}

function collideWithJar(particle) {
  if (!particle.entered && particle.y > JAR.top + particle.r) particle.entered = true;
  if (particle.y < JAR.top - particle.r) return;

  let hit = false;
  if (particle.y <= JAR.curveY) {
    const bounds = jarBoundsAt(particle.y);
    if (particle.x - particle.r < bounds.left) {
      particle.x = bounds.left + particle.r;
      if (particle.vx < 0) particle.vx *= -0.08;
      hit = true;
    }
    if (particle.x + particle.r > bounds.right) {
      particle.x = bounds.right - particle.r;
      if (particle.vx > 0) particle.vx *= -0.08;
      hit = true;
    }
  }

  const leftCenter = { x: JAR.leftFloor + JAR.cornerRadius, y: JAR.curveY };
  const rightCenter = { x: JAR.rightFloor - JAR.cornerRadius, y: JAR.curveY };
  const cornerLimit = JAR.cornerRadius - particle.r;

  if (particle.y > JAR.curveY && particle.x < leftCenter.x) {
    const dx = particle.x - leftCenter.x;
    const dy = particle.y - leftCenter.y;
    const distance = Math.hypot(dx, dy) || 1;
    if (distance > cornerLimit) {
      particle.x = leftCenter.x + (dx / distance) * cornerLimit;
      particle.y = leftCenter.y + (dy / distance) * cornerLimit;
      const normalVelocity = (particle.vx * dx + particle.vy * dy) / distance;
      if (normalVelocity > 0) {
        particle.vx -= (dx / distance) * normalVelocity * 1.08;
        particle.vy -= (dy / distance) * normalVelocity * 1.08;
      }
      hit = true;
    }
  } else if (particle.y > JAR.curveY && particle.x > rightCenter.x) {
    const dx = particle.x - rightCenter.x;
    const dy = particle.y - rightCenter.y;
    const distance = Math.hypot(dx, dy) || 1;
    if (distance > cornerLimit) {
      particle.x = rightCenter.x + (dx / distance) * cornerLimit;
      particle.y = rightCenter.y + (dy / distance) * cornerLimit;
      const normalVelocity = (particle.vx * dx + particle.vy * dy) / distance;
      if (normalVelocity > 0) {
        particle.vx -= (dx / distance) * normalVelocity * 1.08;
        particle.vy -= (dy / distance) * normalVelocity * 1.08;
      }
      hit = true;
    }
  } else if (particle.y + particle.r > JAR.floor) {
    particle.y = JAR.floor - particle.r;
    if (particle.vy > 0) particle.vy *= -0.08;
    hit = true;
  }

  if (hit && Math.hypot(particle.vx, particle.vy) > 65) {
    sound.wall();
    state.wallBlooms.push({ x: particle.x, y: particle.y, age: 0 });
  }
}

function deterministicNormal(first, second) {
  const angle = (((first.id * 73856093) ^ (second.id * 19349663)) >>> 0) % 6283 / 1000;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function applyForces(dt) {
  for (const particle of state.particles) {
    particle.prevX = particle.x;
    particle.prevY = particle.y;
    particle.ax = 0;
    particle.ay = particle.pinned ? 0 : 500;
  }

  for (let firstIndex = 0; firstIndex < state.particles.length; firstIndex += 1) {
    const first = state.particles[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < state.particles.length; secondIndex += 1) {
      const second = state.particles[secondIndex];
      if (first.links.has(second.id)) continue;
      let dx = second.x - first.x;
      let dy = second.y - first.y;
      let distance = Math.hypot(dx, dy);
      if (distance < 0.001) {
        const normal = deterministicNormal(first, second);
        dx = normal.x;
        dy = normal.y;
        distance = 1;
      }
      const same = first.pole === second.pole;
      if (!same && (first.links.size >= 2 || second.links.size >= 2)) continue;
      const range = same ? 100 : 79;
      if (distance >= range) continue;
      const falloff = 1 - distance / range;
      const magnitude = (same ? 1550 : 900) * falloff * falloff;
      const direction = same ? -1 : 1;
      const fx = (dx / distance) * magnitude * direction;
      const fy = (dy / distance) * magnitude * direction;
      if (!first.pinned) {
        first.ax += fx;
        first.ay += fy;
      }
      if (!second.pinned) {
        second.ax -= fx;
        second.ay -= fy;
      }
    }
  }

  for (const particle of state.particles) {
    if (particle.pinned) continue;
    const magneticX = particle.ax;
    const magneticY = particle.ay - 500;
    const magneticLength = Math.hypot(magneticX, magneticY);
    if (magneticLength > 2200) {
      particle.ax = (magneticX / magneticLength) * 2200;
      particle.ay = 500 + (magneticY / magneticLength) * 2200;
    }
  }

  for (const bond of state.bonds) {
    const first = getParticle(bond.a);
    const second = getParticle(bond.b);
    if (!first || !second) continue;
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const distance = Math.hypot(dx, dy) || 1;
    const nx = dx / distance;
    const ny = dy / distance;
    bond.rest += (bond.targetRest - bond.rest) * (1 - Math.exp(-12 * dt));
    const extension = distance - bond.rest;
    const relativeSpeed = (second.vx - first.vx) * nx + (second.vy - first.vy) * ny;
    const force = 95 * extension + 12 * relativeSpeed;
    if (!first.pinned) {
      first.ax += nx * force;
      first.ay += ny * force;
    }
    if (!second.pinned) {
      second.ax -= nx * force;
      second.ay -= ny * force;
    }
  }

  const damping = Math.exp(-0.68 * dt);
  for (const particle of state.particles) {
    if (particle.pinned) continue;
    particle.vx = (particle.vx + particle.ax * dt) * damping;
    particle.vy = (particle.vy + particle.ay * dt) * damping;
    const speed = Math.hypot(particle.vx, particle.vy);
    if (speed > 650) {
      particle.vx = (particle.vx / speed) * 650;
      particle.vy = (particle.vy / speed) * 650;
    }
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
  }
}

function resolveCollisions() {
  for (let iteration = 0; iteration < 4; iteration += 1) {
    for (let firstIndex = 0; firstIndex < state.particles.length; firstIndex += 1) {
      const first = state.particles[firstIndex];
      for (let secondIndex = firstIndex + 1; secondIndex < state.particles.length; secondIndex += 1) {
        const second = state.particles[secondIndex];
        let dx = second.x - first.x;
        let dy = second.y - first.y;
        let distance = Math.hypot(dx, dy);
        const minimum = first.r + second.r;
        if (distance >= minimum) continue;
        if (distance < 0.001) {
          const normal = deterministicNormal(first, second);
          dx = normal.x;
          dy = normal.y;
          distance = 1;
        }
        const nx = dx / distance;
        const ny = dy / distance;
        const penetration = minimum - distance;
        const firstWeight = first.pinned ? 0 : second.pinned ? 1 : 0.5;
        const secondWeight = second.pinned ? 0 : first.pinned ? 1 : 0.5;
        first.x -= nx * penetration * 0.65 * firstWeight;
        first.y -= ny * penetration * 0.65 * firstWeight;
        second.x += nx * penetration * 0.65 * secondWeight;
        second.y += ny * penetration * 0.65 * secondWeight;
        const relativeVelocity = (second.vx - first.vx) * nx + (second.vy - first.vy) * ny;
        if (relativeVelocity < 0) {
          const impulse = -(1.12 * relativeVelocity) / Math.max(1, firstWeight + secondWeight);
          if (!first.pinned) {
            first.vx -= nx * impulse * firstWeight;
            first.vy -= ny * impulse * firstWeight;
          }
          if (!second.pinned) {
            second.vx += nx * impulse * secondWeight;
            second.vy += ny * impulse * secondWeight;
          }
        }
      }
    }
    for (const particle of state.particles) if (!particle.pinned) collideWithJar(particle);
  }

  for (const bond of state.bonds) {
    const first = getParticle(bond.a);
    const second = getParticle(bond.b);
    if (!first || !second) continue;
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const distance = Math.hypot(dx, dy) || 1;
    const maximum = bond.targetRest * 1.35;
    if (distance <= maximum) continue;
    const excess = distance - maximum;
    const nx = dx / distance;
    const ny = dy / distance;
    if (!first.pinned) {
      first.x += nx * excess * 0.5;
      first.y += ny * excess * 0.5;
    }
    if (!second.pinned) {
      second.x -= nx * excess * 0.5;
      second.y -= ny * excess * 0.5;
    }
  }
}

function polygonMetrics(particles) {
  let twiceArea = 0;
  let perimeter = 0;
  for (let index = 0; index < particles.length; index += 1) {
    const current = particles[index];
    const next = particles[(index + 1) % particles.length];
    twiceArea += current.x * next.y - next.x * current.y;
    perimeter += Math.hypot(next.x - current.x, next.y - current.y);
  }
  const area = Math.abs(twiceArea) / 2;
  const compactness = perimeter > 0 ? (4 * Math.PI * area) / (perimeter * perimeter) : 0;
  return { area, compactness };
}

function cycleIsReadable(ids) {
  if (ids.length < 4 || ids.length % 2 !== 0) return false;
  const particles = ids.map(getParticle);
  if (particles.some((particle) => !particle)) return false;
  for (let index = 0; index < particles.length; index += 1) {
    if (particles[index].pole === particles[(index + 1) % particles.length].pole) return false;
  }
  const { area, compactness } = polygonMetrics(particles);
  return area > particles.length * R * R * 0.34 && compactness > 0.1;
}

function scanForBonds() {
  const candidates = [];
  for (let firstIndex = 0; firstIndex < state.particles.length; firstIndex += 1) {
    const first = state.particles[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < state.particles.length; secondIndex += 1) {
      const second = state.particles[secondIndex];
      if (first.pole === second.pole || first.links.has(second.id)) continue;
      if (first.links.size >= 2 || second.links.size >= 2) continue;
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      if (distance > first.r + second.r + 7) continue;
      const relativeSpeed = Math.hypot(second.vx - first.vx, second.vy - first.vy);
      if (relativeSpeed > 270) continue;
      candidates.push({ first, second, distance });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance || a.first.id - b.first.id || a.second.id - b.second.id);

  for (const candidate of candidates) {
    const { first, second } = candidate;
    if (!getParticle(first.id) || !getParticle(second.id)) continue;
    if (first.links.size >= 2 || second.links.size >= 2 || first.links.has(second.id)) continue;
    const ids = state.particles.map((particle) => particle.id);
    const cycle = cycleCreatedByBond(ids, state.bonds, { a: first.id, b: second.id });
    if (cycle && !cycleIsReadable(cycle)) continue;
    addBond(first, second);
    if (cycle) triggerRing(cycle);
  }
}

function removeParticles(ids) {
  const doomed = new Set(ids);
  state.particles = state.particles.filter((particle) => !doomed.has(particle.id));
  state.bonds = state.bonds.filter((bond) => !doomed.has(bond.a) && !doomed.has(bond.b));
  for (const particle of state.particles) {
    for (const id of doomed) particle.links.delete(id);
  }
}

function triggerRing(ids, forcedValue = null) {
  const guidedCompletion = state.learningStage === "guided-close";
  const ring = ids.map(getParticle).filter(Boolean);
  if (ring.length < 4) return;
  const points = ring.map((particle) => ({ x: particle.x, y: particle.y, pole: particle.pole }));
  const center = points.reduce((total, point) => ({ x: total.x + point.x / points.length, y: total.y + point.y / points.length }), { x: 0, y: 0 });
  const enclosed = state.particles.filter((particle) => !ids.includes(particle.id) && pointInPolygon(particle, points));
  state.combo = state.time - state.lastRingAt < 2.8 ? Math.min(5, state.combo + 1) : 1;
  state.lastRingAt = state.time;
  const value = forcedValue ?? scoreRing(points.length, enclosed.length, state.combo);
  state.effects.push({ points, center, age: 0, duration: 0.82, value, awarded: false });
  for (const point of points) {
    for (let mote = 0; mote < 2; mote += 1) {
      state.motes.push({ x: point.x, y: point.y, vx: (random() - 0.5) * 28, vy: (random() - 0.5) * 28, age: 0, life: 0.65 + random() * 0.2, pole: point.pole });
    }
  }
  removeParticles([...ids, ...enclosed.map((particle) => particle.id)]);
  state.shake = REDUCED_MOTION ? 0 : 0.07;
  sound.ring(points.length);
  haptic([8, 30, 18]);
  if (guidedCompletion) {
    state.learningStage = "free";
    state.guidedReleasedId = null;
    state.waitingForNext = true;
    state.nextReadyAt = state.time + 0.82;
    setCoach("LOOP CLOSED", "YOU BRIDGED BOTH OPEN ENDS", "That is a loop: an alternating chain closed back on itself.");
  } else {
    setCoach();
  }
}

function updateEffects(dt) {
  for (const effect of state.effects) {
    effect.age += dt;
    if (!effect.awarded && effect.age >= 0.64) {
      effect.awarded = true;
      state.score += effect.value;
      if (state.score > state.best) {
        state.best = state.score;
        saveBest();
      }
      updateScoreDisplay(true);
    }
  }
  state.effects = state.effects.filter((effect) => effect.age < effect.duration);
  for (const mote of state.motes) {
    mote.age += dt;
    mote.x += mote.vx * dt;
    mote.y += mote.vy * dt;
    mote.vx *= Math.exp(-3 * dt);
    mote.vy *= Math.exp(-3 * dt);
  }
  state.motes = state.motes.filter((mote) => mote.age < mote.life).slice(-24);
  for (const bloom of state.wallBlooms) bloom.age += dt;
  state.wallBlooms = state.wallBlooms.filter((bloom) => bloom.age < 0.16);
  state.shake = Math.max(0, state.shake - dt);
}

function dangerCheck(dt) {
  let maximum = 0;
  for (const particle of state.particles) {
    if (!particle.entered || state.time - particle.bornAt < 0.8) continue;
    if (particle.y - particle.r < JAR.danger) particle.dangerTime += dt;
    else particle.dangerTime = Math.max(0, particle.dangerTime - dt * 2.4);
    maximum = Math.max(maximum, particle.dangerTime / 0.9);
    if (particle.dangerTime >= 0.9 || particle.y + particle.r < JAR.top - 4) {
      failGame();
      return;
    }
  }
  state.danger = clamp(maximum, 0, 1);
}

function failGame() {
  if (state.phase === "gameover") return;
  state.phase = "gameover";
  state.aiming = false;
  sound.fail();
  haptic([18, 45, 28]);
  failureScore.textContent = formatScore(state.score);
  failureBest.textContent = `BEST ${formatScore(state.best)}`;
  failureButton.hidden = false;
  setCoach();
}

function updateTutorialDrop(dt) {
  if (!state.tutorialDrop) return;
  state.tutorialDrop.age += dt;
  if (state.tutorialDrop.age < 0.64) return;
  const missing = addParticle({ x: state.tutorialTarget.x, y: state.tutorialTarget.y, pole: SOUTH, pinned: true });
  const order = state.tutorialOrder.map((id) => id ?? missing.id);
  const first = getParticle(order[0]);
  const second = getParticle(order[2]);
  addBond(first, missing, true);
  addBond(missing, second, true);
  state.tutorialDrop = null;
  state.phase = "playing";
  state.learningStage = "guided-prep";
  state.waitingForNext = false;
  triggerRing(order, 100);
  setCoach("DEMO COMPLETE", "NOW YOU CLOSE ONE", "Next, bridge the two glowing ends yourself.");
}

function updateGuidedRetry() {
  if (state.learningStage !== "guided-close" || state.currentPole !== null || !state.guidedReleasedId || state.time < state.guidedRetryAt) return;
  const released = getParticle(state.guidedReleasedId);
  if (released) removeParticles([released.id]);
  state.guidedReleasedId = null;
  state.guidedRetryAt = 0;
  state.currentPole = NORTH;
  state.aimX = state.guidedTarget.x;
  state.aiming = false;
  setCoach("TRY AGAIN", "DROP + BETWEEN BOTH GLOWING − ENDS", "The bead must touch both endpoints to close the chain.");
}

function physicsStep(dt) {
  if (state.helpOpen) return;
  state.time += dt;
  updateEffects(dt);
  updateTutorialDrop(dt);

  if (state.learningStage === "guided-prep" && state.effects.length === 0 && state.currentPole === null) seedGuidedClosure();

  if (state.phase !== "gameover" && state.phase !== "tutorial") {
    const slowMotion = state.effects.some((effect) => effect.age < 0.09) ? 0.35 : 1;
    applyForces(dt * slowMotion);
    resolveCollisions();
    scanForBonds();
    dangerCheck(dt);
    updateGuidedRetry();
  }

  if (state.phase === "gameover") return;

  if (state.waitingForNext && state.currentPole === null && state.effects.length === 0 && state.time >= state.nextReadyAt) {
    advanceCurrent();
    updatePlayCoach();
  }

  if (state.learningStage === "free" && state.currentPole !== null && state.effects.length === 0 && state.time >= state.nextCoachUpdateAt) {
    state.nextCoachUpdateAt = state.time + 0.25;
    updatePlayCoach();
  }
}

function releaseCurrent() {
  if (state.currentPole === null || state.effects.length > 0) return;
  const pole = state.currentPole;
  state.currentPole = null;
  state.aiming = false;

  if (state.phase === "tutorial") {
    state.tutorialDrop = {
      age: 0,
      start: { x: state.aimX, y: 106 },
      end: { ...state.tutorialTarget },
      pole,
    };
    state.phase = "tutorial-drop";
    setCoach("WATCH THE FIELD", "THE BEAD WILL SNAP INTO PLACE", "Opposite signs attract at close range.");
    haptic(6);
    return;
  }

  const released = addParticle({ x: state.aimX, y: 108, pole, vy: 42 });
  state.dropCount += 1;
  if (state.learningStage === "guided-close") {
    state.guidedReleasedId = released.id;
    state.guidedRetryAt = state.time + 3.2;
    state.waitingForNext = false;
    setCoach("BRIDGE IN MOTION", "WATCH THE + SEEK BOTH GLOWING ENDS", "A loop closes only when the bead bonds to both endpoints.");
  } else {
    state.waitingForNext = true;
    state.nextReadyAt = state.time + 0.46;
    updatePlayCoach();
  }
  haptic(5);
}

function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * W,
    y: ((event.clientY - rect.top) / rect.height) * H,
  };
}

function aimBounds() {
  if (state.phase === "tutorial") return { minimum: state.tutorialTarget.x - 64, maximum: state.tutorialTarget.x + 64 };
  if (state.learningStage === "guided-close") return { minimum: state.guidedTarget.x - 32, maximum: state.guidedTarget.x + 32 };
  return { minimum: JAR.leftTop + R, maximum: JAR.rightTop - R };
}

function updateAim(event) {
  const position = pointerPosition(event);
  const bounds = aimBounds();
  state.aimX = clamp(position.x, bounds.minimum, bounds.maximum);
  if (state.phase === "tutorial" && state.aiming) updateTutorialAimCoach();
  else if (state.learningStage === "guided-close" && state.aiming) updateGuidedAimCoach();
}

canvas.addEventListener("pointerdown", (event) => {
  if (state.helpOpen || state.phase === "gameover" || state.currentPole === null || state.effects.length > 0) return;
  event.preventDefault();
  sound.unlock();
  canvas.focus({ preventScroll: true });
  canvas.setPointerCapture(event.pointerId);
  state.aiming = true;
  updateAim(event);
  sound.pickup(state.currentPole);
});

canvas.addEventListener("pointermove", (event) => {
  if (!state.aiming) return;
  event.preventDefault();
  updateAim(event);
});

function endPointer(event) {
  if (!state.aiming) return;
  event.preventDefault();
  updateAim(event);
  releaseCurrent();
}

canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", (event) => {
  if (!state.aiming) return;
  event.preventDefault();
  state.aiming = false;
  if (state.phase === "tutorial") setCoach("FIRST DROP", "DRAG THE BLUE − BEAD", "Slide left or right. Release to drop.");
  else if (state.learningStage === "guided-close") updatePlayCoach();
});

canvas.addEventListener("keydown", (event) => {
  if (state.phase === "gameover") {
    if (event.key === "Enter" || event.key === " ") resetGame();
    return;
  }
  if (state.currentPole === null || state.effects.length > 0) return;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    state.aiming = true;
    const bounds = aimBounds();
    state.aimX = clamp(state.aimX + (event.key === "ArrowLeft" ? -14 : 14), bounds.minimum, bounds.maximum);
    if (state.phase === "tutorial") updateTutorialAimCoach(true);
    else if (state.learningStage === "guided-close") updateGuidedAimCoach(true);
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    sound.unlock();
    releaseCurrent();
  }
});

failureButton.addEventListener("click", () => {
  sound.unlock();
  resetGame();
});

helpButton.addEventListener("click", () => {
  sound.unlock();
  setRulesOpen(!state.helpOpen);
});

rulesDismiss.addEventListener("click", () => {
  setRulesOpen(false, false);
  canvas.focus({ preventScroll: true });
});

rulesOverlay.addEventListener("pointerdown", (event) => {
  if (event.target === rulesOverlay) setRulesOpen(false, false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.helpOpen) setRulesOpen(false, false);
});

soundButton.addEventListener("click", () => {
  sound.enabled = !sound.enabled;
  soundButton.setAttribute("aria-pressed", String(!sound.enabled));
  soundButton.setAttribute("aria-label", sound.enabled ? "Mute sound" : "Enable sound");
  if (sound.enabled) sound.unlock();
});

function jarPath(context) {
  context.beginPath();
  context.moveTo(JAR.leftTop, JAR.top);
  context.lineTo(JAR.leftFloor, JAR.curveY);
  context.quadraticCurveTo(JAR.leftFloor, JAR.floor, JAR.leftFloor + JAR.cornerRadius, JAR.floor);
  context.lineTo(JAR.rightFloor - JAR.cornerRadius, JAR.floor);
  context.quadraticCurveTo(JAR.rightFloor, JAR.floor, JAR.rightFloor, JAR.curveY);
  context.lineTo(JAR.rightTop, JAR.top);
  context.closePath();
}

function makeNoise() {
  const tile = document.createElement("canvas");
  tile.width = 64;
  tile.height = 64;
  const tileContext = tile.getContext("2d");
  const noiseRandom = createSeededRandom(81173);
  tileContext.clearRect(0, 0, 64, 64);
  for (let index = 0; index < 520; index += 1) {
    const alpha = 0.025 + noiseRandom() * 0.05;
    tileContext.fillStyle = `rgba(216,249,252,${alpha})`;
    tileContext.fillRect(Math.floor(noiseRandom() * 64), Math.floor(noiseRandom() * 64), 1, 1);
  }
  noisePattern = ctx.createPattern(tile, "repeat");
}

function drawBackground() {
  const gradient = ctx.createRadialGradient(195, 690, 20, 195, 690, 430);
  gradient.addColorStop(0, "#10262b");
  gradient.addColorStop(0.54, "#09141a");
  gradient.addColorStop(1, "#05090d");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = noisePattern;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function drawJarBack() {
  ctx.save();
  jarPath(ctx);
  const fill = ctx.createLinearGradient(0, JAR.top, 0, JAR.floor);
  fill.addColorStop(0, "rgba(141,223,232,0.018)");
  fill.addColorStop(0.6, "rgba(141,223,232,0.047)");
  fill.addColorStop(1, "rgba(141,223,232,0.07)");
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.clip();
  const caustic = ctx.createRadialGradient(195, 790, 18, 195, 790, 150);
  caustic.addColorStop(0, "rgba(191,248,241,0.115)");
  caustic.addColorStop(1, "rgba(191,248,241,0)");
  ctx.fillStyle = caustic;
  ctx.fillRect(15, 690, 360, 140);
  ctx.restore();
}

function drawJarFront() {
  ctx.save();
  jarPath(ctx);
  const edge = ctx.createLinearGradient(20, JAR.top, 370, JAR.floor);
  edge.addColorStop(0, "rgba(216,249,252,0.34)");
  edge.addColorStop(0.55, "rgba(216,249,252,0.09)");
  edge.addColorStop(1, "rgba(216,249,252,0.22)");
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1.6;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(JAR.leftTop + 5, JAR.top + 4);
  ctx.lineTo(JAR.leftFloor + 7, JAR.curveY - 5);
  ctx.strokeStyle = "rgba(191,248,241,0.13)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(W / 2, JAR.top, (JAR.rightTop - JAR.leftTop) / 2, 7, 0, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(216,249,252,0.29)";
  ctx.lineWidth = 1.25;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(W / 2, JAR.top + 1.5, 142, 4.5, 0, 0, Math.PI);
  ctx.strokeStyle = "rgba(191,248,241,0.1)";
  ctx.stroke();

  for (const bloom of state.wallBlooms) {
    const alpha = 1 - bloom.age / 0.16;
    const glow = ctx.createRadialGradient(bloom.x, bloom.y, 0, bloom.x, bloom.y, 18);
    glow.addColorStop(0, `rgba(191,248,241,${0.13 * alpha})`);
    glow.addColorStop(1, "rgba(191,248,241,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(bloom.x - 20, bloom.y - 20, 40, 40);
  }
  ctx.restore();
}

function drawDangerLine() {
  const pulse = 0.5 + Math.sin(state.time * 5.2) * 0.5;
  const alpha = 0.04 + state.danger * (0.32 + pulse * 0.16);
  const bounds = jarBoundsAt(JAR.danger);
  ctx.save();
  ctx.setLineDash([3, 8]);
  ctx.lineDashOffset = -state.time * 9;
  ctx.strokeStyle = `rgba(255,82,107,${alpha})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bounds.left + 7, JAR.danger);
  ctx.lineTo(bounds.right - 7, JAR.danger);
  ctx.stroke();
  ctx.restore();
}

function drawFieldCurve(first, second, same, offset, alpha) {
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const distance = Math.hypot(dx, dy) || 1;
  const nx = -dy / distance;
  const ny = dx / distance;
  const midX = (first.x + second.x) / 2 + nx * offset;
  const midY = (first.y + second.y) / 2 + ny * offset;
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  ctx.quadraticCurveTo(midX, midY, second.x, second.y);
  ctx.strokeStyle = same ? `rgba(255,116,74,${alpha})` : `rgba(237,255,215,${alpha})`;
  ctx.lineWidth = same ? 0.75 : 0.9;
  ctx.setLineDash(same ? [4, 8] : []);
  ctx.lineDashOffset = same ? state.time * 18 : 0;
  ctx.stroke();
}

function drawFields() {
  const relationships = [];
  for (let firstIndex = 0; firstIndex < state.particles.length; firstIndex += 1) {
    const first = state.particles[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < state.particles.length; secondIndex += 1) {
      const second = state.particles[secondIndex];
      if (first.links.has(second.id)) continue;
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      if (distance < R * 4.2) relationships.push({ first, second, distance, priority: distance });
    }
  }
  if (state.currentPole !== null && state.aiming) {
    const held = { x: state.aimX, y: 108, pole: state.currentPole };
    for (const particle of state.particles) {
      const distance = Math.hypot(particle.x - held.x, particle.y - held.y);
      if (distance < R * 7) relationships.push({ first: held, second: particle, distance, priority: distance - 80 });
    }
  }
  relationships.sort((a, b) => a.priority - b.priority);
  for (const relationship of relationships.slice(0, 10)) {
    const same = relationship.first.pole === relationship.second.pole;
    const active = state.aiming && relationship.first.y === 108;
    const alpha = active ? 0.3 : 0.07;
    for (const factor of [-0.12, 0, 0.12]) drawFieldCurve(relationship.first, relationship.second, same, relationship.distance * factor, alpha);
  }
  ctx.setLineDash([]);
}

function drawBonds() {
  for (const bond of state.bonds) {
    const first = getParticle(bond.a);
    const second = getParticle(bond.b);
    if (!first || !second) continue;
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const distance = Math.hypot(dx, dy) || 1;
    const nx = dx / distance;
    const ny = dy / distance;
    const start = { x: first.x + nx * R * 0.54, y: first.y + ny * R * 0.54 };
    const end = { x: second.x - nx * R * 0.54, y: second.y - ny * R * 0.54 };
    const gradient = ctx.createLinearGradient(start.x, start.y, end.x, end.y);
    gradient.addColorStop(0, first.pole === NORTH ? "rgba(255,116,74,0.56)" : "rgba(53,207,255,0.56)");
    gradient.addColorStop(0.5, "rgba(237,255,215,0.96)");
    gradient.addColorStop(1, second.pole === NORTH ? "rgba(255,116,74,0.56)" : "rgba(53,207,255,0.56)");
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.strokeStyle = "rgba(237,255,215,0.18)";
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 2.2;
    ctx.stroke();

    for (const socket of [
      { x: first.x + nx * R * 0.93, y: first.y + ny * R * 0.93 },
      { x: second.x - nx * R * 0.93, y: second.y - ny * R * 0.93 },
    ]) {
      ctx.fillStyle = "rgba(237,255,215,0.94)";
      ctx.beginPath();
      ctx.arc(socket.x, socket.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    const pulse = (state.time * 0.55 + bond.a * 0.17) % 1;
    ctx.fillStyle = "rgba(237,255,215,0.96)";
    ctx.beginPath();
    ctx.arc(lerp(start.x, end.x, pulse), lerp(start.y, end.y, pulse), 1.45, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawParticle(particle, alpha = 1, scale = 1) {
  const radius = (particle.r ?? R) * scale;
  const color = particle.pole === NORTH ? COLORS.plus : COLORS.minus;
  const hot = particle.pole === NORTH ? COLORS.plusHot : COLORS.minusHot;
  const speed = Math.hypot(particle.vx ?? 0, particle.vy ?? 0);
  if (speed > 34 && !REDUCED_MOTION) {
    for (const [index, trailAlpha] of [0.1, 0.055, 0.025].entries()) {
      const factor = (index + 1) * 0.018;
      ctx.fillStyle = particle.pole === NORTH ? `rgba(255,116,74,${trailAlpha * alpha})` : `rgba(53,207,255,${trailAlpha * alpha})`;
      ctx.beginPath();
      ctx.arc(particle.x - (particle.vx ?? 0) * factor, particle.y - (particle.vy ?? 0) * factor, radius * (0.9 - index * 0.08), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  const halo = ctx.createRadialGradient(particle.x, particle.y, radius * 0.55, particle.x, particle.y, radius * 1.62);
  halo.addColorStop(0, particle.pole === NORTH ? "rgba(255,116,74,0.14)" : "rgba(53,207,255,0.14)");
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(particle.x, particle.y, radius * 1.62, 0, Math.PI * 2);
  ctx.fill();

  const core = ctx.createRadialGradient(particle.x - radius * 0.34, particle.y - radius * 0.4, radius * 0.05, particle.x, particle.y, radius);
  core.addColorStop(0, hot);
  core.addColorStop(0.3, color);
  core.addColorStop(0.8, "#17242a");
  core.addColorStop(1, "#0b1116");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = particle.pole === NORTH ? "rgba(255,192,106,0.78)" : "rgba(154,244,255,0.78)";
  ctx.lineWidth = 1.25;
  ctx.stroke();

  ctx.strokeStyle = "rgba(243,247,244,0.9)";
  ctx.lineWidth = Math.max(1.6, radius * 0.115);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(particle.x - radius * 0.31, particle.y);
  ctx.lineTo(particle.x + radius * 0.31, particle.y);
  if (particle.pole === NORTH) {
    ctx.moveTo(particle.x, particle.y - radius * 0.31);
    ctx.lineTo(particle.x, particle.y + radius * 0.31);
  }
  ctx.stroke();

  if (particle.pole === NORTH) {
    ctx.strokeStyle = "rgba(255,192,106,0.74)";
    ctx.lineWidth = 1.1;
    for (let tick = 0; tick < 4; tick += 1) {
      const angle = tick * Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(particle.x + Math.cos(angle) * radius * 0.84, particle.y + Math.sin(angle) * radius * 0.84);
      ctx.lineTo(particle.x + Math.cos(angle) * radius * 1.03, particle.y + Math.sin(angle) * radius * 1.03);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawParticles() {
  for (const particle of state.particles) {
    const breathe = particle.pinned && !REDUCED_MOTION ? 1 + Math.sin(state.time * 2.3 + particle.id) * 0.012 : 1;
    drawParticle(particle, 1, breathe);
  }
}

function drawOpenEndpoints() {
  const chains = getOpenChains();
  const bridge = findBridgeOpportunity();
  const bridgeIds = new Set(bridge ? bridge.endpoints.map((endpoint) => endpoint.id) : []);
  const pulse = 0.5 + Math.sin(state.time * 4.6) * 0.5;

  for (const chain of chains) {
    for (const endpoint of chain.endpoints) {
      const neighbor = getParticle([...endpoint.links][0]);
      if (!neighbor) continue;
      const dx = endpoint.x - neighbor.x;
      const dy = endpoint.y - neighbor.y;
      const distance = Math.hypot(dx, dy) || 1;
      const nx = dx / distance;
      const ny = dy / distance;
      const socket = { x: endpoint.x + nx * (R + 5), y: endpoint.y + ny * (R + 5) };
      const emphasized = bridgeIds.has(endpoint.id) || state.learningStage === "guided-close";
      const glowRadius = emphasized ? 14 + pulse * 5 : 9 + pulse * 2;
      const glow = ctx.createRadialGradient(socket.x, socket.y, 0, socket.x, socket.y, glowRadius);
      glow.addColorStop(0, `rgba(237,255,215,${emphasized ? 0.7 : 0.38})`);
      glow.addColorStop(1, "rgba(237,255,215,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(socket.x, socket.y, glowRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.flux;
      ctx.beginPath();
      ctx.arc(socket.x, socket.y, emphasized ? 3.2 : 2.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(237,255,215,${emphasized ? 0.76 : 0.34})`;
      ctx.lineWidth = emphasized ? 1.8 : 1;
      const angle = Math.atan2(ny, nx);
      ctx.beginPath();
      ctx.arc(endpoint.x, endpoint.y, R + 4, angle - 0.42, angle + 0.42);
      ctx.stroke();
    }
  }
}

function drawBridgeOpportunity() {
  if (state.learningStage !== "free") return;
  const opportunity = findBridgeOpportunity();
  if (!opportunity || state.currentPole === null) return;
  const { target, endpoints } = opportunity;
  const pulse = 0.5 + Math.sin(state.time * 4.8) * 0.5;
  ctx.save();
  ctx.setLineDash([3, 6]);
  ctx.lineDashOffset = -state.time * 13;
  ctx.strokeStyle = `rgba(237,255,215,${0.38 + pulse * 0.28})`;
  ctx.lineWidth = 1.4;
  for (const endpoint of endpoints) {
    ctx.beginPath();
    ctx.moveTo(target.x, target.y);
    ctx.lineTo(endpoint.x, endpoint.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  drawParticle({ x: target.x, y: target.y, r: R, pole: state.currentPole, links: new Set(), vx: 0, vy: 0 }, 0.28 + pulse * 0.12, 0.92);
  ctx.fillStyle = "rgba(237,255,215,0.86)";
  ctx.font = '700 9px ui-rounded, "Segoe UI", sans-serif';
  ctx.textAlign = "center";
  ctx.fillText("DROP TO CLOSE", target.x, target.y - R - 17);
  ctx.restore();
}

function drawAirborneParticles() {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, JAR.top + 1);
  ctx.clip();
  for (const particle of state.particles) {
    if (particle.y - particle.r <= JAR.top) drawParticle(particle);
  }
  ctx.restore();
}

function drawHeld() {
  if (state.currentPole === null || state.phase === "gameover") return;
  const y = 106 + (state.aiming ? -2 : Math.sin(state.time * 2.2) * 1.5);
  if (state.aiming) {
    ctx.save();
    const guide = ctx.createLinearGradient(0, y + R, 0, JAR.floor);
    guide.addColorStop(0, "rgba(237,255,215,0.26)");
    guide.addColorStop(1, "rgba(237,255,215,0)");
    ctx.strokeStyle = guide;
    ctx.lineWidth = 0.8;
    ctx.setLineDash([2, 7]);
    ctx.beginPath();
    ctx.moveTo(state.aimX, y + R + 4);
    const learningTarget = activeLearningTarget();
    if (learningTarget) {
      const controlY = (y + learningTarget.y) / 2;
      ctx.quadraticCurveTo(state.aimX, controlY, learningTarget.x, learningTarget.y - R - 8);
    } else {
      ctx.lineTo(state.aimX, JAR.floor - 22);
    }
    ctx.stroke();
    ctx.restore();
  }
  const held = { x: state.aimX, y, r: R, pole: state.currentPole, links: new Set(), vx: 0, vy: 0 };
  drawParticle(held);

  if (state.phase === "tutorial" && !state.aiming) {
    const pulse = 0.5 + Math.sin(state.time * 4) * 0.5;
    ctx.beginPath();
    ctx.arc(held.x, held.y, R + 8 + pulse * 4, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(154,244,255,${0.2 + pulse * 0.2})`;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  for (let index = 0; index < Math.min(2, state.queue.length); index += 1) {
    const pole = state.queue[index];
    ctx.fillStyle = pole === NORTH ? "rgba(255,116,74,0.65)" : "rgba(53,207,255,0.65)";
    ctx.beginPath();
    ctx.arc(326 + index * 15, 104, index === 0 ? 4.2 : 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTutorialDrop() {
  if (!state.tutorialDrop) return;
  const drop = state.tutorialDrop;
  const progress = clamp(drop.age / 0.64, 0, 1);
  const snapStart = 0.58;
  const falling = clamp(progress / snapStart, 0, 1);
  const snapping = clamp((progress - snapStart) / (1 - snapStart), 0, 1);
  const fallEase = 1 - Math.pow(1 - falling, 2);
  const snapEase = 1 - Math.pow(1 - snapping, 3);
  const snapHeight = drop.end.y - 76;
  const particle = {
    x: lerp(drop.start.x, drop.end.x, snapEase),
    y: progress < snapStart ? lerp(drop.start.y, snapHeight, fallEase) : lerp(snapHeight, drop.end.y, snapEase),
    pole: drop.pole,
    r: R,
    links: new Set(),
    vx: 0,
    vy: 0,
  };
  drawParticle(particle);
}

function drawTutorialTarget() {
  const target = activeLearningTarget();
  if (!target) return;
  const guided = state.learningStage === "guided-close";
  const pulse = 0.5 + Math.sin(state.time * 4.4) * 0.5;
  const halo = ctx.createRadialGradient(target.x, target.y, 2, target.x, target.y, 38 + pulse * 7);
  halo.addColorStop(0, `rgba(154,244,255,${0.15 + pulse * 0.08})`);
  halo.addColorStop(1, "rgba(53,207,255,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(target.x, target.y, 46, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.setLineDash([3, 6]);
  ctx.lineDashOffset = -state.time * 12;
  ctx.strokeStyle = `rgba(237,255,215,${0.42 + pulse * 0.28})`;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.arc(target.x, target.y, R + 8 + pulse * 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(237,255,215,0.72)";
  ctx.font = '700 9px ui-rounded, "Segoe UI", sans-serif';
  ctx.textAlign = "center";
  ctx.fillText(guided ? "BRIDGE BOTH ENDS" : "GLOWING GAP", target.x, target.y - R - 18);
  ctx.restore();
}

function drawTutorialGhost() {
  if (state.phase !== "tutorial" || state.aiming || state.time < 1.2) return;
  const cycle = (state.time - 1.2) % 2.4;
  if (cycle > 1.4) return;
  const progress = REDUCED_MOTION ? 0 : cycle / 1.4;
  const x = REDUCED_MOTION ? state.aimX : lerp(state.aimX, state.tutorialTarget.x, 0.5 - Math.cos(progress * Math.PI) * 0.5);
  ctx.save();
  ctx.globalAlpha = REDUCED_MOTION ? 0.38 : Math.sin(progress * Math.PI) * 0.4;
  ctx.strokeStyle = "rgba(237,255,215,0.68)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, 106, 11, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, 117);
  ctx.lineTo(x, 137);
  ctx.stroke();
  ctx.restore();
}

function drawRingEffects() {
  for (const effect of state.effects) {
    const t = effect.age;
    const traceProgress = clamp((t - 0.09) / 0.21, 0, 1);
    const contract = clamp((t - 0.45) / 0.15, 0, 1);
    const easedContract = contract * contract * (3 - 2 * contract);
    const points = effect.points.map((point) => ({
      ...point,
      x: lerp(point.x, effect.center.x, easedContract),
      y: lerp(point.y, effect.center.y, easedContract),
    }));

    if (t >= 0.28 && t < 0.52) {
      const membraneAlpha = Math.sin(clamp((t - 0.28) / 0.24, 0, 1) * Math.PI) * 0.2;
      const membrane = ctx.createRadialGradient(effect.center.x, effect.center.y, 0, effect.center.x, effect.center.y, 70);
      membrane.addColorStop(0, `rgba(237,255,215,${membraneAlpha})`);
      membrane.addColorStop(0.7, `rgba(53,207,255,${membraneAlpha * 0.45})`);
      membrane.addColorStop(1, "rgba(255,116,74,0)");
      ctx.fillStyle = membrane;
      ctx.beginPath();
      points.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
      ctx.closePath();
      ctx.fill();
    }

    const totalEdges = points.length;
    const traced = traceProgress * totalEdges;
    ctx.strokeStyle = "rgba(237,255,215,0.92)";
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    for (let index = 0; index < Math.ceil(traced); index += 1) {
      const first = points[index % totalEdges];
      const second = points[(index + 1) % totalEdges];
      const amount = clamp(traced - index, 0, 1);
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      ctx.lineTo(lerp(first.x, second.x, amount), lerp(first.y, second.y, amount));
      ctx.stroke();
    }

    if (t < 0.61) {
      for (const point of points) drawParticle({ ...point, r: R, links: new Set(), vx: 0, vy: 0 }, 1 - contract * 0.7, 1 + Math.sin(clamp((t - 0.09) / 0.22, 0, 1) * Math.PI) * 0.1);
    }

    if (t >= 0.47) {
      const shock = clamp((t - 0.47) / 0.23, 0, 1);
      ctx.beginPath();
      ctx.arc(effect.center.x, effect.center.y, 10 + shock * 92, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(237,255,215,${(1 - shock) * 0.42})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    if (t >= 0.56) {
      const pearlProgress = clamp((t - 0.56) / 0.2, 0, 1);
      const curve = Math.sin(pearlProgress * Math.PI) * 24;
      const x = lerp(effect.center.x, W / 2, pearlProgress) + curve;
      const y = lerp(effect.center.y, 52, pearlProgress);
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 14);
      glow.addColorStop(0, "rgba(237,255,215,0.95)");
      glow.addColorStop(1, "rgba(237,255,215,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, 14, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for (const mote of state.motes) {
    const alpha = 1 - mote.age / mote.life;
    ctx.fillStyle = mote.pole === NORTH ? `rgba(255,116,74,${alpha * 0.55})` : `rgba(53,207,255,${alpha * 0.55})`;
    ctx.beginPath();
    ctx.arc(mote.x, mote.y, 1.25, 0, Math.PI * 2);
    ctx.fill();
  }
}

function render() {
  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  drawBackground();
  const shakeX = state.shake > 0 ? Math.sin(state.time * 370) * 1.4 : 0;
  const shakeY = state.shake > 0 ? Math.cos(state.time * 290) * 0.7 : 0;
  ctx.save();
  ctx.translate(shakeX, shakeY);
  drawJarBack();
  ctx.save();
  jarPath(ctx);
  ctx.clip();
  drawDangerLine();
  drawFields();
  drawTutorialTarget();
  drawParticles();
  drawBonds();
  drawOpenEndpoints();
  drawBridgeOpportunity();
  ctx.restore();
  drawAirborneParticles();
  drawRingEffects();
  drawHeld();
  drawTutorialDrop();
  drawTutorialGhost();
  drawJarFront();
  ctx.restore();
}

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderScale = dpr;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  makeNoise();
}

function frame(now) {
  const elapsed = Math.min((now - lastFrame) / 1000, FIXED_STEP * MAX_STEPS);
  lastFrame = now;
  accumulator += elapsed;
  let steps = 0;
  while (accumulator >= FIXED_STEP && steps < MAX_STEPS) {
    physicsStep(FIXED_STEP);
    accumulator -= FIXED_STEP;
    steps += 1;
  }
  if (steps === MAX_STEPS && accumulator >= FIXED_STEP) accumulator %= FIXED_STEP;
  render();
  requestAnimationFrame(frame);
}

document.addEventListener("visibilitychange", () => {
  lastFrame = performance.now();
  accumulator = 0;
});
window.addEventListener("resize", resizeCanvas, { passive: true });

export const __test = {
  snapshot: () => ({
    score: state.score,
    dropCount: state.dropCount,
    particleCount: state.particles.length,
    bondCount: state.bonds.length,
    currentPole: state.currentPole,
    learningStage: state.learningStage,
    waitingForNext: state.waitingForNext,
  }),
};

resizeCanvas();
resetGame();
requestAnimationFrame(frame);
