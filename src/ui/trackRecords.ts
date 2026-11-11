import type { TrackId } from '../game/tracks';

const recordKey = (trackId: TrackId): string => `hands-on-highway-best-lap-${trackId}`;

/** This browser's fastest lap on a track, in seconds, or null if none is saved. */
export function loadBestLap(trackId: TrackId): number | null {
  try {
    const value = Number(window.localStorage.getItem(recordKey(trackId)));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Saves `seconds` if it beats the stored lap; returns whether it was a new record. */
export function saveBestLap(trackId: TrackId, seconds: number | null): boolean {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return false;
  const previous = loadBestLap(trackId);
  if (previous !== null && previous <= seconds) return false;
  try {
    window.localStorage.setItem(recordKey(trackId), String(seconds));
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
  return true;
}
