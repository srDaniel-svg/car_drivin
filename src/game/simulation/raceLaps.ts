/**
 * Lap counting on a circuit. Distance along the road is unrolled, so lap N
 * ends the first time a car reaches N × the lap length: reversing back over
 * the line and driving through again never counts twice, and turning round
 * at the start can never count at all.
 */
export interface LapState {
  lapsDone: number;
  /** Race clock reading when the current lap began, in seconds. */
  lapStart: number;
  lastLap: number | null;
  bestLap: number | null;
  /** Race clock reading when the car took the flag; null while racing. */
  finishTime: number | null;
}

export function createLapState(): LapState {
  return { lapsDone: 0, lapStart: 0, lastLap: null, bestLap: null, finishTime: null };
}

export type LapEvent = 'none' | 'lap' | 'finish';

/** Records any finish lines crossed this frame and reports the newest event. */
export function updateLaps(
  state: LapState,
  distance: number,
  lapLength: number,
  totalLaps: number,
  raceTime: number,
): LapEvent {
  let event: LapEvent = 'none';
  while (state.finishTime === null && distance >= (state.lapsDone + 1) * lapLength) {
    const lapTime = raceTime - state.lapStart;
    state.lapsDone += 1;
    state.lastLap = lapTime;
    state.bestLap = state.bestLap === null ? lapTime : Math.min(state.bestLap, lapTime);
    state.lapStart = raceTime;
    if (state.lapsDone >= totalLaps) {
      state.finishTime = raceTime;
      event = 'finish';
    } else {
      event = 'lap';
    }
  }
  return event;
}

export interface RaceStanding {
  distance: number;
  finishTime: number | null;
  crashed: boolean;
}

/**
 * Race positions, 1 for the leader, in the order the standings are given:
 * finishers by time, then everyone still racing by how far round they are,
 * then crashed cars.
 */
export function racePositions(standings: readonly RaceStanding[]): number[] {
  const rank = (s: RaceStanding): [number, number] =>
    s.finishTime !== null ? [0, s.finishTime] : s.crashed ? [2, -s.distance] : [1, -s.distance];
  const order = standings
    .map((standing, index) => ({ index, key: rank(standing) }))
    .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1]);
  const positions = new Array<number>(standings.length);
  order.forEach((entry, place) => (positions[entry.index] = place + 1));
  return positions;
}

/** m:ss.cc, as lap timers show it. */
export function formatLapTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '-:--.--';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(2).padStart(5, '0')}`;
}
