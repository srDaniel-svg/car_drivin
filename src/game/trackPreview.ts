import { MAX_LATERAL_ACCELERATION } from './math';
import { toKph, toMeters } from './config';
import type { TrackDefinition } from './tracks';

/** Distance sampled for the endless road's preview and stats. */
const FREE_ROAD_SAMPLE = 6000;
/** A bend counts once the road curves tighter than this radius (world units). */
const BEND_RADIUS = 900;

export interface TrackStats {
  /** Lap length in kilometres, or null for the endless road. */
  lapKm: number | null;
  /** Distinct bends per lap (per 3 km on the endless road). */
  bends: number;
  /** Fastest speed the grip allows through the tightest bend, in km/h. */
  cornerKph: number;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
}

function curvatureAt(center: (d: number) => number, d: number): number {
  const slope = (center(d + 1) - center(d - 1)) / 2;
  const second = center(d + 1) - 2 * center(d) + center(d - 1);
  return Math.abs(second) / Math.pow(1 + slope * slope, 1.5);
}

export function trackStats(track: TrackDefinition): TrackStats {
  const span = track.length ?? FREE_ROAD_SAMPLE;
  let tightest = 0;
  let bends = 0;
  let inBend = false;
  for (let d = 0; d < span; d += 2) {
    const curvature = curvatureAt(track.center, d);
    tightest = Math.max(tightest, curvature);
    const bending = curvature > 1 / BEND_RADIUS;
    if (bending && !inBend) bends += 1;
    inBend = bending;
  }
  const cornerKph = toKph(Math.sqrt(MAX_LATERAL_ACCELERATION / Math.max(tightest, 1e-9)));
  return {
    lapKm: track.length === null ? null : toMeters(track.length) / 1000,
    bends,
    cornerKph,
    difficulty: cornerKph < 120 ? 'HARD' : bends > 12 ? 'MEDIUM' : 'EASY',
  };
}

/**
 * SVG path data for a track's thumbnail in a `size`-square box. A circuit is
 * drawn as a closed ring, start line at the top, with its bends pushing the
 * ring in and out (exaggerated so they read at thumbnail size); the endless
 * road as an open wavy line running up the box.
 */
export function trackPreviewPath(track: TrackDefinition, size = 100): string {
  const half = size / 2;
  const points: string[] = [];
  const steps = 240;
  if (track.length === null) {
    for (let step = 0; step <= steps; step += 1) {
      const d = (step / steps) * FREE_ROAD_SAMPLE;
      const x = half + track.center(d) * (size * 0.0036);
      const y = size * 0.92 - (step / steps) * size * 0.84;
      points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    return `M${points.join('L')}`;
  }
  for (let step = 0; step < steps; step += 1) {
    const point = circuitPoint(track, (step / steps) * track.length, size);
    points.push(`${point.x.toFixed(1)},${point.y.toFixed(1)}`);
  }
  return `M${points.join('L')}Z`;
}

/**
 * Where `distance` along a circuit falls on its ring drawing (see
 * trackPreviewPath): clockwise from the finish line at the top, one turn per
 * lap, so it also places cars on the minimap.
 */
export function circuitPoint(
  track: TrackDefinition,
  distance: number,
  size = 100,
): { x: number; y: number } {
  const length = track.length ?? FREE_ROAD_SAMPLE;
  const along = ((distance % length) + length) % length;
  const angle = (along / length) * Math.PI * 2;
  // A bend to the right (+offset) pushes the ring outward.
  const r = size * 0.32 + track.center(along) * size * 0.003;
  return { x: size / 2 + Math.sin(angle) * r, y: size / 2 - Math.cos(angle) * r };
}
