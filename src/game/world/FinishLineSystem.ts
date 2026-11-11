import * as THREE from 'three';
import { GAME } from '../config';
import { getActiveTrack, roadCenter, roadHeading } from '../math';

/** Posts stand just outside the verge, clear of the fences. */
const POST_OFFSET = GAME.roadWidth / 2 + 3.4;
const POST_HEIGHT = 10.5;
const BANNER_HEIGHT = 2.6;
/** Depth of the chequered stripe painted across the road, in world units. */
const STRIPE_DEPTH = 4.5;
const STRIPE_COLUMNS = 24;
/** Only drawn while the line is within this distance of the view. */
const VISIBLE_RANGE = 700;

/** Black and white squares, `columns` across and `rows` deep. */
export function createCheckerTexture(columns: number, rows: number): THREE.DataTexture {
  const data = new Uint8Array(columns * rows * 4);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const value = (row + column) % 2 === 0 ? 240 : 18;
      data.set([value, value, value, 255], (row * columns + column) * 4);
    }
  }
  const texture = new THREE.DataTexture(data, columns, rows, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** The banner: a chequered border around "FINISH" in white on black. */
function createBannerTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = '#101214';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const square = 16;
    for (let x = 0; x < canvas.width; x += square) {
      for (const y of [0, square, canvas.height - square * 2, canvas.height - square]) {
        context.fillStyle = (x / square + y / square) % 2 === 0 ? '#f2f2f2' : '#101214';
        context.fillRect(x, y, square, square);
      }
    }
    context.fillStyle = '#ffffff';
    context.font = '900 64px system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('F I N I S H', canvas.width / 2, canvas.height / 2 + 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** The finish line position nearest to `distance` on a circuit `length` long. */
export function nearestFinishLine(distance: number, length: number): number {
  return Math.round(distance / length) * length;
}

/**
 * The start and finish gantry of a circuit: two posts, a chequered banner
 * across the road and a chequered stripe painted on the asphalt. A circuit
 * repeats every lap, so one gantry moves to whichever line is nearest the
 * view. Hidden on the endless free road.
 */
export class FinishLineSystem {
  private readonly group = new THREE.Group();
  private readonly stripeTexture = createCheckerTexture(STRIPE_COLUMNS, 2);
  private readonly bannerTexture = createBannerTexture();
  private readonly materials: THREE.Material[];
  private readonly geometries: THREE.BufferGeometry[];

  constructor(private readonly scene: THREE.Object3D) {
    this.group.name = 'finish-line';
    const stripeMaterial = new THREE.MeshStandardMaterial({
      map: this.stripeTexture,
      roughness: 0.7,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    const postMaterial = new THREE.MeshStandardMaterial({
      color: 0xd8dde2,
      roughness: 0.45,
      metalness: 0.55,
    });
    const bannerMaterial = new THREE.MeshStandardMaterial({
      map: this.bannerTexture,
      roughness: 0.6,
      metalness: 0,
      emissive: 0xffffff,
      emissiveMap: this.bannerTexture,
      emissiveIntensity: 0.25,
    });
    this.materials = [stripeMaterial, postMaterial, bannerMaterial];

    // Local +X runs across the road, −Z along it, like a road heading of 0.
    const stripeGeometry = new THREE.PlaneGeometry(GAME.roadWidth, STRIPE_DEPTH);
    stripeGeometry.rotateX(-Math.PI / 2);
    const stripe = new THREE.Mesh(stripeGeometry, stripeMaterial);
    stripe.position.y = 0.035;
    stripe.receiveShadow = true;

    const postGeometry = new THREE.BoxGeometry(0.8, POST_HEIGHT, 0.8);
    postGeometry.translate(0, POST_HEIGHT / 2, 0);
    const beamWidth = POST_OFFSET * 2 + 0.8;
    const bannerGeometry = new THREE.BoxGeometry(beamWidth, BANNER_HEIGHT, 0.5);
    this.geometries = [stripeGeometry, postGeometry, bannerGeometry];

    this.group.add(stripe);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(postGeometry, postMaterial);
      post.position.x = side * POST_OFFSET;
      post.castShadow = true;
      this.group.add(post);
    }
    const banner = new THREE.Mesh(bannerGeometry, bannerMaterial);
    banner.position.y = POST_HEIGHT - BANNER_HEIGHT / 2;
    banner.castShadow = true;
    this.group.add(banner);

    this.group.visible = false;
    scene.add(this.group);
  }

  /** Moves the gantry to the line nearest what the view looks at. */
  update(distance: number, viewAlong: number): void {
    const { length } = getActiveTrack();
    if (length === null) {
      this.group.visible = false;
      return;
    }
    const line = nearestFinishLine(distance + viewAlong * VISIBLE_RANGE * 0.4, length);
    this.group.visible = Math.abs(line - distance) < VISIBLE_RANGE;
    if (!this.group.visible) return;
    this.group.position.set(roadCenter(line), 0, -line);
    this.group.rotation.y = roadHeading(line);
  }

  dispose(): void {
    this.scene.remove(this.group);
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.stripeTexture.dispose();
    this.bannerTexture.dispose();
  }
}
