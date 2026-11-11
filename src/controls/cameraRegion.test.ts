import { describe, expect, it } from 'vitest';
import { FULL_FRAME, regionRect, regionToFrame, SPLIT_REGIONS } from './cameraRegion';

describe('camera regions', () => {
  const result = {
    landmarks: [[{ x: 0.25, y: 0.4, z: -0.1 }], [{ x: 1, y: 0.6, z: 0 }]],
    handednessScores: [0.9, 0.8],
  };

  it('leaves whole-frame results untouched', () => {
    expect(regionToFrame(result, FULL_FRAME)).toBe(result);
  });

  it('maps a half-frame crop back to whole-frame coordinates', () => {
    const [leftPlayer, rightPlayer] = SPLIT_REGIONS;
    expect(regionToFrame(result, leftPlayer).landmarks).toEqual([
      [{ x: 0.625, y: 0.4, z: -0.1 }],
      [{ x: 1, y: 0.6, z: 0 }],
    ]);
    expect(regionToFrame(result, rightPlayer).landmarks.map((hand) => hand[0].x)).toEqual([
      0.125, 0.5,
    ]);
  });

  it('seats the player on the left of the screen in the right half of the raw picture', () => {
    // The raw camera picture is not mirrored, so the left player appears on its right.
    expect(SPLIT_REGIONS[0].x).toBeGreaterThanOrEqual(0.5);
    expect(SPLIT_REGIONS[1].x + SPLIT_REGIONS[1].width).toBeLessThanOrEqual(0.5);
  });

  it('converts a region into whole pixels that cover the frame without gaps', () => {
    const [left, right] = SPLIT_REGIONS.map((region) => regionRect(region, 1281, 720));
    expect(right).toEqual({ x: 0, y: 0, width: 641, height: 720 });
    expect(left).toEqual({ x: 641, y: 0, width: 640, height: 720 });
  });
});
