import { vec3 } from '../vector';
import type { ReadonlyVector, Vector3 } from '../vector';
import type { GeometryData, PathFrames } from '../types';
import { triangulate } from './earcut';

export type SweepSideLayout = 'shared' | 'edge-isolated';
export type SweepNormalMode = 'profile' | 'mesh';

export interface SweepProfileLoop {
  points: ReadonlyArray<ReadonlyArray<number>>;
  closed: boolean;
  normals?: ReadonlyArray<ReadonlyArray<number>>;
}

export interface SweepProfile {
  loops: SweepProfileLoop[];
  capTriangles?: number[];
}

export interface SweepSection {
  point: ReadonlyVector;
  tangent: ReadonlyVector;
  normal: ReadonlyVector;
  binormal: ReadonlyVector;
  bisector: ReadonlyVector;
  length: number;
  widthScale: number;
  sharp: boolean;
  uniformScale: number;
}

export interface SweepOptions {
  sideLayout: SweepSideLayout;
  normalMode: SweepNormalMode;
  startCap: boolean;
  endCap: boolean;
  flipWinding?: boolean;
  attributeSink: SweepAttributeSink;
}

export type SweepSurface = 'side' | 'start-cap' | 'end-cap';

export type SweepAttributeSink = (
  geometry: GeometryData,
  surface: SweepSurface,
  sectionIndex: number,
  loopIndex: number,
  pointIndex: number,
  profileStep: number,
  profileDistance: number
) => void;

interface SweepLoopMetrics {
  cumulativeLengths: number[];
  totalLength: number;
  edgeCount: number;
}

export interface CreateSweepSectionsOptions {
  scaleNonSharp: boolean;
  sanitizeWidthScale: boolean;
}

function createGeometry(): GeometryData {
  return {
    positions: [],
    normals: [],
    uvs: [],
    uvs2: [],
    indices: []
  };
}

function finiteOrDefault(value: number | undefined, defaultValue: number): number {
  return value !== undefined && Number.isFinite(value) ? value : defaultValue;
}

function normalizeScale(value: number | undefined): number {
  const scale = finiteOrDefault(value, 1);
  return Math.abs(scale) < 1e-12 ? 1 : scale;
}

function scaleAlong(out: Vector3, value: ReadonlyVector, axis: ReadonlyVector, scale: number): Vector3 {
  const axisLengthSq = vec3.squaredLength(axis);

  if (axisLengthSq <= 0) {
    vec3.copy(out, value);
    return out;
  }

  const projection = vec3.dot(value, axis) / axisLengthSq;
  const factor = projection * (scale - 1);

  out[0] = value[0]! + axis[0]! * factor;
  out[1] = value[1]! + axis[1]! * factor;
  out[2] = value[2]! + axis[2]! * factor;

  return out;
}

function pushVec3(target: number[], value: ReadonlyVector): void {
  target.push(value[0]!, value[1]!, value[2]!);
}

function getDistance(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  return Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);
}

function createLoopMetrics(loop: SweepProfileLoop): SweepLoopMetrics {
  const pointCount = loop.points.length;
  const edgeCount = loop.closed ? pointCount : Math.max(0, pointCount - 1);
  const cumulativeLengths = new Array<number>(pointCount).fill(0);
  let totalLength = 0;

  for (let i = 1; i < pointCount; i++) {
    totalLength += getDistance(loop.points[i - 1]!, loop.points[i]!);
    cumulativeLengths[i] = totalLength;
  }

  if (loop.closed && pointCount > 1) {
    totalLength += getDistance(loop.points[pointCount - 1]!, loop.points[0]!);
  }

  return { cumulativeLengths, totalLength, edgeCount };
}

function getProfileNormal(
  out: number[],
  loop: SweepProfileLoop,
  pointIndex: number
): void {
  const supplied = loop.normals?.[pointIndex];
  if (supplied) {
    const length = Math.hypot(supplied[0]!, supplied[1]!);
    if (length > 0) {
      out[0] = supplied[0]! / length;
      out[1] = supplied[1]! / length;
      return;
    }
  }

  const pointCount = loop.points.length;
  const previousIndex = pointIndex > 0 ? pointIndex - 1 : (loop.closed ? pointCount - 1 : 0);
  const nextIndex = pointIndex + 1 < pointCount ? pointIndex + 1 : (loop.closed ? 0 : pointCount - 1);
  const previous = loop.points[previousIndex]!;
  const current = loop.points[pointIndex]!;
  const next = loop.points[nextIndex]!;

  const previousX = current[0]! - previous[0]!;
  const previousY = current[1]! - previous[1]!;
  const nextX = next[0]! - current[0]!;
  const nextY = next[1]! - current[1]!;
  const previousLength = Math.hypot(previousX, previousY);
  const nextLength = Math.hypot(nextX, nextY);

  const nx = (previousLength > 0 ? -previousY / previousLength : 0) +
    (nextLength > 0 ? -nextY / nextLength : 0);
  const ny = (previousLength > 0 ? previousX / previousLength : 0) +
    (nextLength > 0 ? nextX / nextLength : 0);
  const length = Math.hypot(nx, ny);

  if (length > 0) {
    out[0] = nx / length;
    out[1] = ny / length;
  } else {
    out[0] = 0;
    out[1] = 0;
  }
}

function transformPoint(
  out: Vector3,
  local: Vector3,
  section: SweepSection,
  point: ReadonlyArray<number>
): Vector3 {
  vec3.scale(local, section.binormal, point[0]!);
  vec3.scaleAndAdd(local, local, section.normal, point[1]!);

  if (section.sharp) {
    scaleAlong(local, local, section.bisector, section.widthScale);
  } else if (section.uniformScale !== 1) {
    vec3.scale(local, local, section.uniformScale);
  }

  return vec3.add(out, section.point, local);
}

function transformNormal(
  out: Vector3,
  local: Vector3,
  section: SweepSection,
  profileNormal: number[]
): Vector3 {
  vec3.scale(local, section.binormal, profileNormal[0]!);
  vec3.scaleAndAdd(local, local, section.normal, profileNormal[1]!);

  if (section.sharp) {
    scaleAlong(out, local, section.bisector, 1 / section.widthScale);
  } else {
    vec3.copy(out, local);
  }

  return vec3.normalize(out, out);
}

function pushTriangle(indices: number[], a: number, b: number, c: number, flip: boolean): void {
  if (flip) indices.push(a, c, b);
  else indices.push(a, b, c);
}

function addVertex(
  geometry: GeometryData,
  profile: SweepProfile,
  sections: SweepSection[],
  surface: SweepSurface,
  sectionIndex: number,
  loopIndex: number,
  pointIndex: number,
  profileStep: number,
  profileDistance: number,
  analyticNormal: boolean,
  attributeSink: SweepAttributeSink,
  position: Vector3,
  local: Vector3,
  normal: Vector3,
  localNormal: Vector3,
  profileNormal: number[]
): number {
  const loop = profile.loops[loopIndex]!;
  const point = loop.points[pointIndex]!;
  const section = sections[sectionIndex]!;

  transformPoint(position, local, section, point);
  pushVec3(geometry.positions, position);

  if (analyticNormal) {
    getProfileNormal(profileNormal, loop, pointIndex);
    transformNormal(normal, localNormal, section, profileNormal);
    pushVec3(geometry.normals, normal);
  }

  attributeSink(geometry, surface, sectionIndex, loopIndex, pointIndex, profileStep, profileDistance);
  return geometry.positions.length / 3 - 1;
}

function addSharedSides(
  geometry: GeometryData,
  profile: SweepProfile,
  sections: SweepSection[],
  loopMetrics: SweepLoopMetrics[],
  flipWinding: boolean,
  analyticNormals: boolean,
  attributeSink: SweepAttributeSink
): void {
  const position = vec3.create();
  const local = vec3.create();
  const normal = vec3.create();
  const localNormal = vec3.create();
  const profileNormal = [0, 0];
  let previousSectionRings: number[][] | null = null;

  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
    const sectionRings: number[][] = [];

    for (let loopIndex = 0; loopIndex < profile.loops.length; loopIndex++) {
      const loop = profile.loops[loopIndex]!;
      const metrics = loopMetrics[loopIndex]!;
      const ring: number[] = [];
      const vertexCount = loop.points.length + (loop.closed && loop.points.length > 0 ? 1 : 0);

      for (let profileStep = 0; profileStep < vertexCount; profileStep++) {
        const pointIndex = profileStep === loop.points.length ? 0 : profileStep;
        const profileDistance = profileStep === loop.points.length
          ? metrics.totalLength
          : metrics.cumulativeLengths[pointIndex]!;
        ring.push(addVertex(
          geometry,
          profile,
          sections,
          'side',
          sectionIndex,
          loopIndex,
          pointIndex,
          profileStep,
          profileDistance,
          analyticNormals,
          attributeSink,
          position,
          local,
          normal,
          localNormal,
          profileNormal
        ));
      }

      sectionRings.push(ring);
    }

    if (previousSectionRings) {
      for (let loopIndex = 0; loopIndex < profile.loops.length; loopIndex++) {
        const previous = previousSectionRings[loopIndex]!;
        const current = sectionRings[loopIndex]!;
        const edgeCount = loopMetrics[loopIndex]!.edgeCount;

        for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex++) {
          pushTriangle(geometry.indices, current[edgeIndex]!, previous[edgeIndex]!, previous[edgeIndex + 1]!, flipWinding);
          pushTriangle(geometry.indices, current[edgeIndex]!, previous[edgeIndex + 1]!, current[edgeIndex + 1]!, flipWinding);
        }
      }
    }

    previousSectionRings = sectionRings;
  }
}

function addEdgeIsolatedSides(
  geometry: GeometryData,
  profile: SweepProfile,
  sections: SweepSection[],
  loopMetrics: SweepLoopMetrics[],
  flipWinding: boolean,
  analyticNormals: boolean,
  attributeSink: SweepAttributeSink
): void {
  const position = vec3.create();
  const local = vec3.create();
  const normal = vec3.create();
  const localNormal = vec3.create();
  const profileNormal = [0, 0];

  for (let loopIndex = 0; loopIndex < profile.loops.length; loopIndex++) {
    const loop = profile.loops[loopIndex]!;
    const metrics = loopMetrics[loopIndex]!;

    for (let edgeIndex = 0; edgeIndex < metrics.edgeCount; edgeIndex++) {
      const firstPointIndex = edgeIndex;
      const secondPointIndex = edgeIndex + 1 < loop.points.length ? edgeIndex + 1 : 0;
      const firstDistance = metrics.cumulativeLengths[firstPointIndex]!;
      const secondDistance = edgeIndex + 1 < loop.points.length
        ? metrics.cumulativeLengths[secondPointIndex]!
        : metrics.totalLength;
      let previousFirst = -1;
      let previousSecond = -1;

      for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
        const first = addVertex(
          geometry,
          profile,
          sections,
          'side',
          sectionIndex,
          loopIndex,
          firstPointIndex,
          edgeIndex,
          firstDistance,
          analyticNormals,
          attributeSink,
          position,
          local,
          normal,
          localNormal,
          profileNormal
        );
        const second = addVertex(
          geometry,
          profile,
          sections,
          'side',
          sectionIndex,
          loopIndex,
          secondPointIndex,
          edgeIndex + 1,
          secondDistance,
          analyticNormals,
          attributeSink,
          position,
          local,
          normal,
          localNormal,
          profileNormal
        );

        if (sectionIndex > 0) {
          pushTriangle(geometry.indices, previousFirst, previousSecond, first, flipWinding);
          pushTriangle(geometry.indices, previousSecond, second, first, flipWinding);
        }

        previousFirst = first;
        previousSecond = second;
      }
    }
  }
}

interface CapProfileData {
  points: Array<{ loopIndex: number; pointIndex: number }>;
  triangles: number[];
}

function createCapProfileData(profile: SweepProfile): CapProfileData {
  const vertices: number[] = [];
  const holeIndices: number[] = [];
  const points: Array<{ loopIndex: number; pointIndex: number }> = [];
  let closedLoopCount = 0;

  for (let loopIndex = 0; loopIndex < profile.loops.length; loopIndex++) {
    const loop = profile.loops[loopIndex]!;
    if (!loop.closed || loop.points.length < 3) continue;
    if (closedLoopCount > 0) holeIndices.push(points.length);
    closedLoopCount++;

    for (let pointIndex = 0; pointIndex < loop.points.length; pointIndex++) {
      const point = loop.points[pointIndex]!;
      vertices.push(point[0]!, point[1]!);
      points.push({ loopIndex, pointIndex });
    }
  }

  return {
    points,
    triangles: profile.capTriangles ?? (closedLoopCount > 0 ? triangulate(vertices, holeIndices) : [])
  };
}

function addCap(
  geometry: GeometryData,
  profile: SweepProfile,
  sections: SweepSection[],
  loopMetrics: SweepLoopMetrics[],
  capData: CapProfileData,
  surface: 'start-cap' | 'end-cap',
  flipWinding: boolean,
  analyticNormals: boolean,
  attributeSink: SweepAttributeSink
): void {
  if (capData.points.length === 0 || sections.length === 0) return;

  const isEnd = surface === 'end-cap';
  const sectionIndex = isEnd ? sections.length - 1 : 0;
  const position = vec3.create();
  const local = vec3.create();
  const capNormal = vec3.create();
  const vertexIndices: number[] = [];
  const section = sections[sectionIndex]!;

  vec3.normalize(capNormal, section.tangent);
  if (!isEnd) vec3.scale(capNormal, capNormal, -1);

  for (let i = 0; i < capData.points.length; i++) {
    const source = capData.points[i]!;
    const loop = profile.loops[source.loopIndex]!;
    const point = loop.points[source.pointIndex]!;
    transformPoint(position, local, section, point);
    pushVec3(geometry.positions, position);
    if (analyticNormals) pushVec3(geometry.normals, capNormal);

    const profileDistance = loopMetrics[source.loopIndex]!.cumulativeLengths[source.pointIndex]!;
    attributeSink(
      geometry,
      surface,
      sectionIndex,
      source.loopIndex,
      source.pointIndex,
      source.pointIndex,
      profileDistance
    );
    vertexIndices.push(geometry.positions.length / 3 - 1);
  }

  const reverse = isEnd !== flipWinding;
  for (let i = 0; i < capData.triangles.length; i += 3) {
    const a = vertexIndices[capData.triangles[i]!]!;
    const b = vertexIndices[capData.triangles[i + 1]!]!;
    const c = vertexIndices[capData.triangles[i + 2]!]!;
    pushTriangle(geometry.indices, a, b, c, reverse);
  }
}

function accumulateNormal(normals: number[], index: number, nx: number, ny: number, nz: number): void {
  const offset = index * 3;
  normals[offset] = (normals[offset] ?? 0) + nx;
  normals[offset + 1] = (normals[offset + 1] ?? 0) + ny;
  normals[offset + 2] = (normals[offset + 2] ?? 0) + nz;
}

function computeMeshNormals(positions: number[], indices: number[]): number[] {
  const normals = new Array<number>(positions.length).fill(0);

  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]!;
    const b = indices[i + 1]!;
    const c = indices[i + 2]!;
    const ax = positions[a * 3]!;
    const ay = positions[a * 3 + 1]!;
    const az = positions[a * 3 + 2]!;
    const abx = positions[b * 3]! - ax;
    const aby = positions[b * 3 + 1]! - ay;
    const abz = positions[b * 3 + 2]! - az;
    const acx = positions[c * 3]! - ax;
    const acy = positions[c * 3 + 1]! - ay;
    const acz = positions[c * 3 + 2]! - az;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;

    accumulateNormal(normals, a, nx, ny, nz);
    accumulateNormal(normals, b, nx, ny, nz);
    accumulateNormal(normals, c, nx, ny, nz);
  }

  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!);
    if (length > 0) {
      normals[i] = normals[i]! / length;
      normals[i + 1] = normals[i + 1]! / length;
      normals[i + 2] = normals[i + 2]! / length;
    }
  }

  return normals;
}

export function createSweepSections(
  frames: PathFrames,
  options: CreateSweepSectionsOptions
): SweepSection[] {
  const sections: SweepSection[] = [];

  for (let i = 0; i < frames.points.length; i++) {
    const sourceWidthScale = frames.widthScales[i]!;
    const widthScale = options.sanitizeWidthScale ? normalizeScale(sourceWidthScale) : sourceWidthScale;
    const sharp = frames.sharps[i] ?? false;
    sections.push({
      point: frames.points[i]!,
      tangent: frames.tangents[i]!,
      normal: frames.normals[i]!,
      binormal: frames.binormals[i]!,
      bisector: frames.bisectors[i]!,
      length: finiteOrDefault(frames.lengths[i], 0),
      widthScale,
      sharp,
      uniformScale: options.scaleNonSharp && !sharp ? widthScale : 1
    });
  }

  return sections;
}

export function createLinearSweepSections(depth: number): SweepSection[] {
  const tangent = vec3.fromValues(0, 0, -1);
  const normal = vec3.fromValues(0, 1, 0);
  const binormal = vec3.fromValues(1, 0, 0);
  const bisector = vec3.fromValues(1, 0, 0);

  return [
    {
      point: vec3.fromValues(0, 0, 0),
      tangent,
      normal,
      binormal,
      bisector,
      length: 0,
      widthScale: 1,
      sharp: false,
      uniformScale: 1
    },
    {
      point: vec3.fromValues(0, 0, -depth),
      tangent,
      normal,
      binormal,
      bisector,
      length: Math.abs(depth),
      widthScale: 1,
      sharp: false,
      uniformScale: 1
    }
  ];
}

export function createSweep(
  profile: SweepProfile,
  sections: SweepSection[],
  options: SweepOptions
): GeometryData {
  const geometry = createGeometry();
  const loopMetrics = profile.loops.map(createLoopMetrics);

  if (sections.length === 0 || profile.loops.length === 0) return geometry;

  const flipWinding = options.flipWinding ?? false;
  const analyticNormals = options.normalMode === 'profile';
  if (options.sideLayout === 'shared') {
    addSharedSides(geometry, profile, sections, loopMetrics, flipWinding, analyticNormals, options.attributeSink);
  } else {
    addEdgeIsolatedSides(geometry, profile, sections, loopMetrics, flipWinding, analyticNormals, options.attributeSink);
  }

  const capData = options.startCap || options.endCap ? createCapProfileData(profile) : { points: [], triangles: [] };
  if (options.startCap) {
    addCap(geometry, profile, sections, loopMetrics, capData, 'start-cap', flipWinding, analyticNormals, options.attributeSink);
  }
  if (options.endCap) {
    addCap(geometry, profile, sections, loopMetrics, capData, 'end-cap', flipWinding, analyticNormals, options.attributeSink);
  }

  if (options.normalMode === 'mesh') {
    geometry.normals = computeMeshNormals(geometry.positions, geometry.indices);
  }

  return geometry;
}
