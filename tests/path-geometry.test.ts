import { describe, expect, it } from 'vitest';
import { vec3 } from '../src/vector';
import type { Vector3 } from '../src/vector';
import { Vector3 as T3DVector3 } from 't3d';
import { LineCurve3 as T3DLineCurve3 } from 't3d/examples/jsm/math/curves/LineCurve3.js';
import { QuadraticBezierCurve3 as T3DQuadraticBezierCurve3 } from 't3d/examples/jsm/math/curves/QuadraticBezierCurve3.js';
import { CubicBezierCurve3 as T3DCubicBezierCurve3 } from 't3d/examples/jsm/math/curves/CubicBezierCurve3.js';
import { CurvePath3 as T3DCurvePath3 } from 't3d/examples/jsm/math/curves/CurvePath3.js';
import { segment, path, geometry } from '../src/index';
import type { Path, PathFrames, PolylineOptions, ReadonlyVector } from '../src/index';
import { createLinearSweepSections, createSweep } from '../src/geometry/sweep';
import { createCornerSections, transformCornerPoint } from '../src/geometry/corner';

const EPS = 1e-5;

function expectVec3Close(actual: Vector3, expected: Vector3, epsilon = EPS): void {
  expect(actual[0]!).toBeCloseTo(expected[0]!, 5);
  expect(actual[1]!).toBeCloseTo(expected[1]!, 5);
  expect(actual[2]!).toBeCloseTo(expected[2]!, 5);
  expect(Math.abs(actual[0]! - expected[0]!)).toBeLessThanOrEqual(epsilon);
  expect(Math.abs(actual[1]! - expected[1]!)).toBeLessThanOrEqual(epsilon);
  expect(Math.abs(actual[2]! - expected[2]!)).toBeLessThanOrEqual(epsilon);
}

function vec3FromT3D(v: T3DVector3): Vector3 {
  return vec3.fromValues(v.x, v.y, v.z);
}

function toT3DVector3(v: ReadonlyVector): T3DVector3 {
  return new T3DVector3(v[0]!, v[1]!, v[2]!);
}

function expectT3DPointsClose(actual: Vector3[], expected: T3DVector3[], epsilon = EPS): void {
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expectVec3Close(actual[i]!, vec3FromT3D(expected[i]!), epsilon);
  }
}

function expectNumberArrayClose(actual: number[], expected: number[], epsilon = EPS): void {
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(Math.abs(actual[i]! - expected[i]!)).toBeLessThanOrEqual(epsilon);
  }
}

function expectFramesClose(actual: PathFrames, expected: ReturnType<T3DCurvePath3['computeFrames']>, epsilon = EPS): void {
  expectT3DPointsClose(actual.points, expected.points, epsilon);
  expectT3DPointsClose(actual.tangents, expected.tangents, epsilon);
  expectT3DPointsClose(actual.normals, expected.normals, epsilon);
  expectT3DPointsClose(actual.binormals, expected.binormals, epsilon);
  expectNumberArrayClose(actual.lengths, expected.lengths, epsilon);
  expectNumberArrayClose(actual.widthScales, expected.widthScales, epsilon);
  expect(actual.sharps).toEqual(expected.sharps);
  expect(actual.tangentTypes).toEqual(expected.tangentTypes);
}

function expectCurvePathControlsClose(ours: Path, t3d: T3DCurvePath3, epsilon = EPS): void {
  expect(ours.segments).toHaveLength(t3d.curves.length);
  for (let i = 0; i < t3d.curves.length; i++) {
    const oursSegment = ours.segments[i]!;
    const t3dCurve = t3d.curves[i]!;
    if (t3dCurve.isLineCurve3) {
      expect(oursSegment.type).toBe('line');
      if (oursSegment.type !== 'line') continue;
      expectVec3Close(oursSegment.p0, vec3FromT3D(t3dCurve.v1!), epsilon);
      expectVec3Close(oursSegment.p1, vec3FromT3D(t3dCurve.v2!), epsilon);
    } else if (t3dCurve.isQuadraticBezierCurve3) {
      expect(oursSegment.type).toBe('quadratic-bezier');
      if (oursSegment.type !== 'quadratic-bezier') continue;
      expectVec3Close(oursSegment.p0, vec3FromT3D(t3dCurve.v0!), epsilon);
      expectVec3Close(oursSegment.p1, vec3FromT3D(t3dCurve.v1!), epsilon);
      expectVec3Close(oursSegment.p2, vec3FromT3D(t3dCurve.v2!), epsilon);
    } else if (t3dCurve.isCubicBezierCurve3) {
      expect(oursSegment.type).toBe('cubic-bezier');
      if (oursSegment.type !== 'cubic-bezier') continue;
      expectVec3Close(oursSegment.p0, vec3FromT3D(t3dCurve.v0!), epsilon);
      expectVec3Close(oursSegment.p1, vec3FromT3D(t3dCurve.v1!), epsilon);
      expectVec3Close(oursSegment.p2, vec3FromT3D(t3dCurve.v2!), epsilon);
      expectVec3Close(oursSegment.p3, vec3FromT3D(t3dCurve.v3!), epsilon);
    } else {
      throw new Error(`Unsupported t3d curve at index ${i}`);
    }
  }
}

function createPolyline(points: ReadonlyVector[], options?: PolylineOptions): Path {
  const targetPath = path.create();
  return targetPath.setPolyline(points, options);
}

function createStraightFrames(): PathFrames {
  const p = createPolyline([
    vec3.fromValues(0, 0, 0),
    vec3.fromValues(10, 0, 0)
  ]);

  return p.buildFrames({
    divisions: 1,
    initialNormal: vec3.fromValues(0, 1, 0)
  });
}

function createSingleSectionFrames(): PathFrames {
  return {
    points: [vec3.fromValues(0, 0, 0)],
    tangents: [vec3.fromValues(1, 0, 0)],
    normals: [vec3.fromValues(0, 1, 0)],
    binormals: [vec3.fromValues(0, 0, 1)],
    bisectors: [vec3.fromValues(0, 0, 1)],
    lengths: [0],
    widthScales: [1],
    sharps: [false],
    tangentTypes: [0]
  };
}

function createZeroWidthSharpFrames(): PathFrames {
  return {
    points: [
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(1, 0, 0),
      vec3.fromValues(2, 0, 0)
    ],
    tangents: [
      vec3.fromValues(1, 0, 0),
      vec3.fromValues(1, 0, 0),
      vec3.fromValues(1, 0, 0)
    ],
    normals: [
      vec3.fromValues(0, 1, 0),
      vec3.fromValues(0, 1, 0),
      vec3.fromValues(0, 1, 0)
    ],
    binormals: [
      vec3.fromValues(0, 0, 1),
      vec3.fromValues(0, 0, 1),
      vec3.fromValues(0, 0, 1)
    ],
    bisectors: [
      vec3.fromValues(0, 0, 1),
      vec3.fromValues(0, 0, 1),
      vec3.fromValues(0, 0, 1)
    ],
    lengths: [0, 1, 2],
    widthScales: [1, 0, 1],
    sharps: [false, true, false],
    tangentTypes: [0, 0, 0]
  };
}

describe('segments', () => {
  it('uses plain number arrays for vector outputs', () => {
    const line = segment.createLine([0, 0, 0], [1, 2, 3]);
    const frames = path.create().setPolyline([[0, 0, 0], [1, 0, 0]]).buildFrames();

    expect(Array.isArray(line.p0)).toBe(true);
    expect(Array.isArray(line.getPoints(1)[0]!)).toBe(true);
    expect(Array.isArray(frames.points[0]!)).toBe(true);
    expect(Array.isArray(frames.tangents[0]!)).toBe(true);
  });

  it('samples line endpoints and length', () => {
    const seg = segment.createLine(vec3.fromValues(0, 0, 0), vec3.fromValues(3, 4, 0));
    const out = vec3.create();
    expectVec3Close(seg.pointAt(out, 0), vec3.fromValues(0, 0, 0));
    expectVec3Close(seg.pointAt(out, 1), vec3.fromValues(3, 4, 0));
    expect(seg.getLength()).toBeCloseTo(5);
    expect(seg.mapUToT(0.5)).toBeCloseTo(0.5);
  });

  it('samples quadratic and cubic endpoints', () => {
    const q = segment.createQuadraticBezier(vec3.fromValues(0, 0, 0), vec3.fromValues(5, 5, 0), vec3.fromValues(10, 0, 0));
    const c = segment.createCubicBezier(vec3.fromValues(0, 0, 0), vec3.fromValues(3, 6, 0), vec3.fromValues(7, 6, 0), vec3.fromValues(10, 0, 0));
    const out = vec3.create();
    expectVec3Close(q.pointAt(out, 0), vec3.fromValues(0, 0, 0));
    expectVec3Close(q.pointAt(out, 1), vec3.fromValues(10, 0, 0));
    expectVec3Close(c.pointAt(out, 0), vec3.fromValues(0, 0, 0));
    expectVec3Close(c.pointAt(out, 1), vec3.fromValues(10, 0, 0));
  });

  it('returns normalized tangents and refreshes dirty length caches', () => {
    const seg = segment.createLine(vec3.fromValues(0, 0, 0), vec3.fromValues(1, 0, 0));
    const tangent = vec3.create();
    seg.tangentAt(tangent, 0.5);
    expect(vec3.len(tangent)).toBeCloseTo(1);

    expect(seg.getLength()).toBeCloseTo(1);
    seg.p1[0] = 2;
    expect(seg.getLength()).toBeCloseTo(1);
    seg.markDirty();
    expect(seg.getLength()).toBeCloseTo(2);
  });

  it('matches t3d Curve getPoints and getSpacedPoints count behavior', () => {
    const seg = segment.createLine(vec3.fromValues(0, 0, 0), vec3.fromValues(10, 0, 0));
    const linePoints = seg.getPoints(5);
    expect(linePoints).toHaveLength(6);
    expectVec3Close(linePoints[3]!, vec3.fromValues(6, 0, 0));

    const cubic = segment.createCubicBezier(
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(0, 10, 0),
      vec3.fromValues(10, 10, 0),
      vec3.fromValues(10, 0, 0)
    );
    const spaced = cubic.getSpacedPoints(4);
    expect(spaced).toHaveLength(5);
    expectVec3Close(spaced[0]!, vec3.fromValues(0, 0, 0));
    expectVec3Close(spaced[4]!, vec3.fromValues(10, 0, 0));
  });

  it('matches a t3d cubic getPointAt and getSpacedPoints fixture', () => {
    const cubic = segment.createCubicBezier(
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(0, 10, 0),
      vec3.fromValues(10, 10, 5),
      vec3.fromValues(10, 0, 0)
    );
    const point = cubic.pointAtU(vec3.create(), 0.5);
    expectVec3Close(point, vec3.fromValues(5.097610538491925, 7.4987294808879765, 1.8990822487770207), 1e-5);

    const spaced = cubic.getSpacedPoints(4);
    const expected = [
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(1.1201159583222406, 4.945930886811336, 0.514920573467789),
      vec3.fromValues(5.097610538491925, 7.4987294808879765, 1.8990822487770207),
      vec3.fromValues(9.035257846296274, 4.654834152414374, 1.8804580114550629),
      vec3.fromValues(10, 0, 0)
    ];
    for (let i = 0; i < expected.length; i++) {
      expectVec3Close(spaced[i]!, expected[i]!, 1e-5);
    }
  });

  it('matches t3d npm cubic getPointAt and getSpacedPoints at runtime', () => {
    const ours = segment.createCubicBezier(
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(0, 10, 0),
      vec3.fromValues(10, 10, 5),
      vec3.fromValues(10, 0, 0)
    );
    const t3d = new T3DCubicBezierCurve3(
      new T3DVector3(0, 0, 0),
      new T3DVector3(0, 10, 0),
      new T3DVector3(10, 10, 5),
      new T3DVector3(10, 0, 0)
    );

    expectVec3Close(ours.pointAtU(vec3.create(), 0.5), vec3FromT3D(t3d.getPointAt(0.5)), 1e-5);
    const oursSpaced = ours.getSpacedPoints(4);
    const t3dSpaced = t3d.getSpacedPoints(4);
    for (let i = 0; i < t3dSpaced.length; i++) {
      expectVec3Close(oursSpaced[i]!, vec3FromT3D(t3dSpaced[i]!), 1e-5);
    }
  });

  it('matches t3d npm line and quadratic curve sampling at runtime', () => {
    const line = segment.createLine(vec3.fromValues(-1, 2, 3), vec3.fromValues(4, -2, 8));
    const t3dLine = new T3DLineCurve3(new T3DVector3(-1, 2, 3), new T3DVector3(4, -2, 8));
    expect(line.getLength()).toBeCloseTo(t3dLine.getLength());
    expectNumberArrayClose(line.getLengths(1), t3dLine.getLengths(1));
    expectT3DPointsClose(line.getPoints(5), t3dLine.getPoints(5));
    expectT3DPointsClose(line.getSpacedPoints(5), t3dLine.getSpacedPoints(5));
    expectVec3Close(line.pointAtU(vec3.create(), 0.35), vec3FromT3D(t3dLine.getPointAt(0.35)));

    const quadratic = segment.createQuadraticBezier(
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(3, 9, -2),
      vec3.fromValues(10, 0, 5)
    );
    const t3dQuadratic = new T3DQuadraticBezierCurve3(
      new T3DVector3(0, 0, 0),
      new T3DVector3(3, 9, -2),
      new T3DVector3(10, 0, 5)
    );
    expect(quadratic.getLength()).toBeCloseTo(t3dQuadratic.getLength());
    expectNumberArrayClose(quadratic.getLengths(12), t3dQuadratic.getLengths(12));
    expectT3DPointsClose(quadratic.getPoints(6), t3dQuadratic.getPoints(6));
    expectT3DPointsClose(quadratic.getSpacedPoints(6), t3dQuadratic.getSpacedPoints(6));
    expectVec3Close(quadratic.pointAtU(vec3.create(), 0.35), vec3FromT3D(t3dQuadratic.getPointAt(0.35)));
  });
});

describe('paths', () => {
  it('accumulates path length and samples endpoints', () => {
    const writer = path.writer();
    const targetPath = writer
      .moveTo(vec3.fromValues(0, 0, 0))
      .lineTo(vec3.fromValues(10, 0, 0))
      .lineTo(vec3.fromValues(10, 10, 0))
      .toPath();

    const out = vec3.create();
    expect(targetPath.getLength()).toBeCloseTo(20);
    expectVec3Close(targetPath.pointAtDistance(out, 0), vec3.fromValues(0, 0, 0));
    expectVec3Close(targetPath.pointAtDistance(out, targetPath.getLength()), vec3.fromValues(10, 10, 0));
    expectVec3Close(targetPath.pointAtU(out, 0), vec3.fromValues(0, 0, 0));
    expectVec3Close(targetPath.pointAtU(out, 1), vec3.fromValues(10, 10, 0));
  });

  it('supports instance-style path operations', () => {
    const p = path.create()
      .setPolyline([
        vec3.fromValues(0, 0, 0),
        vec3.fromValues(10, 0, 0),
        vec3.fromValues(10, 10, 0)
      ]);
    const out = vec3.create();
    expect(p.getLength()).toBeCloseTo(20);
    expectVec3Close(p.pointAtDistance(out, 0), vec3.fromValues(0, 0, 0));
    expectVec3Close(p.pointAtU(out, 1), vec3.fromValues(10, 10, 0));
    expect(p.getPoints(4)).toHaveLength(3);
    expect(p.getSpacedPoints(4)).toHaveLength(5);
    expect(p.buildFrames({ divisions: 1 }).points).toHaveLength(3);
  });

  it('supports an instance-bound path writer', () => {
    const p = path.create();
    p.writer()
      .moveTo(vec3.fromValues(0, 0, 0))
      .lineTo(vec3.fromValues(5, 0, 0))
      .lineTo(vec3.fromValues(5, 5, 0));

    expect(p.segments).toHaveLength(2);
    expect(p.getLength()).toBeCloseTo(10);
  });

  it('constructs polylines, smooth fallback, and bevel fallback', () => {
    const points = [vec3.fromValues(0, 0, 0), vec3.fromValues(1, 0, 0), vec3.fromValues(1, 1, 0)];
    const p = path.create();
    p.setPolyline(points, { close: true });
    expect(p.segments).toHaveLength(3);

    p.setSmoothCurve(points, { smooth: 0 });
    expect(p.segments.every(segment => segment.type === 'line')).toBe(true);

    p.setBeveledCurve(points, { bevelRadius: 0 });
    expect(p.segments.every(segment => segment.type === 'line')).toBe(true);
  });

  it('keeps path markDirty non-recursive by default and recursive when requested', () => {
    const p = createPolyline([vec3.fromValues(0, 0, 0), vec3.fromValues(1, 0, 0)]);
    expect(p.getLength()).toBeCloseTo(1);

    p.segments[0]!.p1[0] = 2;
    expect(p.markDirty()).toBe(p);
    expect(p.getLength()).toBeCloseTo(1);

    expect(p.markDirty(true)).toBe(p);
    expect(p.getLength()).toBeCloseTo(2);
  });

  it('matches t3d smooth curve control point construction', () => {
    const p = path.create();
    p.setSmoothCurve([
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(10, 0, 0),
      vec3.fromValues(20, 10, 0)
    ], { smooth: 0.3 });

    expect(p.segments).toHaveLength(2);
    expect(p.segments[0]!.type).toBe('cubic-bezier');
    if (p.segments[0]!.type !== 'cubic-bezier') return;
    expectVec3Close(p.segments[0]!.p0, vec3.fromValues(0, 0, 0));
    expectVec3Close(p.segments[0]!.p1, vec3.fromValues(0, 0, 0));
    expectVec3Close(p.segments[0]!.p2, vec3.fromValues(7.5147185, 0, 0), 1e-5);
    expectVec3Close(p.segments[0]!.p3, vec3.fromValues(10, 0, 0));

    expect(p.segments[1]!.type).toBe('cubic-bezier');
    if (p.segments[1]!.type !== 'cubic-bezier') return;
    expectVec3Close(p.segments[1]!.p0, vec3.fromValues(10, 0, 0));
    expectVec3Close(p.segments[1]!.p1, vec3.fromValues(13.514719, 0, 0), 1e-5);
    expectVec3Close(p.segments[1]!.p2, vec3.fromValues(20, 10, 0));
    expectVec3Close(p.segments[1]!.p3, vec3.fromValues(20, 10, 0));
  });

  it('builds a closed cubic curve when requested', () => {
    const p = path.create().setSmoothCurve([
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(10, 0, 0),
      vec3.fromValues(10, 10, 0),
      vec3.fromValues(0, 10, 0)
    ], { smooth: 0.3, close: true });

    expect(p.segments).toHaveLength(4);
    expect(p.segments.every(segment => segment.type === 'cubic-bezier')).toBe(true);
    const first = p.segments[0]!;
    const last = p.segments[3]!;
    if (first.type !== 'cubic-bezier' || last.type !== 'cubic-bezier') return;
    expectVec3Close(first.p0, vec3.fromValues(0, 0, 0));
    expectVec3Close(last.p3, first.p0);
  });

  it('does not duplicate an explicit closing point for smooth curves', () => {
    const p = path.create().setSmoothCurve([
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(10, 0, 0),
      vec3.fromValues(10, 10, 0),
      vec3.fromValues(0, 0, 0)
    ], { smooth: 0.3, close: true });

    expect(p.segments).toHaveLength(3);
    const last = p.segments[2]!;
    expect(last.type).toBe('cubic-bezier');
    if (last.type !== 'cubic-bezier') return;
    expectVec3Close(last.p3, vec3.fromValues(0, 0, 0));
  });

  it('matches t3d beveled curve construction', () => {
    const p = path.create();
    p.setBeveledCurve([
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(10, 0, 0),
      vec3.fromValues(10, 10, 0)
    ], { bevelRadius: 2 });

    expect(p.segments).toHaveLength(3);
    expect(p.segments[0]!.type).toBe('line');
    if (p.segments[0]!.type !== 'line') return;
    expectVec3Close(p.segments[0]!.p0, vec3.fromValues(0, 0, 0));
    expectVec3Close(p.segments[0]!.p1, vec3.fromValues(8, 0, 0));

    expect(p.segments[1]!.type).toBe('quadratic-bezier');
    if (p.segments[1]!.type !== 'quadratic-bezier') return;
    expectVec3Close(p.segments[1]!.p0, vec3.fromValues(8, 0, 0));
    expectVec3Close(p.segments[1]!.p1, vec3.fromValues(10, 0, 0));
    expectVec3Close(p.segments[1]!.p2, vec3.fromValues(10, 2, 0));

    expect(p.segments[2]!.type).toBe('line');
    if (p.segments[2]!.type !== 'line') return;
    expectVec3Close(p.segments[2]!.p0, vec3.fromValues(10, 2, 0));
    expectVec3Close(p.segments[2]!.p1, vec3.fromValues(10, 10, 0));
  });

  it('keeps path constructors unfiltered and exposes explicit point preprocessing', () => {
    const raw = [
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(10, 0, 0),
      vec3.fromValues(10, 0, 0),
      vec3.fromValues(10, 10, 0),
      vec3.fromValues(0, 0, 0)
    ];
    const polyline = createPolyline([
      raw[0]!,
      raw[1]!,
      raw[2]!,
      raw[3]!,
      raw[4]!
    ]);
    expect(polyline.segments).toHaveLength(4);
    expect(polyline.getLength()).toBeCloseTo(20);

    const preprocessed = path.preprocessPoints(raw, { close: true });
    expect(preprocessed).toHaveLength(3);
    expectVec3Close(preprocessed[0]!, vec3.fromValues(0, 0, 0));
    expectVec3Close(preprocessed[1]!, vec3.fromValues(10, 0, 0));
    expectVec3Close(preprocessed[2]!, vec3.fromValues(10, 10, 0));

    const closed = createPolyline(preprocessed, { close: true });
    expect(closed.segments).toHaveLength(3);
  });

  it('matches t3d zero-length smooth and beveled curve construction behavior', () => {
    const duplicatePoints = [
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(10, 0, 0)
    ];

    const oursSmooth = path.create();
    oursSmooth.setSmoothCurve(duplicatePoints, { smooth: 0.3 });
    const t3dSmooth = new T3DCurvePath3();
    t3dSmooth.setSmoothCurves(duplicatePoints.map(point => new T3DVector3(point[0]!, point[1]!, point[2]!)), { smooth: 0.3 });
    expect(oursSmooth.segments).toHaveLength(t3dSmooth.curves.length);
    expect(oursSmooth.segments[0]!.type).toBe('cubic-bezier');
    expect(oursSmooth.segments[1]!.type).toBe('cubic-bezier');
    if (oursSmooth.segments[1]!.type !== 'cubic-bezier') return;
    expect(Number.isNaN(oursSmooth.segments[1]!.p1[0]!)).toBe(true);
    expect(Number.isNaN(t3dSmooth.curves[1]!.v1!.x)).toBe(true);

    const oursBeveled = path.create();
    oursBeveled.setBeveledCurve(duplicatePoints, { bevelRadius: 2 });
    const t3dBeveled = new T3DCurvePath3();
    t3dBeveled.setBeveledCurves(duplicatePoints.map(point => new T3DVector3(point[0]!, point[1]!, point[2]!)), { bevelRadius: 2 });
    expect(oursBeveled.segments).toHaveLength(t3dBeveled.curves.length);
    expect(oursBeveled.segments.map(segment => segment.type)).toEqual(['line', 'quadratic-bezier', 'line']);
  });

  it('matches t3d npm smooth and beveled curve controls at runtime', () => {
    const points = [
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(5, 2, 1),
      vec3.fromValues(12, -1, 4),
      vec3.fromValues(18, 3, -2)
    ];
    const t3dPoints = points.map(toT3DVector3);

    const smooth = path.create().setSmoothCurve(points, { smooth: 0.45 });
    const t3dSmooth = new T3DCurvePath3();
    t3dSmooth.setSmoothCurves(t3dPoints, { smooth: 0.45 });
    expectCurvePathControlsClose(smooth, t3dSmooth, 1e-5);

    const beveled = path.create().setBeveledCurve(points, { bevelRadius: 1.75, close: true });
    const t3dBeveled = new T3DCurvePath3();
    t3dBeveled.setBeveledCurves(t3dPoints, { bevelRadius: 1.75, close: true });
    expectCurvePathControlsClose(beveled, t3dBeveled, 1e-5);
  });

  it('gets points and spaced points', () => {
    const p = path.create();
    p.addSegment(segment.createLine(vec3.fromValues(0, 0, 0), vec3.fromValues(1, 0, 0)));
    p.addSegment(segment.createCubicBezier(
      vec3.fromValues(1, 0, 0),
      vec3.fromValues(2, 0, 0),
      vec3.fromValues(3, 0, 0),
      vec3.fromValues(4, 0, 0)
    ));
    expect(p.getPoints(4)).toHaveLength(6);
    const spaced = p.getSpacedPoints(4);
    expect(spaced).toHaveLength(5);
    expectVec3Close(spaced[0]!, vec3.fromValues(0, 0, 0));
    expectVec3Close(spaced[4]!, vec3.fromValues(4, 0, 0));
  });

  it('clamps path getPoints divisions to avoid NaN samples', () => {
    const p = path.create();
    p.addSegment(segment.createCubicBezier(
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(1, 0, 0),
      vec3.fromValues(2, 0, 0),
      vec3.fromValues(3, 0, 0)
    ));
    const points = p.getPoints(0);
    expect(points).toHaveLength(2);
    for (const point of points) {
      expect(Number.isNaN(point[0]!)).toBe(false);
      expect(Number.isNaN(point[1]!)).toBe(false);
      expect(Number.isNaN(point[2]!)).toBe(false);
    }
  });

  it('normalizes invalid sampling divisions across path and segment APIs', () => {
    const p = path.create().addSegment(segment.createCubicBezier(
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(1, 0, 0),
      vec3.fromValues(2, 0, 0),
      vec3.fromValues(3, 0, 0)
    ));
    const curve = p.segments[0]!;

    expect(p.getPoints(Number.NaN)).toHaveLength(13);
    expect(p.getSpacedPoints(Number.POSITIVE_INFINITY)).toHaveLength(6);
    expect(p.getSpacedPoints(-1)).toHaveLength(2);
    expect(curve.getPoints(Number.NaN)).toHaveLength(6);
    expect(curve.getSpacedPoints(Number.POSITIVE_INFINITY)).toHaveLength(6);
    expect(curve.getLengths(-1)).toHaveLength(2);

    const frames = p.buildFrames({ divisions: 0 });
    expect(frames.points).toHaveLength(2);
    for (const point of frames.points) {
      expect(point.every(Number.isFinite)).toBe(true);
    }
  });

  it('builds orthonormal 3D frames', () => {
    const p = path.create();
    p.setSmoothCurve([
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(5, 2, 0),
      vec3.fromValues(10, 0, 2),
      vec3.fromValues(15, 4, 0)
    ], { smooth: 0.3 });

    const frames = p.buildFrames({ divisions: 4 });
    expect(frames.points.length).toBeGreaterThan(0);

    for (let i = 0; i < frames.points.length; i++) {
      const t = frames.tangents[i]!;
      const n = frames.normals[i]!;
      const b = frames.binormals[i]!;
      expect(vec3.len(t)).toBeCloseTo(1, 4);
      expect(vec3.len(n)).toBeCloseTo(1, 4);
      expect(vec3.len(b)).toBeCloseTo(1, 4);
      expect(vec3.dot(t, n)).toBeCloseTo(0, 4);
      expect(vec3.dot(t, b)).toBeCloseTo(0, 4);
      expect(vec3.dot(n, b)).toBeCloseTo(0, 4);
    }
  });

  it('matches a t3d buildFrames polyline fixture', () => {
    const p = createPolyline([
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(10, 0, 0),
      vec3.fromValues(10, 10, 0),
      vec3.fromValues(0, 10, 5)
    ]);
    const frames = p.buildFrames({
      divisions: 3,
      initialNormal: vec3.fromValues(0, 0, 1),
      transport: true,
      fixLine: true,
      close: false
    });

    const expectedTangents = [
      vec3.fromValues(1, 0, 0),
      vec3.fromValues(0.7071067811865475, 0.7071067811865475, 0),
      vec3.fromValues(-0.6324555320336759, 0.7071067811865476, 0.31622776601683794),
      vec3.fromValues(-0.8944271909999159, 0, 0.4472135954999579)
    ];
    const expectedNormals = [
      vec3.fromValues(0, 0, 1),
      vec3.fromValues(0, 0, 1),
      vec3.fromValues(-0.02242315976828138, -0.4247904357316765, 0.9050139709512217),
      vec3.fromValues(0.3575209564268324, -0.6007443953781136, 0.7150419128536649)
    ];
    const expectedBinormals = [
      vec3.fromValues(0, -1, 0),
      vec3.fromValues(0.7071067811865476, -0.7071067811865476, 0),
      vec3.fromValues(0.7742720464449211, 0.5652902667753023, 0.28451662936127553),
      vec3.fromValues(0.26866106103349446, 0.7994411619511375, 0.5373221220669889)
    ];

    expect(frames.points).toHaveLength(4);
    expect(frames.tangentTypes).toEqual([0, 0, 0, 0]);
    expect(frames.sharps).toEqual([false, true, true, false]);
    expect(frames.lengths).toEqual([0, 10, 20, 31.18033988749895]);
    expect(frames.widthScales).toEqual([1, 1.414213562373095, 1.414213562373095, 1]);

    for (let i = 0; i < 4; i++) {
      expectVec3Close(frames.tangents[i]!, expectedTangents[i]!, 1e-5);
      expectVec3Close(frames.normals[i]!, expectedNormals[i]!, 1e-5);
      expectVec3Close(frames.binormals[i]!, expectedBinormals[i]!, 1e-5);
    }
  });

  it('matches a t3d buildFrames closed non-transport fixture', () => {
    const p = createPolyline([
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(10, 0, 0),
      vec3.fromValues(10, 10, 0),
      vec3.fromValues(0, 10, 5)
    ], { close: true });
    const frames = p.buildFrames({
      divisions: 3,
      initialNormal: vec3.fromValues(0, 0, 1),
      transport: false,
      fixLine: true,
      close: true
    });

    const expectedTangents = [
      vec3.fromValues(1, 0, 0),
      vec3.fromValues(0.7071067811865475, 0.7071067811865475, 0),
      vec3.fromValues(-0.6324555320336759, 0.7071067811865476, 0.31622776601683794),
      vec3.fromValues(-0.7071067811865475, -0.7071067811865475, 0),
      vec3.fromValues(1, 0, 0)
    ];
    const expectedNormals = [
      vec3.fromValues(0, 0, 1),
      vec3.fromValues(0, 0, 1),
      vec3.fromValues(0.210818510677892, -0.23570226039551587, 0.948683298050514),
      vec3.fromValues(0, 0, 1),
      vec3.fromValues(0, 0, 1)
    ];
    const expectedBinormals = [
      vec3.fromValues(0, -1, 0),
      vec3.fromValues(0.7071067811865476, -0.7071067811865476, 0),
      vec3.fromValues(0.7453559924999298, 0.6666666666666666, 0),
      vec3.fromValues(-0.7071067811865476, 0.7071067811865476, 0),
      vec3.fromValues(0, -1, 0)
    ];

    expect(frames.points).toHaveLength(5);
    expect(frames.tangentTypes).toEqual([0, 0, 0, 0, 0]);
    expect(frames.sharps).toEqual([false, true, true, true, false]);
    expect(frames.widthScales).toEqual([1, 1.414213562373095, 1.414213562373095, 1.415, 1]);
    for (let i = 0; i < 5; i++) {
      expect(frames.lengths[i]).toBeCloseTo([0, 10, 20, 31.18033988749895, 42.3606797749979][i]!);
      expectVec3Close(frames.tangents[i]!, expectedTangents[i]!, 1e-5);
      expectVec3Close(frames.normals[i]!, expectedNormals[i]!, 1e-5);
      expectVec3Close(frames.binormals[i]!, expectedBinormals[i]!, 1e-5);
    }
  });

  it('matches t3d npm buildFrames at runtime', () => {
    const points = [
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(10, 0, 0),
      vec3.fromValues(10, 10, 0),
      vec3.fromValues(0, 10, 5)
    ];
    const oursPath = createPolyline(points, { close: true });
    const ours = oursPath.buildFrames({
      divisions: 3,
      initialNormal: vec3.fromValues(0, 0, 1),
      transport: false,
      fixLine: true,
      close: true
    });

    const t3dPath = new T3DCurvePath3();
    t3dPath.setPolylines(points.map(point => new T3DVector3(point[0]!, point[1]!, point[2]!)), { close: true });
    const t3d = t3dPath.computeFrames({
      divisions: 3,
      up: new T3DVector3(0, 0, 1),
      frenet: false,
      fixLine: true,
      close: true
    });

    expect(ours.points).toHaveLength(t3d.points.length);
    expect(ours.tangentTypes).toEqual(t3d.tangentTypes);
    expect(ours.sharps).toEqual(t3d.sharps);
    for (let i = 0; i < t3d.points.length; i++) {
      expect(ours.lengths[i]).toBeCloseTo(t3d.lengths[i]!);
      expect(ours.widthScales[i]).toBeCloseTo(t3d.widthScales[i]!);
      expectVec3Close(ours.points[i]!, vec3FromT3D(t3d.points[i]!), 1e-5);
      expectVec3Close(ours.tangents[i]!, vec3FromT3D(t3d.tangents[i]!), 1e-5);
      expectVec3Close(ours.normals[i]!, vec3FromT3D(t3d.normals[i]!), 1e-5);
      expectVec3Close(ours.binormals[i]!, vec3FromT3D(t3d.binormals[i]!), 1e-5);
    }
  });

  it('matches t3d npm CurvePath3 getPoint and getPoints at runtime', () => {
    const points = [
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(3, 6, 1),
      vec3.fromValues(10, -2, 4),
      vec3.fromValues(14, 2, -1)
    ];
    const ours = path.create().setSmoothCurve(points, { smooth: 0.35 });
    const t3d = new T3DCurvePath3();
    t3d.setSmoothCurves(points.map(toT3DVector3), { smooth: 0.35 });

    expect(ours.getLength()).toBeCloseTo(t3d.getLength());
    expectNumberArrayClose(ours.getLengths(), t3d.getLengths(), 1e-5);
    expectT3DPointsClose(ours.getPoints(5), t3d.getPoints(5), 1e-5);
    for (const u of [0, 0.125, 0.5, 0.875, 1]) {
      expectVec3Close(ours.pointAtU(vec3.create(), u), vec3FromT3D(t3d.getPoint(u)), 1e-5);
    }
  });

  it('matches t3d npm buildFrames for transport and fixLine option variants', () => {
    const points = [
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(8, 0, 0),
      vec3.fromValues(10, 3, 2),
      vec3.fromValues(16, 4, -1)
    ];
    const t3dPoints = points.map(toT3DVector3);

    const transportPath = path.create().setSmoothCurve(points, { smooth: 0.4 });
    const t3dTransportPath = new T3DCurvePath3();
    t3dTransportPath.setSmoothCurves(t3dPoints, { smooth: 0.4 });
    expectFramesClose(
      transportPath.buildFrames({ divisions: 4, initialNormal: vec3.fromValues(0, 0, 1), transport: true, fixLine: true }),
      t3dTransportPath.computeFrames({ divisions: 4, up: new T3DVector3(0, 0, 1), frenet: true, fixLine: true }),
      1e-5
    );

    const mixedPath = path.writer()
      .moveTo(points[0]!)
      .lineTo(points[1]!)
      .cubicTo(vec3.fromValues(9, 4, 0), vec3.fromValues(13, 5, 3), points[3]!)
      .toPath();
    const t3dMixedPath = new T3DCurvePath3();
    t3dMixedPath.setPolylines([toT3DVector3(points[0]!), toT3DVector3(points[1]!)]);
    t3dMixedPath.curves.push(new T3DCubicBezierCurve3(
      toT3DVector3(points[1]!),
      new T3DVector3(9, 4, 0),
      new T3DVector3(13, 5, 3),
      toT3DVector3(points[3]!)
    ));
    expectFramesClose(
      mixedPath.buildFrames({ divisions: 3, initialNormal: vec3.fromValues(0, 1, 0), transport: false, fixLine: false }),
      t3dMixedPath.computeFrames({ divisions: 3, up: new T3DVector3(0, 1, 0), frenet: false, fixLine: false }),
      1e-5
    );
  });

  it('handles empty paths without producing samples', () => {
    const p = path.create();
    const out = vec3.fromValues(9, 9, 9);
    expect(p.getLength()).toBe(0);
    expect(p.buildFrames().points).toHaveLength(0);
    expectVec3Close(p.pointAtU(out, 0.5), vec3.fromValues(9, 9, 9));
  });
});

describe('geometry builders', () => {
  it('builds empty tube and ribbon geometry for empty frames', () => {
    const frames = path.create().buildFrames();
    expect(geometry.createTube(frames)).toEqual({ positions: [], normals: [], uvs: [], uvs2: [], indices: [] });
    expect(geometry.createRibbon(frames)).toEqual({ positions: [], normals: [], uvs: [], uvs2: [], indices: [] });
  });

  it('builds indexed extruded rectangle geometry', () => {
    const extrudeGeom = geometry.createExtrudeShape({
      contour: [[0, 0], [1, 0], [1, 1], [0, 1]],
      depth: 2
    });

    expect(extrudeGeom.positions).toHaveLength(24 * 3);
    expect(extrudeGeom.normals).toHaveLength(24 * 3);
    expect(extrudeGeom.uvs).toHaveLength(24 * 2);
    expect(extrudeGeom.uvs2).toEqual(extrudeGeom.uvs);
    expect(extrudeGeom.indices).toHaveLength(36);
    expectVec3Close(vec3.fromValues(extrudeGeom.positions[0]!, extrudeGeom.positions[1]!, extrudeGeom.positions[2]!), vec3.fromValues(0, 1, 0));
  });

  it('supports extruded shape cap options and holes', () => {
    const withoutTop = geometry.createExtrudeShape({
      contour: [[0, 0], [2, 0], [2, 2], [0, 2]],
      generateTop: false
    });
    const withoutBottom = geometry.createExtrudeShape({
      contour: [[0, 0], [2, 0], [2, 2], [0, 2]],
      generateBottom: false
    });
    const withHole = geometry.createExtrudeShape({
      contour: [[0, 0], [4, 0], [4, 4], [0, 4]],
      holes: [[[1, 1], [1, 3], [3, 3], [3, 1]]]
    });

    expect(withoutTop.positions).toHaveLength(20 * 3);
    expect(withoutTop.indices).toHaveLength(30);
    expect(withoutBottom.positions).toHaveLength(20 * 3);
    expect(withoutBottom.indices).toHaveLength(30);
    expect(withHole.positions).toHaveLength(48 * 3);
    expect(withHole.indices.length).toBeGreaterThan(36);
  });

  it('mutates extruded shape contours like t3d', () => {
    const contour = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
    const hole = [[0.25, 0.25], [0.25, 0.75], [0.75, 0.75], [0.75, 0.25], [0.25, 0.25]];

    geometry.createExtrudeShape({ contour, holes: [hole] });

    expect(contour).toEqual([[0, 0], [0, 1], [1, 1], [1, 0]]);
    expect(hole).toEqual([[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75]]);
  });

  it('builds empty extruded shape geometry for empty path frames', () => {
    const frames = path.create().buildFrames();
    expect(geometry.createExtrudeShape({
      contour: [[0, 0], [1, 0], [1, 1]],
      pathFrames: frames
    })).toEqual({ positions: [], normals: [], uvs: [], uvs2: [], indices: [] });
  });

  it('builds indexed tube side geometry from straight frames', () => {
    const frames = createStraightFrames();
    const tubeGeom = geometry.createTube(frames, { radius: 1, radialSegments: 4 });
    const vertexCount = frames.points.length * (4 + 1);

    expect(tubeGeom.positions).toHaveLength(vertexCount * 3);
    expect(tubeGeom.normals).toHaveLength(vertexCount * 3);
    expect(tubeGeom.uvs).toHaveLength(vertexCount * 2);
    expect(tubeGeom.uvs2).toHaveLength(vertexCount * 2);
    expect(tubeGeom.indices).toHaveLength((frames.points.length - 1) * 4 * 6);
    expectVec3Close(vec3.fromValues(tubeGeom.positions[0]!, tubeGeom.positions[1]!, tubeGeom.positions[2]!), vec3.fromValues(0, 1, 0));
    expectVec3Close(vec3.fromValues(tubeGeom.normals[0]!, tubeGeom.normals[1]!, tubeGeom.normals[2]!), vec3.fromValues(0, 1, 0));
  });

  it('adds tube caps with duplicated cap vertices', () => {
    const frames = createStraightFrames();
    const tubeGeom = geometry.createTube(frames, {
      radius: 1,
      radialSegments: 4,
      generateStartCap: true,
      generateEndCap: true
    });
    const sideVertexCount = frames.points.length * (4 + 1);
    const capVertexCount = 4 * 2;

    expect(tubeGeom.positions).toHaveLength((sideVertexCount + capVertexCount) * 3);
    expect(tubeGeom.indices).toHaveLength((frames.points.length - 1) * 4 * 6 + 2 * (4 - 2) * 3);
  });

  it('preserves degenerate cap topology for zero-radius tubes', () => {
    const frames = createStraightFrames();
    const cases = [
      { generateStartCap: false, generateEndCap: false, vertices: 10, triangles: 8 },
      { generateStartCap: true, generateEndCap: false, vertices: 14, triangles: 10 },
      { generateStartCap: false, generateEndCap: true, vertices: 14, triangles: 10 },
      { generateStartCap: true, generateEndCap: true, vertices: 18, triangles: 12 }
    ];

    for (const options of cases) {
      const tubeGeom = geometry.createTube(frames, {
        radius: 0,
        radialSegments: 4,
        generateStartCap: options.generateStartCap,
        generateEndCap: options.generateEndCap
      });
      expect(tubeGeom.positions).toHaveLength(options.vertices * 3);
      expect(tubeGeom.normals).toHaveLength(options.vertices * 3);
      expect(tubeGeom.uvs).toHaveLength(options.vertices * 2);
      expect(tubeGeom.uvs2).toHaveLength(options.vertices * 2);
      expect(tubeGeom.indices).toHaveLength(options.triangles * 3);
    }
  });

  it('keeps wrapper-specific zero widthScale behavior at sharp sections', () => {
    const frames = createZeroWidthSharpFrames();
    const extrudeGeom = geometry.createExtrudeShape({
      contour: [[0, 0], [1, 0], [0, 1]],
      pathFrames: frames,
      generateTop: false,
      generateBottom: false
    });
    const extrudeMiddlePositions: number[][] = [];
    for (let i = 0; i < extrudeGeom.positions.length; i += 3) {
      if (extrudeGeom.positions[i] === 1) extrudeMiddlePositions.push(extrudeGeom.positions.slice(i, i + 3));
    }
    expect(extrudeMiddlePositions.length).toBeGreaterThan(0);
    expect(extrudeMiddlePositions.every(position => Math.abs(position[2]!) <= EPS)).toBe(true);

    const tubeGeom = geometry.createTube(frames, { radius: 1, radialSegments: 4 });
    const middleRingStart = 5;
    const middleRingPositions = tubeGeom.positions.slice(middleRingStart * 3, (middleRingStart + 5) * 3);
    expect(middleRingPositions.some((value, index) => index % 3 === 2 && Math.abs(value) > 0.9)).toBe(true);
    expect(tubeGeom.positions.every(Number.isFinite)).toBe(true);
    expect(tubeGeom.normals.every(Number.isFinite)).toBe(true);
  });

  it('supports a single sweep section with caps but no side connections', () => {
    const frames = createSingleSectionFrames();
    const tubeGeom = geometry.createTube(frames, {
      radius: 1,
      radialSegments: 4,
      generateStartCap: true,
      generateEndCap: true
    });
    expect(tubeGeom.positions).toHaveLength(13 * 3);
    expect(tubeGeom.normals).toHaveLength(13 * 3);
    expect(tubeGeom.uvs).toHaveLength(13 * 2);
    expect(tubeGeom.uvs2).toHaveLength(13 * 2);
    expect(tubeGeom.indices).toHaveLength(4 * 3);

    const extrudeGeom = geometry.createExtrudeShape({
      contour: [[0, 0], [1, 0], [1, 1], [0, 1]],
      pathFrames: frames
    });
    expect(extrudeGeom.positions).toHaveLength(16 * 3);
    expect(extrudeGeom.normals).toHaveLength(16 * 3);
    expect(extrudeGeom.uvs).toHaveLength(16 * 2);
    expect(extrudeGeom.uvs2).toHaveLength(16 * 2);
    expect(extrudeGeom.indices).toHaveLength(4 * 3);
  });

  it('preserves tube UV seams and analytic cap normals through the sweep core', () => {
    const frames = createStraightFrames();
    const tubeGeom = geometry.createTube(frames, {
      radius: 1,
      radialSegments: 4,
      generateStartCap: true,
      generateEndCap: true
    });
    const ringSize = 5;
    const sideVertexCount = frames.points.length * ringSize;

    for (let ring = 0; ring < frames.points.length; ring++) {
      const first = ring * ringSize;
      const seam = first + 4;
      expectNumberArrayClose(
        tubeGeom.positions.slice(first * 3, first * 3 + 3),
        tubeGeom.positions.slice(seam * 3, seam * 3 + 3)
      );
      expectNumberArrayClose(
        tubeGeom.normals.slice(first * 3, first * 3 + 3),
        tubeGeom.normals.slice(seam * 3, seam * 3 + 3)
      );
      expect(tubeGeom.uvs[first * 2 + 1]).toBe(0);
      expect(tubeGeom.uvs[seam * 2 + 1]).toBe(1);
    }

    for (let i = sideVertexCount; i < sideVertexCount + 4; i++) {
      expectNumberArrayClose(tubeGeom.normals.slice(i * 3, i * 3 + 3), [-1, 0, 0]);
    }
    for (let i = sideVertexCount + 4; i < sideVertexCount + 8; i++) {
      expectNumberArrayClose(tubeGeom.normals.slice(i * 3, i * 3 + 3), [1, 0, 0]);
    }
  });

  it('keeps tube normals finite and normalized at sharp path sections', () => {
    const frames = createPolyline([
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(2, 0, 0),
      vec3.fromValues(2, 2, 0)
    ]).buildFrames({ initialNormal: vec3.fromValues(0, 0, 1) });
    const tubeGeom = geometry.createTube(frames, { radius: 0.5, radialSegments: 8 });

    expect(frames.sharps[1]).toBe(true);
    for (let i = 0; i < tubeGeom.normals.length; i += 3) {
      const length = Math.hypot(tubeGeom.normals[i]!, tubeGeom.normals[i + 1]!, tubeGeom.normals[i + 2]!);
      expect(Number.isFinite(length)).toBe(true);
      expect(length).toBeCloseTo(1);
    }
  });

  it('preserves negative-depth shape winding, hard sides and UV2 semantics', () => {
    const extrudeGeom = geometry.createExtrudeShape({
      contour: [[0, 0], [2, 0], [2, 1], [0, 1]],
      depth: -2
    });

    expect(extrudeGeom.uvs2).toEqual(extrudeGeom.uvs);
    expect(Math.max(...extrudeGeom.positions.filter((_, index) => index % 3 === 2))).toBe(2);
    expect(Math.min(...extrudeGeom.positions.filter((_, index) => index % 3 === 2))).toBe(0);

    let hasStartCapNormal = false;
    let hasEndCapNormal = false;
    for (let i = 0; i < extrudeGeom.positions.length; i += 3) {
      const z = extrudeGeom.positions[i + 2]!;
      const nx = extrudeGeom.normals[i]!;
      const ny = extrudeGeom.normals[i + 1]!;
      const nz = extrudeGeom.normals[i + 2]!;
      if (z === 0 && nx === 0 && ny === 0 && nz < -0.99) hasStartCapNormal = true;
      if (z === 2 && nx === 0 && ny === 0 && nz > 0.99) hasEndCapNormal = true;
    }
    expect(hasStartCapNormal).toBe(true);
    expect(hasEndCapNormal).toBe(true);

    const normalsAtCorners = new Map<string, Set<string>>();
    for (let i = 0; i < extrudeGeom.positions.length; i += 3) {
      const position = extrudeGeom.positions.slice(i, i + 3).join(',');
      const normal = extrudeGeom.normals.slice(i, i + 3).map(value => value.toFixed(5)).join(',');
      const normals = normalsAtCorners.get(position) ?? new Set<string>();
      normals.add(normal);
      normalsAtCorners.set(position, normals);
    }
    expect([...normalsAtCorners.values()].some(normals => normals.size >= 3)).toBe(true);
  });

  it('sweeps concave profiles with multiple holes without invalid attributes', () => {
    const extrudeGeom = geometry.createExtrudeShape({
      contour: [[0, 0], [5, 0], [5, 5], [3, 3], [0, 5]],
      holes: [
        [[0.5, 0.5], [0.5, 1.5], [1.5, 1.5], [1.5, 0.5]],
        [[3.5, 0.5], [3.5, 1.5], [4.5, 1.5], [4.5, 0.5]]
      ],
      depth: 2
    });

    expect(extrudeGeom.positions.length).toBeGreaterThan(0);
    expect(extrudeGeom.indices.length).toBeGreaterThan(0);
    expect(extrudeGeom.positions.every(Number.isFinite)).toBe(true);
    expect(extrudeGeom.normals.every(Number.isFinite)).toBe(true);
    expect(extrudeGeom.uvs.every(Number.isFinite)).toBe(true);
    expect(Math.max(...extrudeGeom.indices)).toBeLessThan(extrudeGeom.positions.length / 3);
  });

  it('builds indexed ribbon geometry from straight frames', () => {
    const frames = createStraightFrames();
    const ribbonGeom = geometry.createRibbon(frames, { width: 2, arrow: false });
    const vertexCount = frames.points.length * 2;

    expect(ribbonGeom.positions).toHaveLength(vertexCount * 3);
    expect(ribbonGeom.normals).toHaveLength(vertexCount * 3);
    expect(ribbonGeom.uvs).toHaveLength(vertexCount * 2);
    expect(ribbonGeom.uvs2).toHaveLength(vertexCount * 2);
    expect(ribbonGeom.indices).toHaveLength((frames.points.length - 1) * 6);
    expectVec3Close(vec3.fromValues(ribbonGeom.positions[0]!, ribbonGeom.positions[1]!, ribbonGeom.positions[2]!), vec3.fromValues(0, 0, -1));
    expectVec3Close(vec3.fromValues(ribbonGeom.positions[3]!, ribbonGeom.positions[4]!, ribbonGeom.positions[5]!), vec3.fromValues(0, 0, 1));
  });

  it('supports one-sided ribbons and arrow heads', () => {
    const frames = createStraightFrames();
    const left = geometry.createRibbon(frames, { width: 2, side: 'left', arrow: false });
    const right = geometry.createRibbon(frames, { width: 2, side: 'right', arrow: false });
    const arrow = geometry.createRibbon(frames, { width: 2, arrow: true });

    expectVec3Close(vec3.fromValues(left.positions[3]!, left.positions[4]!, left.positions[5]!), vec3.fromValues(0, 0, 0));
    expectVec3Close(vec3.fromValues(right.positions[0]!, right.positions[1]!, right.positions[2]!), vec3.fromValues(0, 0, 0));
    expect(arrow.positions).toHaveLength((frames.points.length * 2 + 3) * 3);
    expect(arrow.indices.slice(-3)).toEqual([frames.points.length * 2 + 2, frames.points.length * 2, frames.points.length * 2 + 1]);
  });

  it('applies non-sharp tube miter correction only along the bend direction', () => {
    const frames = createPolyline([
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(4, 0, 0),
      vec3.fromValues(8, 0.8, 0)
    ]).buildFrames({ initialNormal: vec3.fromValues(0, 0, 1) });
    expect(frames.sharps[1]).toBe(false);
    expect(frames.widthScales[1]).toBeGreaterThan(1);

    const tube = geometry.createTube(frames, {
      radius: 1,
      radialSegments: 4,
      cornerTransition: false
    });
    const middleNormalPoint = vec3.fromValues(
      tube.positions[5 * 3]!,
      tube.positions[5 * 3 + 1]!,
      tube.positions[5 * 3 + 2]!
    );
    expect(vec3.distance(middleNormalPoint, frames.points[1]!)).toBeCloseTo(1);
  });

  it('uses directional miter correction for spatial ribbons', () => {
    const diagonal = 1 / Math.sqrt(2);
    const frames: PathFrames = {
      points: [
        vec3.fromValues(0, 0, 0),
        vec3.fromValues(1, 0, 0),
        vec3.fromValues(2, 0, 0)
      ],
      tangents: [
        vec3.fromValues(1, 0, 0),
        vec3.fromValues(1, 0, 0),
        vec3.fromValues(1, 0, 0)
      ],
      normals: [
        vec3.fromValues(0, 1, 0),
        vec3.fromValues(0, 1, 0),
        vec3.fromValues(0, 1, 0)
      ],
      binormals: [
        vec3.fromValues(0, 0, 1),
        vec3.fromValues(0, 0, 1),
        vec3.fromValues(0, 0, 1)
      ],
      bisectors: [
        vec3.fromValues(0, 0, 1),
        vec3.fromValues(0, diagonal, diagonal),
        vec3.fromValues(0, 0, 1)
      ],
      lengths: [0, 1, 2],
      widthScales: [1, Math.sqrt(2), 1],
      sharps: [false, false, false],
      tangentTypes: [0, 0, 0]
    };

    const ribbon = geometry.createRibbon(frames, {
      width: 2,
      arrow: false,
      cornerTransition: false
    });
    const expectedAddition = (Math.sqrt(2) - 1) / 2;
    expectNumberArrayClose(
      ribbon.positions.slice(3 * 3, 3 * 3 + 3),
      [1, expectedAddition, 1 + expectedAddition]
    );
  });

  it('keeps corner transitions opt-in and supports the legacy Ribbon sharp alias', () => {
    const frames = createPolyline([
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(4, 0, 0),
      vec3.fromValues(4, 4, 0)
    ]).buildFrames({ initialNormal: vec3.fromValues(0, 0, 1) });
    expect(frames.sharps[1]).toBe(true);

    const ribbon = geometry.createRibbon(frames, { width: 2, arrow: false });
    const explicitSimpleRibbon = geometry.createRibbon(frames, {
      width: 2,
      arrow: false,
      cornerTransition: false
    });
    const legacyTransition = geometry.createRibbon(frames, {
      width: 2,
      arrow: false,
      sharp: true
    });
    const explicitTransition = geometry.createRibbon(frames, {
      width: 2,
      arrow: false,
      cornerTransition: true,
      sharp: false
    });
    const explicitDisableWins = geometry.createRibbon(frames, {
      width: 2,
      arrow: false,
      cornerTransition: false,
      sharp: true
    });
    expect(ribbon.positions).toHaveLength(6 * 3);
    expect(ribbon.indices).toHaveLength(4 * 3);
    expect(explicitSimpleRibbon).toEqual(ribbon);
    expect(explicitDisableWins).toEqual(ribbon);
    expect(explicitTransition.positions).toHaveLength(10 * 3);
    expect(explicitTransition.indices).toHaveLength(6 * 3);
    expect(legacyTransition).toEqual(explicitTransition);
    const ribbonUs = [0, 1, 2, 3, 4].map(sectionIndex => explicitTransition.uvs[sectionIndex * 4]!);
    const ribbonUs2 = [0, 1, 2, 3, 4].map(sectionIndex => explicitTransition.uvs2[sectionIndex * 4]!);
    expect(ribbonUs).toEqual([...ribbonUs].sort((a, b) => a - b));
    expect(ribbonUs2).toEqual([...ribbonUs2].sort((a, b) => a - b));

    const tube = geometry.createTube(frames, { radius: 1, radialSegments: 4 });
    const transitionedTube = geometry.createTube(frames, {
      radius: 1,
      radialSegments: 4,
      cornerTransition: true
    });
    expect(tube.positions).toHaveLength(15 * 3);
    expect(tube.indices).toHaveLength(16 * 3);
    expect(transitionedTube.positions).toHaveLength(25 * 3);
    expect(transitionedTube.indices).toHaveLength(28 * 3);
    const zeroRadiusTube = geometry.createTube(frames, {
      radius: 0,
      radialSegments: 4,
      cornerTransition: true
    });
    expect(zeroRadiusTube.positions).toHaveLength(15 * 3);
    expect(zeroRadiusTube.indices).toHaveLength(16 * 3);

    const contour = [[-1, -1], [-1, 1], [1, 1], [1, -1]];
    const extrude = geometry.createExtrudeShape({
      contour: contour.map(point => [...point]),
      pathFrames: frames,
      generateTop: false,
      generateBottom: false
    });
    const transitionedExtrude = geometry.createExtrudeShape({
      contour: contour.map(point => [...point]),
      pathFrames: frames,
      generateTop: false,
      generateBottom: false,
      cornerTransition: true
    });
    expect(extrude.positions).toHaveLength(24 * 3);
    expect(extrude.indices).toHaveLength(16 * 3);
    expect(transitionedExtrude.positions).toHaveLength(40 * 3);
    expect(transitionedExtrude.indices).toHaveLength(24 * 3);

    const withHole = geometry.createExtrudeShape({
      contour: [[-2, -2], [-2, 2], [2, 2], [2, -2]],
      holes: [[[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]],
      pathFrames: frames,
      generateTop: false,
      generateBottom: false
    });
    expect(withHole.positions.every(Number.isFinite)).toBe(true);
    expect(withHole.normals.every(Number.isFinite)).toBe(true);
    expect(Math.max(...withHole.indices)).toBeLessThan(withHole.positions.length / 3);
  });
});

describe('internal sweep core', () => {
  it('resolves a sharp corner into affine join sections with monotonic distances', () => {
    const frames = createPolyline([
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(4, 0, 0),
      vec3.fromValues(4, 4, 0)
    ]).buildFrames({ initialNormal: vec3.fromValues(0, 0, 1) });
    const sections = createCornerSections(frames, [[[-1, 0], [1, 0]]], {
      cornerTransition: true,
      resolveWidthScale: value => value ?? 1
    });
    expect(sections.map(section => section.role)).toEqual([
      'regular',
      'join-in',
      'join-center',
      'join-out',
      'regular'
    ]);
    expectNumberArrayClose(sections.map(section => section.length), [0, 3, 4, 5, 8]);

    const inner = vec3.create();
    const outer = vec3.create();
    const centerInner = transformCornerPoint(inner, sections[2]!, [-1, 0]).slice();
    const centerOuter = transformCornerPoint(outer, sections[2]!, [1, 0]).slice();
    expectNumberArrayClose(transformCornerPoint(inner, sections[1]!, [-1, 0]), centerInner);
    expectNumberArrayClose(transformCornerPoint(inner, sections[3]!, [-1, 0]), centerInner);
    expectNumberArrayClose(centerInner, [3, 1, 0]);
    expectNumberArrayClose(centerOuter, [5, -1, 0]);
    expectNumberArrayClose(transformCornerPoint(outer, sections[1]!, [1, 0]), [3, -1, 0]);
    expectNumberArrayClose(transformCornerPoint(outer, sections[3]!, [1, 0]), [5, 1, 0]);
  });

  it('clamps adjacent corner transitions to short path segments', () => {
    const frames = createPolyline([
      vec3.fromValues(0, 0, 0),
      vec3.fromValues(1, 0, 0),
      vec3.fromValues(1, 1, 0),
      vec3.fromValues(2, 1, 0)
    ]).buildFrames({ initialNormal: vec3.fromValues(0, 0, 1) });
    const sections = createCornerSections(frames, [[[-1, 0], [1, 0]]], {
      cornerTransition: true,
      resolveWidthScale: value => value ?? 1
    });
    expect(sections.map(section => section.role)).toEqual([
      'regular',
      'join-in',
      'join-center',
      'join-out',
      'join-in',
      'join-center',
      'join-out',
      'regular'
    ]);
    for (let i = 1; i < sections.length; i++) {
      expect(sections[i]!.length).toBeGreaterThanOrEqual(sections[i - 1]!.length);
    }
    expect(sections[3]!.length).toBeLessThanOrEqual(sections[4]!.length);
  });

  it('supports an open two-point profile without closing or capping it', () => {
    const surfaces: string[] = [];
    const result = createSweep({
      loops: [{
        points: [[-1, 0], [1, 0]],
        normals: [[0, 1], [0, 1]],
        closed: false
      }]
    }, createLinearSweepSections(2), {
      sideLayout: 'shared',
      normalMode: 'profile',
      startCap: true,
      endCap: true,
      attributeSink: (geometry, surface) => {
        surfaces.push(surface);
        geometry.uvs.push(0, 0);
        geometry.uvs2.push(0, 0);
      }
    });

    expect(result.positions).toHaveLength(4 * 3);
    expect(result.normals).toHaveLength(4 * 3);
    expect(result.uvs).toHaveLength(4 * 2);
    expect(result.uvs2).toHaveLength(4 * 2);
    expect(result.indices).toHaveLength(6);
    expect(surfaces).toEqual(['side', 'side', 'side', 'side']);
  });

  it('connects mixed closed and open loops with stable shared-ring indices', () => {
    const result = createSweep({
      loops: [
        {
          points: [[0, 0], [1, 0], [0, 1]],
          normals: [[0, 1], [1, 0], [-1, 0]],
          closed: true
        },
        {
          points: [[2, 0], [3, 0], [4, 0]],
          normals: [[0, 1], [0, 1], [0, 1]],
          closed: false
        }
      ]
    }, createLinearSweepSections(2), {
      sideLayout: 'shared',
      normalMode: 'profile',
      startCap: false,
      endCap: false,
      attributeSink: geometry => {
        geometry.uvs.push(0, 0);
        geometry.uvs2.push(0, 0);
      }
    });

    expect(result.positions).toHaveLength(14 * 3);
    expect(result.indices).toEqual([
      7, 0, 1, 7, 1, 8,
      8, 1, 2, 8, 2, 9,
      9, 2, 3, 9, 3, 10,
      11, 4, 5, 11, 5, 12,
      12, 5, 6, 12, 6, 13
    ]);
    expectNumberArrayClose(result.positions.slice(0, 3), result.positions.slice(9, 12));
    expectNumberArrayClose(result.positions.slice(21, 24), result.positions.slice(30, 33));
  });

  it('keeps partial corner collapses in the shared index layout', () => {
    const base = createLinearSweepSections(1)[0]!;
    const result = createSweep({
      loops: [{
        points: [[0, 0], [1, 0]],
        normals: [[0, 1], [0, 1]],
        closed: false
      }]
    }, [
      base,
      {
        ...base,
        xAxis: [2, 0, 0],
        normalX: [0.5, 0, 0],
        sourceFrameIndex: 1,
        collapsePrevious: true
      }
    ], {
      sideLayout: 'shared',
      normalMode: 'profile',
      startCap: false,
      endCap: false,
      attributeSink: geometry => {
        geometry.uvs.push(0, 0);
        geometry.uvs2.push(0, 0);
      }
    });

    expect(result.indices).toEqual([2, 1, 3]);
  });

  it('precomputes supplied, zero-length and derived profile normals consistently', () => {
    const result = createSweep({
      loops: [{
        points: [[0, 0], [1, 0], [1, 1], [0, 1]],
        normals: [[0, 2], [0, 0]],
        closed: true
      }]
    }, createLinearSweepSections(2), {
      sideLayout: 'shared',
      normalMode: 'profile',
      startCap: false,
      endCap: false,
      attributeSink: geometry => {
        geometry.uvs.push(0, 0);
        geometry.uvs2.push(0, 0);
      }
    });
    const diagonal = 1 / Math.sqrt(2);
    const expectedRing = [
      0, 1, 0,
      -diagonal, diagonal, 0,
      -diagonal, -diagonal, 0,
      diagonal, -diagonal, 0,
      0, 1, 0
    ];

    expectNumberArrayClose(result.normals, [...expectedRing, ...expectedRing]);
  });

  it('preserves precomputed cap triangle mapping on both ends', () => {
    const capCalls: string[] = [];
    const result = createSweep({
      loops: [{
        points: [[0, 0], [1, 0], [1, 1], [0, 1]],
        normals: [[0, 1], [1, 0], [0, -1], [-1, 0]],
        closed: true
      }],
      capTriangles: [0, 2, 1, 0, 3, 2]
    }, [createLinearSweepSections(1)[0]!], {
      sideLayout: 'shared',
      normalMode: 'profile',
      startCap: true,
      endCap: true,
      attributeSink: (geometry, surface, _sectionIndex, loopIndex, pointIndex) => {
        if (surface !== 'side') capCalls.push(`${surface}:${loopIndex}:${pointIndex}`);
        geometry.uvs.push(0, 0);
        geometry.uvs2.push(0, 0);
      }
    });

    expect(capCalls).toEqual([
      'start-cap:0:0', 'start-cap:0:1', 'start-cap:0:2', 'start-cap:0:3',
      'end-cap:0:0', 'end-cap:0:1', 'end-cap:0:2', 'end-cap:0:3'
    ]);
    expect(result.indices).toEqual([
      5, 7, 6, 5, 8, 7,
      9, 10, 11, 9, 11, 12
    ]);
  });

  it('maps Earcut caps with holes to both cap vertex ranges', () => {
    const capCalls: string[] = [];
    const result = createSweep({
      loops: [
        { points: [[-2, -2], [-2, 2], [2, 2], [2, -2]], closed: true },
        { points: [[-1, -1], [1, -1], [1, 1], [-1, 1]], closed: true }
      ]
    }, [createLinearSweepSections(1)[0]!], {
      sideLayout: 'shared',
      normalMode: 'mesh',
      startCap: true,
      endCap: true,
      attributeSink: (geometry, surface, _sectionIndex, loopIndex, pointIndex) => {
        if (surface !== 'side') capCalls.push(`${surface}:${loopIndex}:${pointIndex}`);
        geometry.uvs.push(0, 0);
        geometry.uvs2.push(0, 0);
      }
    });

    expect(capCalls).toEqual([
      'start-cap:0:0', 'start-cap:0:1', 'start-cap:0:2', 'start-cap:0:3',
      'start-cap:1:0', 'start-cap:1:1', 'start-cap:1:2', 'start-cap:1:3',
      'end-cap:0:0', 'end-cap:0:1', 'end-cap:0:2', 'end-cap:0:3',
      'end-cap:1:0', 'end-cap:1:1', 'end-cap:1:2', 'end-cap:1:3'
    ]);
    expect(result.positions).toHaveLength(26 * 3);
    expect(result.indices.length).toBeGreaterThan(0);
    expect(Math.max(...result.indices)).toBeLessThan(26);
  });
});
