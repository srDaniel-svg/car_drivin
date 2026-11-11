export type GamePhase =
  | 'loading'
  | 'permission'
  | 'calibrating'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'crashed'
  | 'finished';
export type ControlMode = 'hands' | 'keyboard';

/** How an input reaches reverse: hold the full brake at a standstill. */
export interface ReverseGear {
  /** Seconds the full brake must stay held after the car stops. */
  delaySeconds: number;
  /** Top reverse speed in world units per second. */
  maxSpeed: number;
}

export interface ControlInput {
  steering: number;
  confidence: number;
  active: boolean;
  accelerating?: boolean;
  braking?: boolean;
  /** Normalized analog brake pressure. Omitted when the brake is released. */
  brakePressure?: number;
  /** The handbrake is held: the rear wheels lock, the car stops and can slide. */
  handbrake?: boolean;
  /** Present when this input can reverse. */
  reverseGear?: ReverseGear;
  /**
   * A brake press switches adaptive cruise off, like a real pedal (keyboard).
   * Otherwise braking and lost tracking only override it until the driver grips again.
   */
  brakeCancelsCruise?: boolean;
}

export type CruiseStatus = 'off' | 'cruising' | 'following' | 'braking';

export interface CruiseSnapshot {
  status: CruiseStatus;
  /** Adaptive cruise set speed in km/h, kept while it is off. */
  setKph: number;
}

/** A driver's race on a circuit. */
export interface RaceSnapshot {
  /** The lap being driven, 1-based; stays on the last lap once finished. */
  lap: number;
  laps: number;
  /** Time on the current lap, or the total race time once finished, in seconds. */
  lapTime: number;
  lastLap: number | null;
  bestLap: number | null;
  /** Race clock in seconds; frozen at the finish. */
  totalTime: number;
  /** 1 for the leader. */
  position: number;
  finished: boolean;
  /** Seconds until the start; 0 to −1 just after it (show GO), −1 once racing. */
  countdown: number;
  /** Where the car is along the road, in world units, for the minimap. */
  roadDistance: number;
}

export interface GameSnapshot {
  /** Speed over the ground, forward or in reverse. */
  speedKph: number;
  /** Distance driven in forward gear, whichever way along the road. */
  distance: number;
  overtakes: number;
  score: number;
  cruise: CruiseSnapshot;
  phase: GamePhase;
  assistMessage: string;
  /** How hard the tyres are sliding, 0 to 1, for the skid sound. */
  skid: number;
  /** Nitro boost left, 1 just after a canister down to 0. */
  nitro: number;
  /** Lap and timing details on a circuit; null on the free road. */
  race: RaceSnapshot | null;
}
