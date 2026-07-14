import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { Vector3 } from 't3d';
import { ExtrudeShapeBuilder } from 't3d/examples/jsm/geometries/builders/ExtrudeShapeBuilder.js';
import { TubeBuilder } from 't3d/examples/jsm/geometries/builders/TubeBuilder.js';

const pathGeometryEntry = process.env.PATH_GEOMETRY_ENTRY ?? new URL('../dist/index.js', import.meta.url).href;
const { geometry } = await import(pathGeometryEntry);

const WARMUP_RUNS = 30;
const BATCH_COUNT = 15;
const PROCESS_COUNT = 5;
const MEMORY_RUNS = 5;
const EPSILON = 1e-6;
const MEBIBYTE = 1024 * 1024;
const SELF_PATH = fileURLToPath(import.meta.url);
const SELF_BASELINES = JSON.parse(readFileSync(new URL('./sweep-baseline.json', import.meta.url), 'utf8'));
const ACCEPTANCE_LIMIT = SELF_BASELINES.threshold;
let blackhole = 0;

const SCENARIOS = [
  { id: 'tube-1k-r8', name: 'Tube 1k / radialSegments 8', family: 'tube', batchSize: 20 },
  { id: 'tube-10k-r8', name: 'Tube 10k / radialSegments 8', family: 'tube', batchSize: 3 },
  { id: 'tube-sharp-1k-r8', name: 'Tube sharp 1k / radialSegments 8', family: 'tube', batchSize: 20 },
  { id: 'tube-caps-1k-r8', name: 'Tube dual cap 1k / radialSegments 8', family: 'tube', batchSize: 20 },
  { id: 'tube-1k-r4', name: 'Tube 1k / radialSegments 4', family: 'tube', batchSize: 20 },
  { id: 'tube-1k-r32', name: 'Tube 1k / radialSegments 32', family: 'tube', batchSize: 20 },
  { id: 'extrude-linear-10k-full', name: 'Extrude linear 10k / full output', family: 'extrude-full', batchSize: 3 },
  { id: 'extrude-linear-10k-minimal', name: 'Extrude linear 10k / minimal output', family: 'extrude-minimal', batchSize: 3 },
  { id: 'extrude-path-16x1k-full', name: 'Extrude path 16 x 1k / full output', family: 'extrude-full', batchSize: 3 },
  { id: 'extrude-path-16x1k-minimal', name: 'Extrude path 16 x 1k / minimal output', family: 'extrude-minimal', batchSize: 3 },
  { id: 'extrude-holes-full', name: 'Extrude contour with hole / full output', family: 'extrude-full', batchSize: 100 },
  { id: 'extrude-holes-minimal', name: 'Extrude contour with hole / minimal output', family: 'extrude-minimal', batchSize: 100 },
  {
    id: 'tube-corner-transition-1k',
    name: 'Tube cornerTransition 1k self baseline',
    family: 'path-only',
    batchSize: 20
  },
  { id: 'ribbon-10k', name: 'Ribbon 10k self baseline', family: 'path-only', batchSize: 3 }
];

const CORRECTNESS_SCENARIOS = [
  { id: 'extrude-negative-depth-full', name: 'Extrude negative depth', family: 'extrude-full' },
  { id: 'extrude-single-cap-full', name: 'Extrude single cap', family: 'extrude-full' }
];

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
    const interior = i > 0 && i < count - 1;
    frames.points[i] = [i, 0, 0];
    frames.tangents[i] = [1, 0, 0];
    frames.normals[i] = [0, 1, 0];
    frames.binormals[i] = [0, 0, 1];
    frames.bisectors[i] = [0, 0, 1];
    frames.lengths[i] = i;
    frames.widthScales[i] = sharp && interior ? 2 : 1;
    frames.sharps[i] = sharp && interior;
    frames.tangentTypes[i] = 0;
  }
  return frames;
}

function toT3DFrames(frames) {
  return {
    ...frames,
    points: frames.points.map(value => new Vector3(value[0], value[1], value[2])),
    tangents: frames.tangents.map(value => new Vector3(value[0], value[1], value[2])),
    normals: frames.normals.map(value => new Vector3(value[0], value[1], value[2])),
    binormals: frames.binormals.map(value => new Vector3(value[0], value[1], value[2])),
    bisectors: frames.bisectors.map(value => new Vector3(value[0], value[1], value[2]))
  };
}

function createCircleContour(pointCount, clockwise = true, radius = 1) {
  const contour = new Array(pointCount);
  const direction = clockwise ? -1 : 1;
  for (let i = 0; i < pointCount; i++) {
    const angle = direction * Math.PI * 2 * i / pointCount;
    contour[i] = [Math.cos(angle) * radius, Math.sin(angle) * radius];
  }
  return contour;
}

function computeMeshNormals(positions, indices) {
  const normals = new Array(positions.length).fill(0);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const ax = positions[a];
    const ay = positions[a + 1];
    const az = positions[a + 2];
    const abx = positions[b] - ax;
    const aby = positions[b + 1] - ay;
    const abz = positions[b + 2] - az;
    const acx = positions[c] - ax;
    const acy = positions[c + 1] - ay;
    const acz = positions[c + 2] - az;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    normals[a] += nx;
    normals[a + 1] += ny;
    normals[a + 2] += nz;
    normals[b] += nx;
    normals[b + 1] += ny;
    normals[b + 2] += nz;
    normals[c] += nx;
    normals[c + 1] += ny;
    normals[c + 2] += nz;
  }
  for (let i = 0; i < normals.length; i += 3) {
    const x = normals[i];
    const y = normals[i + 1];
    const z = normals[i + 2];
    const length = Math.sqrt(x * x + y * y + z * z);
    if (length > 0) {
      normals[i] = x / length;
      normals[i + 1] = y / length;
      normals[i + 2] = z / length;
    }
  }
  return normals;
}

function addFullExtrudeOutput(result) {
  result.normals = computeMeshNormals(result.positions, result.indices);
  result.uvs2 = result.uvs.slice();
  return result;
}

function getTubeConfig(scenario) {
  return {
    count: scenario.id.includes('10k') ? 10_000 : 1_000,
    radialSegments: scenario.id.endsWith('r4') ? 4 : scenario.id.endsWith('r32') ? 32 : 8,
    caps: scenario.id.includes('caps'),
    sharp: scenario.id.includes('sharp') || scenario.id.includes('corner-transition')
  };
}

function createTubeFixture(scenario, implementation) {
  const config = getTubeConfig(scenario);
  const frames = createFrames(config.count, config.sharp);
  const sourceFrames = implementation === 't3d' ? toT3DFrames(frames) : frames;
  const options = {
    radius: 1,
    radialSegments: config.radialSegments,
    generateStartCap: config.caps,
    generateEndCap: config.caps
  };
  if (scenario.id.includes('corner-transition')) options.cornerTransition = true;
  return implementation === 't3d'
    ? () => TubeBuilder.getGeometryData(sourceFrames, options)
    : () => geometry.createTube(sourceFrames, options);
}

function createExtrudeFixture(scenario, implementation) {
  const minimal = scenario.family === 'extrude-minimal';
  let shape;
  if (scenario.id.includes('linear-10k')) {
    shape = { contour: createCircleContour(10_000), depth: 1, generateTop: true, generateBottom: true };
  } else if (scenario.id.includes('path-16x1k')) {
    const frames = createFrames(1_000);
    shape = {
      contour: createCircleContour(16),
      pathFrames: implementation === 't3d' ? toT3DFrames(frames) : frames,
      generateTop: false,
      generateBottom: false
    };
  } else if (scenario.id.includes('holes')) {
    shape = {
      contour: createCircleContour(64, true, 4),
      holes: [createCircleContour(32, false, 1)],
      depth: 2,
      generateTop: true,
      generateBottom: true
    };
  } else if (scenario.id.includes('negative-depth')) {
    shape = { contour: createCircleContour(16), depth: -2, generateTop: true, generateBottom: true };
  } else {
    shape = { contour: createCircleContour(16), depth: 2, generateTop: true, generateBottom: false };
  }

  if (implementation === 'path') {
    if (minimal) {
      shape.generateNormals = false;
      shape.generateUvs2 = false;
    }
    return () => geometry.createExtrudeShape(shape);
  }
  return minimal
    ? () => ExtrudeShapeBuilder.getGeometryData(shape)
    : () => addFullExtrudeOutput(ExtrudeShapeBuilder.getGeometryData(shape));
}

function createFixture(scenario, implementation) {
  if (scenario.family === 'tube' || scenario.id.includes('tube-')) {
    return createTubeFixture(scenario, implementation);
  }
  if (scenario.id === 'ribbon-10k') {
    const frames = createFrames(10_000);
    return () => geometry.createRibbon(frames, { width: 1, arrow: false });
  }
  return createExtrudeFixture(scenario, implementation);
}

function quantize(value) {
  if (Object.is(value, -0)) value = 0;
  return Math.round(value / EPSILON);
}

function comparePayload(first, second) {
  for (let i = 0; i < first.length; i++) {
    const difference = first[i] - second[i];
    if (difference !== 0) return difference;
  }
  return 0;
}

function createVertexPayload(result, index, fullOutput) {
  const positionOffset = index * 3;
  const uvOffset = index * 2;
  const payload = [
    quantize(result.positions[positionOffset]),
    quantize(result.positions[positionOffset + 1]),
    quantize(result.positions[positionOffset + 2])
  ];
  if (fullOutput) {
    payload.push(
      quantize(result.normals[positionOffset]),
      quantize(result.normals[positionOffset + 1]),
      quantize(result.normals[positionOffset + 2])
    );
  }
  payload.push(quantize(result.uvs[uvOffset]), quantize(result.uvs[uvOffset + 1]));
  if (fullOutput) {
    payload.push(quantize(result.uvs2[uvOffset]), quantize(result.uvs2[uvOffset + 1]));
  }
  return payload;
}

function createDirectedTriangleSignatures(result, fullOutput, indices = result.indices) {
  const signatures = new Array(indices.length / 3);

  for (let i = 0; i < indices.length; i += 3) {
    const vertices = [
      createVertexPayload(result, indices[i], fullOutput),
      createVertexPayload(result, indices[i + 1], fullOutput),
      createVertexPayload(result, indices[i + 2], fullOutput)
    ];
    let first = 0;
    if (comparePayload(vertices[1], vertices[first]) < 0) first = 1;
    if (comparePayload(vertices[2], vertices[first]) < 0) first = 2;
    signatures[i / 3] = [
      ...vertices[first],
      ...vertices[(first + 1) % 3],
      ...vertices[(first + 2) % 3]
    ].join(',');
  }
  signatures.sort();
  return signatures;
}

function createTubeCapSurfaceSignature(result, config, fullOutput) {
  const sideVertexCount = config.count * (config.radialSegments + 1);
  const sideIndexCount = Math.max(0, config.count - 1) * config.radialSegments * 6;
  const vertices = [];
  for (let index = sideVertexCount; index < result.positions.length / 3; index++) {
    vertices.push(createVertexPayload(result, index, fullOutput).join(','));
  }
  vertices.sort();

  const surfaceAreas = new Map();
  for (let i = sideIndexCount; i < result.indices.length; i += 3) {
    const a = result.indices[i];
    const b = result.indices[i + 1];
    const c = result.indices[i + 2];
    const ao = a * 3;
    const bo = b * 3;
    const co = c * 3;
    const abx = result.positions[bo] - result.positions[ao];
    const aby = result.positions[bo + 1] - result.positions[ao + 1];
    const abz = result.positions[bo + 2] - result.positions[ao + 2];
    const acx = result.positions[co] - result.positions[ao];
    const acy = result.positions[co + 1] - result.positions[ao + 1];
    const acz = result.positions[co + 2] - result.positions[ao + 2];
    const normalKey = [
      quantize(result.normals[ao]),
      quantize(result.normals[ao + 1]),
      quantize(result.normals[ao + 2])
    ].join(',');
    const area = surfaceAreas.get(normalKey) ?? [0, 0, 0];
    area[0] += aby * acz - abz * acy;
    area[1] += abz * acx - abx * acz;
    area[2] += abx * acy - aby * acx;
    surfaceAreas.set(normalKey, area);
  }
  const surfaces = [...surfaceAreas.entries()].map(([normal, area]) =>
    `${normal}|${quantize(area[0])},${quantize(area[1])},${quantize(area[2])}`
  ).sort();
  return { vertices, surfaces };
}

function validateScenario(scenario) {
  const fullOutput = scenario.family !== 'extrude-minimal';
  const createPath = createFixture(scenario, 'path');
  const createT3D = createFixture(scenario, 't3d');
  const pathResult = createPath();
  const t3dResult = createT3D();
  assert.equal(pathResult.positions.length, t3dResult.positions.length, `${scenario.name}: positions length`);
  assert.equal(pathResult.uvs.length, t3dResult.uvs.length, `${scenario.name}: UV length`);
  assert.equal(pathResult.indices.length, t3dResult.indices.length, `${scenario.name}: index length`);
  if (fullOutput) {
    assert.equal(pathResult.normals.length, t3dResult.normals.length, `${scenario.name}: normal length`);
    assert.equal(pathResult.uvs2.length, t3dResult.uvs2.length, `${scenario.name}: UV2 length`);
  } else {
    assert.deepEqual(pathResult.normals, [], `${scenario.name}: minimal normals`);
    assert.deepEqual(pathResult.uvs2, [], `${scenario.name}: minimal UV2`);
  }
  if (scenario.family === 'tube' && getTubeConfig(scenario).caps) {
    const config = getTubeConfig(scenario);
    const sideIndexCount = Math.max(0, config.count - 1) * config.radialSegments * 6;
    assert.deepEqual(
      createDirectedTriangleSignatures(pathResult, fullOutput, pathResult.indices.slice(0, sideIndexCount)),
      createDirectedTriangleSignatures(t3dResult, fullOutput, t3dResult.indices.slice(0, sideIndexCount)),
      `${scenario.name}: directed side triangle signatures differ`
    );
    assert.deepEqual(
      createTubeCapSurfaceSignature(pathResult, config, fullOutput),
      createTubeCapSurfaceSignature(t3dResult, config, fullOutput),
      `${scenario.name}: oriented cap surfaces differ`
    );
  } else {
    assert.deepEqual(
      createDirectedTriangleSignatures(pathResult, fullOutput),
      createDirectedTriangleSignatures(t3dResult, fullOutput),
      `${scenario.name}: directed triangle signatures differ`
    );
  }
}

function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.floor(ordered.length / 2)];
}

function summarizeGeometry(result) {
  return {
    vertices: result.positions.length / 3,
    triangles: result.indices.length / 3,
    attributes: {
      positions: result.positions.length,
      normals: result.normals?.length ?? 0,
      uvs: result.uvs.length,
      uvs2: result.uvs2?.length ?? 0,
      indices: result.indices.length
    }
  };
}

function memoryDelta(after, before) {
  return {
    heapUsed: after.heapUsed - before.heapUsed,
    arrayBuffers: after.arrayBuffers - before.arrayBuffers
  };
}

function runWorker(scenario, implementation) {
  assert.equal(typeof global.gc, 'function', 'worker requires --expose-gc');
  const createResult = createFixture(scenario, implementation);
  for (let i = 0; i < WARMUP_RUNS; i++) {
    const result = createResult();
    blackhole ^= result.positions.length + result.indices.length;
  }

  const elapsed = [];
  for (let batch = 0; batch < BATCH_COUNT; batch++) {
    const start = performance.now();
    for (let i = 0; i < scenario.batchSize; i++) {
      const result = createResult();
      blackhole ^= result.positions.length + result.indices.length;
    }
    elapsed.push((performance.now() - start) / scenario.batchSize);
  }

  const atReturn = [];
  const retained = [];
  let geometrySummary;
  for (let i = 0; i < MEMORY_RUNS; i++) {
    global.gc();
    const before = process.memoryUsage();
    let result = createResult();
    const returned = process.memoryUsage();
    global.gc();
    const withResult = process.memoryUsage();
    geometrySummary ??= summarizeGeometry(result);
    blackhole ^= result.positions.length + result.indices.length;
    atReturn.push(memoryDelta(returned, before));
    retained.push(memoryDelta(withResult, before));
    result = null;
    global.gc();
  }

  return {
    scenario: scenario.id,
    implementation,
    medianMs: median(elapsed),
    atReturn: {
      heapUsed: median(atReturn.map(value => value.heapUsed)),
      arrayBuffers: median(atReturn.map(value => value.arrayBuffers))
    },
    retained: {
      heapUsed: median(retained.map(value => value.heapUsed)),
      arrayBuffers: median(retained.map(value => value.arrayBuffers))
    },
    geometry: geometrySummary,
    blackhole
  };
}

function runChild(scenario, implementation) {
  const child = spawnSync(
    process.execPath,
    ['--expose-gc', SELF_PATH, '--worker', scenario.id, implementation],
    { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
  );
  if (child.status !== 0) {
    throw new Error(`Benchmark worker failed for ${scenario.id}/${implementation}:\n${child.stderr || child.stdout}`);
  }
  const lines = child.stdout.trim().split(/\r?\n/);
  return JSON.parse(lines[lines.length - 1]);
}

function aggregateWorkers(workers) {
  const result = {
    medianMs: median(workers.map(worker => worker.medianMs)),
    atReturn: {
      heapUsed: median(workers.map(worker => worker.atReturn.heapUsed)),
      arrayBuffers: median(workers.map(worker => worker.atReturn.arrayBuffers))
    },
    retained: {
      heapUsed: median(workers.map(worker => worker.retained.heapUsed)),
      arrayBuffers: median(workers.map(worker => worker.retained.arrayBuffers))
    },
    geometry: workers[0].geometry
  };
  result.atReturn.total = result.atReturn.heapUsed + result.atReturn.arrayBuffers;
  result.retained.total = result.retained.heapUsed + result.retained.arrayBuffers;
  return result;
}

function normalizeBaselineMeasurements(baseline) {
  return {
    medianMs: baseline.medianMs,
    atReturn: {
      ...baseline.atReturn,
      total: baseline.atReturn.heapUsed + baseline.atReturn.arrayBuffers
    },
    retained: {
      ...baseline.retained,
      total: baseline.retained.heapUsed + baseline.retained.arrayBuffers
    },
    geometry: null
  };
}

function round(value, digits = 3) {
  return Number(value.toFixed(digits));
}

function formatMeasurements(measurements) {
  const formatMemory = value => ({
    heapUsedMiB: round(value.heapUsed / MEBIBYTE),
    arrayBuffersMiB: round(value.arrayBuffers / MEBIBYTE),
    totalMiB: round(value.total / MEBIBYTE)
  });
  return {
    medianMs: round(measurements.medianMs),
    atReturn: formatMemory(measurements.atReturn),
    retained: formatMemory(measurements.retained),
    ...(measurements.geometry ?? {})
  };
}

function ratio(numerator, denominator) {
  if (denominator === 0) return numerator === 0 ? 1 : null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  return numerator / denominator;
}

function createRatios(pathResult, t3dResult) {
  return {
    medianMs: ratio(pathResult.medianMs, t3dResult.medianMs),
    atReturnTotal: ratio(pathResult.atReturn.total, t3dResult.atReturn.total),
    retainedTotal: ratio(pathResult.retained.total, t3dResult.retained.total)
  };
}

function formatRatios(ratios) {
  return Object.fromEntries(Object.entries(ratios).map(([key, value]) => [key, value === null ? null : round(value)]));
}

function ratiosPass(ratios) {
  return Object.values(ratios).every(value => value !== null && value <= ACCEPTANCE_LIMIT);
}

function validateBaselineEnvironment(t3dVersion) {
  const expected = SELF_BASELINES.environment;
  assert.equal(SELF_BASELINES.schemaVersion, 1, 'unsupported sweep baseline schema');
  assert.equal(process.versions.node.split('.')[0], expected.node.replace('.x', ''), 'sweep baseline requires Node 24.x');
  assert.equal(process.platform, expected.platform, `sweep baseline requires ${expected.platform}`);
  assert.equal(process.arch, expected.arch, `sweep baseline requires ${expected.arch}`);
  assert.equal(t3dVersion, expected.t3dVersion, `sweep baseline requires t3d ${expected.t3dVersion}`);
}

function main() {
  const packageMetadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const t3dMetadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.resolve('t3d')), 'utf8'));
  validateBaselineEnvironment(t3dMetadata.version);
  validateAllScenarios();
  const failures = [];
  console.log(JSON.stringify({
    kind: 'environment',
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    pathGeometryVersion: packageMetadata.version,
    t3dVersion: t3dMetadata.version,
    warmupRuns: WARMUP_RUNS,
    batchCount: BATCH_COUNT,
    processCount: PROCESS_COUNT,
    memoryRuns: MEMORY_RUNS,
    tolerance: EPSILON,
    acceptanceLimit: ACCEPTANCE_LIMIT,
    ratioDefinition: 'path-geometry / reference; pass when all acceptance ratios are within the configured limit'
  }));

  for (const scenario of SCENARIOS) {
    const implementations = scenario.family === 'path-only' ? ['path'] : ['path', 't3d'];
    const reports = {};
    for (const implementation of implementations) {
      const workers = [];
      for (let processIndex = 0; processIndex < PROCESS_COUNT; processIndex++) {
        workers.push(runChild(scenario, implementation));
      }
      reports[implementation] = aggregateWorkers(workers);
    }
    if (scenario.family === 'path-only') {
      const baselineData = SELF_BASELINES.scenarios[scenario.id];
      assert.ok(baselineData, `${scenario.id}: missing committed self baseline`);
      const baseline = normalizeBaselineMeasurements(baselineData);
      const ratios = createRatios(reports.path, baseline);
      const pass105 = ratiosPass(ratios);
      if (!pass105) failures.push({ scenario: scenario.id, reference: 'committed-baseline', ratios: formatRatios(ratios) });
      console.log(JSON.stringify({
        kind: 'self-comparison',
        name: scenario.name,
        comparable: false,
        batchSize: scenario.batchSize,
        pathGeometry: formatMeasurements(reports.path),
        baseline: formatMeasurements(baseline),
        pathGeometryToBaselineRatio: formatRatios(ratios),
        pass105
      }));
      continue;
    }
    const ratios = createRatios(reports.path, reports.t3d);
    const pass105 = ratiosPass(ratios);
    if (!pass105) failures.push({ scenario: scenario.id, reference: 't3d', ratios: formatRatios(ratios) });
    console.log(JSON.stringify({
      kind: 'comparison',
      name: scenario.name,
      comparable: true,
      batchSize: scenario.batchSize,
      pathGeometry: formatMeasurements(reports.path),
      t3d: formatMeasurements(reports.t3d),
      pathGeometryToT3DRatio: formatRatios(ratios),
      pass105
    }));
  }
  console.log(JSON.stringify({
    kind: 'acceptance',
    limit: ACCEPTANCE_LIMIT,
    pass105: failures.length === 0,
    failures
  }));
  if (failures.length > 0) process.exitCode = 1;
}

function validateAllScenarios() {
  for (const scenario of [...SCENARIOS.filter(value => value.family !== 'path-only'), ...CORRECTNESS_SCENARIOS]) {
    validateScenario(scenario);
  }
}

const workerIndex = process.argv.indexOf('--worker');
if (workerIndex >= 0) {
  const scenarioId = process.argv[workerIndex + 1];
  const implementation = process.argv[workerIndex + 2];
  const scenario = SCENARIOS.find(value => value.id === scenarioId);
  assert.ok(scenario, `unknown scenario: ${scenarioId}`);
  assert.ok(implementation === 'path' || implementation === 't3d', `unknown implementation: ${implementation}`);
  console.log(JSON.stringify(runWorker(scenario, implementation)));
} else if (process.argv.includes('--validate')) {
  validateAllScenarios();
  console.log(JSON.stringify({ kind: 'validation', scenarios: SCENARIOS.length + CORRECTNESS_SCENARIOS.length - 2 }));
} else {
  main();
}

void blackhole;
