import { vec3 } from '../vector';
import type { ReadonlyVector, Vector3 } from '../vector';
import type { GeometryData, PathFrames } from '../types';
import { triangulate } from './earcut';
import {
  createCornerSections,
  transformCornerNormalComponents,
  transformCornerPoint
} from './corner';
import type { CornerSection } from './corner';

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

export type SweepSection = CornerSection;

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
  profileNormals: number[] | null;
}

export interface CreateSweepSectionsOptions {
  cornerTransition: boolean;
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

function pushVec3(target: number[], value: ReadonlyVector): void {
  target.push(value[0]!, value[1]!, value[2]!);
}

function getDistance(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  return Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);
}

function createLoopMetrics(loop: SweepProfileLoop, includeProfileNormals: boolean): SweepLoopMetrics {
  const pointCount = loop.points.length;
  const edgeCount = loop.closed ? pointCount : Math.max(0, pointCount - 1);
  const cumulativeLengths = new Array<number>(pointCount).fill(0);
  const profileNormals = includeProfileNormals ? new Array<number>(pointCount * 2) : null;
  let totalLength = 0;

  for (let i = 1; i < pointCount; i++) {
    totalLength += getDistance(loop.points[i - 1]!, loop.points[i]!);
    cumulativeLengths[i] = totalLength;
  }

  if (loop.closed && pointCount > 1) {
    totalLength += getDistance(loop.points[pointCount - 1]!, loop.points[0]!);
  }

  if (profileNormals) {
    for (let pointIndex = 0; pointIndex < pointCount; pointIndex++) {
      writeProfileNormal(profileNormals, pointIndex * 2, loop, pointIndex);
    }
  }

  return { cumulativeLengths, totalLength, edgeCount, profileNormals };
}

function writeProfileNormal(
  out: number[],
  offset: number,
  loop: SweepProfileLoop,
  pointIndex: number
): void {
  const supplied = loop.normals?.[pointIndex];
  if (supplied) {
    const length = Math.hypot(supplied[0]!, supplied[1]!);
    if (length > 0) {
      out[offset] = supplied[0]! / length;
      out[offset + 1] = supplied[1]! / length;
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
    out[offset] = nx / length;
    out[offset + 1] = ny / length;
  } else {
    out[offset] = 0;
    out[offset + 1] = 0;
  }
}

function transformPoint(
  out: Vector3,
  section: SweepSection,
  point: ReadonlyArray<number>
): Vector3 {
  return transformCornerPoint(out, section, point);
}

function transformNormal(
  out: Vector3,
  section: SweepSection,
  profileNormalX: number,
  profileNormalY: number
): Vector3 {
  return transformCornerNormalComponents(out, section, profileNormalX, profileNormalY);
}

function pushTriangle(indices: number[], a: number, b: number, c: number, flip: boolean): void {
  if (flip) indices.push(a, c, b);
  else indices.push(a, b, c);
}

function verticesCoincide(positions: number[], first: number, second: number): boolean {
  const firstOffset = first * 3;
  const secondOffset = second * 3;
  const dx = positions[firstOffset]! - positions[secondOffset]!;
  const dy = positions[firstOffset + 1]! - positions[secondOffset + 1]!;
  const dz = positions[firstOffset + 2]! - positions[secondOffset + 2]!;
  return dx * dx + dy * dy + dz * dz <= 1e-20;
}

function connectQuad(
  geometry: GeometryData,
  previousFirst: number,
  previousSecond: number,
  currentFirst: number,
  currentSecond: number,
  flipWinding: boolean,
  collapseAware: boolean
): void {
  const firstCollapsed = collapseAware && verticesCoincide(
    geometry.positions,
    previousFirst,
    currentFirst
  );
  const secondCollapsed = collapseAware && verticesCoincide(
    geometry.positions,
    previousSecond,
    currentSecond
  );

  if (!firstCollapsed) {
    pushTriangle(geometry.indices, currentFirst, previousFirst, previousSecond, flipWinding);
  }
  if (!secondCollapsed) {
    pushTriangle(geometry.indices, currentFirst, previousSecond, currentSecond, flipWinding);
  }
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
  profileNormals: number[] | null,
  attributeSink: SweepAttributeSink,
  position: Vector3,
  normal: Vector3
): number {
  const loop = profile.loops[loopIndex]!;
  const point = loop.points[pointIndex]!;
  const section = sections[sectionIndex]!;

  transformPoint(position, section, point);
  pushVec3(geometry.positions, position);

  if (profileNormals) {
    const normalOffset = pointIndex * 2;
    transformNormal(
      normal,
      section,
      profileNormals[normalOffset]!,
      profileNormals[normalOffset + 1]!
    );
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
  attributeSink: SweepAttributeSink
): void {
  const position = vec3.create();
  const normal = vec3.create();
  let previousRingStarts = new Array<number>(profile.loops.length).fill(-1);
  let currentRingStarts = new Array<number>(profile.loops.length).fill(-1);

  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
    for (let loopIndex = 0; loopIndex < profile.loops.length; loopIndex++) {
      const loop = profile.loops[loopIndex]!;
      const metrics = loopMetrics[loopIndex]!;
      const vertexCount = loop.points.length + (loop.closed && loop.points.length > 0 ? 1 : 0);
      currentRingStarts[loopIndex] = geometry.positions.length / 3;

      for (let profileStep = 0; profileStep < vertexCount; profileStep++) {
        const pointIndex = profileStep === loop.points.length ? 0 : profileStep;
        const profileDistance = profileStep === loop.points.length
          ? metrics.totalLength
          : metrics.cumulativeLengths[pointIndex]!;
        addVertex(
          geometry,
          profile,
          sections,
          'side',
          sectionIndex,
          loopIndex,
          pointIndex,
          profileStep,
          profileDistance,
          metrics.profileNormals,
          attributeSink,
          position,
          normal
        );
      }
    }

    if (sectionIndex > 0) {
      for (let loopIndex = 0; loopIndex < profile.loops.length; loopIndex++) {
        const previous = previousRingStarts[loopIndex]!;
        const current = currentRingStarts[loopIndex]!;
        const edgeCount = loopMetrics[loopIndex]!.edgeCount;
        const collapseAware = sections[sectionIndex]!.collapsePrevious;

        for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex++) {
          connectQuad(
            geometry,
            previous + edgeIndex,
            previous + edgeIndex + 1,
            current + edgeIndex,
            current + edgeIndex + 1,
            flipWinding,
            collapseAware
          );
        }
      }
    }

    const ringStarts = previousRingStarts;
    previousRingStarts = currentRingStarts;
    currentRingStarts = ringStarts;
  }
}

function addEdgeIsolatedSides(
  geometry: GeometryData,
  profile: SweepProfile,
  sections: SweepSection[],
  loopMetrics: SweepLoopMetrics[],
  flipWinding: boolean,
  attributeSink: SweepAttributeSink
): void {
  const position = vec3.create();
  const normal = vec3.create();

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
          metrics.profileNormals,
          attributeSink,
          position,
          normal
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
          metrics.profileNormals,
          attributeSink,
          position,
          normal
        );

        if (sectionIndex > 0) {
          connectQuad(
            geometry,
            previousFirst,
            previousSecond,
            first,
            second,
            flipWinding,
            sections[sectionIndex]!.collapsePrevious
          );
        }

        previousFirst = first;
        previousSecond = second;
      }
    }
  }
}

interface CapProfileData {
  loopIndices: number[];
  pointIndices: number[];
  triangles: number[];
}

function createCapProfileData(profile: SweepProfile): CapProfileData {
  const shouldTriangulate = profile.capTriangles === undefined;
  const vertices: number[] | null = shouldTriangulate ? [] : null;
  const holeIndices: number[] | null = shouldTriangulate ? [] : null;
  const loopIndices: number[] = [];
  const pointIndices: number[] = [];
  let closedLoopCount = 0;

  for (let loopIndex = 0; loopIndex < profile.loops.length; loopIndex++) {
    const loop = profile.loops[loopIndex]!;
    if (!loop.closed || loop.points.length < 3) continue;
    if (vertices && holeIndices && closedLoopCount > 0) holeIndices.push(loopIndices.length);
    closedLoopCount++;

    for (let pointIndex = 0; pointIndex < loop.points.length; pointIndex++) {
      const point = loop.points[pointIndex]!;
      if (vertices) vertices.push(point[0]!, point[1]!);
      loopIndices.push(loopIndex);
      pointIndices.push(pointIndex);
    }
  }

  return {
    loopIndices,
    pointIndices,
    triangles: profile.capTriangles ?? (
      closedLoopCount > 0 ? triangulate(vertices!, holeIndices!) : []
    )
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
  if (capData.loopIndices.length === 0 || sections.length === 0) return;

  const isEnd = surface === 'end-cap';
  const sectionIndex = isEnd ? sections.length - 1 : 0;
  const position = vec3.create();
  const capNormal = vec3.create();
  const vertexIndices: number[] = [];
  const section = sections[sectionIndex]!;

  vec3.normalize(capNormal, section.tangent);
  if (!isEnd) vec3.scale(capNormal, capNormal, -1);

  for (let i = 0; i < capData.loopIndices.length; i++) {
    const loopIndex = capData.loopIndices[i]!;
    const pointIndex = capData.pointIndices[i]!;
    const loop = profile.loops[loopIndex]!;
    const point = loop.points[pointIndex]!;
    transformPoint(position, section, point);
    pushVec3(geometry.positions, position);
    if (analyticNormals) pushVec3(geometry.normals, capNormal);

    const profileDistance = loopMetrics[loopIndex]!.cumulativeLengths[pointIndex]!;
    attributeSink(
      geometry,
      surface,
      sectionIndex,
      loopIndex,
      pointIndex,
      pointIndex,
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
  profile: SweepProfile,
  frames: PathFrames,
  options: CreateSweepSectionsOptions
): SweepSection[] {
  return createCornerSections(
    frames,
    profile.loops.map(loop => loop.points),
    {
      cornerTransition: options.cornerTransition,
      resolveWidthScale: options.sanitizeWidthScale
        ? normalizeScale
        : value => value as number
    }
  );
}

export function createLinearSweepSections(depth: number): SweepSection[] {
  const tangent = vec3.fromValues(0, 0, -1);
  const normal = vec3.fromValues(0, 1, 0);
  const binormal = vec3.fromValues(1, 0, 0);

  return [
    {
      origin: vec3.fromValues(0, 0, 0),
      tangent,
      xAxis: binormal,
      yAxis: normal,
      normalX: binormal,
      normalY: normal,
      length: 0,
      sourceFrameIndex: 0,
      role: 'regular',
      collapsePrevious: false
    },
    {
      origin: vec3.fromValues(0, 0, -depth),
      tangent,
      xAxis: binormal,
      yAxis: normal,
      normalX: binormal,
      normalY: normal,
      length: Math.abs(depth),
      sourceFrameIndex: 1,
      role: 'regular',
      collapsePrevious: false
    }
  ];
}

export function createSweep(
  profile: SweepProfile,
  sections: SweepSection[],
  options: SweepOptions
): GeometryData {
  const geometry = createGeometry();

  if (sections.length === 0 || profile.loops.length === 0) return geometry;

  const flipWinding = options.flipWinding ?? false;
  const analyticNormals = options.normalMode === 'profile';
  const loopMetrics = profile.loops.map(loop => createLoopMetrics(loop, analyticNormals));
  if (options.sideLayout === 'shared') {
    addSharedSides(geometry, profile, sections, loopMetrics, flipWinding, options.attributeSink);
  } else {
    addEdgeIsolatedSides(geometry, profile, sections, loopMetrics, flipWinding, options.attributeSink);
  }

  const capData = options.startCap || options.endCap ? createCapProfileData(profile) : null;
  if (options.startCap) {
    addCap(geometry, profile, sections, loopMetrics, capData!, 'start-cap', flipWinding, analyticNormals, options.attributeSink);
  }
  if (options.endCap) {
    addCap(geometry, profile, sections, loopMetrics, capData!, 'end-cap', flipWinding, analyticNormals, options.attributeSink);
  }

  if (options.normalMode === 'mesh') {
    geometry.normals = computeMeshNormals(geometry.positions, geometry.indices);
  }

  return geometry;
}
