# path-geometry

[Chinese README](./README.zh-CN.md)

`path-geometry` is a small dependency-free TypeScript geometry library for 3D paths, curves, frames, and mesh generation. It does not depend on a rendering engine, DOM, Canvas, WebGL, or WebGPU.

It exposes instance-style path APIs with `out` parameters where high-frequency calls matter.

## Status

`path-geometry` is currently a `0.x` MVP. The core behavior is covered by tests, but public APIs may still change before a stable `1.0.0` release.

## Install

```sh
npm install path-geometry
```

## Documentation

This README is the human overview and quick-start guide. Detailed API reference docs can be generated from JSDoc/TSDoc comments with TypeDoc:

Interactive Three.js examples: https://shawn0326.github.io/path-geometry/

Online API documentation: https://shawn0326.github.io/path-geometry/api/

```sh
npm run docs
```

Generated HTML is written to `docs/site/api/` and is ignored by git by default, so CI can publish it later without committing generated files.

The GitHub Actions workflow deploys the visual examples and API documentation to GitHub Pages automatically after every successful push to `master`.

Run the visual lab locally with:

```sh
npm run site:dev
```

The library stays renderer-neutral. A Three.js application only needs a small adapter for the returned buffers:

```ts
import * as THREE from 'three';
import { geometry, path } from 'path-geometry';

const route = path.create().setSmoothCurve(points);
const data = geometry.createTube(route.buildFrames(), { radius: 0.2 });
const threeGeometry = new THREE.BufferGeometry();

threeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
threeGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
threeGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
threeGeometry.setIndex(data.indices);
```

## Basic Usage: From Points

Create a path from an ordered 3D point array when your source data is already a polyline or route. Use `path.create()` to create a `Path` instance, then call instance methods to build or query it:

- `setPolyline` connects points with straight line segments.
- `setSmoothCurve` builds smooth cubic curves through the points.
- `setBeveledCurve` keeps straight sections and rounds corners with quadratic bevels.

For planar data, pass 3D points with `z = 0` instead of using a separate 2D API. Vector inputs and outputs are plain number arrays in `[x, y, z]` order.

```ts
import { path } from 'path-geometry';

const rawPoints = [
  [0, 0, 0],
  [10, 0, 0],
  [10, 10, 0],
  [20, 10, 0]
];

const route = path.create();

route.setPolyline(rawPoints);
route.setSmoothCurve(rawPoints, { smooth: 0.25 });
route.setBeveledCurve(rawPoints, { bevelRadius: 2 });
```

Path constructors do not implicitly filter points. This keeps runtime cost low and leaves input normalization under application control. If input data may contain consecutive duplicate points, call `preprocessPoints` explicitly before constructing a path.

```ts
const points = path.preprocessPoints(rawPoints, { close: true });
route.setPolyline(points, { close: true });
```

`preprocessPoints` removes consecutive duplicate points by default. If `close: true`, it also removes a duplicated final point equal to the first point, then lets the path close by adding the closing segment.

## Path Writer

Create a path with `path.writer()` when your source data is command-like: move, line, quadratic Bezier, cubic Bezier, close. `path.writer()` creates a writer with a new path; `path.writer(route)` or `route.writer()` creates a writer bound to an existing path.

A writer bound to an existing path appends by default. Use `route.clear().writer()` or `route.writer().clear()` when you want to rebuild that path from scratch.

```ts
import { path } from 'path-geometry';

const writer = path.writer();

const route = writer
  .moveTo([0, 0, 0])
  .lineTo([10, 0, 0])
  .cubicTo(
    [15, 5, 0],
    [20, 5, 0],
    [30, 0, 0]
  )
  .toPath();

const point = [0, 0, 0];
const tangent = [0, 0, 0];

route.pointAtDistance(point, 10);
route.tangentAtDistance(tangent, 10);
```

## Sampling

Paths expose sampling methods for common geometry workflows:

- `route.getLength()` returns the approximate total length.
- `route.pointAtU(out, u)` and `route.tangentAtU(out, u)` sample by normalized arc length.
- `route.pointAtDistance(out, distance)` and `route.tangentAtDistance(out, distance)` sample by absolute distance.
- `route.getPoints(divisions?)` samples each segment by its raw parameter.
- `route.getSpacedPoints(divisions?)` samples at approximately even arc-length spacing.

```ts
const length = route.getLength();

const point = [0, 0, 0];
const tangent = [0, 0, 0];

route.pointAtU(point, 0.5);
route.tangentAtDistance(tangent, length * 0.5);

const drawingPoints = route.getPoints(24);
const evenlySpaced = route.getSpacedPoints(32);
```

## Frame Building

Use `route.buildFrames(options?)` when you need stable orientation data along a 3D path, especially for mesh generation such as tubes, ribbons, roads, rails, strokes, or extruded path geometry.

`buildFrames` samples each segment, keeps line segments at one division, and returns both the sampled path points and the frame data needed to place geometry along the path:

- `points`
- `tangents`
- `normals`
- `binormals`
- `bisectors`
- `lengths`
- `widthScales`
- `sharps`
- `tangentTypes`

```ts
const frames = route.buildFrames({
  divisions: 24,
  initialNormal: [0, 0, 1],
  transport: true,
  close: false
});

for (let i = 0; i < frames.points.length; i++) {
  const center = frames.points[i];
  const normal = frames.normals[i];
  const binormal = frames.binormals[i];

  // Use center, normal, and binormal to place cross-section vertices.
}
```

Use `divisions` to control curve sampling density. Use `initialNormal` to lock the starting orientation when the generated mesh needs a predictable roll direction. Use `transport` to enable or disable parallel-transport frame propagation.

## Geometry Building

Use `geometry.createTube(frames, options?)`, `geometry.createRibbon(frames, options?)`, and `geometry.createExtrudeShape(shape)` to create renderer-neutral indexed geometry buffers.

All geometry builders return plain arrays: `positions`, `normals`, `uvs`, `uvs2`, and `indices`. You can convert them to the buffer/attribute format required by WebGL, WebGPU, or your renderer.

Extruded shapes generate normals and secondary UVs by default. Set `generateNormals: false` or `generateUvs2: false` to skip either pass; the corresponding field remains present as an empty array.

Path-based builders apply miter correction only along each frame's corner bisector. Set `cornerTransition: true` to expand sharp frames into corner-transition sections; by default, each frame produces one section. Ribbon's previous `sharp` option remains as a deprecated compatibility alias for `cornerTransition`.

```ts
import { path, geometry } from 'path-geometry';

const route = path.create();
route.setPolyline([
  [0, 0, 0],
  [10, 0, 0],
  [10, 10, 0]
]);

const frames = route.buildFrames({
  divisions: 16,
  initialNormal: [0, 0, 1]
});

const tubeGeometry = geometry.createTube(frames, {
  radius: 0.2,
  radialSegments: 12,
  generateStartCap: true,
  generateEndCap: true,
  cornerTransition: true
});

const ribbonGeometry = geometry.createRibbon(frames, {
  width: 1,
  side: 'both',
  arrow: false,
  cornerTransition: true
});

const extrudeGeometry = geometry.createExtrudeShape({
  contour: [
    [0, 0],
    [2, 0],
    [2, 1],
    [0, 1]
  ],
  holes: [
    [
      [0.5, 0.25],
      [1.5, 0.25],
      [1.5, 0.75],
      [0.5, 0.75]
    ]
  ],
  pathFrames: frames,
  cornerTransition: true,
  generateNormals: true,
  generateUvs2: true
});
```

## Cache Updates

Lengths and arc-length tables are cached and refreshed automatically when the library mutates a path through its own APIs.

If you directly mutate an internal segment point, mark the cache dirty yourself:

```ts
route.segments[0].p1[0] = 20;

// Marks only path-level metrics dirty.
route.markDirty();

// Marks path metrics and all segment metrics dirty.
route.markDirty(true);
```

`_metrics` and `_needsUpdate` are internal cache fields. Do not read or mutate them directly.

Use `route.markDirty(true)` after direct edits to `route.segments[i].p0`, `p1`, `p2`, or `p3`.

## Tests

The test suite includes fixed fixtures and runtime checks for curve, path, frame, and geometry behavior.

```sh
npm run typecheck
npm run test
npm run build
```

## License

MIT
