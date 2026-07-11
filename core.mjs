export const NORTH = 1;
export const SOUTH = -1;

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

export function distanceSquared(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
}

export function createSeededRandom(seed = 0x5f3759df) {
  let state = seed >>> 0;

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function forceDirection(firstPolarity, secondPolarity) {
  return firstPolarity === secondPolarity ? -1 : 1;
}

export function buildAdjacency(particleIds, bonds) {
  const adjacency = new Map(particleIds.map((id) => [id, new Set()]));

  for (const bond of bonds) {
    if (!adjacency.has(bond.a) || !adjacency.has(bond.b)) continue;
    adjacency.get(bond.a).add(bond.b);
    adjacency.get(bond.b).add(bond.a);
  }

  return adjacency;
}

export function findPath(adjacency, start, target, ignoredEdge = null) {
  if (start === target) return [start];

  const queue = [start];
  const previous = new Map([[start, null]]);

  while (queue.length > 0) {
    const current = queue.shift();
    const neighbors = adjacency.get(current) ?? [];

    for (const neighbor of neighbors) {
      if (
        ignoredEdge &&
        ((current === ignoredEdge.a && neighbor === ignoredEdge.b) ||
          (current === ignoredEdge.b && neighbor === ignoredEdge.a))
      ) {
        continue;
      }

      if (previous.has(neighbor)) continue;
      previous.set(neighbor, current);

      if (neighbor === target) {
        const path = [target];
        let cursor = current;
        while (cursor !== null) {
          path.push(cursor);
          cursor = previous.get(cursor);
        }
        return path.reverse();
      }

      queue.push(neighbor);
    }
  }

  return null;
}

export function cycleCreatedByBond(particleIds, bonds, candidateBond) {
  const adjacency = buildAdjacency(particleIds, bonds);
  const existingPath = findPath(adjacency, candidateBond.a, candidateBond.b);

  if (!existingPath || existingPath.length < 4) return null;
  return existingPath;
}

export function connectedComponent(adjacency, start) {
  const component = [];
  const stack = [start];
  const visited = new Set();

  while (stack.length > 0) {
    const current = stack.pop();
    if (visited.has(current)) continue;
    visited.add(current);
    component.push(current);

    for (const neighbor of adjacency.get(current) ?? []) {
      if (!visited.has(neighbor)) stack.push(neighbor);
    }
  }

  return component;
}

export function orderedCycle(adjacency, component) {
  if (component.length < 4) return null;
  if (component.some((id) => (adjacency.get(id)?.size ?? 0) !== 2)) return null;

  const start = component[0];
  const order = [start];
  let previous = null;
  let current = start;

  for (let index = 0; index < component.length; index += 1) {
    const neighbors = [...adjacency.get(current)];
    const next = neighbors.find((id) => id !== previous);
    if (next === undefined) return null;
    if (next === start) {
      return order.length === component.length ? order : null;
    }
    if (order.includes(next)) return null;
    order.push(next);
    previous = current;
    current = next;
  }

  return null;
}

export function pointInPolygon(point, polygon) {
  let inside = false;

  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[current];
    const b = polygon[previous];
    const crosses =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x;
    if (crosses) inside = !inside;
  }

  return inside;
}

export function scoreRing(size, enclosedCount = 0, combo = 1) {
  const halfSize = Math.floor(size / 2);
  const ringValue = 100 * ((halfSize - 1) * halfSize) / 2;
  const captureValue = enclosedCount * 150;
  return Math.round((ringValue + captureValue) * Math.max(1, combo));
}

export function polarityBag(random, previous = []) {
  const history = previous.slice(-3);
  if (history.length === 3 && history.every((value) => value === history[0])) {
    return -history[0];
  }
  return random() < 0.5 ? NORTH : SOUTH;
}
