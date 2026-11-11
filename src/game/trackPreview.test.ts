import { describe, expect, it } from 'vitest';
import { trackPreviewPath, trackStats } from './trackPreview';
import { getTrack } from './tracks';

describe('trackStats', () => {
  it('rates the straight easy and the bendy circuits hard', () => {
    expect(trackStats(getTrack('valley'))).toMatchObject({
      lapKm: 2,
      bends: 0,
      difficulty: 'EASY',
    });
    expect(trackStats(getTrack('serpentine')).difficulty).toBe('HARD');
    expect(trackStats(getTrack('chicanes')).difficulty).toBe('HARD');
  });

  it('counts more bends on the serpentine than on the coastal road', () => {
    expect(trackStats(getTrack('serpentine')).bends).toBeGreaterThan(
      trackStats(getTrack('coastal')).bends,
    );
  });

  it('has no lap length on the free road', () => {
    expect(trackStats(getTrack('free')).lapKm).toBeNull();
  });
});

describe('trackPreviewPath', () => {
  it('closes circuits into a ring and leaves the free road open', () => {
    expect(trackPreviewPath(getTrack('coastal'))).toMatch(/^M.*Z$/);
    expect(trackPreviewPath(getTrack('free'))).not.toMatch(/Z$/);
  });

  it('stays inside the preview box', () => {
    for (const id of ['free', 'valley', 'coastal', 'serpentine', 'chicanes'] as const) {
      const numbers = trackPreviewPath(getTrack(id))
        .match(/-?\d+(\.\d+)?/g)!
        .map(Number);
      expect(Math.min(...numbers)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...numbers)).toBeLessThanOrEqual(100);
    }
  });
});
