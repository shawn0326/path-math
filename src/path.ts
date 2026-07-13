import { vec3 } from './vector';
import type { ReadonlyVector, Vector3 } from './vector';
import type { BeveledCurveOptions, BuildFramesOptions, Path, PathFrames, PointPreprocessOptions, PolylineOptions, Segment, SmoothCurveOptions, PathWriter } from './types';
import { segment } from './segment';
import { clamp, EPSILON, resolveDivisions, rotateAroundAxis } from './helper';

const _p3a = vec3.create();
const _p3b = vec3.create();
const _axis = vec3.create();

interface PathMetrics {
  lengths: number[];
  totalLength: number;
  segmentCount: number;
  needsUpdate: boolean;
}

type PathState = Path & {
  _metrics?: PathMetrics;
  _needsUpdate?: boolean;
};

function initialNormal3(out: Vector3, tangent: ReadonlyVector, initialNormal?: ReadonlyVector | null): Vector3 {
  if (initialNormal) {
    vec3.copy(out, initialNormal);
  } else {
    const tx = Math.abs(tangent[0]!);
    const ty = Math.abs(tangent[1]!);
    const tz = Math.abs(tangent[2]!);
    if (tx <= ty && tx <= tz) vec3.set(out, 1, 0, 0);
    else if (ty <= tx && ty <= tz) vec3.set(out, 0, 1, 0);
    else vec3.set(out, 0, 0, 1);
  }
  return out;
}

function transportNormal3(out: Vector3, previousNormal: ReadonlyVector, previousTangent: ReadonlyVector, tangent: ReadonlyVector): Vector3 {
  vec3.cross(_axis, previousTangent, tangent);
  if (vec3.len(_axis) > EPSILON) {
    vec3.normalize(_axis, _axis);
    const theta = Math.acos(clamp(vec3.dot(previousTangent, tangent), -1, 1));
    rotateAroundAxis(out, previousNormal, _axis, theta);
  } else {
    vec3.copy(out, previousNormal);
  }
  return out;
}

function orthonormalize3(outNormal: Vector3, outBinormal: Vector3, tangent: ReadonlyVector, normal: ReadonlyVector): void {
  vec3.cross(outBinormal, tangent, normal);
  if (vec3.len(outBinormal) <= EPSILON) {
    initialNormal3(outNormal, tangent);
    vec3.cross(outBinormal, tangent, outNormal);
  }
  vec3.normalize(outBinormal, outBinormal);
  vec3.cross(outNormal, outBinormal, tangent);
  vec3.normalize(outNormal, outNormal);
}

function vecEquals(a: ReadonlyVector, b: ReadonlyVector): boolean {
  return a[0] === b[0]! && a[1] === b[1]! && a[2] === b[2]!;
}

function preprocessInputPoints(points: ReadonlyVector[], options: PointPreprocessOptions = {}): Vector3[] {
  const removeConsecutiveDuplicates = options.removeConsecutiveDuplicates !== false;
  const removeClosingDuplicate = options.removeClosingDuplicate ?? options.close === true;
  const normalized: Vector3[] = [];
  for (const point of points) {
    const previous = normalized[normalized.length - 1];
    if (!removeConsecutiveDuplicates || !previous || !vecEquals(previous, point)) {
      normalized.push(vec3.clone(point));
    }
  }
  if (removeClosingDuplicate && normalized.length > 1 && vecEquals(normalized[0]!, normalized[normalized.length - 1]!)) {
    normalized.pop();
  }
  return normalized;
}

function componentMin(out: Vector3, a: ReadonlyVector, b: ReadonlyVector): Vector3 {
  out[0] = Math.min(a[0]!, b[0]!);
  out[1] = Math.min(a[1]!, b[1]!);
  out[2] = Math.min(a[2]!, b[2]!);
  return out;
}

function componentMax(out: Vector3, a: ReadonlyVector, b: ReadonlyVector): Vector3 {
  out[0] = Math.max(a[0]!, b[0]!);
  out[1] = Math.max(a[1]!, b[1]!);
  out[2] = Math.max(a[2]!, b[2]!);
  return out;
}

function clampPointBetween(out: Vector3, value: ReadonlyVector, a: ReadonlyVector, b: ReadonlyVector): Vector3 {
  componentMax(_p3a, a, b);
  componentMin(_p3b, value, _p3a);
  componentMin(_p3a, a, b);
  return componentMax(out, _p3b, _p3a);
}

function normalizeOrFallback(out: Vector3, fallback?: ReadonlyVector): Vector3 {
  if (vec3.len(out) <= EPSILON) {
    if (fallback) vec3.copy(out, fallback);
    else vec3.set(out, 1, 0, 0);
    return out;
  }
  return vec3.normalize(out, out);
}

function markPathDirty(path: PathState, recursive = false): void {
  path._needsUpdate = true;
  if (path._metrics) path._metrics.needsUpdate = true;
  if (recursive) {
    for (const segment of path.segments) {
      segment.markDirty();
    }
  }
}

function getPathLengths(path: PathState): number[] {
  const metrics = path._metrics;
  if (metrics && metrics.segmentCount === path.segments.length && !metrics.needsUpdate && !path._needsUpdate) {
    return metrics.lengths;
  }
  const lengths: number[] = [];
  let sum = 0;
  for (const segment of path.segments) {
    sum += segment.getLength();
    lengths.push(sum);
  }
  path._metrics = { lengths, totalLength: sum, segmentCount: path.segments.length, needsUpdate: false };
  path._needsUpdate = false;
  return lengths;
}

function getPathLength(path: PathState): number {
  const lengths = getPathLengths(path);
  return lengths[lengths.length - 1] ?? 0;
}

function findSegmentDistance(lengths: number[], distance: number): { index: number; localDistance: number } {
  if (lengths.length === 0) return { index: -1, localDistance: 0 };
  const total = lengths[lengths.length - 1] ?? 0;
  const d = clamp(distance, 0, total);
  for (let i = 0; i < lengths.length; i++) {
    const current = lengths[i] ?? 0;
    if (current >= d) {
      const previous = i === 0 ? 0 : lengths[i - 1] ?? 0;
      return { index: i, localDistance: d - previous };
    }
  }
  return { index: lengths.length - 1, localDistance: total - (lengths[lengths.length - 2] ?? 0) };
}

function pathPointAtDistance(out: Vector3, path: PathState, distance: number): Vector3 {
  const lengths = getPathLengths(path);
  const found = findSegmentDistance(lengths, distance);
  const segment_ = path.segments[found.index];
  if (!segment_) return out;
  const segmentLength = segment_.getLength();
  const u = segmentLength === 0 ? 0 : found.localDistance / segmentLength;
  const t = segment_.type === 'line' ? u : segment_.mapUToT(u, found.localDistance);
  return segment_.pointAt(out, t);
}

function pathTangentAtDistance(out: Vector3, path: PathState, distance: number): Vector3 {
  const lengths = getPathLengths(path);
  const found = findSegmentDistance(lengths, distance);
  const segment_ = path.segments[found.index];
  if (!segment_) return out;
  const segmentLength = segment_.getLength();
  const u = segmentLength === 0 ? 0 : found.localDistance / segmentLength;
  const t = segment_.type === 'line' ? u : segment_.mapUToT(u, found.localDistance);
  return segment_.tangentAt(out, t);
}

function setPathPolyline(path: PathState, points: ReadonlyVector[], options: PolylineOptions = {}): Path {
  path.segments.length = 0;
  const close = options.close === true;
  if (points.length < 2) {
    markPathDirty(path);
    return path;
  }

  const lastIndex = points.length - 1;
  const segments = close && !vecEquals(points[0]!, points[lastIndex]!) ? points.length : lastIndex;
  for (let i = 0; i < segments; i++) {
    path.segments.push(segment.createLine(points[i]!, i === lastIndex ? points[0]! : points[i + 1]!));
  }
  markPathDirty(path);
  return path;
}

function setPathSmoothCurve(path: PathState, points: ReadonlyVector[], options: SmoothCurveOptions = {}): Path {
  const smooth = options.smooth || 0;
  const close = options.close === true;
  if (close) {
    const closedPoints = points.length > 1 && vecEquals(points[0]!, points[points.length - 1]!)
      ? points.slice(0, -1)
      : points;
    if (closedPoints.length < 3 || smooth === 0) {
      return setPathPolyline(path, closedPoints, { close: true });
    }

    const extendedPoints = [
      closedPoints[closedPoints.length - 1]!,
      ...closedPoints,
      closedPoints[0]!,
      closedPoints[1]!
    ];
    setPathSmoothCurve(path, extendedPoints, { smooth });
    path.segments.pop();
    path.segments.shift();
    markPathDirty(path);
    return path;
  }

  if (points.length < 2 || smooth === 0 || points.length === 2) {
    return setPathPolyline(path, points, options);
  }

  path.segments.length = 0;
  const cp0 = vec3.clone(points[0]!);
  const cp1 = vec3.create();
  const prev = vec3.create();
  const next = vec3.create();
  const nextCp0 = vec3.create();
  const v1 = vec3.create();
  const v2 = vec3.create();

  for (let i = 0, l = points.length; i < l; i++) {
    const current = points[i]!;
    if (i === 0) {
      vec3.copy(cp0, current);
    } else if (i === l - 1) {
      path.segments.push(segment.createCubicBezier(points[i - 1]!, cp0, current, current));
    } else {
      vec3.copy(next, points[i + 1]!);
      vec3.copy(prev, points[i - 1]!);

      const lenPrevSeg = vec3.len(vec3.sub(v1, current, prev));
      const lenNextSeg = vec3.len(vec3.sub(v2, next, current));

      const ratioNextSeg = lenNextSeg / (lenNextSeg + lenPrevSeg);
      vec3.sub(v1, next, prev);
      vec3.scaleAndAdd(cp1, current, v1, -smooth * (1 - ratioNextSeg));
      vec3.scaleAndAdd(nextCp0, current, v1, smooth * ratioNextSeg);
      clampPointBetween(nextCp0, nextCp0, next, current);

      vec3.sub(v1, nextCp0, current);
      vec3.scaleAndAdd(cp1, current, v1, -lenPrevSeg / lenNextSeg);
      clampPointBetween(cp1, cp1, prev, current);

      vec3.sub(v1, current, cp1);
      vec3.scaleAndAdd(nextCp0, current, v1, lenNextSeg / lenPrevSeg);
      path.segments.push(segment.createCubicBezier(prev, cp0, cp1, current));
      vec3.copy(cp0, nextCp0);
    }
  }

  markPathDirty(path);
  return path;
}

function setPathBeveledCurve(path: PathState, points: ReadonlyVector[], options: BeveledCurveOptions = {}): Path {
  const bevelRadius = options.bevelRadius || 0;
  const close = options.close || false;
  if (points.length < 2 || bevelRadius === 0 || points.length === 2) {
    return setPathPolyline(path, points, options);
  }

  path.segments.length = 0;
  const lastIndex = points.length - 1;
  const segments = close && !vecEquals(points[0]!, points[lastIndex]!) ? points.length : lastIndex;
  const p0 = vec3.clone(points[0]!);
  const lastDir = vec3.create();
  const nextDir = vec3.create();

  for (let i = 0; i < segments; i++) {
    const p1 = points[(i + 1) % (lastIndex + 1)]!;
    const p2 = points[(i + 2) % (lastIndex + 1)]!;
    if (i === segments - 1 && !close) {
      path.segments.push(segment.createLine(p0, p1));
      vec3.copy(p0, p1);
      break;
    }

    vec3.sub(lastDir, p1, p0);
    vec3.sub(nextDir, p2, p1);
    const lastDirLength = vec3.len(lastDir);
    const nextDirLength = vec3.len(nextDir);

    const v0Dist = Math.min((i === 0 ? lastDirLength / 2 : lastDirLength) * 0.999999, bevelRadius);
    const v2Dist = Math.min((nextDirLength / 2) * 0.999999, bevelRadius);
    vec3.normalize(lastDir, lastDir);
    vec3.normalize(nextDir, nextDir);

    const lineEnd = vec3.scaleAndAdd(vec3.create(), p1, lastDir, -v0Dist);
    path.segments.push(segment.createLine(p0, lineEnd));

    const bezierEnd = vec3.scaleAndAdd(vec3.create(), p1, nextDir, v2Dist);
    path.segments.push(segment.createQuadraticBezier(lineEnd, p1, bezierEnd));
    vec3.copy(p0, bezierEnd);
  }

  if (close && path.segments[0]!?.type === 'line') vec3.copy(path.segments[0]!.p0, p0);
  markPathDirty(path);
  return path;
}

function getPathPoints(path: Path, divisions = 12): Vector3[] {
  const points: Vector3[] = [];
  const resolvedDivisions = resolveDivisions(divisions, 12);
  for (let i = 0; i < path.segments.length; i++) {
    const segment_ = path.segments[i]!;
    const resolution = segment_.type === 'line' ? 1 : resolvedDivisions;
    const isLast = i === path.segments.length - 1;
    const limit = isLast ? resolution : resolution - 1;
    for (let j = 0; j <= limit; j++) {
      const point = vec3.create();
      segment_.pointAt(point, j / resolution);
      points.push(point);
    }
  }
  return points;
}

function getPathSpacedPoints(path: Path, divisions = 5): Vector3[] {
  const points: Vector3[] = [];
  const resolvedDivisions = resolveDivisions(divisions, 5);
  for (let i = 0; i <= resolvedDivisions; i++) {
    const point = vec3.create();
    path.pointAtU(point, i / resolvedDivisions);
    points.push(point);
  }
  return points;
}

function buildPathFrames(path: Path, options: BuildFramesOptions = {}): PathFrames {
  const initialNormal = options.initialNormal ?? null;
  const divisions = resolveDivisions(options.divisions, 12);
  const transport = options.transport !== undefined ? options.transport : true;
  const fixLine = options.fixLine !== undefined ? options.fixLine : true;
  const close = options.close !== undefined ? options.close : false;

  const points: Vector3[] = [];
  const tangents: Vector3[] = [];
  const normals: Vector3[] = [];
  const binormals: Vector3[] = [];
  const bisectors: Vector3[] = [];
  const lengths: number[] = [];
  const widthScales: number[] = [];
  const sharps: boolean[] = [];
  const tangentTypes: number[] = [];

  let tangentType = 0;
  for (let i = 0; i < path.segments.length; i++) {
    const segment_ = path.segments[i]!;
    const isLine = segment_.type === 'line';
    const resolution = isLine ? 1 : divisions;
    const isLast = i === path.segments.length - 1;

    if (fixLine && isLine && !isLast && path.segments[i + 1]?.type !== 'line') tangentType = 1;

    const limit = isLast ? resolution : resolution - 1;
    for (let j = 0; j <= limit; j++) {
      const point = vec3.create();
      segment_.pointAt(point, j / resolution);
      points.push(point);
      tangentTypes.push(tangentType);
      if (tangentType === 1) tangentType++;
      else if (tangentType === 2) tangentType = 0;
    }
  }

  if (points.length === 0) {
    return { points, tangents, normals, binormals, bisectors, lengths, widthScales, sharps, tangentTypes };
  }

  tangents[0] = vec3.create();
  normals[0] = vec3.create();
  binormals[0] = vec3.create();
  bisectors[0] = vec3.create();
  if (points[1]!) vec3.sub(tangents[0]!, points[1]!, points[0]!);
  else vec3.set(tangents[0]!, 1, 0, 0);
  normalizeOrFallback(tangents[0]!);
  initialNormal3(normals[0]!, tangents[0]!, initialNormal);
  orthonormalize3(normals[0]!, binormals[0]!, tangents[0]!, normals[0]!);
  vec3.copy(bisectors[0]!, binormals[0]!);
  lengths[0] = 0;
  widthScales[0] = 1;
  sharps[0] = false;

  const lastDir = vec3.create();
  const nextDir = vec3.create();
  for (let i = 1; i < points.length - 1; i++) {
    const tangent = vec3.create();
    const normal = vec3.create();
    const binormal = vec3.create();
    const bisector = vec3.create();

    vec3.sub(lastDir, points[i]!, points[i - 1]!);
    vec3.sub(nextDir, points[i + 1]!, points[i]!);
    const lastLength = vec3.len(lastDir);
    normalizeOrFallback(lastDir, tangents[i - 1]);
    normalizeOrFallback(nextDir, lastDir);

    vec3.sub(bisector, nextDir, lastDir);
    normalizeOrFallback(bisector, binormals[i - 1]);

    const localTangentType = tangentTypes[i] ?? 0;
    if (localTangentType === 1) vec3.copy(tangent, nextDir);
    else if (localTangentType === 2) vec3.copy(tangent, lastDir);
    else normalizeOrFallback(vec3.add(tangent, lastDir, nextDir), lastDir);

    if (transport) {
      transportNormal3(normal, normals[i - 1]!, tangents[i - 1]!, tangent);
      orthonormalize3(normal, binormal, tangent, normal);
    } else {
      vec3.copy(normal, initialNormal ?? normals[i - 1]!);
      if (vec3.dot(tangent, normal) === 1) vec3.cross(binormal, nextDir, normal);
      else vec3.cross(binormal, tangent, normal);
      normalizeOrFallback(binormal, binormals[i - 1]);
      vec3.cross(normal, binormal, tangent);
      normalizeOrFallback(normal, normals[i - 1]);
    }

    tangents[i] = tangent;
    normals[i] = normal;
    binormals[i] = binormal;
    bisectors[i] = bisector;

    const cos = vec3.dot(lastDir, nextDir);
    lengths[i] = (lengths[i - 1] ?? 0) + lastLength;
    widthScales[i] = Math.min(1 / Math.sqrt((1 + cos) / 2), 1.415) || 1;
    sharps[i] = Math.abs(cos - 1) > 0.05;
  }

  const lastIndex = points.length - 1;
  if (lastIndex > 0) {
    const tangent = vec3.create();
    const normal = vec3.create();
    const binormal = vec3.create();
    const bisector = vec3.create();
    vec3.sub(tangent, points[lastIndex]!, points[lastIndex - 1]!);
    const dist = vec3.len(tangent);
    if (close) vec3.copy(tangent, tangents[0]!);
    else normalizeOrFallback(tangent, tangents[lastIndex - 1]);

    transportNormal3(normal, normals[lastIndex - 1]!, tangents[lastIndex - 1]!, tangent);
    orthonormalize3(normal, binormal, tangent, normal);
    vec3.copy(bisector, binormal);
    tangents[lastIndex] = tangent;
    normals[lastIndex] = normal;
    binormals[lastIndex] = binormal;
    bisectors[lastIndex] = bisector;
    lengths[lastIndex] = (lengths[lastIndex - 1] ?? 0) + dist;
    widthScales[lastIndex] = 1;
    sharps[lastIndex] = false;

    if (close) {
      vec3.copy(tangents[0]!, tangent);
      vec3.copy(normals[0]!, normal);
      vec3.copy(binormals[0]!, binormal);
      vec3.copy(bisectors[0]!, bisector);
    }
  }

  return { points, tangents, normals, binormals, bisectors, lengths, widthScales, sharps, tangentTypes };
}

class PathImpl implements Path {
  segments: Segment[] = [];
  _needsUpdate = true;

  clear(): Path {
    this.segments.length = 0;
    markPathDirty(this);
    return this;
  }

  addSegment(segment_: Segment): Path {
    this.segments.push(segment_);
    markPathDirty(this);
    return this;
  }

  markDirty(recursive = false): Path {
    markPathDirty(this, recursive);
    return this;
  }

  writer(): PathWriter {
    return path.writer(this);
  }

  setPolyline(points: ReadonlyVector[], options?: PolylineOptions): Path {
    return setPathPolyline(this, points, options);
  }

  setSmoothCurve(points: ReadonlyVector[], options?: SmoothCurveOptions): Path {
    return setPathSmoothCurve(this, points, options);
  }

  setBeveledCurve(points: ReadonlyVector[], options?: BeveledCurveOptions): Path {
    return setPathBeveledCurve(this, points, options);
  }

  getLength(): number {
    return getPathLength(this);
  }

  getLengths(): number[] {
    return getPathLengths(this);
  }

  pointAtU(out: Vector3, u: number): Vector3 {
    return this.pointAtDistance(out, clamp(u, 0, 1) * this.getLength());
  }

  tangentAtU(out: Vector3, u: number): Vector3 {
    return this.tangentAtDistance(out, clamp(u, 0, 1) * this.getLength());
  }

  pointAtDistance(out: Vector3, distance: number): Vector3 {
    return pathPointAtDistance(out, this, distance);
  }

  tangentAtDistance(out: Vector3, distance: number): Vector3 {
    return pathTangentAtDistance(out, this, distance);
  }

  getPoints(divisions?: number): Vector3[] {
    return getPathPoints(this, divisions);
  }

  getSpacedPoints(divisions?: number): Vector3[] {
    return getPathSpacedPoints(this, divisions);
  }

  buildFrames(options?: BuildFramesOptions): PathFrames {
    return buildPathFrames(this, options);
  }
}

/**
 * Path namespace.
 * Creates path instances, creates path writers, and preprocesses point arrays.
 * Instance methods perform all direct path operations and queries.
 *
 * Path 命名空间。
 * 用于创建 path 实例、创建 path writer，以及预处理点数组。
 * 所有直接操作和查询 path 的能力都通过实例方法完成。
 *
 * @example
 * ```ts
 * const p = path.create()
 *   .addSegment(segment.createLine(p0, p1));
 * const frames = p.buildFrames({ divisions: 20 });
 * ```
 */
export const path = {
  /**
   * Create an empty path instance.
   * 创建一个空 path 实例。
   */
  create(): Path {
    return new PathImpl();
  },

  /**
   * Preprocess a raw point array (remove duplicates, handle closing).
   * 预处理原始点数组（移除重复点、处理闭合）。
   */
  preprocessPoints(points: ReadonlyVector[], options: PointPreprocessOptions = {}): Vector3[] {
    return preprocessInputPoints(points, options);
  },

  /**
   * Return a fluent writer that builds a path imperatively.
   * 返回一个链式 writer，以命令式方式构建 path。
   */
  writer(targetPath?: Path): PathWriter {
    const target = targetPath ?? this.create();
    let currentPoint: Vector3 | null = null;
    let subpathStart: Vector3 | null = null;

    function moveTo(point: ReadonlyVector) {
      currentPoint = vec3.clone(point);
      subpathStart = vec3.clone(point);
      return api;
    }

    function lineTo(point: ReadonlyVector) {
      if (!currentPoint) return moveTo(point);
      target.addSegment(segment.createLine(currentPoint, point));
      vec3.copy(currentPoint, point);
      return api;
    }

    function quadraticTo(control: ReadonlyVector, point: ReadonlyVector) {
      if (!currentPoint) return moveTo(point);
      target.addSegment(segment.createQuadraticBezier(currentPoint, control, point));
      vec3.copy(currentPoint, point);
      return api;
    }

    function cubicTo(control1: ReadonlyVector, control2: ReadonlyVector, point: ReadonlyVector) {
      if (!currentPoint) return moveTo(point);
      target.addSegment(segment.createCubicBezier(currentPoint, control1, control2, point));
      vec3.copy(currentPoint, point);
      return api;
    }

    function close() {
      if (currentPoint && subpathStart && !vecEquals(currentPoint, subpathStart)) {
        lineTo(subpathStart);
      }
      return api;
    }

    function clear() {
      target.clear();
      currentPoint = null;
      subpathStart = null;
      return api;
    }

    function toPath(): Path {
      return target;
    }

    const api: PathWriter = { moveTo, lineTo, quadraticTo, cubicTo, close, clear, toPath };
    return api;
  },
};
