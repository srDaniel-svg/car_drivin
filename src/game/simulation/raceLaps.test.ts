import { describe, expect, it } from 'vitest';
import { createLapState, formatLapTime, racePositions, updateLaps } from './raceLaps';

describe('updateLaps', () => {
  it('counts a lap each time the car first reaches the next line', () => {
    const state = createLapState();
    expect(updateLaps(state, 999, 1000, 3, 30)).toBe('none');
    expect(updateLaps(state, 1001, 1000, 3, 31)).toBe('lap');
    expect(state).toMatchObject({ lapsDone: 1, lastLap: 31, bestLap: 31, lapStart: 31 });
    expect(updateLaps(state, 2000, 1000, 3, 60)).toBe('lap');
    expect(state).toMatchObject({ lapsDone: 2, lastLap: 29, bestLap: 29 });
  });

  it('never counts the same line twice when reversing back over it', () => {
    const state = createLapState();
    updateLaps(state, 1001, 1000, 3, 31);
    updateLaps(state, 980, 1000, 3, 33);
    expect(updateLaps(state, 1005, 1000, 3, 35)).toBe('none');
    expect(state.lapsDone).toBe(1);
  });

  it('does not count driving backward from the start', () => {
    const state = createLapState();
    expect(updateLaps(state, -1500, 1000, 3, 20)).toBe('none');
    expect(state.lapsDone).toBe(0);
  });

  it('takes the flag on the last lap and stops counting', () => {
    const state = createLapState();
    expect(updateLaps(state, 1000, 1000, 2, 30)).toBe('lap');
    expect(updateLaps(state, 2000, 1000, 2, 58)).toBe('finish');
    expect(state.finishTime).toBe(58);
    expect(updateLaps(state, 3200, 1000, 2, 90)).toBe('none');
    expect(state.lapsDone).toBe(2);
  });
});

describe('racePositions', () => {
  it('ranks finishers by time, then by distance, crashed cars last', () => {
    expect(
      racePositions([
        { distance: 500, finishTime: null, crashed: false },
        { distance: 900, finishTime: null, crashed: true },
        { distance: 3000, finishTime: 95, crashed: false },
        { distance: 2100, finishTime: null, crashed: false },
      ]),
    ).toEqual([3, 4, 1, 2]);
  });
});

describe('formatLapTime', () => {
  it('shows minutes, seconds and hundredths', () => {
    expect(formatLapTime(83.456)).toBe('1:23.46');
    expect(formatLapTime(5.2)).toBe('0:05.20');
    expect(formatLapTime(null)).toBe('-:--.--');
  });
});
