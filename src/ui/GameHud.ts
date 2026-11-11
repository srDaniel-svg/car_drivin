import { MAX_SPEED_KPH } from '../game/config';
import { formatLapTime } from '../game/simulation/raceLaps';
import type { CruiseStatus, GameSnapshot, RaceSnapshot } from '../game/types';
import { byId } from './dom';

const CRUISE_LABELS: Record<CruiseStatus, string> = {
  off: 'ACC OFF',
  cruising: 'ACC ON',
  following: 'FOLLOWING',
  braking: 'BRAKING',
};

/** 1ST, 2ND, 3RD, 4TH… */
export function ordinalSuffix(position: number): string {
  if (position % 100 >= 11 && position % 100 <= 13) return 'TH';
  return ['TH', 'ST', 'ND', 'RD'][position % 10] ?? 'TH';
}

/** Updates the in-run HUD without exposing its DOM structure to the game loop. */
export class GameHud {
  private readonly root = byId<HTMLElement>('hud');
  private readonly speed = byId<HTMLElement>('speed');
  private readonly speedFill = byId<HTMLElement>('speed-fill');
  private readonly speedPanel = this.speedFill.closest<HTMLElement>('.speed-panel')!;
  private readonly distance = byId<HTMLElement>('distance');
  private readonly overtakes = byId<HTMLElement>('overtakes');
  private readonly score = byId<HTMLElement>('score');
  private readonly assist = byId<HTMLElement>('assist').querySelector<HTMLElement>('span')!;
  private readonly steering = byId<HTMLElement>('steer-indicator');
  private readonly cruisePanel = byId<HTMLElement>('cruise-panel');
  private readonly cruiseToggle = byId<HTMLButtonElement>('cruise-toggle');
  private readonly cruiseStatus = byId<HTMLElement>('cruise-status');
  private readonly cruiseSpeed = byId<HTMLElement>('cruise-speed');
  private readonly runStats = byId<HTMLElement>('run-stats');
  private readonly racePosition = byId<HTMLElement>('race-position');
  private readonly raceLap = byId<HTMLElement>('race-lap');
  private readonly raceTimeLabel = byId<HTMLElement>('race-time-label');
  private readonly raceTime = byId<HTMLElement>('race-time');
  private readonly raceBest = byId<HTMLElement>('race-best');
  private cruiseState = '';

  show(): void {
    this.root.classList.remove('is-hidden');
  }

  update(snapshot: GameSnapshot, steering: number): void {
    this.speed.textContent = Math.round(snapshot.speedKph).toString().padStart(3, '0');
    // While boosting, the bar shows the nitro left instead of the speed.
    const nitro = snapshot.nitro > 0;
    this.speedPanel.classList.toggle('is-nitro', nitro);
    this.speedFill.style.width = nitro
      ? `${snapshot.nitro * 100}%`
      : `${Math.min(100, (snapshot.speedKph / MAX_SPEED_KPH) * 100)}%`;
    this.distance.innerHTML = `${(snapshot.distance / 1000).toFixed(2)} <small>KM</small>`;
    this.overtakes.textContent = snapshot.overtakes.toString();
    this.score.textContent = snapshot.score.toString().padStart(6, '0');
    this.assist.textContent = snapshot.assistMessage;
    this.steering.style.left = `${50 + steering * 46}%`;
    this.updateRace(snapshot.race);
    const { status, setKph } = snapshot.cruise;
    const cruiseState = `${status}:${setKph}`;
    if (cruiseState !== this.cruiseState) {
      this.cruiseState = cruiseState;
      this.cruisePanel.dataset.state = status;
      this.cruiseToggle.setAttribute('aria-pressed', String(status !== 'off'));
      this.cruiseStatus.textContent = CRUISE_LABELS[status];
      this.cruiseSpeed.textContent = setKph.toString();
    }
  }

  private updateRace(race: RaceSnapshot | null): void {
    this.runStats.classList.toggle('is-race', race !== null);
    if (!race) return;
    this.racePosition.innerHTML = `${race.position}<small>${ordinalSuffix(race.position)}</small>`;
    this.raceLap.innerHTML = `${race.lap}<small>/${race.laps}</small>`;
    this.raceTimeLabel.textContent = race.finished ? 'TOTAL TIME' : 'LAP TIME';
    this.raceTime.textContent = formatLapTime(race.lapTime);
    this.raceBest.textContent = formatLapTime(race.bestLap);
  }
}
