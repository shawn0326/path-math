import { vec3 } from '../vector';
import type { ReadonlyVector, Vector3 } from '../vector';
import type { BuildRibbonOptions, GeometryData, RibbonSide, PathFrames } from '../types';
import {
  createCornerSections,
  transformCornerNormal,
  transformCornerPoint
} from './corner';

const DEFAULT_WIDTH = 0.1;

function createGeometry(): GeometryData {
  return { positions: [], normals: [], uvs: [], uvs2: [], indices: [] };
}

function finiteOrDefault(value: number | undefined, defaultValue: number): number {
  return value !== undefined && Number.isFinite(value) ? value : defaultValue;
}

function normalizePositive(value: number | undefined, defaultValue: number): number {
  return Math.max(0, finiteOrDefault(value, defaultValue));
}

function normalizeScale(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? value : 1;
}

function normalizeSide(value: RibbonSide | undefined): RibbonSide {
  return value === 'left' || value === 'right' ? value : 'both';
}

function pushVec3(target: number[], value: ReadonlyVector): void {
  target.push(value[0]!, value[1]!, value[2]!);
}

function pushNormal(target: number[], normal: ReadonlyVector, count: number): void {
  for (let i = 0; i < count; i++) pushVec3(target, normal);
}

function setLength(out: Vector3, value: ReadonlyVector, length: number): Vector3 {
  const currentLength = vec3.length(value);
  if (currentLength <= 0 || !Number.isFinite(currentLength)) {
    vec3.set(out, 0, 0, 0);
    return out;
  }
  return vec3.scale(out, value, length / currentLength);
}

function computeArrowEdge(
  out: Vector3,
  point: ReadonlyVector,
  binormal: ReadonlyVector,
  halfWidth: number,
  sign: number,
  enabled: boolean
): Vector3 {
  if (!enabled) return vec3.copy(out, point);
  return vec3.scaleAndAdd(out, point, binormal, halfWidth * sign);
}

function verticesCoincide(positions: number[], first: number, second: number): boolean {
  const firstOffset = first * 3;
  const secondOffset = second * 3;
  const dx = positions[firstOffset]! - positions[secondOffset]!;
  const dy = positions[firstOffset + 1]! - positions[secondOffset + 1]!;
  const dz = positions[firstOffset + 2]! - positions[secondOffset + 2]!;
  return dx * dx + dy * dy + dz * dz <= 1e-20;
}

function connectPair(
  geometry: GeometryData,
  previousLeft: number,
  previousRight: number,
  currentLeft: number,
  currentRight: number,
  collapseAware: boolean
): void {
  const leftCollapsed = collapseAware && verticesCoincide(
    geometry.positions,
    previousLeft,
    currentLeft
  );
  const rightCollapsed = collapseAware && verticesCoincide(
    geometry.positions,
    previousRight,
    currentRight
  );

  if (!leftCollapsed) geometry.indices.push(currentLeft, previousLeft, previousRight);
  if (!rightCollapsed) geometry.indices.push(currentLeft, previousRight, currentRight);
}

export function createRibbon(frames: PathFrames, options: BuildRibbonOptions = {}): GeometryData {
  const geometry = createGeometry();
  const frameLength = frames.points.length;
  if (frameLength === 0) return geometry;

  const width = normalizePositive(options.width, DEFAULT_WIDTH);
  const halfWidth = width / 2;
  const arrow = options.arrow ?? false;
  const side = normalizeSide(options.side);
  const cornerTransition = options.cornerTransition ?? options.sharp ?? false;
  const sideWidth = side !== 'both' ? halfWidth : width;
  const lastFrameIndex = frameLength - 1;
  const totalLength = frames.lengths[lastFrameIndex] ?? 0;
  const profile = side === 'left'
    ? [[-halfWidth, 0], [0, 0]]
    : side === 'right'
      ? [[0, 0], [halfWidth, 0]]
      : [[-halfWidth, 0], [halfWidth, 0]];
  const sections = createCornerSections(frames, [profile], {
    cornerTransition,
    resolveWidthScale: normalizeScale
  });

  const left = vec3.create();
  const right = vec3.create();
  const normal = vec3.create();
  let previousLeft = -1;
  let previousRight = -1;

  for (const section of sections) {
    transformCornerPoint(left, section, profile[0]!);
    transformCornerPoint(right, section, profile[1]!);
    transformCornerNormal(normal, section, [0, 1]);

    const leftIndex = geometry.positions.length / 3;
    pushVec3(geometry.positions, left);
    const rightIndex = geometry.positions.length / 3;
    pushVec3(geometry.positions, right);
    pushNormal(geometry.normals, normal, 2);

    const uvU = sideWidth > 0 ? section.length / sideWidth : 0;
    const uvU2 = totalLength > 0 ? section.length / totalLength : 0;
    geometry.uvs.push(uvU, 0, uvU, 1);
    geometry.uvs2.push(uvU2, 0, uvU2, 1);

    if (previousLeft >= 0) {
      connectPair(
        geometry,
        previousLeft,
        previousRight,
        leftIndex,
        rightIndex,
        section.collapsePrevious
      );
    }
    previousLeft = leftIndex;
    previousRight = rightIndex;
  }

  if (arrow) {
    const point = frames.points[lastFrameIndex]!;
    const binormal = frames.binormals[lastFrameIndex]!;
    const arrowNormal = frames.normals[lastFrameIndex]!;
    const tangent = frames.tangents[lastFrameIndex]!;
    const length = frames.lengths[lastFrameIndex] ?? 0;
    const uvU = sideWidth > 0 ? length / sideWidth : 0;
    const uvU2 = totalLength > 0 ? length / totalLength : 0;
    const arrowTip = vec3.create();

    computeArrowEdge(left, point, binormal, halfWidth * 2, -1, side !== 'right');
    computeArrowEdge(right, point, binormal, halfWidth * 2, 1, side !== 'left');
    setLength(arrowTip, tangent, halfWidth * 3);
    vec3.add(arrowTip, arrowTip, point);

    const arrowStart = geometry.positions.length / 3;
    pushVec3(geometry.positions, left);
    pushVec3(geometry.positions, right);
    pushVec3(geometry.positions, arrowTip);
    pushNormal(geometry.normals, arrowNormal, 3);
    geometry.uvs.push(
      uvU,
      side !== 'both' ? (side !== 'right' ? -2 : 0) : -0.5,
      uvU,
      side !== 'both' ? (side !== 'left' ? 2 : 0) : 1.5,
      uvU + 1.5,
      side !== 'both' ? 0 : 0.5
    );
    geometry.uvs2.push(
      uvU2,
      side !== 'both' ? (side !== 'right' ? -2 : 0) : -0.5,
      uvU2,
      side !== 'both' ? (side !== 'left' ? 2 : 0) : 1.5,
      uvU2 + (totalLength > 0 ? 1.5 * width / totalLength : 0),
      side !== 'both' ? 0 : 0.5
    );
    geometry.indices.push(arrowStart + 2, arrowStart, arrowStart + 1);
  }

  return geometry;
}
