import { vec3 } from '../vector';
import type { ReadonlyVector, Vector3 } from '../vector';
import type { CubicBezierSegment } from '../types';
import { getSegmentLength, getSegmentLengths, getSegmentPoints, getSegmentSpacedPoints, mapUToT, markSegmentDirty, segmentOps } from './shared';
import type { SegmentCacheState } from './shared';
import { EPSILON } from '../helper';

type CubicBezierSegmentState = CubicBezierSegment & SegmentCacheState;

/**
 * Operations for 3D cubic Bezier segments.
 * 三维三次 Bezier segment 的操作集合。
 */
class CubicBezierSegmentImpl implements CubicBezierSegment {
  type: 'cubic-bezier' = 'cubic-bezier';
  p0: Vector3;
  p1: Vector3;
  p2: Vector3;
  p3: Vector3;
  arcLengthDivisions = 200;
  _needsUpdate = true;

  constructor(p0: ReadonlyVector = vec3.create(), p1: ReadonlyVector = vec3.create(), p2: ReadonlyVector = vec3.create(), p3: ReadonlyVector = vec3.create()) {
    this.p0 = vec3.clone(p0);
    this.p1 = vec3.clone(p1);
    this.p2 = vec3.clone(p2);
    this.p3 = vec3.clone(p3);
  }

  pointAt(out: Vector3, t: number): Vector3 {
    const k = 1 - t;
    out[0] = k * k * k * this.p0[0]! + 3 * k * k * t * this.p1[0]! + 3 * k * t * t * this.p2[0]! + t * t * t * this.p3[0]!;
    out[1] = k * k * k * this.p0[1]! + 3 * k * k * t * this.p1[1]! + 3 * k * t * t * this.p2[1]! + t * t * t * this.p3[1]!;
    out[2] = k * k * k * this.p0[2]! + 3 * k * k * t * this.p1[2]! + 3 * k * t * t * this.p2[2]! + t * t * t * this.p3[2]!;
    return out;
  }

  pointAtU(out: Vector3, u: number): Vector3 {
    return this.pointAt(out, this.mapUToT(u));
  }

  tangentAt(out: Vector3, t: number): Vector3 {
    const k = 1 - t;
    out[0] = 3 * k * k * (this.p1[0]! - this.p0[0]!) + 6 * k * t * (this.p2[0]! - this.p1[0]!) + 3 * t * t * (this.p3[0]! - this.p2[0]!);
    out[1] = 3 * k * k * (this.p1[1]! - this.p0[1]!) + 6 * k * t * (this.p2[1]! - this.p1[1]!) + 3 * t * t * (this.p3[1]! - this.p2[1]!);
    out[2] = 3 * k * k * (this.p1[2]! - this.p0[2]!) + 6 * k * t * (this.p2[2]! - this.p1[2]!) + 3 * t * t * (this.p3[2]! - this.p2[2]!);
    if (vec3.len(out) <= EPSILON) {
      out[0] = 1;
      out[1] = 0;
      out[2] = 0;
      return out;
    }
    return vec3.normalize(out, out);
  }

  getLength(): number {
    return getSegmentLength(this as CubicBezierSegmentState, segmentOps);
  }

  getLengths(divisions?: number): number[] {
    return getSegmentLengths(this as CubicBezierSegmentState, divisions, segmentOps);
  }

  getPoints(divisions?: number): Vector3[] {
    return getSegmentPoints(this as CubicBezierSegmentState, divisions, segmentOps);
  }

  getSpacedPoints(divisions?: number): Vector3[] {
    return getSegmentSpacedPoints(this as CubicBezierSegmentState, divisions, segmentOps);
  }

  mapUToT(u: number, distance?: number): number {
    return mapUToT(this as CubicBezierSegmentState, u, distance, segmentOps);
  }

  markDirty(): void {
    markSegmentDirty(this);
  }
}
export function createCubicBezier(p0: ReadonlyVector = vec3.create(), p1: ReadonlyVector = vec3.create(), p2: ReadonlyVector = vec3.create(), p3: ReadonlyVector = vec3.create()): CubicBezierSegment {
  return new CubicBezierSegmentImpl(p0, p1, p2, p3);
}
