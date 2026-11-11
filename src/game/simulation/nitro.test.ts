import { describe, expect, it } from 'vitest';
import {
  NITRO_SPACING,
  nitroPickup,
  nitroPickupsBetween,
  nitroSpacing,
  touchesNitro,
} from './nitro';

describe('nitro canisters', () => {
  it('spaces canisters about every 450 m on the free road', () => {
    const pickups = nitroPickupsBetween(0, NITRO_SPACING * 20, null);
    expect(pickups.length).toBeGreaterThanOrEqual(18);
    expect(pickups.length).toBeLessThanOrEqual(21);
  });

  it('places the same canisters on every lap of a circuit', () => {
    const lap = 6000;
    const spacing = nitroSpacing(lap);
    const perLap = lap / spacing;
    expect(Number.isInteger(Math.round(perLap * 1000) / 1000)).toBe(true);
    for (let slot = 1; slot < perLap; slot += 1) {
      const first = nitroPickup(slot, lap)!;
      const second = nitroPickup(slot + perLap, lap)!;
      expect(second.distance - first.distance).toBeCloseTo(lap, 6);
      expect(second.lane).toBe(first.lane);
      expect(second.index).not.toBe(first.index);
    }
  });

  it('keeps the start/finish line clear on a circuit', () => {
    expect(nitroPickup(0, 4000)).toBeNull();
    expect(nitroPickup(Math.round(4000 / nitroSpacing(4000)), 4000)).toBeNull();
  });

  it('puts most canisters on the drivers own side, and some across the centre line', () => {
    const lanes = nitroPickupsBetween(0, NITRO_SPACING * 200, null).map((pickup) => pickup.lane);
    const ownSide = lanes.filter((lane) => lane < 2).length / lanes.length;
    expect(ownSide).toBeGreaterThan(0.55);
    expect(ownSide).toBeLessThan(0.9);
  });

  it('is collected only by driving through it', () => {
    const pickup = { index: 3, distance: 500, lane: 1 };
    expect(touchesNitro(pickup, 498, -4.5, -4.75)).toBe(true);
    expect(touchesNitro(pickup, 480, -4.75, -4.75)).toBe(false);
    expect(touchesNitro(pickup, 500, 4.75, -4.75)).toBe(false);
  });
});
