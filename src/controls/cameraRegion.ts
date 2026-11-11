import type { HandTrackingResult } from './handWorkerTypes';

/**
 * A vertical strip of the camera picture, in normalized raw camera
 * coordinates (not mirrored): `x` is its left edge and `width` its width.
 */
export interface CameraRegion {
  x: number;
  width: number;
}

export const FULL_FRAME: CameraRegion = { x: 0, width: 1 };

/**
 * Split screen with one camera: players face the screen side by side, so the
 * player on the left appears in the right half of the raw (unmirrored)
 * picture, and the player on the right in the left half.
 */
export const SPLIT_REGIONS: readonly [CameraRegion, CameraRegion] = [
  { x: 0.5, width: 0.5 },
  { x: 0, width: 0.5 },
];

export function isFullFrame(region: CameraRegion): boolean {
  return region.x <= 0 && region.width >= 1;
}

/** The region's pixel rectangle in a `videoWidth` × `videoHeight` frame. */
export function regionRect(
  region: CameraRegion,
  videoWidth: number,
  videoHeight: number,
): { x: number; y: number; width: number; height: number } {
  const x = Math.round(region.x * videoWidth);
  const right = Math.round((region.x + region.width) * videoWidth);
  return { x, y: 0, width: Math.max(1, right - x), height: videoHeight };
}

/**
 * Maps landmarks found in a cropped region back to the whole frame, so
 * steering, gestures and the wheel overlay measure them exactly as they would
 * for one player using the whole camera.
 */
export function regionToFrame(
  result: HandTrackingResult,
  region: CameraRegion,
): HandTrackingResult {
  if (isFullFrame(region)) return result;
  return {
    landmarks: result.landmarks.map((hand) =>
      hand.map((point) => ({ x: region.x + point.x * region.width, y: point.y, z: point.z })),
    ),
    handednessScores: result.handednessScores,
  };
}
