import * as THREE from 'three';
import { GAME } from '../config';
import { roadCenter, roadWindowStart } from '../math';
import { createRoadStrip, updateRoadStrip } from '../roadSurface';
import type { EnvironmentLook } from './conditions';
import { FinishLineSystem } from './FinishLineSystem';
import { ForestSystem } from './ForestSystem';
import { LaneMarkings } from './LaneMarkings';
import { RainSystem } from './RainSystem';
import { RoadsideFenceSystem } from './RoadsideFenceSystem';
import { RoadsideScenerySystem } from './RoadsideScenerySystem';
import { StreetLightSystem } from './StreetLightSystem';
import { VehicleLightSystem } from './VehicleLightSystem';

export const GROUND_SIZE = 1200;
export const GRASS_TEXTURE_REPEAT = 30;
const GRASS_TILE_METERS = GROUND_SIZE / GRASS_TEXTURE_REPEAT;
const ROAD_UPDATE_INTERVAL = 1 / 30;

export interface WorldViewMaterials {
  road: THREE.Material;
  shoulder: THREE.Material;
  ground: THREE.MeshStandardMaterial;
  groundGeometry: THREE.BufferGeometry;
}

/**
 * The stretch of world drawn around one driver: road, verges, ground,
 * fences, roadside props, forest, street lights, rain and car lamps. Each
 * system recycles a window that follows one road position, so a split-screen
 * game gives every driver a view of their own, and hides the others' while
 * drawing it. Materials and textures are shared between views.
 */
export class WorldView {
  readonly root = new THREE.Group();
  readonly roadMesh: THREE.Mesh;
  readonly shoulderMesh: THREE.Mesh;
  readonly ground: THREE.Mesh;
  readonly forest: ForestSystem;
  readonly streetLights: StreetLightSystem;
  readonly vehicleLights: VehicleLightSystem;
  readonly rain: RainSystem;
  private readonly roadGeometry: THREE.BufferGeometry;
  private readonly shoulderGeometry: THREE.BufferGeometry;
  private readonly laneMarkings: LaneMarkings;
  private readonly roadsideFences: RoadsideFenceSystem;
  private readonly roadsideScenery: RoadsideScenerySystem;
  private readonly finishLine: FinishLineSystem;
  private roadUpdateElapsed = Number.POSITIVE_INFINITY;
  private lastRoadUpdateDistance = Number.NaN;

  constructor(materials: WorldViewMaterials) {
    this.root.name = 'world-view';
    this.roadGeometry = createRoadStrip(GAME.roadWidth, 320, 0, 1, GAME.roadWidth);
    this.roadMesh = new THREE.Mesh(this.roadGeometry, materials.road);
    this.roadMesh.receiveShadow = true;
    this.root.add(this.roadMesh);

    this.shoulderGeometry = createRoadStrip(GAME.roadWidth + 5.5, 320);
    this.shoulderMesh = new THREE.Mesh(this.shoulderGeometry, materials.shoulder);
    this.shoulderMesh.position.y = -0.055;
    this.shoulderMesh.receiveShadow = true;
    this.root.add(this.shoulderMesh);
    this.laneMarkings = new LaneMarkings(this.root);

    this.ground = new THREE.Mesh(materials.groundGeometry, materials.ground);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.09;
    this.ground.receiveShadow = true;
    this.root.add(this.ground);

    this.roadsideFences = new RoadsideFenceSystem(this.root);
    this.roadsideScenery = new RoadsideScenerySystem(this.root);
    this.forest = new ForestSystem(this.root);
    this.vehicleLights = new VehicleLightSystem(this.root);
    this.streetLights = new StreetLightSystem(this.root);
    this.rain = new RainSystem(this.root);
    this.finishLine = new FinishLineSystem(this.root);
  }

  setTreeModel(pine: THREE.Object3D): void {
    this.forest.setNearModel(pine);
    this.roadsideScenery.setTreeModel(pine);
  }

  setLook(look: EnvironmentLook): void {
    this.vehicleLights.setLook(look);
    this.streetLights.setLook(look);
    this.rain.setRain(look.rain, look.rainColor);
  }

  reset(): void {
    // The road may be a different track now: rebuild it on the next update.
    this.lastRoadUpdateDistance = Number.NaN;
    this.roadsideFences.reset();
    this.streetLights.reset();
    this.roadsideScenery.reset();
    this.forest.reset();
  }

  /** Recycles every windowed system around `distance`, looking `viewAlong` the road. */
  update(distance: number, viewAlong: number, dt: number): void {
    this.roadUpdateElapsed += dt;
    const roadJumped =
      !Number.isFinite(this.lastRoadUpdateDistance) ||
      Math.abs(distance - this.lastRoadUpdateDistance) > 5;
    if (roadJumped || this.roadUpdateElapsed >= ROAD_UPDATE_INTERVAL) {
      const length = GAME.lookAhead + GAME.lookBehind + 150;
      const start = roadWindowStart(distance, viewAlong, length, GAME.lookBehind);
      updateRoadStrip(this.shoulderGeometry, start, length);
      updateRoadStrip(this.roadGeometry, start, length);
      this.laneMarkings.update(start, length);
      this.lastRoadUpdateDistance = distance;
      this.roadUpdateElapsed = 0;
    }
    this.roadsideFences.update(distance, viewAlong);
    this.roadsideScenery.update(distance, viewAlong);
    this.forest.update(distance, viewAlong);
    this.finishLine.update(distance, viewAlong);
    this.ground.position.set(roadCenter(distance), -0.09, -distance - 180 * viewAlong);
  }

  /**
   * The grass texture is shared by every view, so its offset is written just
   * before this view draws. Offsetting from the plane's world position keeps
   * recentring the large ground mesh from making the texture travel.
   */
  applyGroundOffset(): void {
    // PlaneGeometry's V axis points toward negative world Z once laid flat.
    const material = this.ground.material as THREE.MeshStandardMaterial;
    const offsetX = this.ground.position.x / GRASS_TILE_METERS;
    const offsetY = -this.ground.position.z / GRASS_TILE_METERS;
    material.map?.offset.set(offsetX, offsetY);
    material.normalMap?.offset.set(offsetX, offsetY);
    material.roughnessMap?.offset.set(offsetX, offsetY);
    material.metalnessMap?.offset.set(offsetX, offsetY);
  }

  dispose(): void {
    this.roadsideFences.dispose();
    this.roadsideScenery.dispose();
    this.vehicleLights.dispose();
    this.streetLights.dispose();
    this.rain.dispose();
    this.laneMarkings.dispose();
    this.finishLine.dispose();
    this.forest.dispose();
    this.roadGeometry.dispose();
    this.shoulderGeometry.dispose();
    this.root.removeFromParent();
  }
}
