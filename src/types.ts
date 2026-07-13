import type { ReadonlyVector, Vector3 } from './vector';

/**
 * A 3D straight line segment.
 * 三维直线 segment。
 */
export interface LineSegment {
  type: 'line';
  /** Start point. 起点。*/
  p0: Vector3;
  /** End point. 终点。*/
  p1: Vector3;
  /** Evaluate point at raw parameter t. 在原始参数 t 处求点。*/
  pointAt(out: Vector3, t: number): Vector3;
  /** Evaluate point at arc-length normalized parameter u. 在弧长归一化参数 u 处求点。*/
  pointAtU(out: Vector3, u: number): Vector3;
  /** Evaluate unit tangent at raw parameter t. 在原始参数 t 处求单位切线。*/
  tangentAt(out: Vector3, t: number): Vector3;
  /** Get approximate arc length. 获取近似弧长。*/
  getLength(): number;
  /** Get cumulative arc-length table. 获取累计弧长表。*/
  getLengths(divisions?: number): number[];
  /** Sample points by raw parameter. 按原始参数采样点。*/
  getPoints(divisions?: number): Vector3[];
  /** Sample evenly arc-length spaced points. 等弧长采样点。*/
  getSpacedPoints(divisions?: number): Vector3[];
  /** Map normalized arc-length u to raw parameter t. 将归一化弧长 u 映射到原始参数 t。*/
  mapUToT(u: number, distance?: number): number;
  /** Mark internal caches dirty. 标记内部缓存为失效。*/
  markDirty(): void;
}

/**
 * A 3D quadratic Bezier segment.
 * 三维二次 Bezier segment。
 */
export interface QuadraticBezierSegment {
  type: 'quadratic-bezier';
  /** Start point. 起点。*/
  p0: Vector3;
  /** Control point. 控制点。*/
  p1: Vector3;
  /** End point. 终点。*/
  p2: Vector3;
  /** Evaluate point at raw parameter t. 在原始参数 t 处求点。*/
  pointAt(out: Vector3, t: number): Vector3;
  /** Evaluate point at arc-length normalized parameter u. 在弧长归一化参数 u 处求点。*/
  pointAtU(out: Vector3, u: number): Vector3;
  /** Evaluate unit tangent at raw parameter t. 在原始参数 t 处求单位切线。*/
  tangentAt(out: Vector3, t: number): Vector3;
  /** Get approximate arc length. 获取近似弧长。*/
  getLength(): number;
  /** Get cumulative arc-length table. 获取累计弧长表。*/
  getLengths(divisions?: number): number[];
  /** Sample points by raw parameter. 按原始参数采样点。*/
  getPoints(divisions?: number): Vector3[];
  /** Sample evenly arc-length spaced points. 等弧长采样点。*/
  getSpacedPoints(divisions?: number): Vector3[];
  /** Map normalized arc-length u to raw parameter t. 将归一化弧长 u 映射到原始参数 t。*/
  mapUToT(u: number, distance?: number): number;
  /** Mark internal caches dirty. 标记内部缓存为失效。*/
  markDirty(): void;
}

/**
 * A 3D cubic Bezier segment.
 * 三维三次 Bezier segment。
 */
export interface CubicBezierSegment {
  type: 'cubic-bezier';
  /** Start point. 起点。*/
  p0: Vector3;
  /** First control point. 第一控制点。*/
  p1: Vector3;
  /** Second control point. 第二控制点。*/
  p2: Vector3;
  /** End point. 终点。*/
  p3: Vector3;
  /** Evaluate point at raw parameter t. 在原始参数 t 处求点。*/
  pointAt(out: Vector3, t: number): Vector3;
  /** Evaluate point at arc-length normalized parameter u. 在弧长归一化参数 u 处求点。*/
  pointAtU(out: Vector3, u: number): Vector3;
  /** Evaluate unit tangent at raw parameter t. 在原始参数 t 处求单位切线。*/
  tangentAt(out: Vector3, t: number): Vector3;
  /** Get approximate arc length. 获取近似弧长。*/
  getLength(): number;
  /** Get cumulative arc-length table. 获取累计弧长表。*/
  getLengths(divisions?: number): number[];
  /** Sample points by raw parameter. 按原始参数采样点。*/
  getPoints(divisions?: number): Vector3[];
  /** Sample evenly arc-length spaced points. 等弧长采样点。*/
  getSpacedPoints(divisions?: number): Vector3[];
  /** Map normalized arc-length u to raw parameter t. 将归一化弧长 u 映射到原始参数 t。*/
  mapUToT(u: number, distance?: number): number;
  /** Mark internal caches dirty. 标记内部缓存为失效。*/
  markDirty(): void;
}

/**
 * Any supported 3D segment.
 * 任意受支持的三维 segment。
 */
export type Segment = LineSegment | QuadraticBezierSegment | CubicBezierSegment;

/**
 * A 3D path made of ordered 3D segments.
 * 由有序三维 segment 组成的 path。
 */
export interface Path {
  /** Ordered path segments. 有序的 segment 列表。*/
  segments: Segment[];
  /** Remove all segments from the path. 移除 path 中的所有 segment。*/
  clear(): Path;
  /** Append a segment to the path. 将一个 segment 添加到 path 末尾。*/
  addSegment(segment: Segment): Path;
  /** Mark internal caches dirty. 标记内部缓存为失效。*/
  markDirty(recursive?: boolean): Path;
  /** Return a fluent writer bound to this path. 返回绑定到当前 path 的链式 writer。*/
  writer(): PathWriter;
  /** Replace contents with a polyline through the given points. 用给定点的折线替换内容。*/
  setPolyline(points: ReadonlyVector[], options?: PolylineOptions): Path;
  /** Replace contents with t3d-style smooth cubic curves. 用 t3d 风格平滑三次曲线替换内容。*/
  setSmoothCurve(points: ReadonlyVector[], options?: SmoothCurveOptions): Path;
  /** Replace contents with straight edges and beveled corners. 用直边加倒角曲线替换内容。*/
  setBeveledCurve(points: ReadonlyVector[], options?: BeveledCurveOptions): Path;
  /** Get the total arc length of the path. 获取 path 的总弧长。*/
  getLength(): number;
  /** Get cumulative arc-length table across all segments. 获取累计弧长表。*/
  getLengths(): number[];
  /** Evaluate the point at normalized arc-length u. 在归一化弧长参数 u 处求点。*/
  pointAtU(out: Vector3, u: number): Vector3;
  /** Evaluate the unit tangent at normalized arc-length u. 在归一化弧长参数 u 处求单位切线。*/
  tangentAtU(out: Vector3, u: number): Vector3;
  /** Evaluate the point at a given arc distance. 在指定弧长处求点。*/
  pointAtDistance(out: Vector3, distance: number): Vector3;
  /** Evaluate the unit tangent at a given arc distance. 在指定弧长处求单位切线。*/
  tangentAtDistance(out: Vector3, distance: number): Vector3;
  /** Sample points by raw parameter. 按原始参数采样点。*/
  getPoints(divisions?: number): Vector3[];
  /** Sample evenly arc-length spaced points. 等弧长采样点。*/
  getSpacedPoints(divisions?: number): Vector3[];
  /** Build orthonormal 3D frames along the path. 沿 path 构建正交 3D frame。*/
  buildFrames(options?: BuildFramesOptions): PathFrames;
}

/**
 * Fluent writer API for building a `Path` imperatively.
 * 用于命令式构建 `Path` 的链式 writer 接口。
 */
export interface PathWriter {
  /** Move the current point to `point` without creating a segment. */
  moveTo(point: ReadonlyVector): PathWriter;
  /** Add a straight line from the current point to `point`. */
  lineTo(point: ReadonlyVector): PathWriter;
  /** Add a quadratic Bezier from the current point to `point` using `control`. */
  quadraticTo(control: ReadonlyVector, point: ReadonlyVector): PathWriter;
  /** Add a cubic Bezier from the current point to `point` using two control points. */
  cubicTo(control1: ReadonlyVector, control2: ReadonlyVector, point: ReadonlyVector): PathWriter;
  /** Close the current subpath by adding a line to the subpath start when needed. */
  close(): PathWriter;
  /** Clear the writer's internal path. */
  clear(): PathWriter;
  /** Return the built `Path` instance. */
  toPath(): Path;
}

/**
 * Options for building a path from polyline points.
 * 从折线点构建 path 的选项。
 */
export interface PolylineOptions {
  /** Add a closing segment from the last point back to the first point. 从最后一点到第一点添加闭合段。*/
  close?: boolean;
}

/**
 * Options for building smooth cubic curves from points.
 * 从点构建平滑三次曲线的选项。
 */
export interface SmoothCurveOptions {
  /** Smoothness factor used by the t3d-style control point algorithm. t3d 风格控制点算法使用的平滑系数。*/
  smooth?: number;
  /** Add a closing segment from the last point back to the first point. 从最后一点到第一点添加闭合段。*/
  close?: boolean;
}

/**
 * Options for building beveled curves from points.
 * 从点构建倒角曲线的选项。
 */
export interface BeveledCurveOptions {
  /** Maximum bevel radius around each corner. 每个转角处的最大倒角半径。*/
  bevelRadius?: number;
  /** Add a closing segment from the last point back to the first point. 从最后一点到第一点添加闭合段。*/
  close?: boolean;
}

/**
 * Options for explicitly preprocessing point arrays before path construction.
 * 在构建 path 前显式预处理点数组的选项。
 */
export interface PointPreprocessOptions {
  /** Also remove a duplicated closing point when it equals the first point. 等于第一点时同样移除重复的闭合点。*/
  close?: boolean;
  /** Remove consecutive duplicate points. Defaults to true. 移除连续重复点，默认 true。*/
  removeConsecutiveDuplicates?: boolean;
  /** Remove a final point equal to the first point. Defaults to close === true. 移除等于第一点的末点，默认为 close === true。*/
  removeClosingDuplicate?: boolean;
}

/**
 * Frame data sampled from a 3D path for mesh generation.
 * 为网格生成从三维 path 采样得到的 frame 数据。
 */
export interface PathFrames {
  /** Sampled path points. 采样 path 点。*/
  points: Vector3[];
  /** Unit tangents at sampled points. 采样点处的单位切线。*/
  tangents: Vector3[];
  /** Unit normals at sampled points. 采样点处的单位法线。*/
  normals: Vector3[];
  /** Unit binormals at sampled points. 采样点处的单位副法线。*/
  binormals: Vector3[];
  /** Corner bisectors matching the t3d frame output. 匹配 t3d frame 输出的转角二等分向量。*/
  bisectors: Vector3[];
  /** Cumulative distances along sampled points. 沿采样点的累计距离。*/
  lengths: number[];
  /** Width scale hints for corner joins. 转角连接处的宽度缩放系数。*/
  widthScales: number[];
  /** Whether each sampled point is considered a sharp corner. 每个采样点是否为尖锐转角。*/
  sharps: boolean[];
  /** Tangent correction markers used around line-to-curve transitions. 直线-曲线过渡处的切线修正标记。*/
  tangentTypes: number[];
}

/**
 * Options for building 3D path frames.
 * 构建三维 path frame 的选项。
 */
export interface BuildFramesOptions {
  /** Initial normal direction. When omitted, a stable perpendicular axis is chosen. 初始法线方向，省略时自动选择稳定的垂直轴。*/
  initialNormal?: ReadonlyVector | null;
  /** Number of samples per non-line segment. Line segments always use one division. 非直线 segment 的采样数，直线 segment 始终使用一个分段。*/
  divisions?: number;
  /** Use parallel-transport frame propagation. 使用平行传输法传播 frame。*/
  transport?: boolean;
  /** Match t3d's line-to-curve tangent correction behavior. 匹配 t3d 在直线-曲线切换处的切线修正行为。*/
  fixLine?: boolean;
  /** Treat the generated frame sequence as closed. 将生成的 frame 序列视为闭合。*/
  close?: boolean;
}

/**
 * Renderer-neutral indexed 3D geometry buffers.
 * 与渲染器无关的三维索引几何数据。
 */
export interface GeometryData {
  /** Flat XYZ vertex positions. 平铺 XYZ 顶点坐标。*/
  positions: number[];
  /** Flat XYZ vertex normals. 平铺 XYZ 顶点法线。*/
  normals: number[];
  /** Flat UV coordinates. 平铺 UV 坐标。*/
  uvs: number[];
  /** Secondary flat UV coordinates, usually normalized by total path length. 辅助 UV 坐标，通常按 path 总长度归一化。*/
  uvs2: number[];
  /** Triangle indices. 三角形索引。*/
  indices: number[];
}

/**
 * A 2D point used by planar shape extrusion.
 * 用于平面 shape 挤出的二维点。
 */
export type ExtrudeShapePoint = number[];

/**
 * Options for building extruded shape geometry from a 2D contour and optional holes.
 *
 * This builder follows t3d's `ExtrudeShapeBuilder` behavior: it may mutate `contour`
 * and `holes` by reversing point order and removing duplicated closing points.
 *
 * 从二维轮廓和可选孔洞构建挤出几何的选项。
 *
 * 该 builder 遵循 t3d 的 `ExtrudeShapeBuilder` 行为：可能会通过反转点顺序、
 * 移除重复闭合点来修改传入的 `contour` 和 `holes`。
 */
export interface BuildExtrudeShapeOptions {
  /** Outer contour points. 外轮廓点。*/
  contour: ExtrudeShapePoint[];
  /** Hole contours. 孔洞轮廓。*/
  holes?: ExtrudeShapePoint[][];
  /** Extrusion depth. Defaults to 1. 挤出深度，默认 1。*/
  depth?: number;
  /** Generate the top cap. Defaults to true. 是否生成顶部面，默认 true。*/
  generateTop?: boolean;
  /** Generate the bottom cap. Defaults to true. 是否生成底部面，默认 true。*/
  generateBottom?: boolean;
  /** Extrude along path frames instead of the Z axis. 沿 path frame 挤出，而不是沿 Z 轴。*/
  pathFrames?: PathFrames;
  /** Expand sharp path corners into transition sections. Defaults to false. */
  cornerTransition?: boolean;
}

/**
 * Options for building tube geometry from 3D path frames.
 * 从三维 path frame 构建管状几何的选项。
 */
export interface BuildTubeOptions {
  /** Tube radius. Defaults to 0.1. 管半径，默认 0.1。*/
  radius?: number;
  /** Number of segments around each tube ring. Defaults to 8. 每圈环绕的分段数，默认 8。*/
  radialSegments?: number;
  /** Initial angle around the tangent axis in radians. Defaults to 0. 沿切线轴的起始角度（弧度），默认 0。*/
  startRad?: number;
  /** Add triangles that close the first tube ring. Defaults to false. 添加封闭第一圈管环的三角面，默认 false。*/
  generateStartCap?: boolean;
  /** Add triangles that close the last tube ring. Defaults to false. 添加封闭最后一圈管环的三角面，默认 false。*/
  generateEndCap?: boolean;
  /** Expand sharp path corners into transition rings. Defaults to false. */
  cornerTransition?: boolean;
}

/**
 * Which side of the path a ribbon should occupy.
 * 带状相对于路径中心线占据的侧边。
 */
export type RibbonSide = 'both' | 'left' | 'right';

/**
 * Options for building ribbon geometry from 3D path frames.
 * 从三维 path frame 构建带状几何的选项。
 */
export interface BuildRibbonOptions {
  /** Full ribbon width. Defaults to 0.1. 带状总宽度，默认 0.1。*/
  width?: number;
  /** Add an arrow head at the end of the ribbon. Defaults to false. 在带状末端添加箭头，默认 false。*/
  arrow?: boolean;
  /** Build both sides or only one side relative to the path center line. Defaults to 'both'. 相对于路径中心线构建双侧或单侧，默认 'both'。*/
  side?: RibbonSide;
  /** Expand sharp path corners into transition sections. Defaults to false. */
  cornerTransition?: boolean;
  /** @deprecated Use `cornerTransition` instead. */
  sharp?: boolean;
}

/**
 * Read-only 3D vector input accepted by path-geometry APIs.
 * path-geometry API 接受的只读三维向量输入。
 */
export type { ReadonlyVector, Vector3 };
