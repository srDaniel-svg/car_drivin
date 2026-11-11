import type { GameSnapshot } from '../game/types';
import { byId } from './dom';

/** What the start lights show for a countdown reading: 3, 2, 1, GO! or nothing. */
export function countdownLabel(countdown: number): string {
  if (countdown > 0) return String(Math.ceil(countdown));
  return countdown > -0.85 ? 'GO!' : '';
}

/** The big 3-2-1-GO in the middle of the screen at the start of a race. */
export class RaceCountdown {
  private readonly root = byId<HTMLElement>('race-countdown');
  private label = '';

  update(snapshots: readonly GameSnapshot[]): void {
    const countdown = snapshots[0]?.race?.countdown ?? -1;
    const label = snapshots[0]?.phase === 'playing' ? countdownLabel(countdown) : '';
    if (label === this.label) return;
    this.label = label;
    this.root.classList.toggle('is-hidden', label === '');
    this.root.dataset.go = String(label === 'GO!');
    // Restart the pop animation for each new number.
    this.root.textContent = label;
    this.root.classList.remove('is-pop');
    void this.root.offsetWidth;
    this.root.classList.add('is-pop');
  }
}
