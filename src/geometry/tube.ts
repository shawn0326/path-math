import { vec3 } from '../vector';
import type { ReadonlyVector, Vector3 } from '../vector';
import type { BuildTubeOptions, GeometryData, PathFrames } from '../types';
import { rotateAroundAxis } from '../helper';

const TAU = Math.PI * 2;
const DEFAULT_RADIUS = 0.1;
const DEFAULT_RADIAL_SEGMENTS = 8;

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

function normalizeSegments(value: number | undefined): number {
  return Math.max(2, Math.floor(finiteOrDefault(value, DEFAULT_RADIAL_SEGMENTS)));
}

function normalizePositive(value: number | undefined, defaultValue: number): number {
  return Math.max(0, finiteOrDefault(value, defaultValue));
}

function normalizeScale(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || Math.abs(value) < 1e-12) {
    return 1;
  }
  return value;
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

function pushDuplicateVertex(
  geometry: GeometryData,
  sourceIndex: number,
  normal: ReadonlyVector
): void {
  const positionOffset = sourceIndex * 3;
  const uvOffset = sourceIndex * 2;

  geometry.positions.push(
    geometry.positions[positionOffset]!,
    geometry.positions[positionOffset + 1]!,
    geometry.positions[positionOffset + 2]!
  );
  pushVec3(geometry.normals, normal);
  geometry.uvs.push(geometry.uvs[uvOffset]!, geometry.uvs[uvOffset + 1]!);
  geometry.uvs2.push(geometry.uvs2[uvOffset]!, geometry.uvs2[uvOffset + 1]!);
}

export function createTube(frames: PathFrames, options: BuildTubeOptions = {}): GeometryData {
    const geometry = createGeometry();
    const frameLength = frames.points.length;

    if (frameLength === 0) {
      return geometry;
    }

    const radius = normalizePositive(options.radius, DEFAULT_RADIUS);
    const radialSegments = normalizeSegments(options.radialSegments);
    const startRad = finiteOrDefault(options.startRad, 0);
    const generateStartCap = options.generateStartCap ?? false;
    const generateEndCap = options.generateEndCap ?? false;
    const lastFrameIndex = frameLength - 1;
    const circumference = radius * TAU;
    const totalLength = frames.lengths[lastFrameIndex] ?? 0;

    const sectionDirection = vec3.create();
    const position = vec3.create();
    const normal = vec3.create();
    const capNormal = vec3.create();

    let vertexCount = 0;

    for (let frameIndex = 0; frameIndex < frameLength; frameIndex++) {
      const point = frames.points[frameIndex]!;
      const tangent = frames.tangents[frameIndex]!;
      const normalFrame = frames.normals[frameIndex]!;
      const length = frames.lengths[frameIndex] ?? 0;
      const uvU = circumference > 0 ? length / circumference : 0;
      const uvU2 = totalLength > 0 ? length / totalLength : 0;
      const widthScale = normalizeScale(frames.widthScales[frameIndex]);
      const isSharp = frames.sharps[frameIndex] ?? false;

      for (let segmentIndex = 0; segmentIndex <= radialSegments; segmentIndex++) {
        const ringIndex = segmentIndex === radialSegments ? 0 : segmentIndex;
        const angle = startRad + TAU * ringIndex / radialSegments;

        rotateAroundAxis(sectionDirection, normalFrame, tangent, angle);
        vec3.normalize(sectionDirection, sectionDirection);

        if (isSharp) {
          const bisector = frames.bisectors[frameIndex]!;
          scaleAlong(position, sectionDirection, bisector, widthScale);
          vec3.scale(position, position, radius);
          vec3.add(position, position, point);

          scaleAlong(normal, sectionDirection, bisector, 1 / widthScale);
          vec3.normalize(normal, normal);
        } else {
          vec3.scaleAndAdd(position, point, sectionDirection, radius * widthScale);
          vec3.copy(normal, sectionDirection);
        }

        pushVec3(geometry.positions, position);
        pushVec3(geometry.normals, normal);
        geometry.uvs.push(uvU, segmentIndex / radialSegments);
        geometry.uvs2.push(uvU2, segmentIndex / radialSegments);
        vertexCount++;
      }

      if (frameIndex > 0) {
        const previousRingStart = vertexCount - (radialSegments + 1) * 2;
        const currentRingStart = vertexCount - (radialSegments + 1);

        for (let segmentIndex = 0; segmentIndex < radialSegments; segmentIndex++) {
          geometry.indices.push(
            currentRingStart + segmentIndex,
            previousRingStart + segmentIndex,
            previousRingStart + segmentIndex + 1,
            currentRingStart + segmentIndex,
            previousRingStart + segmentIndex + 1,
            currentRingStart + segmentIndex + 1
          );
        }
      }
    }

    if (radialSegments >= 3 && generateEndCap) {
      vec3.normalize(capNormal, frames.tangents[lastFrameIndex]!);

      const sourceStart = vertexCount - radialSegments;
      const capStart = vertexCount;
      for (let sourceIndex = sourceStart; sourceIndex < sourceStart + radialSegments; sourceIndex++) {
        pushDuplicateVertex(geometry, sourceIndex, capNormal);
        vertexCount++;
      }

      for (let segmentIndex = 0; segmentIndex < radialSegments - 2; segmentIndex++) {
        geometry.indices.push(capStart, capStart + segmentIndex + 1, capStart + segmentIndex + 2);
      }
    }

    if (radialSegments >= 3 && generateStartCap) {
      vec3.normalize(capNormal, frames.tangents[0]!);
      vec3.scale(capNormal, capNormal, -1);

      const capStart = vertexCount;
      for (let sourceIndex = 0; sourceIndex < radialSegments; sourceIndex++) {
        pushDuplicateVertex(geometry, sourceIndex, capNormal);
        vertexCount++;
      }

      for (let segmentIndex = 0; segmentIndex < radialSegments - 2; segmentIndex++) {
        geometry.indices.push(capStart, capStart + segmentIndex + 2, capStart + segmentIndex + 1);
      }
    }

    return geometry;
}
