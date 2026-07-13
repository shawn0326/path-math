import { performance } from 'node:perf_hooks';
import { geometry } from '../dist/index.js';

const RADIAL_SEGMENTS = 8;
const REPETITIONS = 7;
const WARMUP_RUNS = 5;
const MEBIBYTE = 1024 * 1024;

if (typeof global.gc !== 'function') {
  throw new Error('Run this benchmark with --expose-gc.');
}

function createFrames(count, sharp = false) {
  const frames = {
    points: new Array(count),
    tangents: new Array(count),
    normals: new Array(count),
    binormals: new Array(count),
    bisectors: new Array(count),
    lengths: new Array(count),
    widthScales: new Array(count),
    sharps: new Array(count),
    tangentTypes: new Array(count)
  };

  for (let i = 0; i < count; i++) {
    const isInterior = i > 0 && i < count - 1;
    frames.points[i] = [i, 0, 0];
    frames.tangents[i] = [1, 0, 0];
    frames.normals[i] = [0, 1, 0];
    frames.binormals[i] = [0, 0, 1];
    frames.bisectors[i] = [0, 0, 1];
    frames.lengths[i] = i;
    frames.widthScales[i] = sharp && isInterior ? 2 : 1;
    frames.sharps[i] = sharp && isInterior;
    frames.tangentTypes[i] = 0;
  }

  return frames;
}

function createCircleContour(pointCount) {
  const contour = new Array(pointCount);
  for (let i = 0; i < pointCount; i++) {
    const angle = Math.PI * 2 * i / pointCount;
    contour[i] = [Math.cos(angle), Math.sin(angle)];
  }
  return contour;
}

function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.floor(ordered.length / 2)];
}

function toMiB(bytes) {
  return bytes / MEBIBYTE;
}

function summarizeGeometry(result) {
  return {
    vertices: result.positions.length / 3,
    triangles: result.indices.length / 3
  };
}

function runBenchmark(name, createGeometry) {
  for (let i = 0; i < WARMUP_RUNS; i++) {
    let warmup = createGeometry();
    warmup = null;
  }
  global.gc();

  const elapsedTimes = [];
  const heapAtReturn = [];
  const retainedHeap = [];
  const reclaimableHeap = [];
  let geometrySummary;

  for (let i = 0; i < REPETITIONS; i++) {
    global.gc();
    const heapBefore = process.memoryUsage().heapUsed;
    const start = performance.now();
    let result = createGeometry();
    elapsedTimes.push(performance.now() - start);

    const heapAfterReturn = process.memoryUsage().heapUsed;
    global.gc();
    const heapWithResult = process.memoryUsage().heapUsed;
    geometrySummary ??= summarizeGeometry(result);

    heapAtReturn.push(heapAfterReturn - heapBefore);
    retainedHeap.push(heapWithResult - heapBefore);
    reclaimableHeap.push(heapAfterReturn - heapWithResult);

    result = null;
    global.gc();
  }

  const report = {
    name,
    repetitions: REPETITIONS,
    medianMs: Number(median(elapsedTimes).toFixed(3)),
    heapAtReturnMiB: Number(toMiB(median(heapAtReturn)).toFixed(2)),
    retainedHeapMiB: Number(toMiB(median(retainedHeap)).toFixed(2)),
    reclaimableHeapMiB: Number(toMiB(median(reclaimableHeap)).toFixed(2)),
    ...geometrySummary
  };
  console.log(JSON.stringify(report));
}

const frames1k = createFrames(1_000);
const frames10k = createFrames(10_000);
const sharpFrames1k = createFrames(1_000, true);
const contour10k = createCircleContour(10_000);

runBenchmark('tube sections=1000 radialSegments=8', () => geometry.createTube(frames1k, {
  radius: 1,
  radialSegments: RADIAL_SEGMENTS
}));

runBenchmark('tube sections=10000 radialSegments=8', () => geometry.createTube(frames10k, {
  radius: 1,
  radialSegments: RADIAL_SEGMENTS
}));

runBenchmark('tube sharp sections=1000 cornerTransition=false', () => geometry.createTube(sharpFrames1k, {
  radius: 1,
  radialSegments: RADIAL_SEGMENTS,
  cornerTransition: false
}));

runBenchmark('tube sharp sections=1000 cornerTransition=true', () => geometry.createTube(sharpFrames1k, {
  radius: 1,
  radialSegments: RADIAL_SEGMENTS,
  cornerTransition: true
}));

runBenchmark('extrude contourPoints=10000 caps=true', () => geometry.createExtrudeShape({
  contour: contour10k,
  depth: 1
}));
