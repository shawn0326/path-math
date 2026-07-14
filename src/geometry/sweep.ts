import type { GeometryData, PathFrames } from '../types';
import type { ReadonlyVector, Vector3 } from '../vector';
import { triangulate } from './earcut';
import { createCornerSections, scaleAlong, setCornerNormalAxes } from './corner';
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

const SECTION_EXPANDED = 0;
const SECTION_FRAMES = 1;
const SECTION_LINEAR = 2;
const REGULAR_SCALE_AXIS = 0;
const REGULAR_SCALE_UNIFORM = 1;
const REGULAR_SCALE_NONE = 2;
const ATTRIBUTE_CUSTOM = 0;
const ATTRIBUTE_TUBE = 1;
const ATTRIBUTE_EXTRUDE_LINEAR = 2;
const ATTRIBUTE_EXTRUDE_PATH = 3;
const SURFACE_SIDE = 0;
const SURFACE_START_CAP = 1;
const SURFACE_END_CAP = 2;

type SectionKind = typeof SECTION_EXPANDED | typeof SECTION_FRAMES | typeof SECTION_LINEAR;
type RegularScaleMode = typeof REGULAR_SCALE_AXIS | typeof REGULAR_SCALE_UNIFORM | typeof REGULAR_SCALE_NONE;
type AttributeKind = typeof ATTRIBUTE_CUSTOM | typeof ATTRIBUTE_TUBE |
  typeof ATTRIBUTE_EXTRUDE_LINEAR | typeof ATTRIBUTE_EXTRUDE_PATH;
type SurfaceCode = typeof SURFACE_SIDE | typeof SURFACE_START_CAP | typeof SURFACE_END_CAP;

export interface SweepSectionSource {
  kind: SectionKind;
  count: number;
  frames: PathFrames | null;
  sections: SweepSection[] | null;
  depth: number;
  regularScaleMode: RegularScaleMode;
  sanitizeWidthScale: boolean;
}

export interface SweepAttributeProgram {
  kind: AttributeKind;
  radialSegments: number;
  circumference: number;
  totalLength: number;
  negativeDepth: boolean;
  writeUvs2: boolean;
  customSink: SweepAttributeSink | null;
}

export interface SweepOptions {
  sideLayout: SweepSideLayout;
  normalMode: SweepNormalMode;
  startCap: boolean;
  endCap: boolean;
  flipWinding?: boolean;
  generateNormals?: boolean;
  attributes?: SweepAttributeProgram;
  /** Internal compatibility hook for direct Sweep tests. Geometry builders use `attributes`. */
  attributeSink?: SweepAttributeSink;
}

interface SweepLoopMetrics {
  cumulativeLengths: number[];
  totalLength: number;
  edgeCount: number;
  profileNormals: number[];
}

export interface CreateSweepSectionsOptions {
  cornerTransition: boolean;
  sanitizeWidthScale: boolean;
  regularScaleMode?: 'axis' | 'uniform' | 'none';
}

interface ResolvedSection {
  origin: Vector3;
  tangent: Vector3;
  xAxis: Vector3;
  yAxis: Vector3;
  normalX: Vector3;
  normalY: Vector3;
  length: number;
  collapsePrevious: boolean;
}

interface CapProfileData {
  loopIndices: number[];
  pointIndices: number[];
  triangles: number[];
}

function createGeometry(): GeometryData {
  return { positions: [], normals: [], uvs: [], uvs2: [], indices: [] };
}

function finiteOrDefault(value: number | undefined, defaultValue: number): number {
  return value !== undefined && Number.isFinite(value) ? value : defaultValue;
}

function normalizeScale(value: number | undefined): number {
  const scale = finiteOrDefault(value, 1);
  return Math.abs(scale) < 1e-12 ? 1 : scale;
}

function resolveRegularScaleMode(value: CreateSweepSectionsOptions['regularScaleMode']): RegularScaleMode {
  if (value === 'uniform') return REGULAR_SCALE_UNIFORM;
  if (value === 'none') return REGULAR_SCALE_NONE;
  return REGULAR_SCALE_AXIS;
}

function createResolvedSection(): ResolvedSection {
  return {
    origin: [0, 0, 0], tangent: [0, 0, 0], xAxis: [0, 0, 0], yAxis: [0, 0, 0],
    normalX: [0, 0, 0], normalY: [0, 0, 0], length: 0, collapsePrevious: false
  };
}

function copyVector(out: Vector3, value: ReadonlyVector): void {
  out[0] = value[0]!;
  out[1] = value[1]!;
  out[2] = value[2]!;
}

function scaleVector(out: Vector3, value: ReadonlyVector, scale: number): void {
  out[0] = value[0]! * scale;
  out[1] = value[1]! * scale;
  out[2] = value[2]! * scale;
}

function resolveSection(
  out: ResolvedSection,
  source: SweepSectionSource,
  index: number,
  includeNormalAxes: boolean
): void {
  if (source.kind === SECTION_EXPANDED) {
    const section = source.sections![index]!;
    copyVector(out.origin, section.origin);
    copyVector(out.tangent, section.tangent);
    copyVector(out.xAxis, section.xAxis);
    copyVector(out.yAxis, section.yAxis);
    if (includeNormalAxes) {
      copyVector(out.normalX, section.normalX);
      copyVector(out.normalY, section.normalY);
    }
    out.length = section.length;
    out.collapsePrevious = section.collapsePrevious;
    return;
  }

  if (source.kind === SECTION_LINEAR) {
    out.origin[0] = 0;
    out.origin[1] = 0;
    out.origin[2] = index === 0 ? 0 : -source.depth;
    out.tangent[0] = 0;
    out.tangent[1] = 0;
    out.tangent[2] = -1;
    out.xAxis[0] = 1;
    out.xAxis[1] = 0;
    out.xAxis[2] = 0;
    out.yAxis[0] = 0;
    out.yAxis[1] = 1;
    out.yAxis[2] = 0;
    if (includeNormalAxes) {
      copyVector(out.normalX, out.xAxis);
      copyVector(out.normalY, out.yAxis);
    }
    out.length = index === 0 ? 0 : Math.abs(source.depth);
    out.collapsePrevious = false;
    return;
  }

  const frames = source.frames!;
  const point = frames.points[index]!;
  const tangent = frames.tangents[index]!;
  const normal = frames.normals[index]!;
  const binormal = frames.binormals[index]!;
  const bisector = frames.bisectors[index]!;
  const rawWidthScale = frames.widthScales[index];
  const widthScale = source.sanitizeWidthScale ? normalizeScale(rawWidthScale) : rawWidthScale as number;
  const sharp = frames.sharps[index] ?? false;

  copyVector(out.origin, point);
  copyVector(out.tangent, tangent);
  if (sharp || source.regularScaleMode === REGULAR_SCALE_AXIS) {
    scaleAlong(out.xAxis, binormal, bisector, widthScale);
    scaleAlong(out.yAxis, normal, bisector, widthScale);
  } else if (source.regularScaleMode === REGULAR_SCALE_UNIFORM) {
    scaleVector(out.xAxis, binormal, widthScale);
    scaleVector(out.yAxis, normal, widthScale);
  } else {
    copyVector(out.xAxis, binormal);
    copyVector(out.yAxis, normal);
  }

  if (includeNormalAxes) {
    if (sharp || source.regularScaleMode === REGULAR_SCALE_AXIS) {
      setCornerNormalAxes(
        out.normalX, out.normalY, out.xAxis, out.yAxis, out.tangent, binormal, normal
      );
    } else {
      copyVector(out.normalX, binormal);
      copyVector(out.normalY, normal);
    }
  }
  out.length = finiteOrDefault(frames.lengths[index], 0);
  out.collapsePrevious = false;
}

function getDistance(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  const x = b[0]! - a[0]!;
  const y = b[1]! - a[1]!;
  return Math.sqrt(x * x + y * y);
}

function createLoopMetrics(loop: SweepProfileLoop, includeProfileNormals: boolean): SweepLoopMetrics {
  const pointCount = loop.points.length;
  const edgeCount = loop.closed ? pointCount : Math.max(0, pointCount - 1);
  const cumulativeLengths = new Array<number>(pointCount).fill(0);
  const profileNormals = includeProfileNormals ? new Array<number>(pointCount * 2) : [];
  let totalLength = 0;
  for (let i = 1; i < pointCount; i++) {
    totalLength += getDistance(loop.points[i - 1]!, loop.points[i]!);
    cumulativeLengths[i] = totalLength;
  }
  if (loop.closed && pointCount > 1) {
    totalLength += getDistance(loop.points[pointCount - 1]!, loop.points[0]!);
  }
  if (includeProfileNormals) {
    for (let pointIndex = 0; pointIndex < pointCount; pointIndex++) {
      writeProfileNormal(profileNormals, pointIndex * 2, loop, pointIndex);
    }
  }
  return { cumulativeLengths, totalLength, edgeCount, profileNormals };
}

function writeProfileNormal(out: number[], offset: number, loop: SweepProfileLoop, pointIndex: number): void {
  const supplied = loop.normals?.[pointIndex];
  if (supplied) {
    const x = supplied[0]!;
    const y = supplied[1]!;
    const length = Math.sqrt(x * x + y * y);
    if (length > 0) {
      out[offset] = x / length;
      out[offset + 1] = y / length;
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
  const previousLength = Math.sqrt(previousX * previousX + previousY * previousY);
  const nextLength = Math.sqrt(nextX * nextX + nextY * nextY);
  const nx = (previousLength > 0 ? -previousY / previousLength : 0) +
    (nextLength > 0 ? -nextY / nextLength : 0);
  const ny = (previousLength > 0 ? previousX / previousLength : 0) +
    (nextLength > 0 ? nextX / nextLength : 0);
  const length = Math.sqrt(nx * nx + ny * ny);
  if (length > 0) {
    out[offset] = nx / length;
    out[offset + 1] = ny / length;
  } else {
    out[offset] = 0;
    out[offset + 1] = 0;
  }
}

function surfaceName(surface: SurfaceCode): SweepSurface {
  if (surface === SURFACE_START_CAP) return 'start-cap';
  if (surface === SURFACE_END_CAP) return 'end-cap';
  return 'side';
}

function writeAttributes(
  geometry: GeometryData,
  program: SweepAttributeProgram,
  surface: SurfaceCode,
  section: ResolvedSection,
  sectionIndex: number,
  loopIndex: number,
  pointIndex: number,
  profileStep: number,
  profileDistance: number,
  point: ReadonlyArray<number>
): void {
  if (program.kind === ATTRIBUTE_TUBE) {
    const uvU = program.circumference > 0 ? section.length / program.circumference : 0;
    let uvV = profileStep / program.radialSegments;
    if (surface === SURFACE_END_CAP && pointIndex === 0) uvV = 1;
    geometry.uvs.push(uvU, uvV);
    if (program.writeUvs2) {
      const uvU2 = program.totalLength > 0 ? section.length / program.totalLength : 0;
      geometry.uvs2.push(uvU2, uvV);
    }
    return;
  }

  if (program.kind === ATTRIBUTE_EXTRUDE_LINEAR || program.kind === ATTRIBUTE_EXTRUDE_PATH) {
    let u: number;
    let v: number;
    if (surface === SURFACE_SIDE) {
      u = -profileDistance;
      v = program.kind === ATTRIBUTE_EXTRUDE_PATH ? -section.length : section.origin[2]!;
    } else if (surface === SURFACE_START_CAP) {
      u = program.negativeDepth ? -point[0]! : point[0]!;
      v = point[1]!;
    } else {
      u = program.negativeDepth ? point[0]! : -point[0]!;
      v = point[1]!;
    }
    geometry.uvs.push(u, v);
    if (program.writeUvs2) geometry.uvs2.push(u, v);
    return;
  }

  program.customSink?.(
    geometry, surfaceName(surface), sectionIndex, loopIndex, pointIndex, profileStep, profileDistance
  );
}

function addVertex(
  geometry: GeometryData,
  program: SweepAttributeProgram,
  loop: SweepProfileLoop,
  section: ResolvedSection,
  surface: SurfaceCode,
  sectionIndex: number,
  loopIndex: number,
  pointIndex: number,
  profileStep: number,
  profileDistance: number,
  profileNormals: number[],
  analyticNormals: boolean
): void {
  const point = loop.points[pointIndex]!;
  const px = point[0]!;
  const py = point[1]!;
  geometry.positions.push(
    section.origin[0]! + section.xAxis[0]! * px + section.yAxis[0]! * py,
    section.origin[1]! + section.xAxis[1]! * px + section.yAxis[1]! * py,
    section.origin[2]! + section.xAxis[2]! * px + section.yAxis[2]! * py
  );
  if (analyticNormals) {
    const normalOffset = pointIndex * 2;
    const profileNormalX = profileNormals[normalOffset]!;
    const profileNormalY = profileNormals[normalOffset + 1]!;
    const nx = section.normalX[0]! * profileNormalX + section.normalY[0]! * profileNormalY;
    const ny = section.normalX[1]! * profileNormalX + section.normalY[1]! * profileNormalY;
    const nz = section.normalX[2]! * profileNormalX + section.normalY[2]! * profileNormalY;
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (length > 0) geometry.normals.push(nx / length, ny / length, nz / length);
    else geometry.normals.push(0, 0, 0);
  }
  writeAttributes(
    geometry, program, surface, section, sectionIndex, loopIndex,
    pointIndex, profileStep, profileDistance, point
  );
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
  if (!collapseAware) {
    if (flipWinding) {
      geometry.indices.push(
        currentFirst, previousSecond, previousFirst,
        currentFirst, currentSecond, previousSecond
      );
    } else {
      geometry.indices.push(
        currentFirst, previousFirst, previousSecond,
        currentFirst, previousSecond, currentSecond
      );
    }
    return;
  }
  const firstCollapsed = verticesCoincide(geometry.positions, previousFirst, currentFirst);
  const secondCollapsed = verticesCoincide(geometry.positions, previousSecond, currentSecond);
  if (!firstCollapsed) {
    if (flipWinding) geometry.indices.push(currentFirst, previousSecond, previousFirst);
    else geometry.indices.push(currentFirst, previousFirst, previousSecond);
  }
  if (!secondCollapsed) {
    if (flipWinding) geometry.indices.push(currentFirst, currentSecond, previousSecond);
    else geometry.indices.push(currentFirst, previousSecond, currentSecond);
  }
}

function addSharedSides(
  geometry: GeometryData,
  profile: SweepProfile,
  source: SweepSectionSource,
  loopMetrics: SweepLoopMetrics[],
  flipWinding: boolean,
  analyticNormals: boolean,
  program: SweepAttributeProgram
): number {
  const section = createResolvedSection();
  let previousRingStarts = new Array<number>(profile.loops.length).fill(-1);
  let currentRingStarts = new Array<number>(profile.loops.length).fill(-1);
  let vertexCount = 0;
  for (let sectionIndex = 0; sectionIndex < source.count; sectionIndex++) {
    resolveSection(section, source, sectionIndex, analyticNormals);
    for (let loopIndex = 0; loopIndex < profile.loops.length; loopIndex++) {
      const loop = profile.loops[loopIndex]!;
      const metrics = loopMetrics[loopIndex]!;
      const pointCount = loop.points.length;
      const ringVertexCount = pointCount + (loop.closed && pointCount > 0 ? 1 : 0);
      currentRingStarts[loopIndex] = vertexCount;
      for (let profileStep = 0; profileStep < ringVertexCount; profileStep++) {
        const pointIndex = profileStep === pointCount ? 0 : profileStep;
        const profileDistance = profileStep === pointCount
          ? metrics.totalLength
          : metrics.cumulativeLengths[pointIndex]!;
        addVertex(
          geometry, program, loop, section, SURFACE_SIDE, sectionIndex, loopIndex,
          pointIndex, profileStep, profileDistance, metrics.profileNormals, analyticNormals
        );
        vertexCount++;
      }
    }
    if (sectionIndex > 0) {
      for (let loopIndex = 0; loopIndex < profile.loops.length; loopIndex++) {
        const previous = previousRingStarts[loopIndex]!;
        const current = currentRingStarts[loopIndex]!;
        const edgeCount = loopMetrics[loopIndex]!.edgeCount;
        for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex++) {
          connectQuad(
            geometry,
            previous + edgeIndex,
            previous + edgeIndex + 1,
            current + edgeIndex,
            current + edgeIndex + 1,
            flipWinding,
            section.collapsePrevious
          );
        }
      }
    }
    const ringStarts = previousRingStarts;
    previousRingStarts = currentRingStarts;
    currentRingStarts = ringStarts;
  }
  return vertexCount;
}

function addEdgeIsolatedSides(
  geometry: GeometryData,
  profile: SweepProfile,
  source: SweepSectionSource,
  loopMetrics: SweepLoopMetrics[],
  flipWinding: boolean,
  analyticNormals: boolean,
  program: SweepAttributeProgram
): number {
  const section = createResolvedSection();
  let vertexCount = 0;
  for (let loopIndex = 0; loopIndex < profile.loops.length; loopIndex++) {
    const loop = profile.loops[loopIndex]!;
    const metrics = loopMetrics[loopIndex]!;
    const pointCount = loop.points.length;
    for (let edgeIndex = 0; edgeIndex < metrics.edgeCount; edgeIndex++) {
      const firstPointIndex = edgeIndex;
      const secondPointIndex = edgeIndex + 1 < pointCount ? edgeIndex + 1 : 0;
      const firstDistance = metrics.cumulativeLengths[firstPointIndex]!;
      const secondDistance = edgeIndex + 1 < pointCount
        ? metrics.cumulativeLengths[secondPointIndex]!
        : metrics.totalLength;
      let previousFirst = -1;
      let previousSecond = -1;
      for (let sectionIndex = 0; sectionIndex < source.count; sectionIndex++) {
        resolveSection(section, source, sectionIndex, analyticNormals);
        const first = vertexCount++;
        addVertex(
          geometry, program, loop, section, SURFACE_SIDE, sectionIndex, loopIndex,
          firstPointIndex, edgeIndex, firstDistance, metrics.profileNormals, analyticNormals
        );
        const second = vertexCount++;
        addVertex(
          geometry, program, loop, section, SURFACE_SIDE, sectionIndex, loopIndex,
          secondPointIndex, edgeIndex + 1, secondDistance, metrics.profileNormals, analyticNormals
        );
        if (sectionIndex > 0) {
          connectQuad(
            geometry, previousFirst, previousSecond, first, second,
            flipWinding, section.collapsePrevious
          );
        }
        previousFirst = first;
        previousSecond = second;
      }
    }
  }
  return vertexCount;
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
    triangles: profile.capTriangles ?? (closedLoopCount > 0 ? triangulate(vertices!, holeIndices!) : [])
  };
}

function addCap(
  geometry: GeometryData,
  profile: SweepProfile,
  source: SweepSectionSource,
  loopMetrics: SweepLoopMetrics[],
  capData: CapProfileData,
  surface: typeof SURFACE_START_CAP | typeof SURFACE_END_CAP,
  flipWinding: boolean,
  analyticNormals: boolean,
  program: SweepAttributeProgram,
  vertexCount: number
): number {
  if (capData.loopIndices.length === 0 || source.count === 0) return vertexCount;
  const isEnd = surface === SURFACE_END_CAP;
  const sectionIndex = isEnd ? source.count - 1 : 0;
  const section = createResolvedSection();
  resolveSection(section, source, sectionIndex, analyticNormals);
  const tx = section.tangent[0]!;
  const ty = section.tangent[1]!;
  const tz = section.tangent[2]!;
  const tangentLength = Math.sqrt(tx * tx + ty * ty + tz * tz);
  const normalScale = tangentLength > 0 ? (isEnd ? 1 : -1) / tangentLength : 0;
  const capStart = vertexCount;
  for (let i = 0; i < capData.loopIndices.length; i++) {
    const loopIndex = capData.loopIndices[i]!;
    const pointIndex = capData.pointIndices[i]!;
    const loop = profile.loops[loopIndex]!;
    const point = loop.points[pointIndex]!;
    const px = point[0]!;
    const py = point[1]!;
    geometry.positions.push(
      section.origin[0]! + section.xAxis[0]! * px + section.yAxis[0]! * py,
      section.origin[1]! + section.xAxis[1]! * px + section.yAxis[1]! * py,
      section.origin[2]! + section.xAxis[2]! * px + section.yAxis[2]! * py
    );
    if (analyticNormals) geometry.normals.push(tx * normalScale, ty * normalScale, tz * normalScale);
    writeAttributes(
      geometry, program, surface, section, sectionIndex, loopIndex, pointIndex, pointIndex,
      loopMetrics[loopIndex]!.cumulativeLengths[pointIndex]!, point
    );
    vertexCount++;
  }
  const reverse = isEnd !== flipWinding;
  for (let i = 0; i < capData.triangles.length; i += 3) {
    const a = capStart + capData.triangles[i]!;
    const b = capStart + capData.triangles[i + 1]!;
    const c = capStart + capData.triangles[i + 2]!;
    if (reverse) geometry.indices.push(a, c, b);
    else geometry.indices.push(a, b, c);
  }
  return vertexCount;
}

function computeMeshNormals(positions: number[], indices: number[]): number[] {
  const normals = new Array<number>(positions.length).fill(0);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]! * 3;
    const b = indices[i + 1]! * 3;
    const c = indices[i + 2]! * 3;
    const ax = positions[a]!;
    const ay = positions[a + 1]!;
    const az = positions[a + 2]!;
    const abx = positions[b]! - ax;
    const aby = positions[b + 1]! - ay;
    const abz = positions[b + 2]! - az;
    const acx = positions[c]! - ax;
    const acy = positions[c + 1]! - ay;
    const acz = positions[c + 2]! - az;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    normals[a] = normals[a]! + nx;
    normals[a + 1] = normals[a + 1]! + ny;
    normals[a + 2] = normals[a + 2]! + nz;
    normals[b] = normals[b]! + nx;
    normals[b + 1] = normals[b + 1]! + ny;
    normals[b + 2] = normals[b + 2]! + nz;
    normals[c] = normals[c]! + nx;
    normals[c + 1] = normals[c + 1]! + ny;
    normals[c + 2] = normals[c + 2]! + nz;
  }
  for (let i = 0; i < normals.length; i += 3) {
    const x = normals[i]!;
    const y = normals[i + 1]!;
    const z = normals[i + 2]!;
    const length = Math.sqrt(x * x + y * y + z * z);
    if (length > 0) {
      normals[i] = x / length;
      normals[i + 1] = y / length;
      normals[i + 2] = z / length;
    }
  }
  return normals;
}

function createDirectTubeSweep(
  profile: SweepProfile,
  source: SweepSectionSource,
  loopMetrics: SweepLoopMetrics[],
  startCap: boolean,
  endCap: boolean,
  flipWinding: boolean,
  analyticNormals: boolean,
  program: SweepAttributeProgram
): GeometryData {
  const loop = profile.loops[0]!;
  const metrics = loopMetrics[0]!;
  const pointCount = loop.points.length;
  const ringVertexCount = pointCount + (loop.closed && pointCount > 0 ? 1 : 0);
  const capData = startCap || endCap ? createCapProfileData(profile) : null;
  const capCount = (startCap ? 1 : 0) + (endCap ? 1 : 0);
  const capVertexCount = (capData?.loopIndices.length ?? 0) * capCount;
  const sideVertexCount = source.count * ringVertexCount;
  const sideIndexCount = Math.max(0, source.count - 1) * metrics.edgeCount * 6;
  const capIndexCount = (capData?.triangles.length ?? 0) * capCount;
  const vertexTotal = sideVertexCount + capVertexCount;
  const geometry: GeometryData = {
    positions: new Array<number>(vertexTotal * 3),
    normals: analyticNormals ? new Array<number>(vertexTotal * 3) : [],
    uvs: new Array<number>(vertexTotal * 2),
    uvs2: program.writeUvs2 ? new Array<number>(vertexTotal * 2) : [],
    indices: new Array<number>(sideIndexCount + capIndexCount)
  };
  const section = createResolvedSection();
  let vertexCursor = 0;
  let indexCursor = 0;

  for (let sectionIndex = 0; sectionIndex < source.count; sectionIndex++) {
    resolveSection(section, source, sectionIndex, analyticNormals);
    const uvU = program.circumference > 0 ? section.length / program.circumference : 0;
    const uvU2 = program.totalLength > 0 ? section.length / program.totalLength : 0;
    const ringStart = vertexCursor;
    for (let profileStep = 0; profileStep < ringVertexCount; profileStep++) {
      const pointIndex = profileStep === pointCount ? 0 : profileStep;
      const point = loop.points[pointIndex]!;
      const px = point[0]!;
      const py = point[1]!;
      const positionOffset = vertexCursor * 3;
      geometry.positions[positionOffset] = section.origin[0]! + section.xAxis[0]! * px + section.yAxis[0]! * py;
      geometry.positions[positionOffset + 1] = section.origin[1]! + section.xAxis[1]! * px + section.yAxis[1]! * py;
      geometry.positions[positionOffset + 2] = section.origin[2]! + section.xAxis[2]! * px + section.yAxis[2]! * py;

      if (analyticNormals) {
        const profileNormalOffset = pointIndex * 2;
        const profileNormalX = metrics.profileNormals[profileNormalOffset]!;
        const profileNormalY = metrics.profileNormals[profileNormalOffset + 1]!;
        const nx = section.normalX[0]! * profileNormalX + section.normalY[0]! * profileNormalY;
        const ny = section.normalX[1]! * profileNormalX + section.normalY[1]! * profileNormalY;
        const nz = section.normalX[2]! * profileNormalX + section.normalY[2]! * profileNormalY;
        const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
        const normalScale = length > 0 ? 1 / length : 0;
        geometry.normals[positionOffset] = nx * normalScale;
        geometry.normals[positionOffset + 1] = ny * normalScale;
        geometry.normals[positionOffset + 2] = nz * normalScale;
      }

      const uvOffset = vertexCursor * 2;
      const uvV = profileStep / program.radialSegments;
      geometry.uvs[uvOffset] = uvU;
      geometry.uvs[uvOffset + 1] = uvV;
      if (program.writeUvs2) {
        geometry.uvs2[uvOffset] = uvU2;
        geometry.uvs2[uvOffset + 1] = uvV;
      }
      vertexCursor++;
    }

    if (sectionIndex > 0) {
      const previousRingStart = ringStart - ringVertexCount;
      for (let edgeIndex = 0; edgeIndex < metrics.edgeCount; edgeIndex++) {
        const previousFirst = previousRingStart + edgeIndex;
        const previousSecond = previousFirst + 1;
        const currentFirst = ringStart + edgeIndex;
        const currentSecond = currentFirst + 1;
        if (flipWinding) {
          geometry.indices[indexCursor++] = currentFirst;
          geometry.indices[indexCursor++] = previousSecond;
          geometry.indices[indexCursor++] = previousFirst;
          geometry.indices[indexCursor++] = currentFirst;
          geometry.indices[indexCursor++] = currentSecond;
          geometry.indices[indexCursor++] = previousSecond;
        } else {
          geometry.indices[indexCursor++] = currentFirst;
          geometry.indices[indexCursor++] = previousFirst;
          geometry.indices[indexCursor++] = previousSecond;
          geometry.indices[indexCursor++] = currentFirst;
          geometry.indices[indexCursor++] = previousSecond;
          geometry.indices[indexCursor++] = currentSecond;
        }
      }
    }
  }

  for (let pass = 0; pass < 2; pass++) {
    const isEnd = pass === 1;
    if ((isEnd && !endCap) || (!isEnd && !startCap)) continue;
    const sectionIndex = isEnd ? source.count - 1 : 0;
    resolveSection(section, source, sectionIndex, analyticNormals);
    const tx = section.tangent[0]!;
    const ty = section.tangent[1]!;
    const tz = section.tangent[2]!;
    const tangentLength = Math.sqrt(tx * tx + ty * ty + tz * tz);
    const normalScale = tangentLength > 0 ? (isEnd ? 1 : -1) / tangentLength : 0;
    const uvU = program.circumference > 0 ? section.length / program.circumference : 0;
    const uvU2 = program.totalLength > 0 ? section.length / program.totalLength : 0;
    const capStart = vertexCursor;
    for (let i = 0; i < capData!.loopIndices.length; i++) {
      const loopIndex = capData!.loopIndices[i]!;
      const pointIndex = capData!.pointIndices[i]!;
      const point = profile.loops[loopIndex]!.points[pointIndex]!;
      const px = point[0]!;
      const py = point[1]!;
      const positionOffset = vertexCursor * 3;
      geometry.positions[positionOffset] = section.origin[0]! + section.xAxis[0]! * px + section.yAxis[0]! * py;
      geometry.positions[positionOffset + 1] = section.origin[1]! + section.xAxis[1]! * px + section.yAxis[1]! * py;
      geometry.positions[positionOffset + 2] = section.origin[2]! + section.xAxis[2]! * px + section.yAxis[2]! * py;
      if (analyticNormals) {
        geometry.normals[positionOffset] = tx * normalScale;
        geometry.normals[positionOffset + 1] = ty * normalScale;
        geometry.normals[positionOffset + 2] = tz * normalScale;
      }
      const uvOffset = vertexCursor * 2;
      const uvV = isEnd && pointIndex === 0 ? 1 : pointIndex / program.radialSegments;
      geometry.uvs[uvOffset] = uvU;
      geometry.uvs[uvOffset + 1] = uvV;
      if (program.writeUvs2) {
        geometry.uvs2[uvOffset] = uvU2;
        geometry.uvs2[uvOffset + 1] = uvV;
      }
      vertexCursor++;
    }
    const reverse = isEnd !== flipWinding;
    for (let i = 0; i < capData!.triangles.length; i += 3) {
      const a = capStart + capData!.triangles[i]!;
      const b = capStart + capData!.triangles[i + 1]!;
      const c = capStart + capData!.triangles[i + 2]!;
      geometry.indices[indexCursor++] = a;
      geometry.indices[indexCursor++] = reverse ? c : b;
      geometry.indices[indexCursor++] = reverse ? b : c;
    }
  }
  return geometry;
}

function createDirectExtrudeSweep(
  profile: SweepProfile,
  source: SweepSectionSource,
  loopMetrics: SweepLoopMetrics[],
  startCap: boolean,
  endCap: boolean,
  flipWinding: boolean,
  generateNormals: boolean,
  program: SweepAttributeProgram
): GeometryData {
  let edgeCount = 0;
  for (let i = 0; i < loopMetrics.length; i++) edgeCount += loopMetrics[i]!.edgeCount;
  const capData = startCap || endCap ? createCapProfileData(profile) : null;
  const capCount = (startCap ? 1 : 0) + (endCap ? 1 : 0);
  const sideVertexCount = edgeCount * source.count * 2;
  const capVertexCount = (capData?.loopIndices.length ?? 0) * capCount;
  const sideIndexCount = edgeCount * Math.max(0, source.count - 1) * 6;
  const capIndexCount = (capData?.triangles.length ?? 0) * capCount;
  const vertexTotal = sideVertexCount + capVertexCount;
  const positions = new Array<number>(vertexTotal * 3);
  const uvs = new Array<number>(vertexTotal * 2);
  const indices = new Array<number>(sideIndexCount + capIndexCount);
  const section = createResolvedSection();
  const linearSource = source.kind === SECTION_LINEAR;
  let vertexCursor = 0;
  let indexCursor = 0;

  for (let loopIndex = 0; loopIndex < profile.loops.length; loopIndex++) {
    const loop = profile.loops[loopIndex]!;
    const points = loop.points;
    const pointCount = points.length;
    const metrics = loopMetrics[loopIndex]!;
    const distances = metrics.cumulativeLengths;
    for (let edgeIndex = 0; edgeIndex < metrics.edgeCount; edgeIndex++) {
      const firstPointIndex = edgeIndex;
      const secondPointIndex = edgeIndex + 1 < pointCount ? edgeIndex + 1 : 0;
      const firstPoint = points[firstPointIndex]!;
      const secondPoint = points[secondPointIndex]!;
      const firstX = firstPoint[0]!;
      const firstY = firstPoint[1]!;
      const secondX = secondPoint[0]!;
      const secondY = secondPoint[1]!;
      const firstU = -distances[firstPointIndex]!;
      const secondU = -(edgeIndex + 1 < pointCount
        ? distances[secondPointIndex]!
        : metrics.totalLength);
      let previousFirst = -1;
      let previousSecond = -1;

      for (let sectionIndex = 0; sectionIndex < source.count; sectionIndex++) {
        const first = vertexCursor++;
        const second = vertexCursor++;
        let v: number;
        let positionOffset = first * 3;
        if (linearSource) {
          const z = sectionIndex === 0 ? 0 : -source.depth;
          positions[positionOffset] = firstX;
          positions[positionOffset + 1] = firstY;
          positions[positionOffset + 2] = z;
          positionOffset = second * 3;
          positions[positionOffset] = secondX;
          positions[positionOffset + 1] = secondY;
          positions[positionOffset + 2] = z;
          v = z;
        } else {
          resolveSection(section, source, sectionIndex, false);
          const ox = section.origin[0]!;
          const oy = section.origin[1]!;
          const oz = section.origin[2]!;
          const xx = section.xAxis[0]!;
          const xy = section.xAxis[1]!;
          const xz = section.xAxis[2]!;
          const yx = section.yAxis[0]!;
          const yy = section.yAxis[1]!;
          const yz = section.yAxis[2]!;
          positions[positionOffset] = ox + xx * firstX + yx * firstY;
          positions[positionOffset + 1] = oy + xy * firstX + yy * firstY;
          positions[positionOffset + 2] = oz + xz * firstX + yz * firstY;
          positionOffset = second * 3;
          positions[positionOffset] = ox + xx * secondX + yx * secondY;
          positions[positionOffset + 1] = oy + xy * secondX + yy * secondY;
          positions[positionOffset + 2] = oz + xz * secondX + yz * secondY;
          v = -section.length;
        }

        let uvOffset = first * 2;
        uvs[uvOffset] = firstU;
        uvs[uvOffset + 1] = v;
        uvOffset = second * 2;
        uvs[uvOffset] = secondU;
        uvs[uvOffset + 1] = v;
        if (sectionIndex > 0) {
          if (flipWinding) {
            indices[indexCursor++] = first;
            indices[indexCursor++] = previousSecond;
            indices[indexCursor++] = previousFirst;
            indices[indexCursor++] = first;
            indices[indexCursor++] = second;
            indices[indexCursor++] = previousSecond;
          } else {
            indices[indexCursor++] = first;
            indices[indexCursor++] = previousFirst;
            indices[indexCursor++] = previousSecond;
            indices[indexCursor++] = first;
            indices[indexCursor++] = previousSecond;
            indices[indexCursor++] = second;
          }
        }
        previousFirst = first;
        previousSecond = second;
      }
    }
  }

  for (let pass = 0; pass < 2; pass++) {
    const isEnd = pass === 1;
    if ((isEnd && !endCap) || (!isEnd && !startCap)) continue;
    const sectionIndex = isEnd ? source.count - 1 : 0;
    if (!linearSource) resolveSection(section, source, sectionIndex, false);
    const capStart = vertexCursor;
    for (let i = 0; i < capData!.loopIndices.length; i++) {
      const loopIndex = capData!.loopIndices[i]!;
      const pointIndex = capData!.pointIndices[i]!;
      const point = profile.loops[loopIndex]!.points[pointIndex]!;
      const px = point[0]!;
      const py = point[1]!;
      const positionOffset = vertexCursor * 3;
      if (linearSource) {
        positions[positionOffset] = px;
        positions[positionOffset + 1] = py;
        positions[positionOffset + 2] = isEnd ? -source.depth : 0;
      } else {
        positions[positionOffset] = section.origin[0]! + section.xAxis[0]! * px + section.yAxis[0]! * py;
        positions[positionOffset + 1] = section.origin[1]! + section.xAxis[1]! * px + section.yAxis[1]! * py;
        positions[positionOffset + 2] = section.origin[2]! + section.xAxis[2]! * px + section.yAxis[2]! * py;
      }
      const uvOffset = vertexCursor * 2;
      const u = isEnd
        ? (program.negativeDepth ? px : -px)
        : (program.negativeDepth ? -px : px);
      uvs[uvOffset] = u;
      uvs[uvOffset + 1] = py;
      vertexCursor++;
    }
    const reverse = isEnd !== flipWinding;
    for (let i = 0; i < capData!.triangles.length; i += 3) {
      const a = capStart + capData!.triangles[i]!;
      const b = capStart + capData!.triangles[i + 1]!;
      const c = capStart + capData!.triangles[i + 2]!;
      indices[indexCursor++] = a;
      indices[indexCursor++] = reverse ? c : b;
      indices[indexCursor++] = reverse ? b : c;
    }
  }

  return {
    positions,
    normals: generateNormals ? computeMeshNormals(positions, indices) : [],
    uvs,
    uvs2: program.writeUvs2 ? uvs.slice() : [],
    indices
  };
}

function expandedSectionSource(sections: SweepSection[]): SweepSectionSource {
  return {
    kind: SECTION_EXPANDED, count: sections.length, frames: null, sections, depth: 0,
    regularScaleMode: REGULAR_SCALE_AXIS, sanitizeWidthScale: false
  };
}

function normalizeSectionSource(source: SweepSectionSource | SweepSection[]): SweepSectionSource {
  return Array.isArray(source) ? expandedSectionSource(source) : source;
}

export function createSweepSectionSource(
  profile: SweepProfile,
  frames: PathFrames,
  options: CreateSweepSectionsOptions
): SweepSectionSource {
  if (options.cornerTransition) {
    return expandedSectionSource(createCornerSections(
      frames,
      profile.loops.map(loop => loop.points),
      {
        cornerTransition: true,
        resolveWidthScale: options.sanitizeWidthScale ? normalizeScale : value => value as number
      }
    ));
  }
  return {
    kind: SECTION_FRAMES,
    count: frames.points.length,
    frames,
    sections: null,
    depth: 0,
    regularScaleMode: resolveRegularScaleMode(options.regularScaleMode),
    sanitizeWidthScale: options.sanitizeWidthScale
  };
}

export function createLinearSweepSource(depth: number): SweepSectionSource {
  return {
    kind: SECTION_LINEAR, count: 2, frames: null, sections: null, depth,
    regularScaleMode: REGULAR_SCALE_NONE, sanitizeWidthScale: false
  };
}

export function createTubeSweepAttributes(
  radialSegments: number,
  circumference: number,
  totalLength: number
): SweepAttributeProgram {
  return {
    kind: ATTRIBUTE_TUBE, radialSegments, circumference, totalLength,
    negativeDepth: false, writeUvs2: true, customSink: null
  };
}

export function createExtrudeSweepAttributes(
  pathMode: boolean,
  negativeDepth: boolean,
  writeUvs2: boolean
): SweepAttributeProgram {
  return {
    kind: pathMode ? ATTRIBUTE_EXTRUDE_PATH : ATTRIBUTE_EXTRUDE_LINEAR,
    radialSegments: 0,
    circumference: 0,
    totalLength: 0,
    negativeDepth,
    writeUvs2,
    customSink: null
  };
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
      resolveWidthScale: options.sanitizeWidthScale ? normalizeScale : value => value as number
    }
  );
}

export function createLinearSweepSections(depth: number): SweepSection[] {
  const tangent = [0, 0, -1];
  const normal = [0, 1, 0];
  const binormal = [1, 0, 0];
  return [
    {
      origin: [0, 0, 0], tangent, xAxis: binormal, yAxis: normal,
      normalX: binormal, normalY: normal, length: 0, sourceFrameIndex: 0,
      role: 'regular', collapsePrevious: false
    },
    {
      origin: [0, 0, -depth], tangent, xAxis: binormal, yAxis: normal,
      normalX: binormal, normalY: normal, length: Math.abs(depth), sourceFrameIndex: 1,
      role: 'regular', collapsePrevious: false
    }
  ];
}

function createCustomAttributes(sink: SweepAttributeSink | undefined): SweepAttributeProgram {
  return {
    kind: ATTRIBUTE_CUSTOM, radialSegments: 0, circumference: 0, totalLength: 0,
    negativeDepth: false, writeUvs2: true, customSink: sink ?? null
  };
}

export function createSweep(
  profile: SweepProfile,
  sectionInput: SweepSectionSource | SweepSection[],
  options: SweepOptions
): GeometryData {
  const geometry = createGeometry();
  const source = normalizeSectionSource(sectionInput);
  if (source.count === 0 || profile.loops.length === 0) return geometry;
  const generateNormals = options.generateNormals ?? true;
  const analyticNormals = options.normalMode === 'profile' && generateNormals;
  const flipWinding = options.flipWinding ?? false;
  const program = options.attributes ?? createCustomAttributes(options.attributeSink);
  const loopMetrics = profile.loops.map(loop => createLoopMetrics(loop, analyticNormals));
  if (
    source.kind !== SECTION_EXPANDED &&
    program.kind === ATTRIBUTE_TUBE &&
    options.sideLayout === 'shared' &&
    options.normalMode === 'profile' &&
    profile.loops.length === 1
  ) {
    return createDirectTubeSweep(
      profile, source, loopMetrics, options.startCap, options.endCap,
      flipWinding, analyticNormals, program
    );
  }
  if (
    source.kind !== SECTION_EXPANDED &&
    (program.kind === ATTRIBUTE_EXTRUDE_LINEAR || program.kind === ATTRIBUTE_EXTRUDE_PATH) &&
    options.sideLayout === 'edge-isolated' &&
    options.normalMode === 'mesh'
  ) {
    return createDirectExtrudeSweep(
      profile, source, loopMetrics, options.startCap, options.endCap,
      flipWinding, generateNormals, program
    );
  }
  let vertexCount = options.sideLayout === 'shared'
    ? addSharedSides(geometry, profile, source, loopMetrics, flipWinding, analyticNormals, program)
    : addEdgeIsolatedSides(geometry, profile, source, loopMetrics, flipWinding, analyticNormals, program);
  const capData = options.startCap || options.endCap ? createCapProfileData(profile) : null;
  if (options.startCap) {
    vertexCount = addCap(
      geometry, profile, source, loopMetrics, capData!, SURFACE_START_CAP,
      flipWinding, analyticNormals, program, vertexCount
    );
  }
  if (options.endCap) {
    addCap(
      geometry, profile, source, loopMetrics, capData!, SURFACE_END_CAP,
      flipWinding, analyticNormals, program, vertexCount
    );
  }
  if (options.normalMode === 'mesh' && generateNormals) {
    geometry.normals = computeMeshNormals(geometry.positions, geometry.indices);
  }
  return geometry;
}
