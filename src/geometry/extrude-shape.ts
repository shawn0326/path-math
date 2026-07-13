import { vec3 } from '../vector';
import type { ReadonlyVector, Vector3 } from '../vector';
import type { BuildExtrudeShapeOptions, ExtrudeShapePoint, GeometryData, PathFrames } from '../types';
import { triangulate } from './earcut';

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

function getLength(x0: number, y0: number, x1: number, y1: number): number {
  const x = x1 - x0;
  const y = y1 - y0;
  return Math.sqrt(x * x + y * y);
}

function area2D(contour: ExtrudeShapePoint[]): number {
  const n = contour.length;
  let a = 0;

  for (let p = n - 1, q = 0; q < n; p = q++) {
    a += contour[p]![0]! * contour[q]![1]! - contour[q]![0]! * contour[p]![1]!;
  }

  return a * 0.5;
}

function isClockWise(contour: ExtrudeShapePoint[]): boolean {
  return area2D(contour) < 0;
}

function isArrayEquals(a: ExtrudeShapePoint, b: ExtrudeShapePoint): boolean {
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }

  return true;
}

function removeDupEndPts(contour: ExtrudeShapePoint[]): void {
  const l = contour.length;

  if (l > 2 && isArrayEquals(contour[l - 1]!, contour[0]!)) {
    contour.pop();
  }
}

function addContour(vertices: number[], contour: ExtrudeShapePoint[]): void {
  for (let i = 0; i < contour.length; i++) {
    vertices.push(contour[i]![0]!, contour[i]![1]!);
  }
}

function convertShapeDataToEarcut(shape: BuildExtrudeShapeOptions, vertices: number[], holeIndices: number[]): void {
  let contour = shape.contour;
  const holes = shape.holes;

  if (!isClockWise(contour)) {
    contour = contour.reverse();
  }

  if (holes) {
    for (let i = 0; i < holes.length; i++) {
      const hole = holes[i]!;
      if (isClockWise(hole)) {
        holes[i] = hole.reverse();
      }
    }
  }

  removeDupEndPts(contour);
  addContour(vertices, contour);

  if (holes) {
    let holeIndex = contour.length;

    holes.forEach(removeDupEndPts);

    for (let i = 0; i < holes.length; i++) {
      holeIndices.push(holeIndex);
      holeIndex += holes[i]!.length;
      addContour(vertices, holes[i]!);
    }
  }
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

const frameNormal = vec3.create();
const frameBinormal = vec3.create();
const framePosition = vec3.create();

function setPositionByPathFrames(frames: PathFrames, index: number, x: number, y: number, positions: number[]): void {
  vec3.scale(frameNormal, frames.normals[index]!, y);
  vec3.scale(frameBinormal, frames.binormals[index]!, x);

  vec3.add(framePosition, frameNormal, frameBinormal);
  if (frames.sharps[index]) {
    scaleAlong(framePosition, framePosition, frames.bisectors[index]!, frames.widthScales[index]!);
  }
  vec3.add(framePosition, framePosition, frames.points[index]!);

  positions.push(framePosition[0]!, framePosition[1]!, framePosition[2]!);
}

function accumulateNormal(normals: number[], index: number, nx: number, ny: number, nz: number): void {
  const offset = index * 3;

  normals[offset] = (normals[offset] ?? 0) + nx;
  normals[offset + 1] = (normals[offset + 1] ?? 0) + ny;
  normals[offset + 2] = (normals[offset + 2] ?? 0) + nz;
}

function addFaceNormal(normals: number[], positions: number[], a: number, b: number, c: number): void {
  const ax = positions[a * 3]!;
  const ay = positions[a * 3 + 1]!;
  const az = positions[a * 3 + 2]!;
  const bx = positions[b * 3]!;
  const by = positions[b * 3 + 1]!;
  const bz = positions[b * 3 + 2]!;
  const cx = positions[c * 3]!;
  const cy = positions[c * 3 + 1]!;
  const cz = positions[c * 3 + 2]!;

  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;

  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;

  accumulateNormal(normals, a, nx, ny, nz);
  accumulateNormal(normals, b, nx, ny, nz);
  accumulateNormal(normals, c, nx, ny, nz);
}

function computeNormals(positions: number[], indices: number[]): number[] {
  const normals = new Array<number>(positions.length).fill(0);

  for (let i = 0; i < indices.length; i += 3) {
    addFaceNormal(normals, positions, indices[i]!, indices[i + 1]!, indices[i + 2]!);
  }

  for (let i = 0; i < normals.length; i += 3) {
    const x = normals[i]!;
    const y = normals[i + 1]!;
    const z = normals[i + 2]!;
    const length = Math.hypot(x, y, z);

    if (length > 0) {
      normals[i] = x / length;
      normals[i + 1] = y / length;
      normals[i + 2] = z / length;
    }
  }

  return normals;
}

/**
 * Build indexed extruded shape geometry from a 2D contour and optional holes.
 *
 * This follows t3d's `ExtrudeShapeBuilder`: input contours may be mutated by
 * winding correction and duplicated closing-point removal.
 *
 * 从二维轮廓和可选孔洞构建索引挤出几何。该实现遵循 t3d 的
 * `ExtrudeShapeBuilder`：输入轮廓可能会在方向修正和重复闭合点移除时被修改。
 */
export function createExtrudeShape(shape: BuildExtrudeShapeOptions): GeometryData {
  const geometry = createGeometry();
  const depth = finiteOrDefault(shape.depth, 1);
  const generateTop = shape.generateTop ?? true;
  const generateBottom = shape.generateBottom ?? true;
  const pathFrames = shape.pathFrames;

  if (shape.contour.length < 3 || (pathFrames && pathFrames.points.length === 0)) {
    return geometry;
  }

  let negativeDepth = false;
  if (!pathFrames) {
    negativeDepth = depth < 0;
  }

  const vertices: number[] = [];
  const holeIndices: number[] = [];

  convertShapeDataToEarcut(shape, vertices, holeIndices);

  if (vertices.length < 6) {
    return geometry;
  }

  const faces = triangulate(vertices, holeIndices);
  const { positions, uvs, indices } = geometry;

  let vertexCount = 0;

  if (generateTop) {
    for (let i = 0; i < vertices.length; i += 2) {
      if (pathFrames) {
        setPositionByPathFrames(pathFrames, 0, vertices[i]!, vertices[i + 1]!, positions);
      } else {
        positions.push(vertices[i]!, vertices[i + 1]!, 0);
      }

      uvs.push(negativeDepth ? -vertices[i]! : vertices[i]!, vertices[i + 1]!);
    }

    for (let i = 0; i < faces.length; i += 3) {
      if (negativeDepth) {
        indices.push(faces[i]!, faces[i + 2]!, faces[i + 1]!);
      } else {
        indices.push(faces[i]!, faces[i + 1]!, faces[i + 2]!);
      }
    }
  }

  if (generateBottom) {
    vertexCount = positions.length / 3;

    for (let i = 0; i < vertices.length; i += 2) {
      if (pathFrames) {
        setPositionByPathFrames(pathFrames, pathFrames.points.length - 1, vertices[i]!, vertices[i + 1]!, positions);
      } else {
        positions.push(vertices[i]!, vertices[i + 1]!, -depth);
      }

      uvs.push(negativeDepth ? vertices[i]! : -vertices[i]!, vertices[i + 1]!);
    }

    for (let i = 0; i < faces.length; i += 3) {
      if (negativeDepth) {
        indices.push(vertexCount + faces[i + 1]!, vertexCount + faces[i + 2]!, vertexCount + faces[i]!);
      } else {
        indices.push(vertexCount + faces[i + 2]!, vertexCount + faces[i + 1]!, vertexCount + faces[i]!);
      }
    }
  }

  vertexCount = positions.length / 3;

  const loops: Array<[number, number]> = [];
  if (holeIndices.length > 0) {
    loops.push([0, holeIndices[0]! * 2]);
    for (let i = 0; i < holeIndices.length - 1; i++) {
      loops.push([holeIndices[i]! * 2, holeIndices[i + 1]! * 2]);
    }
    loops.push([holeIndices[holeIndices.length - 1]! * 2, vertices.length]);
  } else {
    loops.push([0, vertices.length]);
  }

  const steps = pathFrames ? pathFrames.points.length - 1 : 1;

  for (let i = 0; i < loops.length; i++) {
    let dist = 0;
    const sideStart = loops[i]![0];
    const sideFinish = loops[i]![1];

    for (let j = sideStart; j < sideFinish; j += 2) {
      const index1 = j;
      const index2 = j + 2 >= sideFinish ? sideStart : j + 2;

      const dist1 = dist;
      const dist2 = dist - getLength(vertices[index1]!, vertices[index1 + 1]!, vertices[index2]!, vertices[index2 + 1]!);
      dist = dist2;

      for (let s = 0; s <= steps; s++) {
        if (pathFrames) {
          setPositionByPathFrames(pathFrames, s, vertices[index1]!, vertices[index1 + 1]!, positions);
          setPositionByPathFrames(pathFrames, s, vertices[index2]!, vertices[index2 + 1]!, positions);

          uvs.push(dist1, -pathFrames.lengths[s]!);
          uvs.push(dist2, -pathFrames.lengths[s]!);
        } else {
          const z = -depth / steps * s;

          positions.push(vertices[index1]!, vertices[index1 + 1]!, z);
          positions.push(vertices[index2]!, vertices[index2 + 1]!, z);

          uvs.push(dist1, z);
          uvs.push(dist2, z);
        }

        if (s > 0) {
          if (negativeDepth) {
            indices.push(vertexCount - 2, vertexCount, vertexCount - 1);
            indices.push(vertexCount - 1, vertexCount, vertexCount + 1);
          } else {
            indices.push(vertexCount - 2, vertexCount - 1, vertexCount);
            indices.push(vertexCount - 1, vertexCount + 1, vertexCount);
          }
        }

        vertexCount += 2;
      }
    }
  }

  geometry.normals = computeNormals(positions, indices);
  geometry.uvs2 = uvs.slice();

  return geometry;
}
