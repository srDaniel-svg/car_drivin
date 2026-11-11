import { HAND_REVERSE } from '../game/config';
import { damp, steeringFromHands } from '../game/math';
import type { ControlInput } from '../game/types';
import {
  GestureTrigger,
  isClosedHand,
  isOpenPalm,
  isThumbUp,
  isVictorySign,
  SustainedGesture,
} from './handGestures';
import type { HandPoint, HandTrackingResult } from './handWorkerTypes';

type TrackingStatus = 'idle' | 'loading' | 'ready' | 'calibrating' | 'tracking' | 'lost' | 'error';

/** One-off requests made by holding a gesture. */
export type RemoteHandCommand = 'cruise-toggle' | 'cruise-faster' | 'cruise-slower';

const CALIBRATION_SAMPLES = 45;
const BRAKE_GESTURE_HOLD_MS = 180;
const CRUISE_TOGGLE_HOLD_MS = 800;
const CRUISE_STEP_HOLD_MS = 450;
const CRUISE_STEP_REPEAT_MS = 550;

/**
 * A hand controller that receives landmarks from a remote device over
 * WebSocket instead of running MediaPipe locally.  It reuses the same
 * gesture-detection and calibration logic as the local HandController but
 * never opens a camera or loads any ML model on the game machine.
 */
export class RemoteHandController {
  private ws: WebSocket | null = null;
  private neutralAngle = 0;
  private calibrationAngles: number[] = [];
  private input: ControlInput = { steering: 0, confidence: 0, active: false };
  private readonly brakeGesture = new SustainedGesture(BRAKE_GESTURE_HOLD_MS);
  private readonly cruiseToggleGesture = new GestureTrigger(CRUISE_TOGGLE_HOLD_MS);
  private readonly cruiseFasterGesture = new GestureTrigger(
    CRUISE_STEP_HOLD_MS,
    CRUISE_STEP_REPEAT_MS,
  );
  private readonly cruiseSlowerGesture = new GestureTrigger(
    CRUISE_STEP_HOLD_MS,
    CRUISE_STEP_REPEAT_MS,
  );
  private status: TrackingStatus = 'idle';
  private lastSeen = 0;
  private stopped = false;
  private paused = false;

  constructor(
    private readonly onStatus: (status: TrackingStatus, progress?: number) => void,
    private readonly onCommand: (command: RemoteHandCommand) => void = () => undefined,
  ) {}

  /** Connects to the WebSocket relay and waits for a remote tracker. */
  async start(): Promise<void> {
    this.stopped = false;
    this.setStatus('loading');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws-tracking`;

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = (): void => {
        ws.send(JSON.stringify({ type: 'register', role: 'game' }));
        this.setStatus('ready');
        resolve();
      };

      ws.onerror = (): void => {
        this.setStatus('error');
        reject(new Error('Could not connect to the tracking relay.'));
      };

      ws.onmessage = (event): void => {
        if (this.stopped || this.paused) return;
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.type === 'tracker-connected') {
            this.beginCalibration();
          } else if (msg.type === 'tracker-disconnected') {
            this.input.active = false;
            this.resetGestures();
            this.setStatus('lost');
          } else if (msg.type === 'tracking') {
            this.consumeResult(msg.result as HandTrackingResult);
          }
        } catch {
          /* ignore */
        }
      };

      ws.onclose = (): void => {
        if (!this.stopped) {
          this.setStatus('error');
        }
      };
    });
  }

  beginCalibration(): void {
    this.calibrationAngles = [];
    this.input = { steering: 0, confidence: 0, active: false };
    this.resetGestures();
    this.setStatus('calibrating', 0);
  }

  getInput(): ControlInput {
    if (performance.now() - this.lastSeen > 420) {
      this.resetGestures();
      return { steering: 0, confidence: 0, active: false };
    }
    return { ...this.input };
  }

  getStatus(): TrackingStatus {
    return this.status;
  }

  /** No local preview to toggle; returns false. */
  togglePreview(): boolean {
    return false;
  }

  stop(): void {
    this.stopped = true;
    this.resetGestures();
    this.ws?.close();
    this.ws = null;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.resetGestures();
  }

  // ── Gesture processing (mirrors HandController.consumeResult) ─────

  private consumeResult(result: HandTrackingResult): void {
    if (result.landmarks.length !== 2) {
      this.resetGestures();
      this.input.active = false;
      if (this.status === 'tracking') this.setStatus('lost');
      return;
    }

    const hands = result.landmarks
      .map((landmarks: HandPoint[], index: number) => ({
        landmarks,
        wrist: landmarks[0],
        closed: isClosedHand(landmarks),
        openPalm: isOpenPalm(landmarks),
        thumbUp: isThumbUp(landmarks),
        victory: isVictorySign(landmarks),
        score: result.handednessScores[index] ?? 0.7,
      }))
      .sort((a, b) => a.wrist.x - b.wrist.x);

    const separation = Math.hypot(
      hands[1].wrist.x - hands[0].wrist.x,
      hands[1].wrist.y - hands[0].wrist.y,
    );
    const fistsClosed = hands.every((hand) => hand.closed);
    const palmsOpen = hands.every((hand) => hand.openPalm);
    const victory = hands.every((hand) => hand.victory);
    if ((!fistsClosed && !palmsOpen && !victory) || separation < 0.14) {
      this.resetGestures();
      this.input.active = false;
      if (this.status === 'tracking') this.setStatus('lost');
      return;
    }

    const angle = Math.atan2(
      hands[1].wrist.y - hands[0].wrist.y,
      hands[1].wrist.x - hands[0].wrist.x,
    );
    const confidence = Math.min(hands[0].score, hands[1].score);
    this.lastSeen = performance.now();

    if (this.status === 'calibrating') {
      this.resetGestures();
      if (!fistsClosed) {
        this.input.active = false;
        return;
      }
      this.calibrationAngles.push(angle);
      const progress = this.calibrationAngles.length / CALIBRATION_SAMPLES;
      this.onStatus('calibrating', progress);
      if (this.calibrationAngles.length >= CALIBRATION_SAMPLES) {
        this.neutralAngle = this.circularAverage(this.calibrationAngles);
        this.setStatus('tracking');
      }
      return;
    }

    this.updateCruiseGestures(hands, victory, this.lastSeen);
    const raw = -steeringFromHands(hands[0].wrist, hands[1].wrist, this.neutralAngle);
    const rawBrakePressure = palmsOpen ? 1 : hands.every((hand) => hand.thumbUp) ? 0.5 : 0;
    const braking = this.brakeGesture.update(rawBrakePressure > 0, this.lastSeen);
    this.input = {
      steering: damp(this.input.steering, raw, 13, 1 / 30),
      confidence,
      active: true,
      braking: braking ? true : undefined,
      brakePressure: braking ? rawBrakePressure : undefined,
      reverseGear: HAND_REVERSE,
    };
    if (this.status !== 'tracking') this.setStatus('tracking');
  }

  private resetGestures(): void {
    this.brakeGesture.reset();
    this.cruiseToggleGesture.reset();
    this.cruiseFasterGesture.reset();
    this.cruiseSlowerGesture.reset();
  }

  private updateCruiseGestures(
    hands: readonly { closed: boolean; thumbUp: boolean }[],
    victory: boolean,
    now: number,
  ): void {
    const [right, left] = hands;
    const rightThumbOnly = right.thumbUp && !left.thumbUp && left.closed;
    const leftThumbOnly = left.thumbUp && !right.thumbUp && right.closed;
    if (this.cruiseToggleGesture.update(victory, now)) this.onCommand('cruise-toggle');
    if (this.cruiseFasterGesture.update(rightThumbOnly, now)) this.onCommand('cruise-faster');
    if (this.cruiseSlowerGesture.update(leftThumbOnly, now)) this.onCommand('cruise-slower');
  }

  private circularAverage(values: number[]): number {
    const sin = values.reduce((sum, angle) => sum + Math.sin(angle), 0);
    const cos = values.reduce((sum, angle) => sum + Math.cos(angle), 0);
    return Math.atan2(sin, cos);
  }

  private setStatus(status: TrackingStatus, progress?: number): void {
    this.status = status;
    this.onStatus(status, progress);
  }
}
