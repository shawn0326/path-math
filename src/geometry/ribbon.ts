import { vec3 } from '../vector';
import type { ReadonlyVector, Vector3 } from '../vector';
import type { BuildRibbonOptions, GeometryData, RibbonSide, PathFrames } from '../types';

const DEFAULT_WIDTH = 0.1;

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
  for (let i = 0; i < count; i++) {
    pushVec3(target, normal);
  }
}

function readLastVertex(out: Vector3, positions: number[], offsetFromEnd: number): Vector3 {
  const index = positions.length - offsetFromEnd;
  out[0] = positions[index]!;
  out[1] = positions[index + 1]!;
  out[2] = positions[index + 2]!;
  return out;
}

function setLength(out: Vector3, value: ReadonlyVector, length: number): Vector3 {
  const currentLength = vec3.length(value);

  if (currentLength <= 0 || !Number.isFinite(currentLength)) {
    vec3.set(out, 0, 0, 0);
    return out;
  }

  return vec3.scale(out, value, length / currentLength);
}

function computeEdge(
  out: Vector3,
  point: ReadonlyVector,
  binormal: ReadonlyVector,
  halfWidth: number,
  widthScale: number,
  sign: number,
  enabled: boolean
): Vector3 {
  if (!enabled) {
    vec3.copy(out, point);
    return out;
  }

  return vec3.scaleAndAdd(out, point, binormal, halfWidth * widthScale * sign);
}

function pushSimplePair(
  geometry: GeometryData,
  left: ReadonlyVector,
  right: ReadonlyVector,
  normal: ReadonlyVector,
  uvU: number,
  uvU2: number
): void {
  pushVec3(geometry.positions, left);
  pushVec3(geometry.positions, right);
  pushNormal(geometry.normals, normal, 2);
  geometry.uvs.push(uvU, 0, uvU, 1);
  geometry.uvs2.push(uvU2, 0, uvU2, 1);
}

export function createRibbon(frames: PathFrames, options: BuildRibbonOptions = {}): GeometryData {
    const geometry = createGeometry();
    const frameLength = frames.points.length;

    if (frameLength === 0) {
      return geometry;
    }

    const width = normalizePositive(options.width, DEFAULT_WIDTH);
    const halfWidth = width / 2;
    const arrow = options.arrow ?? false;
    const side = normalizeSide(options.side);
    const sharp = options.sharp ?? false;
    const sideWidth = side !== 'both' ? halfWidth : width;
    const lastFrameIndex = frameLength - 1;
    const totalLength = frames.lengths[lastFrameIndex] ?? 0;
    const sharpUvOffset = sideWidth > 0 ? halfWidth / sideWidth : 0;
    const sharpUvOffset2 = totalLength > 0 ? halfWidth / totalLength : 0;

    const left = vec3.create();
    const right = vec3.create();
    const previousLeft = vec3.create();
    const previousRight = vec3.create();
    const leftOffset = vec3.create();
    const rightOffset = vec3.create();
    const longerOffset = vec3.create();
    const cornerPoint = vec3.create();
    const extensionPoint = vec3.create();
    const temp = vec3.create();
    const arrowTip = vec3.create();

    let vertexCount = 0;

    for (let frameIndex = 0; frameIndex < frameLength; frameIndex++) {
      const point = frames.points[frameIndex]!;
      const binormal = frames.binormals[frameIndex]!;
      const normal = frames.normals[frameIndex]!;
      const length = frames.lengths[frameIndex] ?? 0;
      const uvU = sideWidth > 0 ? length / sideWidth : 0;
      const uvU2 = totalLength > 0 ? length / totalLength : 0;
      const widthScale = normalizeScale(frames.widthScales[frameIndex]);

      computeEdge(left, point, binormal, halfWidth, widthScale, -1, side !== 'right');
      computeEdge(right, point, binormal, halfWidth, widthScale, 1, side !== 'left');

      if (sharp && frameIndex > 0 && (frames.sharps[frameIndex] ?? false) && vertexCount >= 2) {
        readLastVertex(previousLeft, geometry.positions, 6);
        readLastVertex(previousRight, geometry.positions, 3);
        vec3.sub(leftOffset, previousLeft, left);
        vec3.sub(rightOffset, previousRight, right);

        const leftDistance = vec3.length(leftOffset);
        const rightDistance = vec3.length(rightOffset);
        const sideOffset = leftDistance - rightDistance;
        const useLeftLongEdge = sideOffset > 0;
        const longEdge = useLeftLongEdge ? left : right;

        vec3.copy(longerOffset, useLeftLongEdge ? leftOffset : rightOffset);
        setLength(cornerPoint, longerOffset, Math.abs(sideOffset));
        vec3.add(cornerPoint, cornerPoint, longEdge);

        vec3.sub(temp, longEdge, cornerPoint);
        const edgeLength = vec3.length(temp);
        const tangent = frames.tangents[frameIndex]!;
        const cosine = edgeLength > 0 ? vec3.dot(setLength(temp, temp, 1), tangent) : 0;
        const extensionDistance = cosine * edgeLength * 2;
        setLength(extensionPoint, tangent, extensionDistance);
        vec3.add(extensionPoint, extensionPoint, cornerPoint);

        if (useLeftLongEdge) {
          pushVec3(geometry.positions, cornerPoint);
          pushVec3(geometry.positions, right);
          pushVec3(geometry.positions, left);
          pushVec3(geometry.positions, right);
          pushVec3(geometry.positions, extensionPoint);
          pushVec3(geometry.positions, right);

          vertexCount += 6;
          geometry.indices.push(
            vertexCount - 6,
            vertexCount - 8,
            vertexCount - 7,
            vertexCount - 6,
            vertexCount - 7,
            vertexCount - 5,
            vertexCount - 4,
            vertexCount - 6,
            vertexCount - 5,
            vertexCount - 2,
            vertexCount - 4,
            vertexCount - 1
          );
        } else {
          pushVec3(geometry.positions, left);
          pushVec3(geometry.positions, cornerPoint);
          pushVec3(geometry.positions, left);
          pushVec3(geometry.positions, right);
          pushVec3(geometry.positions, left);
          pushVec3(geometry.positions, extensionPoint);

          vertexCount += 6;
          geometry.indices.push(
            vertexCount - 6,
            vertexCount - 8,
            vertexCount - 7,
            vertexCount - 6,
            vertexCount - 7,
            vertexCount - 5,
            vertexCount - 6,
            vertexCount - 5,
            vertexCount - 3,
            vertexCount - 2,
            vertexCount - 3,
            vertexCount - 1
          );
        }

        pushNormal(geometry.normals, normal, 6);
        geometry.uvs.push(
          uvU - sharpUvOffset, 0,
          uvU - sharpUvOffset, 1,
          uvU, 0,
          uvU, 1,
          uvU + sharpUvOffset, 0,
          uvU + sharpUvOffset, 1
        );
        geometry.uvs2.push(
          uvU2 - sharpUvOffset2, 0,
          uvU2 - sharpUvOffset2, 1,
          uvU2, 0,
          uvU2, 1,
          uvU2 + sharpUvOffset2, 0,
          uvU2 + sharpUvOffset2, 1
        );
      } else {
        pushSimplePair(geometry, left, right, normal, uvU, uvU2);
        vertexCount += 2;

        if (frameIndex > 0) {
          geometry.indices.push(
            vertexCount - 2,
            vertexCount - 4,
            vertexCount - 3,
            vertexCount - 2,
            vertexCount - 3,
            vertexCount - 1
          );
        }
      }
    }

    if (arrow) {
      const point = frames.points[lastFrameIndex]!;
      const binormal = frames.binormals[lastFrameIndex]!;
      const normal = frames.normals[lastFrameIndex]!;
      const tangent = frames.tangents[lastFrameIndex]!;
      const length = frames.lengths[lastFrameIndex] ?? 0;
      const uvU = sideWidth > 0 ? length / sideWidth : 0;
      const uvU2 = totalLength > 0 ? length / totalLength : 0;

      computeEdge(left, point, binormal, halfWidth * 2, 1, -1, side !== 'right');
      computeEdge(right, point, binormal, halfWidth * 2, 1, 1, side !== 'left');
      setLength(arrowTip, tangent, halfWidth * 3);
      vec3.add(arrowTip, arrowTip, point);

      pushVec3(geometry.positions, left);
      pushVec3(geometry.positions, right);
      pushVec3(geometry.positions, arrowTip);
      pushNormal(geometry.normals, normal, 3);
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

      vertexCount += 3;
      geometry.indices.push(vertexCount - 1, vertexCount - 3, vertexCount - 2);
    }

    return geometry;
}
