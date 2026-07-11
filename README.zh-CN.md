# path-geometry

[English README](./README.md)

`path-geometry` 是一个无依赖的小型 TypeScript 几何库，用于 3D path、curve、frame 和 mesh 生成。它不依赖渲染引擎、DOM、Canvas、WebGL 或 WebGPU。

它在高频调用场景中提供实例式 path API 和 `out` 参数优先的采样方法。

## 状态

`path-geometry` 当前是 `0.x` MVP。核心行为已有测试覆盖；但在稳定的 `1.0.0` 之前，公开 API 仍可能调整。

## 安装

```sh
npm install path-geometry
```

## 文档

这个 README 作为人工维护的概览和快速上手文档。详细 API reference 可以通过 JSDoc/TSDoc 注释和 TypeDoc 生成：

Three.js 交互示例：https://shawn0326.github.io/path-geometry/

在线 API 文档：https://shawn0326.github.io/path-geometry/api/

```sh
npm run docs
```

生成的 HTML 会输出到 `docs/site/api/`，并默认被 git 忽略。后续可以通过 CI 发布在线文档，而不需要提交生成产物。

GitHub Actions workflow 会在每次成功推送到 `master` 后，自动把视觉示例和 API 文档部署到 GitHub Pages。

可以在本地启动视觉实验室：

```sh
npm run site:dev
```

核心库仍然与渲染器无关。Three.js 应用只需要用一小段适配代码转换返回的 buffer：

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

## 基础用法：从点生成

当数据来源已经是一组有序三维点，比如 polyline 或 route，可以从点数组生成 path。使用 `path.create()` 创建 `Path` 实例，然后通过实例方法构建或查询它：

- `setPolyline` 用直线 segment 连接点。
- `setSmoothCurve` 生成穿过这些点的平滑 cubic curve。
- `setBeveledCurve` 保留直线段，并用 quadratic bevel 对拐角做圆角处理。

对于平面数据，使用 `z = 0` 的三维点输入，而不是单独的 2D API。向量输入和输出均为按 `[x, y, z]` 排列的普通 number 数组。

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

path 构建方法不会隐式过滤点。这样可以降低运行时成本，并由应用自行控制输入规范化。如果输入数据可能包含连续重复点，可以在构建 path 前显式调用 `preprocessPoints`。

```ts
const points = path.preprocessPoints(rawPoints, { close: true });
route.setPolyline(points, { close: true });
```

`preprocessPoints` 默认会移除连续重复点。如果设置了 `close: true`，它还会移除与第一个点相同的最后一个点，然后让 path 通过额外的闭合 segment 完成闭合。

## Path Writer

当数据来源更像绘制命令时，可以用 writer 创建 path：move、line、quadratic Bezier、cubic Bezier、close。`path.writer()` 会创建一个带有新 path 的 writer；`path.writer(route)` 或 `route.writer()` 会创建绑定到已有 path 的 writer。

绑定到已有 path 的 writer 默认会追加 segment。如果想从头重建这个 path，可以使用 `route.clear().writer()` 或 `route.writer().clear()`。

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

## 采样

path 提供了适合常见几何工作流的采样方法：

- `route.getLength()` 返回近似总长度。
- `route.pointAtU(out, u)` 和 `route.tangentAtU(out, u)` 按归一化弧长采样。
- `route.pointAtDistance(out, distance)` 和 `route.tangentAtDistance(out, distance)` 按绝对路径距离采样。
- `route.getPoints(divisions?)` 按每个 segment 的原始参数采样。
- `route.getSpacedPoints(divisions?)` 按近似均匀弧长间距采样。

```ts
const length = route.getLength();

const point = [0, 0, 0];
const tangent = [0, 0, 0];

route.pointAtU(point, 0.5);
route.tangentAtDistance(tangent, length * 0.5);

const drawingPoints = route.getPoints(24);
const evenlySpaced = route.getSpacedPoints(32);
```

## Frame 构建

当需要沿 3D path 获取稳定的方向数据时，可以使用 `route.buildFrames(options?)`。它尤其适合 tube、ribbon、road、rail、stroke 或 extruded path geometry 等网格生成场景。

`buildFrames` 会对每个 segment 采样，line segment 保持一个 division，并返回用于沿 path 放置几何体的采样点和 frame 数据：

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

使用 `divisions` 控制 curve 的采样密度。使用 `initialNormal` 可以锁定起始方向，让生成的 mesh 有可预测的 roll 方向。使用 `transport` 控制是否启用 parallel-transport frame 传播。

## 几何生成

可以使用 `geometry.createTube(frames, options?)`、`geometry.createRibbon(frames, options?)` 和 `geometry.createExtrudeShape(shape)`，创建与渲染器无关的索引几何数据。

所有 geometry builder 都返回普通数组：`positions`、`normals`、`uvs`、`uvs2` 和 `indices`。你可以按需要把它们转换成 WebGL、WebGPU 或自定义 renderer 所需的 buffer/attribute 格式。

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
  generateEndCap: true
});

const ribbonGeometry = geometry.createRibbon(frames, {
  width: 1,
  side: 'both',
  arrow: false
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
  pathFrames: frames
});
```

## 缓存更新

长度和弧长表会被缓存。通过库自身 API 修改 path 时，缓存会自动标脏并在查询时刷新。

如果你直接修改了内部 segment 点，需要自己标记缓存为 dirty：

```ts
route.segments[0].p1[0] = 20;

// Marks only path-level metrics dirty.
route.markDirty();

// Marks path metrics and all segment metrics dirty.
route.markDirty(true);
```

`_metrics` 和 `_needsUpdate` 是内部缓存字段，不要直接读取或修改。

直接编辑 `route.segments[i].p0`、`p1`、`p2` 或 `p3` 后，请使用 `route.markDirty(true)`。

## 测试

测试套件包含固定 fixture，以及针对 curve、path、frame 和 geometry 行为的运行时检查。

```sh
npm run typecheck
npm run test
npm run build
```

## License

MIT
