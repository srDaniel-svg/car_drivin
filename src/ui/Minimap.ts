import { getActiveTrack } from '../game/math';
import { circuitPoint, trackPreviewPath } from '../game/trackPreview';
import type { GameSnapshot } from '../game/types';
import { byId } from './dom';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * A small map of the circuit in the bottom-left corner: the track, the
 * finish line and a dot for each car. Hidden on the endless free road and
 * on menus.
 */
export class Minimap {
  private readonly root = byId<HTMLElement>('minimap');
  private readonly road = this.root.querySelector<SVGPathElement>('.minimap-road')!;
  private readonly line = this.root.querySelector<SVGPathElement>('.minimap-line')!;
  private readonly cars = this.root.querySelector<SVGGElement>('.minimap-cars')!;
  private trackId = '';

  update(snapshots: readonly GameSnapshot[]): void {
    const track = getActiveTrack();
    const racing = snapshots.some(
      (snapshot) => snapshot.race !== null && snapshot.phase !== 'ready',
    );
    this.root.classList.toggle('is-hidden', !racing || track.length === null);
    if (!racing || track.length === null) return;

    if (track.id !== this.trackId) {
      this.trackId = track.id;
      const path = trackPreviewPath(track);
      this.road.setAttribute('d', path);
      this.line.setAttribute('d', path);
    }
    // Player one is drawn last so their dot stays on top when side by side.
    while (this.cars.childElementCount < snapshots.length) {
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('r', '4.2');
      dot.classList.add('minimap-car');
      this.cars.prepend(dot);
    }
    const dots = [...this.cars.children].reverse();
    snapshots.forEach((snapshot, index) => {
      const dot = dots[index];
      const distance = snapshot.race?.roadDistance;
      if (!dot || distance === undefined) return;
      const point = circuitPoint(track, distance);
      dot.setAttribute('cx', point.x.toFixed(2));
      dot.setAttribute('cy', point.y.toFixed(2));
      dot.setAttribute('data-player', String(index + 1));
    });
  }
}
