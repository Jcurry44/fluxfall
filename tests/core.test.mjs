import test from "node:test";
import assert from "node:assert/strict";

import {
  NORTH,
  SOUTH,
  buildAdjacency,
  createSeededRandom,
  cycleCreatedByBond,
  forceDirection,
  orderedCycle,
  pointInPolygon,
  polarityBag,
  scoreRing,
} from "../core.mjs";

test("same poles repel and opposites attract", () => {
  assert.equal(forceDirection(NORTH, NORTH), -1);
  assert.equal(forceDirection(SOUTH, SOUTH), -1);
  assert.equal(forceDirection(NORTH, SOUTH), 1);
});

test("a candidate bond identifies the path it closes", () => {
  const ids = [1, 2, 3, 4];
  const bonds = [
    { a: 1, b: 2 },
    { a: 2, b: 3 },
    { a: 3, b: 4 },
  ];
  assert.deepEqual(cycleCreatedByBond(ids, bonds, { a: 4, b: 1 }), [4, 3, 2, 1]);
  assert.equal(cycleCreatedByBond(ids, bonds, { a: 1, b: 3 }), null);
});

test("a degree-two component can be ordered as a cycle", () => {
  const ids = [1, 2, 3, 4];
  const adjacency = buildAdjacency(ids, [
    { a: 1, b: 2 },
    { a: 2, b: 3 },
    { a: 3, b: 4 },
    { a: 4, b: 1 },
  ]);
  assert.deepEqual(orderedCycle(adjacency, ids), [1, 2, 3, 4]);
});

test("capture geometry and score are deterministic", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  assert.equal(pointInPolygon({ x: 5, y: 5 }, square), true);
  assert.equal(pointInPolygon({ x: 12, y: 5 }, square), false);
  assert.equal(scoreRing(4), 100);
  assert.equal(scoreRing(6), 300);
  assert.equal(scoreRing(8), 600);
  assert.equal(scoreRing(4, 2, 2), 800);
});

test("seeded random and polarity streak protection are repeatable", () => {
  const first = createSeededRandom(42);
  const second = createSeededRandom(42);
  assert.deepEqual(
    Array.from({ length: 8 }, () => first()),
    Array.from({ length: 8 }, () => second()),
  );
  assert.equal(polarityBag(first, [NORTH, NORTH, NORTH]), SOUTH);
  assert.equal(polarityBag(first, [SOUTH, SOUTH, SOUTH]), NORTH);
});
