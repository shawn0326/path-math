import { vec3 } from '../vector';
import type { ReadonlyVector, Vector3 } from '../vector';
import type { QuadraticBezierSegment } from '../types';
import { getSegmentLength, getSegmentLengths, getSegmentPoints, getSegmentSpacedPoints, mapUToT, markSegmentDirty, segmentOps } from './shared';
import type { SegmentCacheState } from './shared';
import { EPSILON } from '../helper';

type QuadraticBezierSegmentState = QuadraticBezierSegment & SegmentCacheState;

/**
 * Operations for 3D quadratic Bezier segments.
 * 三维二次 Bezier segment 的操作集合。
 */
class QuadraticBezierSegmentImpl implements QuadraticBezierSegment {
  type: 'quadratic-bezier' = 'quadratic-bezier';
  p0: Vector3;
  p1: Vector3;
  p2: Vector3;
  arcLengthDivisions = 200;
  _needsUpdate = true;

  constructor(p0: ReadonlyVector = vec3.create(), p1: ReadonlyVector = vec3.create(), p2: ReadonlyVector = vec3.create()) {
    this.p0 = vec3.clone(p0);
    this.p1 = vec3.clone(p1);
    this.p2 = vec3.clone(p2);
  }

  pointAt(out: Vector3, t: number): Vector3 {
    const k = 1 - t;
    out[0] = k * k * this.p0[0]! + 2 * k * t * this.p1[0]! + t * t * this.p2[0]!;
    out[1] = k * k * this.p0[1]! + 2 * k * t * this.p1[1]! + t * t * this.p2[1]!;
    out[2] = k * k * this.p0[2]! + 2 * k * t * this.p1[2]! + t * t * this.p2[2]!;
    return out;
  }

  pointAtU(out: Vector3, u: number): Vector3 {
    return this.pointAt(out, this.mapUToT(u));
  }

  tangentAt(out: Vector3, t: number): Vector3 {
    out[0] = 2 * (1 - t) * (this.p1[0]! - this.p0[0]!) + 2 * t * (this.p2[0]! - this.p1[0]!);
    out[1] = 2 * (1 - t) * (this.p1[1]! - this.p0[1]!) + 2 * t * (this.p2[1]! - this.p1[1]!);
    out[2] = 2 * (1 - t) * (this.p1[2]! - this.p0[2]!) + 2 * t * (this.p2[2]! - this.p1[2]!);
    if (vec3.len(out) <= EPSILON) {
      out[0] = 1;
      out[1] = 0;
      out[2] = 0;
      return out;
    }
    return vec3.normalize(out, out);
  }

  getLength(): number {
    return getSegmentLength(this as QuadraticBezierSegmentState, segmentOps);
  }

  getLengths(divisions?: number): number[] {
    return getSegmentLengths(this as QuadraticBezierSegmentState, divisions, segmentOps);
  }

  getPoints(divisions?: number): Vector3[] {
    return getSegmentPoints(this as QuadraticBezierSegmentState, divisions, segmentOps);
  }

  getSpacedPoints(divisions?: number): Vector3[] {
    return getSegmentSpacedPoints(this as QuadraticBezierSegmentState, divisions, segmentOps);
  }

  mapUToT(u: number, distance?: number): number {
    return mapUToT(this as QuadraticBezierSegmentState, u, distance, segmentOps);
  }

  markDirty(): void {
    markSegmentDirty(this);
  }
}
export function createQuadraticBezier(p0: ReadonlyVector = vec3.create(), p1: ReadonlyVector = vec3.create(), p2: ReadonlyVector = vec3.create()): QuadraticBezierSegment {
  return new QuadraticBezierSegmentImpl(p0, p1, p2);
}
