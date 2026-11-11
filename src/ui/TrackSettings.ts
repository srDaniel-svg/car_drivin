import { MAX_SPEED_KPH } from '../game/config';
import { trackPreviewPath, trackStats } from '../game/trackPreview';
import { DEFAULT_LAPS, DEFAULT_TRACK_ID, isTrackId, LAP_OPTIONS, TRACKS } from '../game/tracks';
import type { TrackId } from '../game/tracks';
import { byId } from './dom';
import { formatLapTime } from '../game/simulation/raceLaps';
import { loadBestLap } from './trackRecords';

const TRACK_KEY = 'hands-on-highway-track';
const LAPS_KEY = 'hands-on-highway-laps';

export interface TrackChoice {
  trackId: TrackId;
  laps: number;
}

/** The start screen's track cards, each with a drawn preview, and the lap picker. */
export function createTrackPickerMarkup(): string {
  const cards = TRACKS.map((track) => {
    const stats = trackStats(track);
    const length = stats.lapKm === null ? '∞ KM' : `${stats.lapKm.toFixed(1)} KM`;
    const corner =
      stats.cornerKph >= MAX_SPEED_KPH ? 'FLAT OUT' : `${Math.round(stats.cornerKph / 5) * 5} KM/H`;
    const badge = track.length === null ? 'FREE' : stats.difficulty;
    return `
      <button type="button" class="track-card" role="radio" aria-checked="false" data-track="${track.id}"
        title="${track.description}">
        <span class="track-badge" data-level="${badge}">${badge}</span>
        <svg class="track-preview" viewBox="0 0 100 100" aria-hidden="true">
          <path class="track-preview-road" d="${trackPreviewPath(track)}"></path>
          <path class="track-preview-line" d="${trackPreviewPath(track)}"></path>
          ${track.length === null ? '' : '<rect class="track-preview-flag" x="46" y="12" width="8" height="12"></rect>'}
        </svg>
        <b>${track.name}</b>
        <small>${length} · ${stats.bends} BENDS</small>
        <small>TIGHTEST ${corner}</small>
        ${track.length === null ? '' : '<small class="track-record" data-record></small>'}
      </button>`;
  }).join('');
  const lapOptions = LAP_OPTIONS.map(
    (laps) => `<option value="${laps}">${laps} ${laps === 1 ? 'LAP' : 'LAPS'}</option>`,
  ).join('');
  return `
    <div class="track-picker">
      <div class="track-picker-head">
        <span>TRACK</span>
        <label id="lap-option" class="lap-option"><span>LAPS</span><select id="lap-count" aria-label="Choose how many laps to race">${lapOptions}</select></label>
      </div>
      <div id="track-cards" class="track-cards" role="radiogroup" aria-label="Choose a track">${cards}</div>
    </div>`;
}

/**
 * Owns the track cards and lap picker on the start screen. The choice is
 * saved locally, and shared by one- and two-player games.
 */
export class TrackSettings {
  private readonly cards = [
    ...byId('track-cards').querySelectorAll<HTMLButtonElement>('.track-card'),
  ];
  private readonly lapSelect = byId<HTMLSelectElement>('lap-count');
  private readonly lapOption = byId<HTMLElement>('lap-option');
  private choice = this.load();
  /** The whole picker, so a results screen can borrow it between races. */
  readonly element = byId('track-cards').closest<HTMLElement>('.track-picker')!;

  constructor() {
    this.sync();
    this.refreshRecords();
  }

  /** Shows this browser's best lap on each circuit card. */
  refreshRecords(): void {
    for (const card of this.cards) {
      const record = card.querySelector<HTMLElement>('[data-record]');
      const id = card.dataset.track;
      if (!record || !isTrackId(id)) continue;
      const best = loadBestLap(id);
      record.textContent = best === null ? 'NO RECORD YET' : `BEST LAP ${formatLapTime(best)}`;
      record.classList.toggle('has-record', best !== null);
    }
  }

  bind(onChange: (choice: TrackChoice) => void, signal: AbortSignal): void {
    for (const card of this.cards) {
      card.addEventListener(
        'click',
        () => {
          const id = card.dataset.track;
          if (!isTrackId(id)) return;
          this.update({ ...this.choice, trackId: id }, onChange);
        },
        { signal },
      );
    }
    this.lapSelect.addEventListener(
      'change',
      () => this.update({ ...this.choice, laps: Number(this.lapSelect.value) }, onChange),
      { signal },
    );
    // Arrow keys move between cards, as in any radio group.
    byId('track-cards').addEventListener(
      'keydown',
      (event) => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        if (!step) return;
        event.preventDefault();
        const index = this.cards.findIndex((card) => card.dataset.track === this.choice.trackId);
        const next = this.cards[(index + step + this.cards.length) % this.cards.length];
        next.focus();
        next.click();
      },
      { signal },
    );
  }

  get(): TrackChoice {
    return { ...this.choice };
  }

  private update(choice: TrackChoice, onChange: (choice: TrackChoice) => void): void {
    this.choice = choice;
    this.sync();
    this.save();
    onChange(this.get());
  }

  private sync(): void {
    for (const card of this.cards) {
      const selected = card.dataset.track === this.choice.trackId;
      card.setAttribute('aria-checked', String(selected));
      card.tabIndex = selected ? 0 : -1;
    }
    this.lapSelect.value = String(this.choice.laps);
    const free = TRACKS.find((track) => track.id === this.choice.trackId)?.length === null;
    this.lapOption.classList.toggle('is-disabled', free);
    this.lapSelect.disabled = free;
  }

  private load(): TrackChoice {
    try {
      const trackId = window.localStorage.getItem(TRACK_KEY);
      const laps = Number(window.localStorage.getItem(LAPS_KEY));
      return {
        trackId: isTrackId(trackId) ? trackId : DEFAULT_TRACK_ID,
        laps: (LAP_OPTIONS as readonly number[]).includes(laps) ? laps : DEFAULT_LAPS,
      };
    } catch {
      return { trackId: DEFAULT_TRACK_ID, laps: DEFAULT_LAPS };
    }
  }

  private save(): void {
    try {
      window.localStorage.setItem(TRACK_KEY, this.choice.trackId);
      window.localStorage.setItem(LAPS_KEY, String(this.choice.laps));
    } catch {
      // Storage can be unavailable in private or restricted browser contexts.
    }
  }
}
