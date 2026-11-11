import { describe, expect, it } from 'vitest';
import { MAX_LATERAL_ACCELERATION } from './math';
import { START_STRAIGHT_HALF, TRACKS } from './tracks';

const circuits = TRACKS.filter((track) => track.length !== null);

function slope(center: (d: number) => number, d: number): number {
  return (center(d + 0.5) - center(d - 0.5)) / 1;
}

function curvature(center: (d: number) => number, d: number): number {
  const first = slope(center, d);
  const second = center(d + 1) - 2 * center(d) + center(d - 1);
  return Math.abs(second) / Math.pow(1 + first * first, 1.5);
}

describe('tracks', () => {
  it('offers seven circuits besides the free road', () => {
    expect(circuits).toHaveLength(7);
    expect(TRACKS.find((track) => track.id === 'free')?.length).toBeNull();
  });

  for (const track of circuits) {
    const length = track.length!;

    describe(track.name, () => {
      it('repeats exactly every lap', () => {
        for (let d = -length; d < length; d += 37) {
          expect(track.center(d + length)).toBeCloseTo(track.center(d), 6);
        }
      });

      it('starts and finishes on a straight', () => {
        for (let d = -START_STRAIGHT_HALF; d <= START_STRAIGHT_HALF; d += 10) {
          expect(Math.abs(track.center(d))).toBeLessThan(1e-9);
        }
      });

      it('never bends past the angle the road model can drive', () => {
        // The road is an offset per distance, so it must keep well under 45°.
        let steepest = 0;
        for (let d = 0; d < length; d += 2)
          steepest = Math.max(steepest, Math.abs(slope(track.center, d)));
        expect(Math.atan(steepest)).toBeLessThan((38 * Math.PI) / 180);
      });

      it('keeps every bend drivable at a sensible speed', () => {
        let tightest = 0;
        for (let d = 0; d < length; d += 2)
          tightest = Math.max(tightest, curvature(track.center, d));
        const radius = 1 / tightest;
        // Grip allows v = sqrt(a·r): at least ~80 km/h (44 units/s) in the tightest bend.
        expect(Math.sqrt(MAX_LATERAL_ACCELERATION * radius)).toBeGreaterThan(44);
      });
    });
  }
});
