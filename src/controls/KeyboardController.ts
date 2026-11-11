import { KEYBOARD_REVERSE } from '../game/config';
import type { ControlInput } from '../game/types';

/** Which keys steer, accelerate and brake. */
export interface KeyBindings {
  left: readonly string[];
  right: readonly string[];
  accelerate: readonly string[];
  brake: readonly string[];
}

/** One driver alone: WASD and the arrow keys both drive. */
export const SOLO_KEYS: KeyBindings = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  accelerate: ['ArrowUp', 'KeyW'],
  brake: ['ArrowDown', 'KeyS'],
};

/** Split screen: player one drives on WASD... */
export const PLAYER_ONE_KEYS: KeyBindings = {
  left: ['KeyA'],
  right: ['KeyD'],
  accelerate: ['KeyW'],
  brake: ['KeyS'],
};

/** ...and player two on the arrow keys. */
export const PLAYER_TWO_KEYS: KeyBindings = {
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  accelerate: ['ArrowUp'],
  brake: ['ArrowDown'],
};

export class KeyboardController {
  private left = false;
  private right = false;
  private accelerating = false;
  private braking = false;

  constructor(
    private readonly eventTarget: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
    private readonly bindings: KeyBindings = SOLO_KEYS,
  ) {
    this.eventTarget.addEventListener('keydown', this.onKeyDown);
    this.eventTarget.addEventListener('keyup', this.onKeyUp);
    this.eventTarget.addEventListener('blur', this.reset);
  }

  getInput(): ControlInput {
    return {
      steering: Number(this.right) - Number(this.left),
      confidence: 1,
      active: this.left || this.right || this.accelerating || this.braking,
      accelerating: this.accelerating,
      braking: this.braking,
      reverseGear: KEYBOARD_REVERSE,
      brakeCancelsCruise: true,
    };
  }

  private setKey(code: string, pressed: boolean): void {
    if (this.bindings.left.includes(code)) this.left = pressed;
    if (this.bindings.right.includes(code)) this.right = pressed;
    if (this.bindings.accelerate.includes(code)) this.accelerating = pressed;
    if (this.bindings.brake.includes(code)) this.braking = pressed;
  }

  private onKeyDown = (event: KeyboardEvent): void => this.setKey(event.code, true);

  private onKeyUp = (event: KeyboardEvent): void => this.setKey(event.code, false);

  private reset = (): void => {
    this.left = false;
    this.right = false;
    this.accelerating = false;
    this.braking = false;
  };

  dispose(): void {
    this.eventTarget.removeEventListener('keydown', this.onKeyDown);
    this.eventTarget.removeEventListener('keyup', this.onKeyUp);
    this.eventTarget.removeEventListener('blur', this.reset);
  }
}
