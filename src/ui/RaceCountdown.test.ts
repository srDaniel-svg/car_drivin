import { describe, expect, it } from 'vitest';
import { countdownLabel } from './RaceCountdown';

describe('countdownLabel', () => {
  it('counts 3, 2, 1, then shows GO! briefly', () => {
    expect(countdownLabel(3)).toBe('3');
    expect(countdownLabel(2.4)).toBe('3');
    expect(countdownLabel(1.2)).toBe('2');
    expect(countdownLabel(0.3)).toBe('1');
    expect(countdownLabel(-0.2)).toBe('GO!');
    expect(countdownLabel(-1)).toBe('');
  });
});
