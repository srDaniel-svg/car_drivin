import { MAX_SPEED_KPH } from '../game/config';
import { formatLapTime } from '../game/simulation/raceLaps';
import type { CruiseStatus, GameSnapshot } from '../game/types';
import { ordinalSuffix } from './GameHud';
import { byId } from './dom';

const CRUISE_LABELS: Record<CruiseStatus, string> = {
  off: 'ACC OFF',
  cruising: 'ACC ON',
  following: 'FOLLOWING',
  braking: 'BRAKING',
};

interface PlayerPanel {
  root: HTMLElement;
  speed: HTMLElement;
  speedFill: HTMLElement;
  distance: HTMLElement;
  overtakes: HTMLElement;
  score: HTMLElement;
  position: HTMLElement;
  lap: HTMLElement;
  lapTime: HTMLElement;
  assist: HTMLElement;
  cruise: HTMLElement;
  steering: HTMLElement;
}

/** One compact panel per split-screen driver, each in the corner of their half. */
export class SplitHud {
  private readonly root = byId<HTMLElement>('split-hud');
  private readonly panels: PlayerPanel[] = [];

  show(playerCount: number): void {
    if (this.panels.length !== playerCount) this.build(playerCount);
    this.root.classList.remove('is-hidden');
  }

  hide(): void {
    this.root.classList.add('is-hidden');
  }

  update(snapshots: readonly GameSnapshot[], steering: readonly number[]): void {
    snapshots.forEach((snapshot, index) => {
      const panel = this.panels[index];
      if (!panel) return;
      panel.speed.textContent = Math.round(snapshot.speedKph).toString().padStart(3, '0');
      const nitro = snapshot.nitro > 0;
      panel.root.classList.toggle('is-nitro', nitro);
      panel.speedFill.style.width = nitro
        ? `${snapshot.nitro * 100}%`
        : `${Math.min(100, (snapshot.speedKph / MAX_SPEED_KPH) * 100)}%`;
      panel.distance.textContent = (snapshot.distance / 1000).toFixed(2);
      panel.overtakes.textContent = snapshot.overtakes.toString();
      panel.score.textContent = snapshot.score.toString().padStart(6, '0');
      panel.assist.textContent = snapshot.assistMessage;
      const { status, setKph } = snapshot.cruise;
      panel.cruise.textContent = `${CRUISE_LABELS[status]} · ${setKph}`;
      panel.cruise.dataset.state = status;
      panel.root.classList.toggle('is-crashed', snapshot.phase === 'crashed');
      const { race } = snapshot;
      panel.root.classList.toggle('is-race', race !== null);
      if (race) {
        panel.position.textContent = `${race.position}${ordinalSuffix(race.position)}`;
        panel.lap.textContent = `${race.lap}/${race.laps}`;
        panel.lapTime.textContent = formatLapTime(race.lapTime);
      }
      panel.steering.style.left = `${50 + (steering[index] ?? 0) * 46}%`;
    });
  }

  private build(playerCount: number): void {
    this.root.replaceChildren();
    this.panels.length = 0;
    const divider = document.createElement('div');
    divider.className = 'split-divider';
    this.root.append(divider);
    for (let index = 0; index < playerCount; index += 1) {
      const root = document.createElement('div');
      root.className = 'split-panel';
      root.dataset.player = String(index + 1);
      root.innerHTML = `
        <div class="split-tag">P${index + 1}</div>
        <div class="split-speed"><b>000</b><small>KM/H</small></div>
        <div class="split-speed-track"><span></span></div>
        <div class="split-stats">
          <span class="race-stat">POS<b data-field="position">1ST</b></span>
          <span class="race-stat">LAP<b data-field="lap">1/3</b></span>
          <span class="race-stat">TIME<b data-field="lap-time">0:00.00</b></span>
          <span class="free-stat">KM<b data-field="distance">0.00</b></span>
          <span>PASSED<b data-field="overtakes">0</b></span>
          <span class="free-stat">SCORE<b data-field="score">000000</b></span>
        </div>
        <div class="split-status"><span data-field="assist">READY</span><span data-field="cruise">ACC OFF</span></div>
        <div class="split-steer"><i></i></div>
        <div class="split-crashed">CRASHED</div>`;
      const field = (name: string): HTMLElement =>
        root.querySelector<HTMLElement>(`[data-field="${name}"]`)!;
      this.panels.push({
        root,
        speed: root.querySelector<HTMLElement>('.split-speed b')!,
        speedFill: root.querySelector<HTMLElement>('.split-speed-track span')!,
        distance: field('distance'),
        overtakes: field('overtakes'),
        score: field('score'),
        position: field('position'),
        lap: field('lap'),
        lapTime: field('lap-time'),
        assist: field('assist'),
        cruise: field('cruise'),
        steering: root.querySelector<HTMLElement>('.split-steer i')!,
      });
      this.root.append(root);
    }
  }
}
