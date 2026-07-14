import type { BuildExtrudeShapeOptions, ExtrudeShapePoint, GeometryData } from '../types';
import {
  createExtrudeSweepAttributes,
  createLinearSweepSource,
  createSweep,
  createSweepSectionSource
} from './sweep';
import type { SweepProfile } from './sweep';

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

function area2D(contour: ExtrudeShapePoint[]): number {
  const n = contour.length;
  let area = 0;

  for (let previous = n - 1, current = 0; current < n; previous = current++) {
    area += contour[previous]![0]! * contour[current]![1]! -
      contour[current]![0]! * contour[previous]![1]!;
  }

  return area * 0.5;
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
  const length = contour.length;
  if (length > 2 && isArrayEquals(contour[length - 1]!, contour[0]!)) contour.pop();
}

function createProfile(shape: BuildExtrudeShapeOptions): SweepProfile {
  const contour = shape.contour;
  const holes = shape.holes;

  if (!isClockWise(contour)) contour.reverse();

  if (holes) {
    for (let i = 0; i < holes.length; i++) {
      const hole = holes[i]!;
      if (isClockWise(hole)) holes[i] = hole.reverse();
    }
  }

  removeDupEndPts(contour);
  if (holes) holes.forEach(removeDupEndPts);

  return {
    loops: [
      { points: contour, closed: true },
      ...(holes ?? []).map(points => ({ points, closed: true }))
    ]
  };
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
  const pathFrames = shape.pathFrames;
  if (shape.contour.length < 3 || (pathFrames && pathFrames.points.length === 0)) {
    return createGeometry();
  }

  const depth = finiteOrDefault(shape.depth, 1);
  const negativeDepth = !pathFrames && depth < 0;
  const profile = createProfile(shape);
  if (profile.loops[0]!.points.length < 3) return createGeometry();

  const sectionSource = pathFrames
    ? createSweepSectionSource(profile, pathFrames, {
      cornerTransition: shape.cornerTransition ?? false,
      sanitizeWidthScale: false,
      regularScaleMode: 'none'
    })
    : createLinearSweepSource(depth);

  return createSweep(profile, sectionSource, {
    sideLayout: 'edge-isolated',
    normalMode: 'mesh',
    startCap: shape.generateTop ?? true,
    endCap: shape.generateBottom ?? true,
    flipWinding: negativeDepth,
    generateNormals: shape.generateNormals ?? true,
    attributes: createExtrudeSweepAttributes(
      pathFrames !== undefined,
      negativeDepth,
      shape.generateUvs2 ?? true
    )
  });
}
