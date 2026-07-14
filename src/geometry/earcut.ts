/**
 * Port from https://github.com/mapbox/earcut (v2.2.2), via t3d's Earcut builder helper.
 * Used internally for triangulating extruded 2D shape caps.
 */

interface EarcutNode {
  i: number;
  x: number;
  y: number;
  prev: EarcutNode;
  next: EarcutNode;
  z: number | null;
  prevZ: EarcutNode | null;
  nextZ: EarcutNode | null;
  steiner: boolean;
}

function createNode(i: number, x: number, y: number): EarcutNode {
  return {
    i, x, y,
    prev: null!, next: null!,
    z: null, prevZ: null, nextZ: null,
    steiner: false
  };
}

export function triangulate(data: number[], holeIndices: number[] = [], dim = 2): number[] {
  const hasHoles = holeIndices.length > 0;
  const outerLen = hasHoles ? holeIndices[0]! * dim : data.length;
  let outerNode = linkedList(data, 0, outerLen, dim, true);
  const triangles: number[] = [];

  if (!outerNode || outerNode.next === outerNode.prev) return triangles;

  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  let invSize = 0;

  if (hasHoles) {
    outerNode = eliminateHoles(data, holeIndices, outerNode, dim);
  }

  if (data.length > 80 * dim) {
    minX = maxX = data[0]!;
    minY = maxY = data[1]!;

    for (let i = dim; i < outerLen; i += dim) {
      const x = data[i]!;
      const y = data[i + 1]!;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }

    invSize = Math.max(maxX - minX, maxY - minY);
    invSize = invSize !== 0 ? 1 / invSize : 0;
  }

  earcutLinked(outerNode, triangles, dim, minX, minY, invSize);

  return triangles;
}

function linkedList(data: number[], start: number, end: number, dim: number, clockwise: boolean): EarcutNode | null {
  let last: EarcutNode | null = null;

  if (clockwise === (signedArea(data, start, end, dim) > 0)) {
    for (let i = start; i < end; i += dim) {
      last = insertNode(i, data[i]!, data[i + 1]!, last);
    }
  } else {
    for (let i = end - dim; i >= start; i -= dim) {
      last = insertNode(i, data[i]!, data[i + 1]!, last);
    }
  }

  if (last && equals(last, last.next)) {
    const next = last.next;
    removeNode(last);
    last = next;
  }

  return last;
}

function filterPoints(start: EarcutNode | null, end?: EarcutNode): EarcutNode | null {
  if (!start) return start;
  const endNode = end ?? start;
  let p = start;
  let stop = endNode;
  let again: boolean;

  do {
    again = false;

    if (!p.steiner && (equals(p, p.next) || area(p.prev, p, p.next) === 0)) {
      removeNode(p);
      p = stop = p.prev;
      if (p === p.next) break;
      again = true;
    } else {
      p = p.next;
    }
  } while (again || p !== stop);

  return stop;
}

function earcutLinked(
  ear: EarcutNode | null,
  triangles: number[],
  dim: number,
  minX: number,
  minY: number,
  invSize: number,
  pass = 0
): void {
  if (!ear) return;

  if (!pass && invSize) indexCurve(ear, minX, minY, invSize);

  let current: EarcutNode = ear;
  let stop = current;

  while (current.prev !== current.next) {
    const prev = current.prev;
    const next = current.next;

    if (invSize ? isEarHashed(current, minX, minY, invSize) : isEar(current)) {
      triangles.push(prev.i / dim, current.i / dim, next.i / dim);
      removeNode(current);
      current = next.next;
      stop = next.next;
      continue;
    }

    current = next;

    if (current === stop) {
      if (!pass) {
        earcutLinked(filterPoints(current), triangles, dim, minX, minY, invSize, 1);
      } else if (pass === 1) {
        const cured = cureLocalIntersections(filterPoints(current), triangles, dim);
        earcutLinked(cured, triangles, dim, minX, minY, invSize, 2);
      } else if (pass === 2) {
        splitEarcut(current, triangles, dim, minX, minY, invSize);
      }
      break;
    }
  }
}

function isEar(ear: EarcutNode): boolean {
  const a = ear.prev;
  const b = ear;
  const c = ear.next;

  if (area(a, b, c) >= 0) return false;

  let p = ear.next.next;
  while (p !== ear.prev) {
    if (pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) && area(p.prev, p, p.next) >= 0) {
      return false;
    }
    p = p.next;
  }

  return true;
}

function isEarHashed(ear: EarcutNode, minX: number, minY: number, invSize: number): boolean {
  const a = ear.prev;
  const b = ear;
  const c = ear.next;

  if (area(a, b, c) >= 0) return false;

  const minTX = a.x < b.x ? (a.x < c.x ? a.x : c.x) : (b.x < c.x ? b.x : c.x);
  const minTY = a.y < b.y ? (a.y < c.y ? a.y : c.y) : (b.y < c.y ? b.y : c.y);
  const maxTX = a.x > b.x ? (a.x > c.x ? a.x : c.x) : (b.x > c.x ? b.x : c.x);
  const maxTY = a.y > b.y ? (a.y > c.y ? a.y : c.y) : (b.y > c.y ? b.y : c.y);

  const minZ = zOrder(minTX, minTY, minX, minY, invSize);
  const maxZ = zOrder(maxTX, maxTY, minX, minY, invSize);

  let p = ear.prevZ;
  let n = ear.nextZ;

  while (p && p.z! >= minZ && n && n.z! <= maxZ) {
    if (p !== ear.prev && p !== ear.next && pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) && area(p.prev, p, p.next) >= 0) {
      return false;
    }
    p = p.prevZ;

    if (n !== ear.prev && n !== ear.next && pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, n.x, n.y) && area(n.prev, n, n.next) >= 0) {
      return false;
    }
    n = n.nextZ;
  }

  while (p && p.z! >= minZ) {
    if (p !== ear.prev && p !== ear.next && pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) && area(p.prev, p, p.next) >= 0) {
      return false;
    }
    p = p.prevZ;
  }

  while (n && n.z! <= maxZ) {
    if (n !== ear.prev && n !== ear.next && pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, n.x, n.y) && area(n.prev, n, n.next) >= 0) {
      return false;
    }
    n = n.nextZ;
  }

  return true;
}

function cureLocalIntersections(start: EarcutNode | null, triangles: number[], dim: number): EarcutNode | null {
  if (!start) return start;

  let p = start;
  do {
    const a = p.prev;
    const b = p.next.next;

    if (!equals(a, b) && intersects(a, p, p.next, b) && locallyInside(a, b) && locallyInside(b, a)) {
      triangles.push(a.i / dim, p.i / dim, b.i / dim);
      removeNode(p);
      removeNode(p.next);
      p = start = b;
    }

    p = p.next;
  } while (p !== start);

  return filterPoints(p);
}

function splitEarcut(start: EarcutNode, triangles: number[], dim: number, minX: number, minY: number, invSize: number): void {
  let a = start;
  do {
    let b = a.next.next;
    while (b !== a.prev) {
      if (a.i !== b.i && isValidDiagonal(a, b)) {
        let c = splitPolygon(a, b);
        const filteredA = filterPoints(a, a.next);
        c = filterPoints(c, c.next)!;
        earcutLinked(filteredA, triangles, dim, minX, minY, invSize);
        earcutLinked(c, triangles, dim, minX, minY, invSize);
        return;
      }

      b = b.next;
    }

    a = a.next;
  } while (a !== start);
}

function eliminateHoles(data: number[], holeIndices: number[], outerNode: EarcutNode, dim: number): EarcutNode {
  const queue: EarcutNode[] = [];

  for (let i = 0; i < holeIndices.length; i++) {
    const start = holeIndices[i]! * dim;
    const end = i < holeIndices.length - 1 ? holeIndices[i + 1]! * dim : data.length;
    const list = linkedList(data, start, end, dim, false);
    if (!list) continue;
    if (list === list.next) list.steiner = true;
    queue.push(getLeftmost(list));
  }

  queue.sort(compareX);

  for (let i = 0; i < queue.length; i++) {
    eliminateHole(queue[i]!, outerNode);
    outerNode = filterPoints(outerNode, outerNode.next)!;
  }

  return outerNode;
}

function compareX(a: EarcutNode, b: EarcutNode): number {
  return a.x - b.x;
}

function eliminateHole(hole: EarcutNode, outerNode: EarcutNode): void {
  const bridge = findHoleBridge(hole, outerNode);
  if (bridge) {
    const b = splitPolygon(bridge, hole);
    filterPoints(bridge, bridge.next);
    filterPoints(b, b.next);
  }
}

function findHoleBridge(hole: EarcutNode, outerNode: EarcutNode): EarcutNode | null {
  let p = outerNode;
  const hx = hole.x;
  const hy = hole.y;
  let qx = -Infinity;
  let m: EarcutNode | null = null;

  do {
    if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
      const x = p.x + (hy - p.y) * (p.next.x - p.x) / (p.next.y - p.y);
      if (x <= hx && x > qx) {
        qx = x;
        if (x === hx) {
          if (hy === p.y) return p;
          if (hy === p.next.y) return p.next;
        }

        m = p.x < p.next.x ? p : p.next;
      }
    }

    p = p.next;
  } while (p !== outerNode);

  if (!m) return null;
  if (hx === qx) return m;

  const stop = m;
  const mx = m.x;
  const my = m.y;
  let tanMin = Infinity;

  p = m;
  do {
    if (hx >= p.x && p.x >= mx && hx !== p.x && pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {
      const tan = Math.abs(hy - p.y) / (hx - p.x);

      if (locallyInside(p, hole) && (tan < tanMin || (tan === tanMin && (p.x > m.x || (p.x === m.x && sectorContainsSector(m!, p)))))) {
        m = p;
        tanMin = tan;
      }
    }

    p = p.next;
  } while (p !== stop);

  return m;
}

function sectorContainsSector(m: EarcutNode, p: EarcutNode): boolean {
  return area(m.prev, m, p.prev) < 0 && area(p.next, m, m.next) < 0;
}

function indexCurve(start: EarcutNode, minX: number, minY: number, invSize: number): void {
  let p = start;
  do {
    if (p.z === null) p.z = zOrder(p.x, p.y, minX, minY, invSize);
    p.prevZ = p.prev;
    p.nextZ = p.next;
    p = p.next;
  } while (p !== start);

  p.prevZ!.nextZ = null;
  p.prevZ = null;

  sortLinked(p);
}

function sortLinked(list: EarcutNode): EarcutNode {
  let inSize = 1;

  while (true) {
    let p: EarcutNode | null = list;
    let result: EarcutNode | null = null;
    let tail: EarcutNode | null = null;
    let numMerges = 0;

    while (p) {
      numMerges++;
      let q: EarcutNode | null = p;
      let pSize = 0;
      for (let i = 0; i < inSize; i++) {
        pSize++;
        q = q.nextZ;
        if (!q) break;
      }

      let qSize = inSize;

      while (pSize > 0 || (qSize > 0 && q)) {
        let e: EarcutNode;
        if (pSize !== 0 && p && (qSize === 0 || !q || p.z! <= q.z!)) {
          e = p;
          p = p.nextZ;
          pSize--;
        } else {
          e = q!;
          q = q!.nextZ;
          qSize--;
        }

        if (tail) tail.nextZ = e;
        else result = e;

        e.prevZ = tail;
        tail = e;
      }

      p = q;
    }

    if (tail) tail.nextZ = null;
    list = result!;
    inSize *= 2;

    if (numMerges <= 1) return list;
  }
}

function zOrder(xValue: number, yValue: number, minX: number, minY: number, invSize: number): number {
  let x = 32767 * (xValue - minX) * invSize;
  let y = 32767 * (yValue - minY) * invSize;

  x = (x | (x << 8)) & 0x00FF00FF;
  x = (x | (x << 4)) & 0x0F0F0F0F;
  x = (x | (x << 2)) & 0x33333333;
  x = (x | (x << 1)) & 0x55555555;

  y = (y | (y << 8)) & 0x00FF00FF;
  y = (y | (y << 4)) & 0x0F0F0F0F;
  y = (y | (y << 2)) & 0x33333333;
  y = (y | (y << 1)) & 0x55555555;

  return x | (y << 1);
}

function getLeftmost(start: EarcutNode): EarcutNode {
  let p = start;
  let leftmost = start;
  do {
    if (p.x < leftmost.x || (p.x === leftmost.x && p.y < leftmost.y)) leftmost = p;
    p = p.next;
  } while (p !== start);

  return leftmost;
}

function pointInTriangle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, px: number, py: number): boolean {
  return (cx - px) * (ay - py) - (ax - px) * (cy - py) >= 0 &&
    (ax - px) * (by - py) - (bx - px) * (ay - py) >= 0 &&
    (bx - px) * (cy - py) - (cx - px) * (by - py) >= 0;
}

function isValidDiagonal(a: EarcutNode, b: EarcutNode): boolean {
  return a.next.i !== b.i && a.prev.i !== b.i && !intersectsPolygon(a, b) &&
    ((locallyInside(a, b) && locallyInside(b, a) && middleInside(a, b) &&
      (area(a.prev, a, b.prev) !== 0 || area(a, b.prev, b) !== 0)) ||
      (equals(a, b) && area(a.prev, a, a.next) > 0 && area(b.prev, b, b.next) > 0));
}

function area(p: EarcutNode, q: EarcutNode, r: EarcutNode): number {
  return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
}

function equals(p1: EarcutNode, p2: EarcutNode): boolean {
  return p1.x === p2.x && p1.y === p2.y;
}

function intersects(p1: EarcutNode, q1: EarcutNode, p2: EarcutNode, q2: EarcutNode): boolean {
  const o1 = sign(area(p1, q1, p2));
  const o2 = sign(area(p1, q1, q2));
  const o3 = sign(area(p2, q2, p1));
  const o4 = sign(area(p2, q2, q1));

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;

  return false;
}

function onSegment(p: EarcutNode, q: EarcutNode, r: EarcutNode): boolean {
  return q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) && q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y);
}

function sign(num: number): number {
  return num > 0 ? 1 : num < 0 ? -1 : 0;
}

function intersectsPolygon(a: EarcutNode, b: EarcutNode): boolean {
  let p = a;
  do {
    if (p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i && intersects(p, p.next, a, b)) {
      return true;
    }
    p = p.next;
  } while (p !== a);

  return false;
}

function locallyInside(a: EarcutNode, b: EarcutNode): boolean {
  return area(a.prev, a, a.next) < 0 ?
    area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0 :
    area(a, b, a.prev) < 0 || area(a, a.next, b) < 0;
}

function middleInside(a: EarcutNode, b: EarcutNode): boolean {
  let p = a;
  let inside = false;
  const px = (a.x + b.x) / 2;
  const py = (a.y + b.y) / 2;

  do {
    if (((p.y > py) !== (p.next.y > py)) && p.next.y !== p.y &&
      (px < (p.next.x - p.x) * (py - p.y) / (p.next.y - p.y) + p.x)) {
      inside = !inside;
    }
    p = p.next;
  } while (p !== a);

  return inside;
}

function splitPolygon(a: EarcutNode, b: EarcutNode): EarcutNode {
  const a2 = createNode(a.i, a.x, a.y);
  const b2 = createNode(b.i, b.x, b.y);
  const an = a.next;
  const bp = b.prev;

  a.next = b;
  b.prev = a;

  a2.next = an;
  an.prev = a2;

  b2.next = a2;
  a2.prev = b2;

  bp.next = b2;
  b2.prev = bp;

  return b2;
}

function insertNode(i: number, x: number, y: number, last: EarcutNode | null): EarcutNode {
  const p = createNode(i, x, y);

  if (!last) {
    p.prev = p;
    p.next = p;
  } else {
    p.next = last.next;
    p.prev = last;
    last.next.prev = p;
    last.next = p;
  }

  return p;
}

function removeNode(p: EarcutNode): void {
  p.next.prev = p.prev;
  p.prev.next = p.next;

  if (p.prevZ) p.prevZ.nextZ = p.nextZ;
  if (p.nextZ) p.nextZ.prevZ = p.prevZ;
}

function signedArea(data: number[], start: number, end: number, dim: number): number {
  let sum = 0;
  for (let i = start, j = end - dim; i < end; i += dim) {
    sum += (data[j]! - data[i]!) * (data[i + 1]! + data[j + 1]!);
    j = i;
  }

  return sum;
}
