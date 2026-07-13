import { vec3 } from '../vector';
import type { ReadonlyVector, Vector3 } from '../vector';
import type { LineSegment } from '../types';
import { getSegmentLength, getSegmentLengths, getSegmentPoints, getSegmentSpacedPoints, mapUToT, markSegmentDirty, segmentOps } from './shared';
import type { SegmentCacheState } from './shared';
import { EPSILON } from '../helper';

type LineSegmentState = LineSegment & SegmentCacheState;

/**
 * Operations for 3D straight line segments.
 * 三维直线 segment 的操作集合。
 */
class LineSegmentImpl implements LineSegment {
  type: 'line' = 'line';
  p0: Vector3;
  p1: Vector3;
  arcLengthDivisions = 1;
  _needsUpdate = true;

  constructor(p0: ReadonlyVector = vec3.create(), p1: ReadonlyVector = vec3.create()) {
    this.p0 = vec3.clone(p0);
    this.p1 = vec3.clone(p1);
  }

  pointAt(out: Vector3, t: number): Vector3 {
    out[0] = this.p0[0]! + (this.p1[0]! - this.p0[0]!) * t;
    out[1] = this.p0[1]! + (this.p1[1]! - this.p0[1]!) * t;
    out[2] = this.p0[2]! + (this.p1[2]! - this.p0[2]!) * t;
    return out;
  }

  pointAtU(out: Vector3, u: number): Vector3 {
    return this.pointAt(out, u);
  }

  tangentAt(out: Vector3, t: number): Vector3 {
    vec3.sub(out, this.p1, this.p0);
    if (vec3.len(out) <= EPSILON) {
      out[0] = 1;
      out[1] = 0;
      out[2] = 0;
      return out;
    }
    return vec3.normalize(out, out);
  }

  getLength(): number {
    return getSegmentLength(this as LineSegmentState, segmentOps);
  }

  getLengths(divisions?: number): number[] {
    return getSegmentLengths(this as LineSegmentState, divisions ?? 1, segmentOps);
  }

  getPoints(divisions?: number): Vector3[] {
    return getSegmentPoints(this as LineSegmentState, divisions, segmentOps);
  }

  getSpacedPoints(divisions?: number): Vector3[] {
    return getSegmentSpacedPoints(this as LineSegmentState, divisions, segmentOps);
  }

  mapUToT(u: number, distance?: number): number {
    return mapUToT(this as LineSegmentState, u, distance, segmentOps);
  }

  markDirty(): void {
    markSegmentDirty(this);
  }
}
export function createLine(p0: ReadonlyVector = vec3.create(), p1: ReadonlyVector = vec3.create()): LineSegment {
  return new LineSegmentImpl(p0, p1);
}
