import { vec3 } from '../vector';
import type { ReadonlyVector, Vector3 } from '../vector';
import type { PathFrames } from '../types';

const EPSILON = 1e-12;
const REVERSE_CORNER_DOT = -0.999999;

export type CornerSectionRole = 'regular' | 'join-in' | 'join-center' | 'join-out';

export interface CornerSection {
  origin: ReadonlyVector;
  tangent: ReadonlyVector;
  xAxis: ReadonlyVector;
  yAxis: ReadonlyVector;
  normalX: ReadonlyVector;
  normalY: ReadonlyVector;
  length: number;
  sourceFrameIndex: number;
  role: CornerSectionRole;
  collapsePrevious: boolean;
}

export interface CreateCornerSectionsOptions {
  cornerTransition: boolean;
  resolveWidthScale: (value: number | undefined) => number;
}

export type CornerProfileLoops = ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>;

function finiteOrDefault(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

export function scaleAlong(
  out: Vector3,
  value: ReadonlyVector,
  axis: ReadonlyVector,
  scale: number
): Vector3 {
  const axisLengthSq = vec3.squaredLength(axis);
  if (axisLengthSq <= EPSILON || !Number.isFinite(axisLengthSq) || !Number.isFinite(scale)) {
    return vec3.copy(out, value);
  }

  const projection = vec3.dot(value, axis) / axisLengthSq;
  const factor = projection * (scale - 1);
  out[0] = value[0]! + axis[0]! * factor;
  out[1] = value[1]! + axis[1]! * factor;
  out[2] = value[2]! + axis[2]! * factor;
  return out;
}

export function setCornerNormalAxes(
  normalX: Vector3,
  normalY: Vector3,
  xAxis: ReadonlyVector,
  yAxis: ReadonlyVector,
  tangent: ReadonlyVector,
  fallbackX: ReadonlyVector,
  fallbackY: ReadonlyVector
): void {
  const crossYTX = yAxis[1]! * tangent[2]! - yAxis[2]! * tangent[1]!;
  const crossYTY = yAxis[2]! * tangent[0]! - yAxis[0]! * tangent[2]!;
  const crossYTZ = yAxis[0]! * tangent[1]! - yAxis[1]! * tangent[0]!;
  const determinant = xAxis[0]! * crossYTX +
    xAxis[1]! * crossYTY +
    xAxis[2]! * crossYTZ;
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= EPSILON) {
    vec3.copy(normalX, fallbackX);
    vec3.copy(normalY, fallbackY);
    return;
  }

  const inverseDeterminant = 1 / determinant;
  normalX[0] = crossYTX * inverseDeterminant;
  normalX[1] = crossYTY * inverseDeterminant;
  normalX[2] = crossYTZ * inverseDeterminant;
  normalY[0] = (
    tangent[1]! * xAxis[2]! - tangent[2]! * xAxis[1]!
  ) * inverseDeterminant;
  normalY[1] = (
    tangent[2]! * xAxis[0]! - tangent[0]! * xAxis[2]!
  ) * inverseDeterminant;
  normalY[2] = (
    tangent[0]! * xAxis[1]! - tangent[1]! * xAxis[0]!
  ) * inverseDeterminant;
}

function createSection(
  origin: ReadonlyVector,
  tangent: ReadonlyVector,
  xAxis: ReadonlyVector,
  yAxis: ReadonlyVector,
  fallbackX: ReadonlyVector,
  fallbackY: ReadonlyVector,
  length: number,
  sourceFrameIndex: number,
  role: CornerSectionRole,
  collapsePrevious: boolean,
  copyOriginAndTangent = true
): CornerSection {
  const resolvedOrigin = copyOriginAndTangent ? vec3.clone(origin) : origin;
  const resolvedTangent = copyOriginAndTangent ? vec3.clone(tangent) : tangent;
  const resolvedXAxis = vec3.clone(xAxis);
  const resolvedYAxis = vec3.clone(yAxis);
  const normalX = vec3.create();
  const normalY = vec3.create();
  setCornerNormalAxes(
    normalX,
    normalY,
    resolvedXAxis,
    resolvedYAxis,
    resolvedTangent,
    fallbackX,
    fallbackY
  );

  return {
    origin: resolvedOrigin,
    tangent: resolvedTangent,
    xAxis: resolvedXAxis,
    yAxis: resolvedYAxis,
    normalX,
    normalY,
    length,
    sourceFrameIndex,
    role,
    collapsePrevious
  };
}

function getSupportRange(
  profileLoops: CornerProfileLoops,
  supportX: number,
  supportY: number
): { minimum: number; maximum: number } | null {
  let minimum = Infinity;
  let maximum = -Infinity;

  for (const loop of profileLoops) {
    for (const point of loop) {
      const support = point[0]! * supportX + point[1]! * supportY;
      if (!Number.isFinite(support)) continue;
      minimum = Math.min(minimum, support);
      maximum = Math.max(maximum, support);
    }
  }

  return Number.isFinite(minimum) && Number.isFinite(maximum) ? { minimum, maximum } : null;
}

function normalizedDirection(out: Vector3, from: ReadonlyVector, to: ReadonlyVector): number {
  vec3.sub(out, to, from);
  const length = vec3.length(out);
  if (length <= EPSILON || !Number.isFinite(length)) {
    vec3.set(out, 0, 0, 0);
    return 0;
  }
  vec3.scale(out, out, 1 / length);
  return length;
}

export function createCornerSections(
  frames: PathFrames,
  profileLoops: CornerProfileLoops,
  options: CreateCornerSectionsOptions
): CornerSection[] {
  const sections: CornerSection[] = [];
  const frameCount = frames.points.length;
  const incoming = vec3.create();
  const outgoing = vec3.create();
  const xAxis = vec3.create();
  const yAxis = vec3.create();
  const joinOrigin = vec3.create();
  const joinXAxis = vec3.create();
  const joinYAxis = vec3.create();

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    const point = frames.points[frameIndex]!;
    const tangent = frames.tangents[frameIndex]!;
    const normal = frames.normals[frameIndex]!;
    const binormal = frames.binormals[frameIndex]!;
    const bisector = frames.bisectors[frameIndex]!;
    const widthScale = options.resolveWidthScale(frames.widthScales[frameIndex]);
    const length = finiteOrDefault(frames.lengths[frameIndex], 0);

    scaleAlong(xAxis, binormal, bisector, widthScale);
    scaleAlong(yAxis, normal, bisector, widthScale);

    const center = createSection(
      point,
      tangent,
      xAxis,
      yAxis,
      binormal,
      normal,
      length,
      frameIndex,
      'regular',
      false,
      false
    );

    if (
      !options.cornerTransition ||
      frameIndex === 0 ||
      frameIndex === frameCount - 1 ||
      !(frames.sharps[frameIndex] ?? false) ||
      !Number.isFinite(widthScale) ||
      widthScale <= 1
    ) {
      sections.push(center);
      continue;
    }

    const incomingLength = normalizedDirection(incoming, frames.points[frameIndex - 1]!, point);
    const outgoingLength = normalizedDirection(outgoing, point, frames.points[frameIndex + 1]!);
    if (
      incomingLength <= 0 ||
      outgoingLength <= 0 ||
      vec3.dot(incoming, outgoing) <= REVERSE_CORNER_DOT
    ) {
      sections.push(center);
      continue;
    }

    const supportX = vec3.dot(binormal, bisector);
    const supportY = vec3.dot(normal, bisector);
    const supportRange = getSupportRange(profileLoops, supportX, supportY);
    if (!supportRange) {
      sections.push(center);
      continue;
    }

    const range = supportRange.maximum - supportRange.minimum;
    let transitionFactor = Math.sqrt(Math.max(0, widthScale * widthScale - 1));
    if (range <= EPSILON || transitionFactor <= EPSILON || !Number.isFinite(transitionFactor)) {
      sections.push(center);
      continue;
    }

    transitionFactor = Math.min(
      transitionFactor,
      incomingLength / (2 * range),
      outgoingLength / (2 * range)
    );
    if (transitionFactor <= EPSILON) {
      sections.push(center);
      continue;
    }

    const innerSupport = supportRange.maximum;
    const referenceOffset = range * transitionFactor / 2;

    vec3.scaleAndAdd(joinOrigin, point, incoming, -innerSupport * transitionFactor);
    vec3.scaleAndAdd(joinXAxis, center.xAxis, incoming, supportX * transitionFactor);
    vec3.scaleAndAdd(joinYAxis, center.yAxis, incoming, supportY * transitionFactor);
    sections.push(createSection(
      joinOrigin,
      incoming,
      joinXAxis,
      joinYAxis,
      binormal,
      normal,
      length - referenceOffset,
      frameIndex,
      'join-in',
      false
    ));

    center.role = 'join-center';
    center.collapsePrevious = true;
    sections.push(center);

    vec3.scaleAndAdd(joinOrigin, point, outgoing, innerSupport * transitionFactor);
    vec3.scaleAndAdd(joinXAxis, center.xAxis, outgoing, -supportX * transitionFactor);
    vec3.scaleAndAdd(joinYAxis, center.yAxis, outgoing, -supportY * transitionFactor);
    sections.push(createSection(
      joinOrigin,
      outgoing,
      joinXAxis,
      joinYAxis,
      binormal,
      normal,
      length + referenceOffset,
      frameIndex,
      'join-out',
      true
    ));
  }

  return sections;
}

export function transformCornerPoint(
  out: Vector3,
  section: CornerSection,
  point: ReadonlyArray<number>
): Vector3 {
  vec3.scale(out, section.xAxis, point[0]!);
  vec3.scaleAndAdd(out, out, section.yAxis, point[1]!);
  return vec3.add(out, section.origin, out);
}

export function transformCornerNormal(
  out: Vector3,
  section: CornerSection,
  normal: ReadonlyArray<number>
): Vector3 {
  return transformCornerNormalComponents(out, section, normal[0]!, normal[1]!);
}

export function transformCornerNormalComponents(
  out: Vector3,
  section: CornerSection,
  normalX: number,
  normalY: number
): Vector3 {
  vec3.scale(out, section.normalX, normalX);
  vec3.scaleAndAdd(out, out, section.normalY, normalY);
  return vec3.normalize(out, out);
}
