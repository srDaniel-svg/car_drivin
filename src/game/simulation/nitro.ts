import { fromKph } from '../config';

/**
 * Nitro canisters sit in the lanes along the road. Driving through one fires
 * a short boost straight away: harder acceleration and a top speed past the
 * car's usual limit, fading back once it runs out.
 */

/** Average spacing between canisters on the free road (about 450 m). */
export const NITRO_SPACING = 900;
/** How long one canister boosts for. */
export const NITRO_SECONDS = 3;
/** Top speed while boosting, and how hard the boost pushes. */
export const NITRO_MAX_KPH = 190;
export const NITRO_MAX_SPEED = fromKph(NITRO_MAX_KPH);
export const NITRO_ACCELERATION = 26;
/** A car collects a canister within this distance along the road and this far sideways. */
export const NITRO_PICKUP_LENGTH = 6;
export const NITRO_PICKUP_WIDTH = 4.6;

export interface NitroPickup {
  /** Unique along the whole road (and per lap on a circuit), so collecting it is remembered. */
  index: number;
  distance: number;
  /** Lane 0–3 (see laneOffsets); 2 and 3 are the oncoming side. */
  lane: number;
}

/** A repeatable pseudo-random number in [0, 1) for a canister slot. */
function slotRandom(slot: number, salt: number): number {
  const value = Math.sin(slot * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

/** Canister spacing that divides a lap evenly, so every lap has the same canisters. */
export function nitroSpacing(lapLength: number | null): number {
  if (lapLength === null) return NITRO_SPACING;
  return lapLength / Math.max(2, Math.round(lapLength / NITRO_SPACING));
}

/**
 * The canister in slot `index`, or null for an empty slot (the start/finish
 * line on a circuit). On a circuit it sits in the same place every lap.
 */
export function nitroPickup(index: number, lapLength: number | null): NitroPickup | null {
  const spacing = nitroSpacing(lapLength);
  const perLap = lapLength === null ? null : Math.round(lapLength / spacing);
  const slot = perLap === null ? index : ((index % perLap) + perLap) % perLap;
  if (slot === 0) return null;
  const jitter = (slotRandom(slot, 1) - 0.5) * spacing * 0.5;
  // Most canisters are on the drivers' own side; a few tempt them into the oncoming lanes.
  const side = slotRandom(slot, 2) < 0.7 ? 0 : 2;
  const lane = side + (slotRandom(slot, 3) < 0.5 ? 0 : 1);
  return { index, distance: index * spacing + jitter, lane };
}

/** Every canister whose slot falls in `[from, to]` along the road. */
export function nitroPickupsBetween(
  from: number,
  to: number,
  lapLength: number | null,
): NitroPickup[] {
  const spacing = nitroSpacing(lapLength);
  const pickups: NitroPickup[] = [];
  const first = Math.floor(Math.min(from, to) / spacing) - 1;
  const last = Math.ceil(Math.max(from, to) / spacing) + 1;
  for (let index = first; index <= last; index += 1) {
    const pickup = nitroPickup(index, lapLength);
    if (pickup && pickup.distance >= Math.min(from, to) && pickup.distance <= Math.max(from, to)) {
      pickups.push(pickup);
    }
  }
  return pickups;
}

/** The car at `distance`/`lateral` is driving through the canister. */
export function touchesNitro(
  pickup: NitroPickup,
  distance: number,
  lateral: number,
  pickupLateral: number,
): boolean {
  return (
    Math.abs(pickup.distance - distance) < NITRO_PICKUP_LENGTH &&
    Math.abs(pickupLateral - lateral) < NITRO_PICKUP_WIDTH
  );
}
