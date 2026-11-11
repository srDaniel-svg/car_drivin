/**
 * The roads a game can be played on. Each track gives the road's centre line
 * as a sideways offset for every distance along it (the road runs toward −Z,
 * so it can bend but never double back).
 *
 * A circuit repeats exactly every `length` world units: its finish line sits at
 * every whole multiple of `length`, so driving on simply starts the next lap
 * over the same bends. The free road never repeats and has no finish line.
 */
export type TrackId = 'free' | 'valley' | 'coastal' | 'serpentine' | 'chicanes';

export interface TrackDefinition {
  id: TrackId;
  name: string;
  description: string;
  /** World units per lap, or null for the endless free road. */
  length: number | null;
  /** Sideways offset of the road's centre line at `distance`. */
  center: (distance: number) => number;
}

/** Each circuit runs dead straight for this far either side of the finish line. */
export const START_STRAIGHT_HALF = 140;
/** Then its bends fade in over this distance. */
const START_RAMP = 520;

const TAU = Math.PI * 2;

/** Hermite smoothstep from 0 at `edge0` to 1 at `edge1`. */
function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Wave number of a sine that repeats `cycles` times per lap, so the lap joins up seamlessly. */
function wave(cycles: number, length: number): number {
  return (TAU * cycles) / length;
}

/**
 * 0 on the straight around each finish line, rising smoothly to 1. Multiplying
 * a circuit's bends by it keeps the start grid and finish line on a straight.
 */
export function startStraightEnvelope(distance: number, length: number): number {
  const along = ((distance % length) + length) % length;
  const fromLine = Math.min(along, length - along);
  return smoothstep(START_STRAIGHT_HALF, START_STRAIGHT_HALF + START_RAMP, fromLine);
}

/** The original endless road: three incommensurate sines, so it never repeats. */
function freeRoad(distance: number): number {
  return (
    Math.sin(distance * 0.0065) * 17 +
    Math.sin(distance * 0.014 + 1.8) * 7 +
    Math.sin(distance * 0.0021 + 0.4) * 25
  );
}

const VALLEY_LENGTH = 4000;
const COASTAL_LENGTH = 6000;
const SERPENTINE_LENGTH = 4800;
const CHICANE_LENGTH = 7200;

export const TRACKS: readonly TrackDefinition[] = [
  {
    id: 'free',
    name: 'Free Road',
    description: 'The endless highway, no finish line.',
    length: null,
    center: freeRoad,
  },
  {
    id: 'valley',
    name: 'Valley Straight',
    description: 'Almost dead straight: flat out all the way round.',
    length: VALLEY_LENGTH,
    center: (d) =>
      startStraightEnvelope(d, VALLEY_LENGTH) *
      (Math.sin(d * wave(2, VALLEY_LENGTH)) * 18 + Math.sin(d * wave(5, VALLEY_LENGTH)) * 3),
  },
  {
    id: 'coastal',
    name: 'Coastal Road',
    description: 'Long, flowing bends you can take at speed.',
    length: COASTAL_LENGTH,
    center: (d) =>
      startStraightEnvelope(d, COASTAL_LENGTH) *
      (Math.sin(d * wave(6, COASTAL_LENGTH)) * 17 +
        Math.sin(d * wave(13, COASTAL_LENGTH) + 1.8) * 7 +
        Math.sin(d * wave(2, COASTAL_LENGTH) + 0.4) * 25),
  },
  {
    id: 'serpentine',
    name: 'Serpentine',
    description: 'One bend after another: brake, turn, accelerate.',
    length: SERPENTINE_LENGTH,
    center: (d) =>
      startStraightEnvelope(d, SERPENTINE_LENGTH) *
      (Math.sin(d * wave(12, SERPENTINE_LENGTH)) * 32 +
        Math.sin(d * wave(25, SERPENTINE_LENGTH) + 0.7) * 6),
  },
  {
    id: 'chicanes',
    name: 'Chicane Run',
    description: 'Fast straights broken by three tight S-bends.',
    length: CHICANE_LENGTH,
    center: (d) => {
      // Three bursts of quick S-bends per lap, with straights between them.
      const burst = Math.max(0, Math.sin(d * wave(3, CHICANE_LENGTH) - 0.6)) ** 2;
      return (
        startStraightEnvelope(d, CHICANE_LENGTH) *
        (Math.sin(d * wave(30, CHICANE_LENGTH)) * 20 * burst +
          Math.sin(d * wave(2, CHICANE_LENGTH)) * 30)
      );
    },
  },
];

export const DEFAULT_TRACK_ID: TrackId = 'free';
export const LAP_OPTIONS = [1, 3, 5, 10] as const;
export const DEFAULT_LAPS = 3;

export function getTrack(id: TrackId): TrackDefinition {
  return TRACKS.find((track) => track.id === id) ?? TRACKS[0];
}

export function isTrackId(value: unknown): value is TrackId {
  return TRACKS.some((track) => track.id === value);
}
