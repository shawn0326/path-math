import { path } from 'path-geometry';
import type { Path, ReadonlyVector } from 'path-geometry';

export type PresetId = 'sharp' | 'mixed' | 'spatial' | 'closed';
export type PathMode = 'polyline' | 'smooth' | 'beveled';

export interface Preset {
  label: string;
  description: string;
  points: ReadonlyVector[];
}

export const presets: Record<PresetId, Preset> = {
  sharp: {
    label: 'Sharp route',
    description: 'A planar route with acute corners for join and width-scale checks.',
    points: [[-7, 0, -4], [-2, 0, -4], [0, 0, 2], [5, 0, -1], [7, 0, 4]]
  },
  mixed: {
    label: 'Line + cubic',
    description: 'A straight segment flowing into a spatial cubic Bézier curve.',
    points: [[-7, 0, 0], [-2, 0, 0], [1, 4, 2], [4, -3, 4], [7, 1, 0]]
  },
  spatial: {
    label: 'Spatial S curve',
    description: 'A non-planar S curve that exposes frame transport and roll changes.',
    points: [[-7, -1, -2], [-4, 3, 2], [0, -2, 4], [4, 3, 1], [7, 0, -3]]
  },
  closed: {
    label: 'Closed loop',
    description: 'A closed 3D loop for seam and end-frame continuity checks.',
    points: [[-5, 0, -3], [0, 3, -5], [5, 0, -2], [4, -2, 4], [-2, 2, 5], [-6, 0, 1]]
  }
};

export function buildPresetPath(id: PresetId, mode: PathMode, close: boolean): Path {
  const preset = presets[id];
  if (id === 'mixed') {
    return path.writer()
      .moveTo(preset.points[0]!)
      .lineTo(preset.points[1]!)
      .cubicTo(preset.points[2]!, preset.points[3]!, preset.points[4]!)
      .toPath();
  }

  const route = path.create();
  const shouldClose = close || id === 'closed';
  if (mode === 'polyline') return route.setPolyline(preset.points, { close: shouldClose });
  if (mode === 'beveled') return route.setBeveledCurve(preset.points, { bevelRadius: 1.2, close: shouldClose });
  return route.setSmoothCurve(preset.points, { smooth: 0.35, close: shouldClose });
}
