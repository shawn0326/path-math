import type { BuildTubeOptions, GeometryData, PathFrames } from '../types';
import { createSweep, createSweepSections } from './sweep';
import type { SweepAttributeSink, SweepProfile } from './sweep';

const TAU = Math.PI * 2;
const DEFAULT_RADIUS = 0.1;
const DEFAULT_RADIAL_SEGMENTS = 8;

function createGeometry(): GeometryData {
  return {
    positions: [],
    normals: [],
    uvs: [],
    uvs2: [],
    indices: []
  };
}

function finiteOrDefault(value: number | undefined, defaultValue: number): number {
  return value !== undefined && Number.isFinite(value) ? value : defaultValue;
}

function normalizeSegments(value: number | undefined): number {
  return Math.max(2, Math.floor(finiteOrDefault(value, DEFAULT_RADIAL_SEGMENTS)));
}

function normalizePositive(value: number | undefined, defaultValue: number): number {
  return Math.max(0, finiteOrDefault(value, defaultValue));
}

function createCircleProfile(radius: number, radialSegments: number, startRad: number): SweepProfile {
  const points: number[][] = [];
  const normals: number[][] = [];
  const capTriangles: number[] = [];

  for (let segmentIndex = 0; segmentIndex < radialSegments; segmentIndex++) {
    const angle = startRad + TAU * segmentIndex / radialSegments;
    const x = Math.sin(angle);
    const y = Math.cos(angle);
    points.push([x * radius, y * radius]);
    normals.push([x, y]);
  }

  for (let triangleIndex = 0; triangleIndex < radialSegments - 2; triangleIndex++) {
    capTriangles.push(0, triangleIndex + 2, triangleIndex + 1);
  }

  return {
    loops: [{ points, normals, closed: true }],
    capTriangles
  };
}

export function createTube(frames: PathFrames, options: BuildTubeOptions = {}): GeometryData {
  if (frames.points.length === 0) return createGeometry();

  const radius = normalizePositive(options.radius, DEFAULT_RADIUS);
  const radialSegments = normalizeSegments(options.radialSegments);
  const startRad = finiteOrDefault(options.startRad, 0);
  const circumference = radius * TAU;
  const profile = createCircleProfile(radius, radialSegments, startRad);
  const sections = createSweepSections(profile, frames, {
    cornerTransition: options.cornerTransition ?? false,
    sanitizeWidthScale: true
  });
  const totalLength = sections[sections.length - 1]?.length ?? 0;
  const attributeSink: SweepAttributeSink = (
    geometry,
    surface,
    sectionIndex,
    _loopIndex,
    pointIndex,
    profileStep
  ) => {
    const length = sections[sectionIndex]!.length;
    const uvU = circumference > 0 ? length / circumference : 0;
    const uvU2 = totalLength > 0 ? length / totalLength : 0;
    let uvV = profileStep / radialSegments;

    // The existing end cap copies vertices 1..n from the seam-split side ring.
    // Preserve the UV at each geometric circle point even though Sweep caps use 0..n-1 order.
    if (surface === 'end-cap' && pointIndex === 0) uvV = 1;

    geometry.uvs.push(uvU, uvV);
    geometry.uvs2.push(uvU2, uvV);
  };

  return createSweep(
    profile,
    sections,
    {
      sideLayout: 'shared',
      normalMode: 'profile',
      startCap: options.generateStartCap ?? false,
      endCap: options.generateEndCap ?? false,
      attributeSink
    }
  );
}
