import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Vector3 } from 't3d';
import { ExtrudeShapeBuilder } from 't3d/examples/jsm/geometries/builders/ExtrudeShapeBuilder.js';
import { TubeBuilder } from 't3d/examples/jsm/geometries/builders/TubeBuilder.js';
import { geometry } from '../dist/index.js';

const RADIAL_SEGMENTS = 8;
const REPETITIONS = 7;
const WARMUP_RUNS = 5;
const MEBIBYTE = 1024 * 1024;
const GEOMETRY_ATTRIBUTES = ['positions', 'normals', 'uvs', 'uvs2', 'indices'];

if (typeof global.gc !== 'function') {
  throw new Error('Run this benchmark with --expose-gc.');
}

const packageMetadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const t3dPackageMetadata = JSON.parse(readFileSync(
  new URL('../package.json', import.meta.resolve('t3d')),
  'utf8'
));

let blackhole = 0;

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

function toT3DFrames(frames) {
  return {
    ...frames,
    points: frames.points.map(point => new Vector3(point[0], point[1], point[2])),
    tangents: frames.tangents.map(tangent => new Vector3(tangent[0], tangent[1], tangent[2])),
    normals: frames.normals.map(normal => new Vector3(normal[0], normal[1], normal[2])),
    binormals: frames.binormals.map(binormal => new Vector3(binormal[0], binormal[1], binormal[2])),
    bisectors: frames.bisectors.map(bisector => new Vector3(bisector[0], bisector[1], bisector[2]))
  };
}

function createCircleContour(pointCount) {
  const contour = new Array(pointCount);
  for (let i = 0; i < pointCount; i++) {
    // Both builders expect clockwise contours. Keeping the fixture normalized
    // prevents their input-mutating winding correction from affecting a run.
    const angle = -Math.PI * 2 * i / pointCount;
    contour[i] = [Math.cos(angle), Math.sin(angle)];
  }
  return contour;
}

function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.floor(ordered.length / 2)];
}

function round(value, digits) {
  return Number(value.toFixed(digits));
}

function toMiB(bytes) {
  return bytes / MEBIBYTE;
}

function summarizeGeometry(result) {
  const attributes = {};
  let numericEntries = 0;

  for (const attribute of GEOMETRY_ATTRIBUTES) {
    const values = result[attribute];
    if (values === undefined) continue;
    attributes[attribute] = values.length;
    numericEntries += values.length;
  }

  return {
    vertices: result.positions.length / 3,
    triangles: result.indices.length / 3,
    numericEntries,
    attributes
  };
}

function createMeasurementStore() {
  return {
    elapsedTimes: [],
    heapAtReturn: [],
    retainedHeap: [],
    reclaimableHeap: [],
    geometry: null
  };
}

function warmUp(createGeometry) {
  for (let i = 0; i < WARMUP_RUNS; i++) {
    let result = createGeometry();
    blackhole ^= result.positions.length + result.indices.length;
    result = null;
  }
  global.gc();
}

function measureOnce(createGeometry, measurements) {
  global.gc();
  const heapBefore = process.memoryUsage().heapUsed;
  const start = performance.now();
  let result = createGeometry();
  const elapsed = performance.now() - start;
  const heapAfterReturn = process.memoryUsage().heapUsed;

  global.gc();
  const heapWithResult = process.memoryUsage().heapUsed;
  measurements.geometry ??= summarizeGeometry(result);
  blackhole ^= result.positions.length + result.indices.length;

  measurements.elapsedTimes.push(elapsed);
  measurements.heapAtReturn.push(heapAfterReturn - heapBefore);
  measurements.retainedHeap.push(heapWithResult - heapBefore);
  measurements.reclaimableHeap.push(heapAfterReturn - heapWithResult);

  result = null;
  global.gc();
}

function summarizeMeasurements(measurements) {
  const medianMs = median(measurements.elapsedTimes);
  const heapAtReturn = median(measurements.heapAtReturn);
  const retainedHeap = median(measurements.retainedHeap);
  const reclaimableHeap = median(measurements.reclaimableHeap);

  for (const value of [medianMs, heapAtReturn, retainedHeap, reclaimableHeap]) {
    assert.ok(Number.isFinite(value), 'benchmark produced a non-finite measurement');
  }

  return {
    medianMs: round(medianMs, 3),
    heapAtReturnMiB: round(toMiB(heapAtReturn), 2),
    retainedHeapMiB: round(toMiB(retainedHeap), 2),
    reclaimableHeapMiB: round(toMiB(reclaimableHeap), 2),
    ...measurements.geometry
  };
}

function assertGeometrySizesMatch(name, pathGeometryResult, t3dResult, attributes) {
  const pathGeometrySummary = summarizeGeometry(pathGeometryResult);
  const t3dSummary = summarizeGeometry(t3dResult);

  assert.equal(
    pathGeometrySummary.vertices,
    t3dSummary.vertices,
    `${name}: vertex counts differ`
  );
  assert.equal(
    pathGeometrySummary.triangles,
    t3dSummary.triangles,
    `${name}: triangle counts differ`
  );

  for (const attribute of attributes) {
    assert.notEqual(
      pathGeometrySummary.attributes[attribute],
      undefined,
      `${name}: path-geometry did not return ${attribute}`
    );
    assert.notEqual(
      t3dSummary.attributes[attribute],
      undefined,
      `${name}: t3d did not return ${attribute}`
    );
    assert.equal(
      pathGeometrySummary.attributes[attribute],
      t3dSummary.attributes[attribute],
      `${name}: ${attribute} lengths differ`
    );
  }

  return {
    pathGeometryOnlyAttributes: GEOMETRY_ATTRIBUTES.filter(attribute =>
      pathGeometrySummary.attributes[attribute] !== undefined &&
      t3dSummary.attributes[attribute] === undefined
    ),
    t3dOnlyAttributes: GEOMETRY_ATTRIBUTES.filter(attribute =>
      t3dSummary.attributes[attribute] !== undefined &&
      pathGeometrySummary.attributes[attribute] === undefined
    )
  };
}

function validateComparison(name, comparisonType, createPathGeometry, createT3DGeometry) {
  let pathGeometryResult = createPathGeometry();
  let t3dResult = createT3DGeometry();
  const sharedAttributes = comparisonType === 'tube'
    ? GEOMETRY_ATTRIBUTES
    : ['positions', 'uvs', 'indices'];
  const outputDifference = assertGeometrySizesMatch(
    name,
    pathGeometryResult,
    t3dResult,
    sharedAttributes
  );

  if (comparisonType === 'tube') {
    assert.deepEqual(
      outputDifference,
      { pathGeometryOnlyAttributes: [], t3dOnlyAttributes: [] },
      `${name}: tube outputs do not expose the same attributes`
    );
  } else {
    assert.deepEqual(
      outputDifference,
      { pathGeometryOnlyAttributes: ['normals', 'uvs2'], t3dOnlyAttributes: [] },
      `${name}: unexpected extrude output attributes`
    );
  }

  pathGeometryResult = null;
  t3dResult = null;
  global.gc();
  return outputDifference;
}

function createRatio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  return round(numerator / denominator, 3);
}

function createRatios(pathGeometryMeasurements, t3dMeasurements) {
  return {
    medianMs: createRatio(
      median(t3dMeasurements.elapsedTimes),
      median(pathGeometryMeasurements.elapsedTimes)
    ),
    heapAtReturnMiB: createRatio(
      median(t3dMeasurements.heapAtReturn),
      median(pathGeometryMeasurements.heapAtReturn)
    ),
    retainedHeapMiB: createRatio(
      median(t3dMeasurements.retainedHeap),
      median(pathGeometryMeasurements.retainedHeap)
    ),
    reclaimableHeapMiB: createRatio(
      median(t3dMeasurements.reclaimableHeap),
      median(pathGeometryMeasurements.reclaimableHeap)
    )
  };
}

function runComparison(name, comparisonType, createPathGeometry, createT3DGeometry) {
  const outputDifference = validateComparison(
    name,
    comparisonType,
    createPathGeometry,
    createT3DGeometry
  );

  warmUp(createPathGeometry);
  warmUp(createT3DGeometry);

  const pathGeometryMeasurements = createMeasurementStore();
  const t3dMeasurements = createMeasurementStore();

  for (let i = 0; i < REPETITIONS; i++) {
    if (i % 2 === 0) {
      measureOnce(createPathGeometry, pathGeometryMeasurements);
      measureOnce(createT3DGeometry, t3dMeasurements);
    } else {
      measureOnce(createT3DGeometry, t3dMeasurements);
      measureOnce(createPathGeometry, pathGeometryMeasurements);
    }
  }

  const pathGeometryReport = summarizeMeasurements(pathGeometryMeasurements);
  const t3dReport = summarizeMeasurements(t3dMeasurements);
  console.log(JSON.stringify({
    kind: 'comparison',
    name,
    comparable: true,
    repetitions: REPETITIONS,
    pathGeometry: pathGeometryReport,
    t3d: t3dReport,
    t3dToPathGeometryRatio: createRatios(pathGeometryMeasurements, t3dMeasurements),
    outputDifference
  }));
}

function runPathGeometryOnly(name, reason, createGeometry) {
  let validationResult = createGeometry();
  const validationSummary = summarizeGeometry(validationResult);
  validationResult = null;
  global.gc();

  warmUp(createGeometry);
  const measurements = createMeasurementStore();
  for (let i = 0; i < REPETITIONS; i++) {
    measureOnce(createGeometry, measurements);
  }

  const report = summarizeMeasurements(measurements);
  assert.deepEqual(
    {
      vertices: report.vertices,
      triangles: report.triangles,
      numericEntries: report.numericEntries,
      attributes: report.attributes
    },
    validationSummary,
    `${name}: output shape changed between validation and measurement`
  );
  console.log(JSON.stringify({
    kind: 'benchmark',
    name,
    comparable: false,
    reason,
    repetitions: REPETITIONS,
    pathGeometry: report
  }));
}

const frames1k = createFrames(1_000);
const frames10k = createFrames(10_000);
const sharpFrames1k = createFrames(1_000, true);
const t3dFrames1k = toT3DFrames(frames1k);
const t3dFrames10k = toT3DFrames(frames10k);
const t3dSharpFrames1k = toT3DFrames(sharpFrames1k);
const pathGeometryContour10k = createCircleContour(10_000);
const t3dContour10k = createCircleContour(10_000);
const pathGeometryPathContour = createCircleContour(16);
const t3dPathContour = createCircleContour(16);

console.log(JSON.stringify({
  kind: 'environment',
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  pathGeometryVersion: packageMetadata.version,
  t3dVersion: t3dPackageMetadata.version,
  warmupRuns: WARMUP_RUNS,
  repetitions: REPETITIONS,
  ratioDefinition: 't3d/pathGeometry; values above 1 mean t3d used more time or heap'
}));

runComparison(
  'tube sections=1000 radialSegments=8',
  'tube',
  () => geometry.createTube(frames1k, { radius: 1, radialSegments: RADIAL_SEGMENTS }),
  () => TubeBuilder.getGeometryData(t3dFrames1k, { radius: 1, radialSegments: RADIAL_SEGMENTS })
);

runComparison(
  'tube sections=10000 radialSegments=8',
  'tube',
  () => geometry.createTube(frames10k, { radius: 1, radialSegments: RADIAL_SEGMENTS }),
  () => TubeBuilder.getGeometryData(t3dFrames10k, { radius: 1, radialSegments: RADIAL_SEGMENTS })
);

runComparison(
  'tube sharp sections=1000 cornerTransition=false',
  'tube',
  () => geometry.createTube(sharpFrames1k, {
    radius: 1,
    radialSegments: RADIAL_SEGMENTS,
    cornerTransition: false
  }),
  () => TubeBuilder.getGeometryData(t3dSharpFrames1k, {
    radius: 1,
    radialSegments: RADIAL_SEGMENTS
  })
);

runPathGeometryOnly(
  'tube sharp sections=1000 cornerTransition=true',
  'path-geometry extension; t3d has no cornerTransition equivalent',
  () => geometry.createTube(sharpFrames1k, {
    radius: 1,
    radialSegments: RADIAL_SEGMENTS,
    cornerTransition: true
  })
);

runComparison(
  'extrude linear contourPoints=10000 caps=true',
  'extrude',
  () => geometry.createExtrudeShape({
    contour: pathGeometryContour10k,
    depth: 1,
    generateTop: true,
    generateBottom: true
  }),
  () => ExtrudeShapeBuilder.getGeometryData({
    contour: t3dContour10k,
    depth: 1,
    generateTop: true,
    generateBottom: true
  })
);

runComparison(
  'extrude path contourPoints=16 sections=1000 caps=false',
  'extrude',
  () => geometry.createExtrudeShape({
    contour: pathGeometryPathContour,
    pathFrames: frames1k,
    generateTop: false,
    generateBottom: false
  }),
  () => ExtrudeShapeBuilder.getGeometryData({
    contour: t3dPathContour,
    pathFrames: t3dFrames1k,
    generateTop: false,
    generateBottom: false
  })
);

// Keep the warm-up/measurement sink referenced without adding non-JSON output.
void blackhole;
