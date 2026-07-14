declare module 't3d' {
  export class Vector2 {
    constructor(x?: number, y?: number);
    x: number;
    y: number;
  }

  export class Vector3 {
    constructor(x?: number, y?: number, z?: number);
    x: number;
    y: number;
    z: number;
  }
}

declare module 't3d/examples/jsm/math/curves/CubicBezierCurve3.js' {
  import { Vector3 } from 't3d';

  export class CubicBezierCurve3 {
    constructor(v0?: Vector3, v1?: Vector3, v2?: Vector3, v3?: Vector3);
    isCubicBezierCurve3?: boolean;
    v0: Vector3;
    v1: Vector3;
    v2: Vector3;
    v3: Vector3;
    getPoint(t: number): Vector3;
    getPointAt(u: number): Vector3;
    getLength(): number;
    getLengths(divisions?: number): number[];
    getPoints(divisions?: number): Vector3[];
    getSpacedPoints(divisions?: number): Vector3[];
  }
}

declare module 't3d/examples/jsm/math/curves/LineCurve3.js' {
  import { Vector3 } from 't3d';

  export class LineCurve3 {
    constructor(v1?: Vector3, v2?: Vector3);
    getPoint(t: number): Vector3;
    getPointAt(u: number): Vector3;
    getLength(): number;
    getLengths(divisions?: number): number[];
    getPoints(divisions?: number): Vector3[];
    getSpacedPoints(divisions?: number): Vector3[];
  }
}

declare module 't3d/examples/jsm/math/curves/QuadraticBezierCurve3.js' {
  import { Vector3 } from 't3d';

  export class QuadraticBezierCurve3 {
    constructor(v0?: Vector3, v1?: Vector3, v2?: Vector3);
    getPoint(t: number): Vector3;
    getPointAt(u: number): Vector3;
    getLength(): number;
    getLengths(divisions?: number): number[];
    getPoints(divisions?: number): Vector3[];
    getSpacedPoints(divisions?: number): Vector3[];
  }
}

declare module 't3d/examples/jsm/math/curves/CurvePath3.js' {
  import { Vector3 } from 't3d';

  export class CurvePath3 {
    setPolylines(points: Vector3[], options?: { close?: boolean }): void;
    setSmoothCurves(points: Vector3[], options?: { smooth?: number; close?: boolean }): void;
    setBeveledCurves(points: Vector3[], options?: { bevelRadius?: number; close?: boolean }): void;
    curves: Array<{
      isLineCurve3?: boolean;
      isQuadraticBezierCurve3?: boolean;
      isCubicBezierCurve3?: boolean;
      v0?: Vector3;
      v1?: Vector3;
      v2?: Vector3;
      v3?: Vector3;
    }>;
    getPoint(t: number): Vector3;
    getLength(): number;
    getLengths(): number[];
    getPoints(divisions?: number): Vector3[];
    computeFrames(options?: {
      up?: Vector3;
      divisions?: number;
      frenet?: boolean;
      fixLine?: boolean;
      close?: boolean;
    }): {
      points: Vector3[];
      tangents: Vector3[];
      normals: Vector3[];
      binormals: Vector3[];
      lengths: number[];
      widthScales: number[];
      sharps: boolean[];
      tangentTypes: number[];
    };
  }
}

declare module 't3d/examples/jsm/geometries/builders/TubeBuilder.js' {
  export const TubeBuilder: {
    getGeometryData(frames: unknown, options?: {
      radius?: number;
      radialSegments?: number;
      startRad?: number;
      generateStartCap?: boolean;
      generateEndCap?: boolean;
    }): {
      positions: number[];
      normals: number[];
      uvs: number[];
      uvs2: number[];
      indices: number[];
    };
  };
}

declare module 't3d/examples/jsm/geometries/builders/ExtrudeShapeBuilder.js' {
  export const ExtrudeShapeBuilder: {
    getGeometryData(shape: {
      contour: number[][];
      holes?: number[][][];
      depth?: number;
      generateTop?: boolean;
      generateBottom?: boolean;
      pathFrames?: unknown;
    }): {
      positions: number[];
      uvs: number[];
      indices: number[];
    };
  };
}
