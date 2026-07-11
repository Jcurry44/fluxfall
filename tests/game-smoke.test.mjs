import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("hidden overlays cannot render or intercept taps in WebKit", async () => {
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(styles, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important;[^}]*pointer-events:\s*none\s*!important;/s);
});

function makeClassList() {
  const names = new Set();
  return {
    add: (...values) => values.forEach((value) => names.add(value)),
    remove: (...values) => values.forEach((value) => names.delete(value)),
    contains: (value) => names.has(value),
  };
}

function makeNode() {
  const listeners = new Map();
  return {
    textContent: "",
    hidden: false,
    offsetWidth: 0,
    focus: () => {},
    classList: makeClassList(),
    attributes: new Map(),
    listeners,
    addEventListener(type, callback) {
      listeners.set(type, callback);
    },
    setAttribute(name, value) {
      this.attributes.set(name, value);
    },
  };
}

function makeContext() {
  const noop = () => {};
  const gradient = () => ({ addColorStop: noop });
  return new Proxy({}, {
    get(target, property) {
      if (property in target) return target[property];
      if (property === "createLinearGradient" || property === "createRadialGradient") return gradient;
      if (property === "createPattern") return () => ({});
      return noop;
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    },
  });
}

test("the chamber supports exact 2D placement without gravity or automatic moves", async () => {
  const context = makeContext();
  const canvas = makeNode();
  canvas.width = 390;
  canvas.height = 844;
  canvas.getContext = () => context;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 390, height: 844 });
  canvas.focus = () => {};
  canvas.setPointerCapture = () => {};

  const nodes = new Map([
    ["#game", canvas],
    ["#score", makeNode()],
    ["#prompt", makeNode()],
    ["#prompt-step", makeNode()],
    ["#prompt-title", makeNode()],
    ["#prompt-detail", makeNode()],
    ["#help-toggle", makeNode()],
    ["#rules-overlay", makeNode()],
    ["#rules-dismiss", makeNode()],
    ["#sound-toggle", makeNode()],
    ["#failure", makeNode()],
    ["#failure-score", makeNode()],
    ["#failure-best", makeNode()],
  ]);
  nodes.get("#failure").hidden = true;
  nodes.get("#rules-overlay").hidden = true;

  const documentListeners = new Map();
  const documentStub = {
    querySelector: (selector) => nodes.get(selector),
    createElement: () => ({ width: 0, height: 0, getContext: () => makeContext() }),
    addEventListener: (type, callback) => documentListeners.set(type, callback),
  };

  let nextFrame = null;
  Object.defineProperty(globalThis, "document", { value: documentStub, configurable: true });
  Object.defineProperty(globalThis, "window", {
    value: { devicePixelRatio: 2, addEventListener: () => {} },
    configurable: true,
  });
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
  Object.defineProperty(globalThis, "localStorage", {
    value: { getItem: () => null, setItem: () => {} },
    configurable: true,
  });
  Object.defineProperty(globalThis, "matchMedia", {
    value: () => ({ matches: false }),
    configurable: true,
  });
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    value: (callback) => {
      nextFrame = callback;
      return 1;
    },
    configurable: true,
  });

  const game = await import(`../game.mjs?smoke=${Date.now()}`);

  assert.equal(canvas.width, 780);
  assert.equal(canvas.height, 1688);
  assert.equal(nodes.get("#score").textContent, "000000");
  assert.equal(nodes.get("#prompt-title").textContent, "DRAG + INTO THE GLOWING BRIDGE");
  assert.equal(nodes.get("#prompt-detail").textContent, "Release when the preview shows two bonds around the core.");

  nodes.get("#help-toggle").listeners.get("click")();
  assert.equal(nodes.get("#rules-overlay").hidden, false);
  assert.equal(nodes.get("#help-toggle").attributes.get("aria-expanded"), "true");
  nodes.get("#rules-dismiss").listeners.get("click")();
  assert.equal(nodes.get("#rules-overlay").hidden, true);

  const pointer = {
    clientX: 195,
    clientY: 438,
    pointerId: 1,
    preventDefault: () => {},
  };
  assert.equal(game.__test.snapshot().particleCount, 3);
  assert.equal(game.__test.snapshot().dropCount, 0);

  canvas.listeners.get("pointerdown")(pointer);
  assert.equal(nodes.get("#prompt-title").textContent, "RELEASE TO BRIDGE BOTH ENDS");
  canvas.listeners.get("pointercancel")(pointer);
  assert.equal(nodes.get("#prompt-title").textContent, "DRAG + INTO THE GLOWING BRIDGE");
  assert.equal(nodes.get("#score").textContent, "000000");

  let now = performance.now();
  for (let frame = 0; frame < 600; frame += 1) {
    now += 1000 / 60;
    const callback = nextFrame;
    assert.equal(typeof callback, "function");
    callback(now);
  }

  const afterWaiting = game.__test.snapshot();
  assert.equal(afterWaiting.score, 0);
  assert.equal(afterWaiting.dropCount, 0);
  assert.equal(afterWaiting.particleCount, 3);
  assert.equal(afterWaiting.currentPole, 1);
  assert.equal(afterWaiting.learningStage, "guided-close");

  canvas.listeners.get("pointerdown")(pointer);
  canvas.listeners.get("pointermove")(pointer);
  assert.equal(nodes.get("#prompt-title").textContent, "RELEASE TO BRIDGE BOTH ENDS");
  canvas.listeners.get("pointerup")(pointer);

  for (let frame = 0; frame < 120; frame += 1) {
    now += 1000 / 60;
    nextFrame(now);
  }

  const afterEarnedLoop = game.__test.snapshot();
  assert.equal(afterEarnedLoop.learningStage, "free");
  assert.equal(afterEarnedLoop.score, 100);
  assert.equal(afterEarnedLoop.dropCount, 1);
  assert.equal(afterEarnedLoop.particleCount, 0);
  assert.notDeepEqual(
    { x: afterEarnedLoop.fluxSeed.x, y: afterEarnedLoop.fluxSeed.y },
    { x: 195, y: 470 },
  );

  pointer.clientX = 130;
  pointer.clientY = 350;
  canvas.listeners.get("pointerdown")(pointer);
  canvas.listeners.get("pointermove")(pointer);
  canvas.listeners.get("pointerup")(pointer);

  for (let frame = 0; frame < 600; frame += 1) {
    now += 1000 / 60;
    nextFrame(now);
  }

  const suspended = game.__test.snapshot();
  assert.equal(suspended.dropCount, 2);
  assert.equal(suspended.particleCount, 1);
  assert.ok(Math.abs(suspended.particles[0].y - 350) < 0.001);
  assert.equal(nodes.get("#failure").hidden, true);
});
