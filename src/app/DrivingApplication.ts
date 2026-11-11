import { EngineSound } from '../audio/EngineSound';
import type { HandCommand, HandController } from '../controls/HandController';
import type { RemoteHandCommand } from '../controls/RemoteHandController';
import {
  KeyboardController,
  PLAYER_ONE_KEYS,
  PLAYER_TWO_KEYS,
} from '../controls/KeyboardController';
import type { DrivingGame } from '../game/DrivingGame';
import type { DrivingConditions } from '../game/conditionsCatalog';
import type { ControlInput, ControlMode, GameSnapshot } from '../game/types';
import { DEFAULT_CAR_MODEL_ID } from '../game/vehicleCatalog';
import type { CarModelId } from '../game/vehicleCatalog';
import { formatLapTime } from '../game/simulation/raceLaps';
import { getTrack } from '../game/tracks';
import { ordinalSuffix } from '../ui/GameHud';
import { cacheAssets } from '../services/assetCache';
import { AssetGate } from '../ui/AssetGate';
import { ConditionsSettings } from '../ui/ConditionsSettings';
import { byId } from '../ui/dom';
import { GameHud } from '../ui/GameHud';
import { GraphicsSettings } from '../ui/GraphicsSettings';
import { PerformanceHud } from '../ui/PerformanceHud';
import { Minimap } from '../ui/Minimap';
import { RaceCountdown } from '../ui/RaceCountdown';
import { SplitHud } from '../ui/SplitHud';
import { saveBestLap } from '../ui/trackRecords';
import { launchConfetti } from '../ui/confetti';
import { QuizOverlay } from '../ui/QuizOverlay';
import type { QuizMatch } from '../quiz/quizMatch';
import { TrackSettings } from '../ui/TrackSettings';
import type { TrackChoice } from '../ui/TrackSettings';

type TrackingState = 'ok' | 'warn' | 'off';

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
}

/** Keys that hold each split-screen player's handbrake. */
const HANDBRAKE_KEYS: readonly (readonly string[])[] = [['Space'], ['ShiftRight']];

/** Coordinates UI intent with the input, audio, asset, and game subsystems. */
export class DrivingApplication {
  private readonly events = new AbortController();
  private readonly keyboard = new KeyboardController();
  private readonly audio = new EngineSound();
  private readonly hud = new GameHud();
  private readonly splitHud = new SplitHud();
  private readonly graphicsSettings = new GraphicsSettings();
  private readonly conditionsSettings = new ConditionsSettings();
  private readonly trackSettings = new TrackSettings();
  private readonly raceCountdown = new RaceCountdown();
  private readonly minimap = new Minimap();
  private readonly performanceHud = new PerformanceHud();
  private readonly assetGate = new AssetGate();
  private readonly viewport = byId<HTMLDivElement>('viewport');
  private readonly gameShell = document.querySelector<HTMLElement>('.game-shell');
  private readonly overlay = byId<HTMLElement>('overlay');
  private readonly video = byId<HTMLVideoElement>('camera-video');
  private readonly cameraCanvases = [
    byId<HTMLCanvasElement>('camera-canvas'),
    byId<HTMLCanvasElement>('camera-canvas-2'),
  ];
  private readonly cameraShell = document.querySelector<HTMLElement>('.camera-shell');
  private readonly trackingPill = byId<HTMLElement>('tracking-pill');
  private readonly trackingLabel = byId<HTMLElement>('tracking-label');
  private readonly cameraHint = byId<HTMLElement>('camera-hint');
  private readonly pauseButton = byId<HTMLButtonElement>('pause-button');
  private readonly fullscreenButton = byId<HTMLButtonElement>('fullscreen-button');

  private game: DrivingGame | null = null;
  private handControllers: HandController[] = [];
  private remoteControllers: import('../controls/RemoteHandController').RemoteHandController[] = [];
  /** Per-player keyboards for split screen, created on first use. */
  private splitKeyboards: KeyboardController[] = [];
  /** The camera opened for split screen, shared by both players' trackers. */
  private sharedStream: MediaStream | null = null;
  private handStatuses: string[] = [];
  /** Per player: how far calibration has got, 0 to 1. */
  private handProgress: number[] = [];
  private mode: ControlMode = 'hands';
  private lastSnapshots: GameSnapshot[] = [];
  private soundEnabled = true;
  /** Per player: the handbrake key is held, in either control mode. */
  private handbrakeHeld = [false, false];
  private driverCar: CarModelId = DEFAULT_CAR_MODEL_ID;
  private secondDriverCar: CarModelId = DEFAULT_CAR_MODEL_ID;
  private playerCount: 1 | 2 = 1;
  private trafficCount = 4;
  private rushHour = true;
  /** Two-player races end in a surprise question for the first car home. */
  private quizEnabled = true;
  private modelCount = 1;
  private assetsReady: Promise<boolean> = Promise.resolve(false);
  private sceneReady: Promise<boolean> = Promise.resolve(false);
  private resumeAfterGraphics = false;

  constructor() {
    if (!this.gameShell || !this.cameraShell) throw new Error('The game shell is incomplete.');
  }

  start(): void {
    this.fullscreenButton.hidden = !document.fullscreenEnabled;
    this.applyConditions(this.conditionsSettings.get());
    this.bindUiEvents();
    this.assetsReady = this.installAssets();
  }

  dispose(): void {
    this.events.abort();
    this.stopHandControllers();
    this.remoteControllers.forEach((controller) => controller.stop());
    this.remoteControllers = [];
    this.keyboard.dispose();
    this.splitKeyboards.forEach((keyboard) => keyboard.dispose());
    this.audio.stop();
    this.game?.dispose();
  }

  /** Players actually in the game: fixed once the cars are applied. */
  private get players(): number {
    return this.game?.getPlayerCount() ?? this.playerCount;
  }

  private bindUiEvents(): void {
    const options = { signal: this.events.signal };
    this.graphicsSettings.bind(
      {
        onOpen: () => this.openGraphicsSettings(),
        onClose: () => this.closeGraphicsSettings(),
        onChange: (mode) => this.game?.setGraphicsQuality(mode),
      },
      this.events.signal,
    );
    this.trackSettings.bind((choice) => this.applyTrack(choice), this.events.signal);
    this.conditionsSettings.bind(
      (conditions) => this.applyConditions(conditions),
      this.events.signal,
    );
    this.assetGate.retryButton.addEventListener(
      'click',
      () => {
        this.assetsReady = this.installAssets();
      },
      options,
    );
    byId<HTMLSelectElement>('player-count').addEventListener(
      'change',
      (event) => {
        this.setPlayerCount((event.currentTarget as HTMLSelectElement).value === '2' ? 2 : 1);
      },
      options,
    );
    byId<HTMLSelectElement>('driver-car').addEventListener(
      'change',
      (event) => {
        this.driverCar = (event.currentTarget as HTMLSelectElement).value as CarModelId;
      },
      options,
    );
    byId<HTMLSelectElement>('second-driver-car').addEventListener(
      'change',
      (event) => {
        this.secondDriverCar = (event.currentTarget as HTMLSelectElement).value as CarModelId;
      },
      options,
    );
    byId<HTMLSelectElement>('traffic-count').addEventListener(
      'change',
      (event) => {
        this.trafficCount = Number((event.currentTarget as HTMLSelectElement).value);
      },
      options,
    );
    byId<HTMLSelectElement>('rush-hour').addEventListener(
      'change',
      (event) => {
        this.rushHour = (event.currentTarget as HTMLSelectElement).value === 'on';
        this.game?.setRushHour(this.rushHour);
      },
      options,
    );
    byId<HTMLSelectElement>('quiz-mode').addEventListener(
      'change',
      (event) => {
        this.quizEnabled = (event.currentTarget as HTMLSelectElement).value === 'on';
        this.game?.setEndOnFirstFinish(this.quizActive());
      },
      options,
    );
    byId<HTMLSelectElement>('car-model-count').addEventListener(
      'change',
      (event) => {
        this.modelCount = Number((event.currentTarget as HTMLSelectElement).value);
      },
      options,
    );
    byId<HTMLButtonElement>('camera-start').addEventListener(
      'click',
      (event) => {
        void this.useHandControls(event.currentTarget as HTMLButtonElement);
      },
      options,
    );
    byId('keyboard-start').addEventListener('click', () => void this.useKeyboard(), options);
    byId('remote-start').addEventListener(
      'click',
      (event) => {
        void this.useRemoteHandControls(event.currentTarget as HTMLButtonElement);
      },
      options,
    );
    this.pauseButton.addEventListener('click', () => this.togglePause(), options);
    byId('cruise-toggle').addEventListener('click', () => this.game?.toggleCruise(0), options);
    byId('cruise-down').addEventListener('click', () => this.game?.adjustCruise(-1, 0), options);
    byId('cruise-up').addEventListener('click', () => this.game?.adjustCruise(1, 0), options);
    byId('hide-camera').addEventListener('click', () => this.setCameraVisible(false), options);
    byId('show-camera').addEventListener('click', () => this.setCameraVisible(true), options);
    byId<HTMLButtonElement>('mute-button').addEventListener(
      'click',
      (event) => {
        this.soundEnabled = !this.soundEnabled;
        this.audio.setEnabled(this.soundEnabled);
        (event.currentTarget as HTMLButtonElement).textContent = this.soundEnabled
          ? 'SOUND ON'
          : 'SOUND OFF';
      },
      options,
    );
    this.fullscreenButton.addEventListener('click', () => void this.toggleFullscreen(), options);
    document.addEventListener('fullscreenchange', () => this.onFullscreenChange(), options);
    document.addEventListener(
      'visibilitychange',
      () => {
        this.handControllers.forEach((controller) => controller.setPaused(document.hidden));
        this.remoteControllers.forEach((controller) => controller.setPaused(document.hidden));
      },
      options,
    );
    window.addEventListener('keydown', (event) => this.onGlobalKeyDown(event), options);
    window.addEventListener(
      'keyup',
      (event) => {
        if (event.code === 'KeyH') this.audio.setHorn(false);
        const player = this.handbrakePlayer(event.code);
        if (player >= 0) {
          // Space would otherwise press whichever button has focus.
          if (this.handbrakeHeld[player]) event.preventDefault();
          this.handbrakeHeld[player] = false;
        }
      },
      options,
    );
    window.addEventListener(
      'blur',
      () => {
        this.audio.setHorn(false);
        this.handbrakeHeld = [false, false];
      },
      options,
    );
    window.addEventListener('beforeunload', () => this.dispose(), { once: true });
  }

  private setPlayerCount(count: 1 | 2): void {
    this.playerCount = count;
    const split = count === 2;
    for (const option of document.querySelectorAll('.second-driver-option')) {
      option.classList.toggle('is-hidden', !split);
    }
    this.game?.setEndOnFirstFinish(this.quizActive());
    byId('split-note').classList.toggle('is-hidden', !split);
    byId('driver-car-label').textContent = split ? 'PLAYER 1 CAR' : 'YOUR CAR';
    byId('keyboard-start-keys').textContent = split ? 'P1 WASD · P2 ARROWS' : 'WASD / ARROWS';
  }

  private async installAssets(): Promise<boolean> {
    this.assetGate.begin();
    const cached = await cacheAssets((progress) => this.assetGate.update(progress));
    if (!cached) {
      this.assetGate.showError();
      return false;
    }

    this.assetGate.markPreparing();
    if (!this.game) {
      this.game = await this.createGame();
      this.sceneReady = this.game.whenReady().then(
        () => true,
        (error) => {
          console.error('Could not prepare all scene assets.', error);
          return false;
        },
      );
    }
    if (!(await this.sceneReady)) {
      this.assetGate.markPreparationError();
      this.assetGate.showError();
      return false;
    }

    this.assetGate.markReady();
    await this.assetGate.finish();
    return true;
  }

  private async createGame(): Promise<DrivingGame> {
    const { DrivingGame } = await import('../game/DrivingGame');
    const game = new DrivingGame(
      this.viewport,
      (playerIndex) => this.getControl(playerIndex),
      (snapshots) => this.onSnapshots(snapshots),
      () => this.showCrash(),
      (results) => this.showRaceResults(results),
      (snapshot) => this.performanceHud.update(snapshot),
    );
    game.setPerformanceMonitoring(this.performanceHud.isVisible());
    game.setGraphicsQuality(this.graphicsSettings.getMode());
    game.setConditions(this.conditionsSettings.get());
    this.applyTrack(this.trackSettings.get(), game);
    return game;
  }

  private onSnapshots(snapshots: GameSnapshot[]): void {
    this.lastSnapshots = snapshots;
    this.raceCountdown.update(snapshots);
    this.minimap.update(snapshots);
    if (snapshots.length === 1) {
      this.hud.update(snapshots[0], this.getControl(0).steering);
    } else {
      this.splitHud.update(
        snapshots,
        snapshots.map((_, index) => this.getControl(index).steering),
      );
    }
    // One engine note for the room: it follows whoever is driving fastest.
    const driving = snapshots.filter((snapshot) => snapshot.phase !== 'crashed');
    this.audio.update(Math.max(0, ...driving.map((snapshot) => snapshot.speedKph)));
    this.audio.setSkid(Math.max(0, ...snapshots.map((snapshot) => snapshot.skid)));
  }

  /** Shows the chosen track behind the start screen; the next run races on it. */
  private applyTrack(choice: TrackChoice, game = this.game): void {
    game?.setTrack(choice.trackId, choice.laps);
  }

  private applyConditions(conditions: DrivingConditions): void {
    this.game?.setConditions(conditions);
    this.audio.setRain(conditions.weather === 'rain' ? 1 : 0);
  }

  private getControl(playerIndex: number): ControlInput {
    const handbrake = this.handbrakeHeld[playerIndex] ?? false;
    if (this.mode === 'hands') {
      const input =
        this.remoteControllers[playerIndex]?.getInput() ??
        this.handControllers[playerIndex]?.getInput() ?? {
          steering: 0,
          confidence: 0,
          active: false,
        };
      return { ...input, handbrake };
    }
    // Keyboard mode remains active while keys are released so coasting works.
    const keyboard = this.players > 1 ? this.splitKeyboard(playerIndex) : this.keyboard;
    return { ...keyboard.getInput(), active: true, handbrake };
  }

  private splitKeyboard(playerIndex: number): KeyboardController {
    if (this.splitKeyboards.length === 0) {
      this.splitKeyboards = [
        new KeyboardController(window, PLAYER_ONE_KEYS),
        new KeyboardController(window, PLAYER_TWO_KEYS),
      ];
    }
    return this.splitKeyboards[playerIndex] ?? this.splitKeyboards[0];
  }

  private async prepareSelectedCars(button?: HTMLButtonElement): Promise<boolean> {
    const originalContent = button?.innerHTML;
    if (button) {
      button.disabled = true;
      button.textContent = 'LOADING GAME...';
    }
    try {
      const [assetsAvailable, sceneAvailable] = await Promise.all([
        this.assetsReady,
        this.sceneReady,
      ]);
      if (!assetsAvailable || !sceneAvailable || !this.game)
        throw new Error('Required assets are unavailable.');
      this.applyTrack(this.trackSettings.get());
      this.game.setRushHour(this.rushHour);
      this.game.setEndOnFirstFinish(this.quizActive());
      await this.game.setCars(
        this.driverCar,
        this.trafficCount,
        this.modelCount,
        this.playerCount === 2 ? this.secondDriverCar : undefined,
      );
      this.gameShell!.classList.toggle('is-split', this.players > 1);
      return true;
    } catch (error) {
      console.error('Could not prepare the game.', error);
      this.showGameLoadError();
      return false;
    } finally {
      if (button && originalContent !== undefined) {
        button.innerHTML = originalContent;
        button.disabled = false;
      }
    }
  }

  private async useHandControls(button: HTMLButtonElement): Promise<void> {
    if (!(await this.prepareSelectedCars(button))) return;
    const players = this.players;
    this.mode = 'hands';
    this.audio.start();
    this.cameraShell!.classList.remove('is-offline', 'is-hidden');
    this.cameraShell!.classList.add('is-calibrating');
    const rings = Array.from(
      { length: players },
      (_, index) => `
        <div class="calibration-player">
          ${players > 1 ? `<b>PLAYER ${index + 1}</b>` : ''}
          <div class="calibration-ring" data-player="${index}"><span>0%</span></div>
        </div>`,
    ).join('');
    this.overlay.innerHTML = `
      <div class="modal compact-modal calibration-modal">
        <div class="eyebrow"><span></span> CALIBRATING</div>
        <h2>${players > 1 ? 'BOTH HOLD THE WHEEL.' : 'HOLD THE WHEEL.'}</h2>
        <p>${
          players > 1
            ? 'Sit side by side, each on your own half of the camera. Keep two closed hands apart and level, and hold steady while we find each neutral position.'
            : 'Keep two closed hands apart and level. Hold steady while we find your neutral position.'
        }</p>
        <div class="calibration-rings">${rings}</div>
        <button id="cancel-camera" class="secondary-button">USE KEYBOARD INSTEAD</button>
      </div>`;
    byId('cancel-camera').addEventListener('click', () => void this.useKeyboard(), {
      signal: this.events.signal,
    });
    this.setTracking('LOADING HAND MODEL', 'warn');
    this.cameraHint.textContent = 'LOADING TRACKER';

    this.stopHandControllers();
    this.handStatuses = Array.from({ length: players }, () => 'loading');
    this.handProgress = Array.from({ length: players }, () => 0);
    // MediaPipe is a large optional dependency; keyboard players never need to
    // download or parse it, so load the controller only after hand mode wins.
    const { HandController, openCamera } = await import('../controls/HandController');
    const { FULL_FRAME, SPLIT_REGIONS } = await import('../controls/cameraRegion');
    try {
      if (players > 1) this.sharedStream = await openCamera(this.video, 'split');
      this.handControllers = Array.from(
        { length: players },
        (_, index) =>
          new HandController(
            this.video,
            this.cameraCanvases[index],
            (status, progress = 0) => this.onHandStatus(index, status, progress),
            (command) => this.onHandCommand(index, command),
            players > 1 ? SPLIT_REGIONS[index] : FULL_FRAME,
          ),
      );
      await Promise.all(this.handControllers.map((controller) => controller.start()));
    } catch (error) {
      console.warn('Hand tracking unavailable:', error);
      if (this.mode === 'hands') this.onHandStatus(0, 'error', 0);
    }
  }

  private stopHandControllers(): void {
    this.handControllers.forEach((controller) => controller.stop());
    this.handControllers = [];
    this.sharedStream?.getTracks().forEach((track) => track.stop());
    this.sharedStream = null;
    this.video.srcObject = null;
    for (const canvas of this.cameraCanvases) {
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  private onHandCommand(playerIndex: number, command: HandCommand): void {
    if (command === 'cruise-toggle') this.game?.toggleCruise(playerIndex);
    else this.game?.adjustCruise(command === 'cruise-faster' ? 1 : -1, playerIndex);
  }

  private onHandStatus(playerIndex: number, status: string, progress: number): void {
    if (this.mode !== 'hands') return;
    this.handStatuses[playerIndex] = status;
    this.handProgress[playerIndex] = progress;
    const percent = Math.min(100, Math.round(progress * 100));
    const ring = document.querySelector<HTMLElement>(
      `.calibration-ring[data-player="${playerIndex}"]`,
    );
    if (status === 'calibrating') {
      ring?.querySelector('span')?.replaceChildren(`${percent}%`);
      ring?.style.setProperty('--progress', `${percent * 3.6}deg`);
    } else if (status === 'tracking') {
      ring?.querySelector('span')?.replaceChildren('OK');
      ring?.style.setProperty('--progress', '360deg');
    }

    if (status === 'error') {
      this.cameraShell!.classList.remove('is-calibrating');
      this.cameraShell!.classList.add('is-offline');
      this.setTracking('CAMERA UNAVAILABLE');
      this.stopHandControllers();
      this.mode = 'keyboard';
      this.showKeyboardReady();
      return;
    }

    const statuses = this.handStatuses;
    const allTracking = statuses.every((current) => current === 'tracking');
    if (allTracking) {
      this.cameraShell!.classList.remove('is-calibrating');
      this.setTracking('HANDS TRACKED', 'ok');
      this.cameraHint.textContent = 'STEERING ACTIVE';
      if (this.game?.getPhase() !== 'playing' && !document.getElementById('begin-run')) {
        this.showDriveReady(
          'CALIBRATION LOCKED.',
          statuses.length > 1
            ? 'Both wheels are locked. Each player turns their hands like a wheel on their own half of the camera. Raise both thumbs to slow to 40 km/h, or show both open palms for a full stop. A V sign with both hands toggles adaptive cruise. Player 1 holds Space for the handbrake, player 2 holds Right Shift. Last driver on the road wins.'
            : 'Turn your hands like a wheel. Raise both thumbs to slow to 40 km/h, or show both open palms for a full stop; keep them open for a few seconds after the car stops to reverse (a countdown shows when). Hold a V sign with both hands for adaptive cruise, and raise just your right or left thumb to change its speed. Press H for the horn and Space for the handbrake.',
        );
      }
      return;
    }

    const describe = (current: string, index: number): string =>
      current === 'calibrating'
        ? (this.handProgress[index] ?? 0) > 0
          ? 'HOLD STEADY'
          : 'SHOW TWO FISTS'
        : current === 'lost'
          ? 'SHOW TWO CLOSED HANDS'
          : current === 'tracking'
            ? 'OK'
            : 'LOADING';
    if (statuses.length > 1) {
      const lost = statuses.some((current) => current === 'lost');
      this.setTracking(
        lost
          ? 'HANDS LOST'
          : statuses.includes('calibrating')
            ? 'HOLD BOTH FISTS'
            : 'LOADING HAND MODEL',
        'warn',
      );
      this.cameraHint.textContent = statuses
        .map((current, index) => `P${index + 1}: ${describe(current, index)}`)
        .join(' · ');
    } else if (status === 'calibrating') {
      this.setTracking('HOLD BOTH FISTS', 'warn');
      this.cameraHint.textContent = progress > 0 ? 'HOLD STEADY' : 'SHOW TWO CLOSED HANDS';
    } else if (status === 'lost') {
      this.setTracking('HANDS LOST', 'warn');
      this.cameraHint.textContent = 'SHOW TWO CLOSED HANDS';
    }
  }

  private async useKeyboard(): Promise<void> {
    const button = document.getElementById('keyboard-start') as HTMLButtonElement | null;
    if (!(await this.prepareSelectedCars(button ?? undefined))) return;
    this.mode = 'keyboard';
    this.stopHandControllers();
    this.cameraShell!.classList.remove('is-calibrating');
    this.cameraShell!.classList.add('is-offline', 'is-hidden');
    this.setTracking('KEYBOARD CONTROL', 'ok');
    this.cameraHint.textContent = 'CAMERA OFF';
    this.showKeyboardReady();
  }

  private showKeyboardReady(): void {
    if (this.players > 1) {
      this.showDriveReady(
        'KEYBOARDS READY.',
        'Player 1 (left screen): W / S to accelerate and brake, A / D to steer, Space for the handbrake, C for adaptive cruise and − / + for its speed. Player 2 (right screen): the arrow keys, Right Shift for the handbrake, Right Ctrl or Numpad 0 for adaptive cruise and Numpad − / + for its speed. Keep braking at a stop to reverse. Last driver on the road wins.',
      );
      return;
    }
    this.showDriveReady(
      'KEYBOARD READY.',
      'Use W or ↑ to accelerate, S or ↓ to brake, and A / D or ← / → to steer. Keep holding S at a stop to reverse. Hold Space for the handbrake and H for the horn. Press C or use the ACC panel for adaptive cruise; + and − set its speed.',
    );
  }

  private showDriveReady(title: string, message: string): void {
    this.overlay.classList.remove('is-hidden');
    this.overlay.innerHTML = `
      <div class="modal compact-modal">
        <div class="eyebrow"><span></span> SYSTEM READY</div>
        <h2>${title}</h2><p>${message}</p>
        <button id="begin-run" class="primary-button"><span>START THE RUN</span><i>→</i></button>
      </div>`;
    byId('begin-run').addEventListener('click', () => this.beginRun(), {
      signal: this.events.signal,
    });
  }

  private beginRun(): void {
    if (!this.game) return;
    this.audio.start();
    this.audio.setPlaying(true);
    this.overlay.classList.add('is-hidden');
    if (this.players > 1) this.splitHud.show(this.players);
    else this.hud.show();
    this.game.start();
    this.pauseButton.textContent = 'PAUSE';
  }

  /**
   * The race is over: times, positions and any new lap record, with the
   * track picker borrowed from the start screen so the next race can be on
   * another circuit or over a different number of laps.
   */
  private showRaceResults(results: readonly GameSnapshot[]): void {
    this.audio.setPlaying(false);
    this.raceCountdown.update([]);
    const winner = results.findIndex(
      (result) => result.race?.finished && result.race.position === 1,
    );
    if (results.length === 2 && this.quizActive() && winner >= 0) {
      void this.runQuiz(results, winner);
      return;
    }
    this.renderRaceResults(results);
  }

  private quizActive(): boolean {
    return this.quizEnabled && this.playerCount === 2;
  }

  /** The name typed on the start screen, or JUGADOR 1 / JUGADOR 2. */
  private playerName(index: number): string {
    const input = document.getElementById(index === 0 ? 'player-one-name' : 'player-two-name');
    const typed = input instanceof HTMLInputElement ? input.value.trim().toUpperCase() : '';
    return typed || `JUGADOR ${index + 1}`;
  }

  /** The race is paused on the line while the surprise quiz decides the champion. */
  private async runQuiz(results: readonly GameSnapshot[], winner: number): Promise<void> {
    const quiz = new QuizOverlay(this.overlay, [this.playerName(0), this.playerName(1)]);
    const match = await quiz.run(winner, this.events.signal);
    if (this.events.signal.aborted) return;
    this.renderRaceResults(results, match);
  }

  private renderRaceResults(results: readonly GameSnapshot[], quiz?: QuizMatch): void {
    this.overlay.classList.remove('is-hidden');
    const { trackId } = this.trackSettings.get();
    const track = getTrack(trackId);
    const fastest = Math.min(...results.map((result) => result.race?.bestLap ?? Infinity));
    const newRecord = saveBestLap(trackId, Number.isFinite(fastest) ? fastest : null);
    this.trackSettings.refreshRecords();
    const record = newRecord ? '<div class="record-flag">NEW LAP RECORD</div>' : '';
    let headline: string;
    let summary: string;
    if (results.length === 1) {
      const race = results[0].race;
      headline = 'CHEQUERED FLAG.';
      summary = `
        <div class="final-stats">
          <div><span>TOTAL TIME</span><b>${formatLapTime(race?.totalTime ?? null)}</b></div>
          <div><span>BEST LAP</span><b>${formatLapTime(race?.bestLap ?? null)}</b></div>
          <div><span>LAPS</span><b>${race?.laps ?? 0}</b></div>
        </div>`;
    } else {
      const ranked = results
        .map((result, index) => ({ result, index }))
        .sort((x, y) => (x.result.race?.position ?? 0) - (y.result.race?.position ?? 0));
      const winner = ranked[0];
      headline = winner.result.race?.finished
        ? `PLAYER ${winner.index + 1} WINS.`
        : 'NO FINISHERS.';
      summary = `<div class="split-results">${ranked
        .map(({ result, index }) => {
          const race = result.race;
          const position = race?.position ?? index + 1;
          const time = race?.finished
            ? formatLapTime(race.totalTime)
            : `DNF · LAP ${race?.lap ?? 1}/${race?.laps ?? 1}`;
          return `
            <div class="split-result${race?.finished && position === 1 ? ' is-winner' : ''}">
              <span>${position}${ordinalSuffix(position)} · ${quiz ? escapeHtml(this.playerName(index)) : `PLAYER ${index + 1}`}</span>
              <b>${time}</b>
              <small>BEST LAP ${formatLapTime(race?.bestLap ?? null)}</small>
            </div>`;
        })
        .join('')}</div>`;
    }
    const champion = quiz ? this.championMarkup(results, quiz) : `<h2>${headline}</h2>`;
    this.overlay.innerHTML = `
      <div class="modal results-modal${quiz ? ' has-champion' : ''}">
        <div class="eyebrow"><span></span> RACE COMPLETE · ${track.name.toUpperCase()}</div>
        ${champion}
        ${record}
        ${summary}
        <div id="results-track-slot" class="results-track-slot"></div>
        <button id="restart-run" class="primary-button"><span>${quiz ? 'NUEVA CARRERA' : 'RACE AGAIN'}</span><i>↻</i></button>
      </div>`;
    byId('results-track-slot').append(this.trackSettings.element);
    const confetti = new AbortController();
    if (quiz) launchConfetti(this.overlay, 5500, confetti.signal);
    byId('restart-run').addEventListener(
      'click',
      () => {
        confetti.abort();
        this.beginRun();
      },
      { signal: this.events.signal },
    );
  }

  /** The quiz champion: trophy, name, score, time and right answers. */
  private championMarkup(results: readonly GameSnapshot[], quiz: QuizMatch): string {
    const index = quiz.champion ?? quiz.raceWinner;
    const result = results[index];
    const race = result?.race;
    const how =
      quiz.correct[index] > 0
        ? index === quiz.raceWinner
          ? '¡Llegó primero y respondió bien!'
          : '¡Robó la victoria con la respuesta correcta!'
        : 'Nadie acertó: la victoria es para quien llegó primero.';
    return `
      <div class="champion" data-player="${index}">
        <div class="champion-trophy" aria-hidden="true">🏆</div>
        <div class="champion-label">¡CAMPEÓN!</div>
        <h2 class="champion-name">${escapeHtml(this.playerName(index))}</h2>
        <p class="champion-how">${how}</p>
        <div class="final-stats champion-stats">
          <div><span>PUNTUACIÓN</span><b>${result?.score ?? 0}</b></div>
          <div><span>TIEMPO</span><b>${race?.finished ? formatLapTime(race.totalTime) : 'DNF'}</b></div>
          <div><span>RESPUESTAS CORRECTAS</span><b>${quiz.correct[index]}</b></div>
        </div>
      </div>`;
  }

  private showCrash(): void {
    this.audio.setPlaying(false);
    this.overlay.classList.remove('is-hidden');
    const snapshots = this.lastSnapshots;
    if (snapshots.length > 1) {
      this.showSplitResults(snapshots);
      return;
    }
    const snapshot = snapshots[0];
    this.overlay.innerHTML = `
      <div class="modal compact-modal crash-modal">
        <div class="eyebrow danger"><span></span> RUN ENDED</div>
        <h2>IMPACT.</h2><p>The road always wins eventually. Reset, refocus, and take the next line cleaner.</p>
        <div class="final-stats">
          <div><span>DISTANCE</span><b>${((snapshot?.distance ?? 0) / 1000).toFixed(2)} KM</b></div>
          <div><span>OVERTAKES</span><b>${snapshot?.overtakes ?? 0}</b></div>
          <div><span>SCORE</span><b>${snapshot?.score ?? 0}</b></div>
        </div>
        <button id="restart-run" class="primary-button"><span>DRIVE AGAIN</span><i>↻</i></button>
      </div>`;
    byId('restart-run').addEventListener('click', () => this.beginRun(), {
      signal: this.events.signal,
    });
  }

  /** Both drivers have crashed: the higher score wins. */
  private showSplitResults(snapshots: readonly GameSnapshot[]): void {
    const best = Math.max(...snapshots.map((snapshot) => snapshot.score));
    const winners = snapshots
      .map((snapshot, index) => ({ snapshot, index }))
      .filter(({ snapshot }) => snapshot.score === best);
    const headline = winners.length > 1 ? 'DEAD HEAT.' : `PLAYER ${winners[0].index + 1} WINS.`;
    const rows = snapshots
      .map(
        (snapshot, index) => `
          <div class="split-result${snapshot.score === best ? ' is-winner' : ''}">
            <span>PLAYER ${index + 1}</span>
            <b>${snapshot.score}</b>
            <small>${(snapshot.distance / 1000).toFixed(2)} KM · ${snapshot.overtakes} PASSED</small>
          </div>`,
      )
      .join('');
    this.overlay.innerHTML = `
      <div class="modal compact-modal crash-modal">
        <div class="eyebrow danger"><span></span> RACE OVER</div>
        <h2>${headline}</h2><p>Both drivers are off the road. Distance and overtakes decide the score.</p>
        <div class="split-results">${rows}</div>
        <button id="restart-run" class="primary-button"><span>REMATCH</span><i>↻</i></button>
      </div>`;
    byId('restart-run').addEventListener('click', () => this.beginRun(), {
      signal: this.events.signal,
    });
  }

  private togglePause(): void {
    if (!this.game) return;
    if (this.game.getPhase() === 'playing') {
      this.game.pause();
      this.audio.setPlaying(false);
      this.pauseButton.textContent = 'RESUME';
      this.overlay.classList.remove('is-hidden');
      this.overlay.innerHTML = `
        <div class="modal compact-modal">
          <div class="eyebrow"><span></span> RUN PAUSED</div>
          <h2>TAKE A BREATH.</h2><p>The road is waiting exactly where you left it.</p>
          <button id="resume-run" class="primary-button"><span>RESUME DRIVE</span><i>→</i></button>
        </div>`;
      byId('resume-run').addEventListener('click', () => this.resumeRun(), {
        signal: this.events.signal,
      });
    } else if (this.game.getPhase() === 'paused') {
      this.resumeRun();
    }
  }

  private resumeRun(): void {
    this.game?.resume();
    this.audio.setPlaying(true);
    this.overlay.classList.add('is-hidden');
    this.pauseButton.textContent = 'PAUSE';
  }

  private showGameLoadError(): void {
    this.overlay.classList.remove('is-hidden');
    this.overlay.innerHTML = `
      <div class="modal compact-modal">
        <div class="eyebrow danger"><span></span> LOADING INTERRUPTED</div>
        <h2>ASSETS NOT READY.</h2>
        <p>The game will not start until every required texture and model has loaded. Check your connection and try again.</p>
        <button id="reload-game" class="secondary-button">RELOAD GAME</button>
      </div>`;
    byId('reload-game').addEventListener('click', () => window.location.reload(), {
      signal: this.events.signal,
    });
  }

  private setTracking(text: string, state: TrackingState = 'off'): void {
    this.trackingLabel.textContent = text;
    this.trackingPill.dataset.state = state;
  }

  private setCameraVisible(visible: boolean): void {
    this.cameraShell!.classList.toggle('is-hidden', !visible);
    byId('show-camera').classList.toggle('is-hidden', visible);
  }

  private async toggleFullscreen(): Promise<void> {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await this.gameShell!.requestFullscreen();
  }

  private onFullscreenChange(): void {
    const active = document.fullscreenElement !== null;
    this.fullscreenButton.textContent = active ? 'EXIT FULL SCREEN' : 'FULL SCREEN';
    this.fullscreenButton.setAttribute(
      'aria-label',
      active ? 'Exit full screen' : 'Enter full screen',
    );
    this.fullscreenButton.setAttribute('aria-pressed', active.toString());
    requestAnimationFrame(() => requestAnimationFrame(() => this.game?.refreshViewport()));
  }

  /** Which player a handbrake key belongs to, or −1. One player uses Space alone. */
  private handbrakePlayer(code: string): number {
    const keys = this.players > 1 ? HANDBRAKE_KEYS : HANDBRAKE_KEYS.slice(0, 1);
    return keys.findIndex((playerKeys) => playerKeys.includes(code));
  }

  /** Adaptive cruise keys: [player, action], or null. */
  private cruiseKey(code: string): [number, 'toggle' | 1 | -1] | null {
    if (code === 'KeyC') return [0, 'toggle'];
    if (this.players > 1) {
      if (code === 'Equal') return [0, 1];
      if (code === 'Minus') return [0, -1];
      if (code === 'ControlRight' || code === 'Numpad0') return [1, 'toggle'];
      if (code === 'NumpadAdd') return [1, 1];
      if (code === 'NumpadSubtract') return [1, -1];
      return null;
    }
    if (code === 'Equal' || code === 'NumpadAdd') return [0, 1];
    if (code === 'Minus' || code === 'NumpadSubtract') return [0, -1];
    return null;
  }

  private onGlobalKeyDown(event: KeyboardEvent): void {
    const handbrakePlayer = this.handbrakePlayer(event.code);
    if (handbrakePlayer >= 0) {
      // The handbrake works in hand and keyboard modes alike, while driving.
      if (this.game?.getPhase() === 'playing') {
        event.preventDefault();
        this.handbrakeHeld[handbrakePlayer] = true;
      }
      return;
    }
    if (event.code === 'KeyH') {
      // The horn is manual, in hand and keyboard modes alike.
      if (this.game?.getPhase() === 'playing') this.audio.setHorn(true);
      return;
    }
    const cruise = this.cruiseKey(event.code);
    if (cruise) {
      const [player, action] = cruise;
      if (action === 'toggle') {
        if (!event.repeat) this.game?.toggleCruise(player);
      } else {
        this.game?.adjustCruise(action, player);
      }
      return;
    }
    if (event.code === 'Escape' && this.graphicsSettings.isOpen()) {
      event.preventDefault();
      this.closeGraphicsSettings();
      return;
    }
    if (event.code === 'F3') {
      event.preventDefault();
      this.game?.setPerformanceMonitoring(this.performanceHud.toggle());
      return;
    }
    if (event.code !== 'Escape') return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else this.pauseButton.click();
  }

  private openGraphicsSettings(): void {
    if (this.graphicsSettings.isOpen()) return;
    this.resumeAfterGraphics = this.game?.getPhase() === 'playing';
    if (this.resumeAfterGraphics) {
      this.game?.pause();
      this.audio.setPlaying(false);
      this.pauseButton.textContent = 'RESUME';
    }
    this.graphicsSettings.open();
  }

  private closeGraphicsSettings(): void {
    if (!this.graphicsSettings.isOpen()) return;
    this.graphicsSettings.close();
    if (this.resumeAfterGraphics) {
      this.game?.resume();
      this.audio.setPlaying(true);
      this.pauseButton.textContent = 'PAUSE';
    }
    this.resumeAfterGraphics = false;
  }
}
