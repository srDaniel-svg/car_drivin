import * as THREE from 'three';
import { PerformanceMonitor } from '../diagnostics/PerformanceMonitor';
import type { PerformanceSnapshot } from '../diagnostics/PerformanceMonitor';
import { fromKph, GAME, laneOffsets, toKph, toMeters } from './config';
import {
  clamp,
  constrainToRoad,
  damp,
  followTravelHeading,
  HANDBRAKE_SLIDE_MIN_SPEED,
  HANDBRAKE_YAW_BOOST,
  roadCenter,
  roadHeading,
  setActiveTrack,
  steeringYawRate,
} from './math';
import { AdaptiveQuality, chooseInitialQuality } from './rendering/AdaptiveQuality';
import type { GraphicsQualityMode, RenderQualitySettings } from './rendering/AdaptiveQuality';
import { installKeyLightGlintControl, setKeyLightGlint } from './rendering/keyLightGlint';
import { installVividToneMapping, VIVID_TONE_MAPPING } from './rendering/vividToneMapping';
import { PostProcessing } from './rendering/PostProcessing';
import { applyGroundVariation } from './rendering/groundVariation';
import { SceneryAssets } from './sceneryAssets';
import {
  adjustCruise,
  CRUISE_DEFAULT_KPH,
  cruiseStaysEngaged,
  findLeadVehicle,
} from './simulation/cruiseControl';
import type { RadarTarget } from './simulation/cruiseControl';
import { createSpeedPlan, updateReverseHold } from './simulation/drivingAssist';
import { createLapState, formatLapTime, racePositions, updateLaps } from './simulation/raceLaps';
import type { LapState } from './simulation/raceLaps';
import {
  NITRO_ACCELERATION,
  NITRO_MAX_SPEED,
  NITRO_SECONDS,
  nitroPickupsBetween,
  touchesNitro,
} from './simulation/nitro';
import { findTrafficLead, trafficAcceleration } from './simulation/trafficFollowing';
import type { RoadUser } from './simulation/trafficFollowing';
import {
  addSceneLighting,
  applySceneLighting,
  SurfaceTextureStore,
  updateSceneShadow,
} from './sceneAssets';
import type { SceneLighting } from './sceneAssets';
import { DEFAULT_LAPS, DEFAULT_TRACK_ID, getTrack } from './tracks';
import type { TrackId } from './tracks';
import type { ControlInput, CruiseStatus, GamePhase, GameSnapshot, RaceSnapshot } from './types';
import { VehicleAssets } from './vehicleAssets';
import type { LoadedCarModel } from './vehicleAssets';
import { DEFAULT_CAR_MODEL_ID, selectCarModelIds } from './vehicleCatalog';
import type { CarModelId } from './vehicleCatalog';
import { installAtmosphericFog, setAtmosphericScattering } from './world/atmosphere';
import { createEnvironmentLook, DEFAULT_CONDITIONS } from './world/conditions';
import type { DrivingConditions, EnvironmentLook } from './world/conditions';
import { MountainRange } from './world/MountainRange';
import { SkySystem } from './world/SkySystem';
import { GRASS_TEXTURE_REPEAT, GROUND_SIZE, WorldView } from './world/WorldView';

interface TrafficCar {
  mesh: THREE.Group;
  distance: number;
  lane: number;
  laneOffset: number;
  speed: number;
  targetSpeed: number;
  speedChangeTimer: number;
  direction: 1 | -1;
  /** The driver this car spawns ahead of and is recycled around. */
  owner: number;
  /** Per driver: the car is already behind them, so passing it no longer counts. */
  counted: boolean[];
  /** Collision envelope of the car's model, in world units. */
  length: number;
  width: number;
  /** Where in its lane the car settles; `laneOffset` eases back here after a lane change. */
  restOffset: number;
  /** Seconds until the car may next change lanes (only during rush hour). */
  laneChangeTimer: number;
  /** One of the extra cars a rush-hour wave brings; it leaves once the wave is over. */
  rush: boolean;
}

interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One player's car, its chase camera, and the stretch of world drawn for them. */
interface Driver {
  index: number;
  mesh: THREE.Group;
  carModel: CarModelId;
  camera: THREE.PerspectiveCamera;
  view: WorldView;
  postProcessing?: PostProcessing;
  viewport: Viewport;
  distance: number;
  speed: number;
  lateral: number;
  worldX: number;
  vehicleHeading: number;
  /** Direction of travel; it lags the nose while the handbrake slides the car. */
  travelHeading: number;
  /** The rear wheels are locked by the handbrake this frame. */
  rearWheelsLocked: boolean;
  /** How hard the tyres are sliding, 0 to 1. */
  skid: number;
  steeringVisual: number;
  longitudinalAcceleration: number;
  /** Seconds the full brake has been held at a standstill; engages reverse. */
  reverseHoldSeconds: number;
  /** Which way along the road the car points: 1 the original way, -1 after a U-turn. */
  facing: 1 | -1;
  /** Cosine between the camera's view and the road's forward direction. */
  viewAlong: number;
  /** Distance driven in forward gear; the score counts this, not the position. */
  odometer: number;
  /** Adaptive cruise: on/off, its set speed (kept while off) and what it is doing. */
  cruiseOn: boolean;
  cruiseSetKph: number;
  cruiseStatus: CruiseStatus;
  /** A short-lived HUD message, such as a refused cruise request. */
  notice: { message: string; seconds: number };
  overtakes: number;
  assistMessage: string;
  /** This driver hit something; their run is over while others may drive on. */
  crashed: boolean;
  /** Laps and lap times on a circuit. */
  laps: LapState;
  /** Seconds a respawned car is held still on the line before it may drive. */
  holdSeconds: number;
  /** Seconds a respawned car passes through others, so it cannot crash again at once. */
  ghostSeconds: number;
  /** Seconds of nitro boost left. */
  nitroSeconds: number;
  /** The boost is pushing the car this frame. */
  boosting: boolean;
  /** How strongly the nitro camera effect shows, 0 to 1; eases in fast and out slowly. */
  nitroFx: number;
  /** The jolt of grabbing a canister, 1 at the moment it fires and decaying fast. */
  nitroKick: number;
  /** Nitro canisters this driver has already taken; they vanish from their view. */
  readonly collectedNitro: Set<number>;
  /** Canister meshes drawn along this driver's stretch of road. */
  readonly nitroMeshes: THREE.Group[];
  readonly forward: THREE.Vector3;
  readonly desiredCamera: THREE.Vector3;
  readonly cameraTarget: THREE.Vector3;
  readonly viewDirection: THREE.Vector3;
  readonly lastPosition: THREE.Vector3;
  hasLastPosition: boolean;
  /** Put the chase camera straight behind the car next frame instead of easing it there. */
  snapCamera: boolean;
}

const IDLE_RENDER_INTERVAL_MS = 200;
const BASE_FOV = 56;
/** Split-screen views are narrow, so their lens opens wider to keep the road in view. */
const SPLIT_BASE_FOV = 68;
const SPEED_FOV_BOOST = 9;
const CAMERA_DISTANCE = 8.5;
/** The chase camera eases back this much further at top speed. */
const CAMERA_SPEED_PULLBACK = 3;
/** Road texture vibration felt through the camera at top speed, in world units. */
const CAMERA_SHAKE = 0.05;
/** Spawn queues start at least this far ahead: about four seconds of warning at top speed. */
const TRAFFIC_SPAWN_AHEAD = 260;
/** Traffic lights its brake lamps when slowing harder than this (about 0.1 g). */
const TRAFFIC_BRAKE_LIGHT_DECELERATION = 2;
/** The view must turn this far past side-on before traffic treats it as the new way ahead. */
const FACING_HYSTERESIS = 0.2;
/** Extra cars a rush-hour wave puts on the road, on top of the chosen traffic. */
const RUSH_EXTRA_CARS = 8;
/** Seconds of driving before the first wave, and between the end of one and the next. */
const RUSH_FIRST_WAVE_SECONDS = 25;
const RUSH_INTERVAL_SECONDS = [35, 60] as const;
/** How long a wave lasts, and how long before it the HUD warns of it. */
const RUSH_DURATION_SECONDS = 24;
const RUSH_WARNING_SECONDS = 4;
/** Wave cars appear just beyond the drawn road, so they come into view rather than pop in. */
const RUSH_SPAWN_AHEAD = 470;
/** Lanes must be clear this far either side before traffic moves into them. */
const LANE_CHANGE_CLEARANCE = 26;
/** Traffic never cuts in this close to a driver. */
const LANE_CHANGE_DRIVER_CLEARANCE = 28;
/** Nitro canisters drawn ahead of each driver; more than ever fit in the drawn road. */
const NITRO_MESHES_PER_DRIVER = 4;
/** The lens opens this much further during a nitro boost, and this much more at the jolt. */
const NITRO_FOV_BOOST = 16;
const NITRO_FOV_KICK = 14;
/** A race starts after a 3-2-1 countdown with every car held on the line. */
export const RACE_COUNTDOWN_SECONDS = 3;
/** Once the first car takes the flag, the others have this long to finish. */
export const RACE_FINISH_GRACE_SECONDS = 30;
/** A car that crashes in a race is put back in its lane and held this long. */
const RESPAWN_HOLD_SECONDS = 2;
/** Then it drives through other cars for this long. */
const RESPAWN_GHOST_SECONDS = 3;
/** A car that has taken the flag brakes to a stop on its own. */
const FINISHED_CONTROL: ControlInput = { steering: 0, confidence: 1, active: true, braking: true };
/** Player two's paint, so two drivers of the same model can tell their cars apart. */
const SECOND_DRIVER_COLOR = 0x1f5fe0;
/** Each driver starts in their own lane going the same way: player one outside, two inside. */
const DRIVER_START_LANES = [0, 1] as const;
/** Dry and fully wet values for the road, verge and meadow surfaces. */
const SURFACE_WETNESS = {
  road: { roughness: [0.96, 0.36], brightness: [1, 0.64], reflection: [1, 1.5] },
  shoulder: { roughness: [0.96, 0.48], brightness: [1, 0.74], reflection: [1, 1.3] },
  ground: { roughness: [0.96, 0.8], brightness: [1, 0.84], reflection: [1, 1.1] },
} as const;

export class DrivingGame {
  private readonly scene = new THREE.Scene();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly performanceMonitor = new PerformanceMonitor();
  private readonly adaptiveQuality: AdaptiveQuality;
  private readonly clock = new THREE.Clock();
  private readonly vehicleAssets = new VehicleAssets();
  private readonly drivers: Driver[] = [];
  private readonly traffic: TrafficCar[] = [];
  private readonly sky: SkySystem;
  private readonly fog: THREE.FogExp2;
  private readonly drawingBufferSize = new THREE.Vector2();
  private look?: EnvironmentLook;
  private readonly mountainRange: MountainRange;
  private readonly lighting: SceneLighting;
  private readonly textureStore: SurfaceTextureStore;
  private readonly sceneryAssets: SceneryAssets;
  private readonly sceneAssetsReady: Promise<void>;
  private readonly roadMaterial: THREE.MeshStandardMaterial;
  private readonly shoulderMaterial: THREE.MeshStandardMaterial;
  private readonly groundMaterial: THREE.MeshStandardMaterial;
  private readonly groundGeometry = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE);
  private readonly shadowCenter = new THREE.Vector3();
  private pineTree?: THREE.Object3D;
  private phase: GamePhase = 'ready';
  private carModelsPromise?: Promise<LoadedCarModel[]>;
  private carModelsApplied = false;
  private sceneAssetsLoaded = false;
  private lastSnapshot = 0;
  private lastIdleRender = 0;
  private animationFrame = 0;
  private performanceMonitoring = false;
  private graphicsQualityMode: GraphicsQualityMode = 'auto';
  private pendingRenderQuality?: RenderQualitySettings;
  private denseForest = false;
  private trackId: TrackId = DEFAULT_TRACK_ID;
  /** Lap length of the circuit being raced, or null on the free road. */
  private lapLength: number | null = null;
  private totalLaps = DEFAULT_LAPS;
  /** Seconds of racing since the start; stops while paused. */
  private raceTime = 0;
  /**
   * Seconds left before the start lights go green. It keeps counting below
   * zero for a moment so the HUD can show GO; −Infinity once that is over.
   */
  private countdown = Number.NEGATIVE_INFINITY;
  /** Seconds the others have left to finish once someone has won; null until then. */
  private finishGrace: number | null = null;
  /** Rush hour: waves of extra, slower traffic that also changes lanes. */
  private rushHourEnabled = true;
  private rushActive = false;
  /** Seconds until the next wave starts, or until the current one ends. */
  private rushClock = RUSH_FIRST_WAVE_SECONDS;
  private rushWarned = false;
  /** Wave cars not on the road right now. */
  private readonly rushReserve: TrafficCar[] = [];

  constructor(
    private readonly container: HTMLElement,
    private readonly getControl: (playerIndex: number) => ControlInput,
    private readonly onUpdate: (snapshots: GameSnapshot[]) => void,
    private readonly onCrash: () => void,
    private readonly onRaceFinish: (results: GameSnapshot[]) => void,
    private readonly onPerformanceUpdate: (snapshot: PerformanceSnapshot) => void,
  ) {
    // Aerial-perspective fog, the key-light glint control and the vivid tone
    // mapping must be installed before any material compiles.
    installAtmosphericFog();
    installKeyLightGlintControl();
    installVividToneMapping();
    this.fog = new THREE.FogExp2(0xffffff);
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color();

    const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    this.adaptiveQuality = new AdaptiveQuality(
      chooseInitialQuality(navigator.hardwareConcurrency || 2, deviceMemory),
    );
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, this.adaptiveQuality.settings.pixelRatioCap),
    );
    this.renderer.setSize(container.clientWidth, container.clientHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = VIVID_TONE_MAPPING;
    this.renderer.toneMappingExposure = 1.0;
    // The effect composer issues several renders per frame; count them all.
    this.renderer.info.autoReset = false;
    container.appendChild(this.renderer.domElement);

    // The sky is both the backdrop and the source of image-based lighting, so
    // car paint, glass and chrome reflect the same clouds the player sees.
    this.sky = new SkySystem();
    this.scene.add(this.sky.mesh);
    this.mountainRange = new MountainRange();
    this.scene.add(this.mountainRange.mesh);
    // Apply the starting tier on the first frame (creates the effect composer
    // when post-processing is enabled, including in Auto mode).
    this.pendingRenderQuality = this.adaptiveQuality.settings;

    this.textureStore = new SurfaceTextureStore(this.renderer.capabilities.getMaxAnisotropy());

    this.roadMaterial = this.textureStore.createMaterial(
      'RoadLines_baseColor.jpeg',
      'RoadLines_normal.png',
      'RoadLines_metallicRoughness.png',
      {
        textureRoot: 'roads/textures',
        normalScale: 0.34,
        tint: 0xffffff,
      },
    );
    this.shoulderMaterial = this.textureStore.createMaterial(
      'Sidewalk01_baseColor.jpeg',
      'Sidewalk01_normal.png',
      'Sidewalk01_metallicRoughness.png',
      {
        textureRoot: 'roads/textures',
        normalScale: 0.38,
        tint: 0xffffff,
      },
    );
    this.groundMaterial = this.textureStore.createMaterial(
      'Grass02_baseColor.jpeg',
      'Grass02_normal.png',
      'Grass02_metallicRoughness.png',
      {
        textureRoot: 'roads/textures',
        repeatX: GRASS_TEXTURE_REPEAT,
        repeatY: GRASS_TEXTURE_REPEAT,
        normalScale: 0.34,
        tint: 0xffffff,
      },
    );
    applyGroundVariation(this.groundMaterial);
    this.sceneryAssets = new SceneryAssets();

    this.lighting = addSceneLighting(this.scene, this.adaptiveQuality.settings.shadowMapSize);
    this.addDriver(DEFAULT_CAR_MODEL_ID);
    this.setupTraffic();
    this.setConditions(DEFAULT_CONDITIONS);
    const natureReady = this.sceneryAssets.loadNature().then(() => {
      const pine = this.sceneryAssets.getPineTreePrototype();
      if (!pine) return;
      this.pineTree = pine;
      for (const driver of this.drivers) driver.view.setTreeModel(pine);
    });
    this.sceneAssetsReady = Promise.all([this.textureStore.whenReady(), natureReady]).then(() => {
      this.sceneAssetsLoaded = true;
    });
    this.resize();
    window.addEventListener('resize', this.resize);
    this.animationFrame = requestAnimationFrame(this.animate);
  }

  start(): void {
    if (!this.sceneAssetsLoaded || !this.carModelsApplied) {
      throw new Error('The game cannot start before all required assets load.');
    }
    if (this.phase === 'crashed' || this.phase === 'finished') this.reset();
    if (this.phase === 'ready' && this.lapLength !== null) {
      this.countdown = RACE_COUNTDOWN_SECONDS;
      for (const driver of this.drivers) driver.assistMessage = 'GET READY';
    }
    this.phase = 'playing';
    this.clock.getDelta();
  }

  pause(): void {
    if (this.phase === 'playing') {
      this.phase = 'paused';
      for (const driver of this.drivers) {
        if (!driver.crashed) driver.assistMessage = 'PAUSED';
      }
    }
  }

  resume(): void {
    if (this.phase === 'paused') {
      this.phase = 'playing';
      this.clock.getDelta();
    }
  }

  reset(): void {
    for (const driver of this.drivers) this.resetDriver(driver);
    this.phase = 'ready';
    this.raceTime = 0;
    this.countdown = Number.NEGATIVE_INFINITY;
    this.finishGrace = null;
    this.endRushHour(true);
    this.rushClock = RUSH_FIRST_WAVE_SECONDS;
    let ongoingCursor = 45;
    let incomingCursor = 62;
    this.traffic.forEach((car, index) => {
      car.owner = index % this.drivers.length;
      car.direction = index === 0 ? 1 : index === 1 ? -1 : Math.random() < 0.56 ? 1 : -1;
      if (car.direction === 1) {
        ongoingCursor += 34 + Math.random() * 48;
        this.spawnTraffic(car, ongoingCursor);
      } else {
        incomingCursor += 38 + Math.random() * 58;
        this.spawnTraffic(car, incomingCursor);
      }
    });
  }

  /**
   * Chooses the road and, on a circuit, how many laps the race runs. Puts
   * every car back on the start line, so it is only accepted between runs.
   */
  setTrack(id: TrackId, laps: number = DEFAULT_LAPS): void {
    if (this.phase === 'playing' || this.phase === 'paused') return;
    this.totalLaps = Math.max(1, Math.round(laps));
    if (id === this.trackId) return;
    this.trackId = id;
    this.lapLength = getTrack(id).length;
    setActiveTrack(id);
    this.reset();
    this.lastIdleRender = 0;
  }

  /** Turns the rush-hour waves on or off; taken up from the next run. */
  setRushHour(enabled: boolean): void {
    this.rushHourEnabled = enabled;
    if (!enabled) this.endRushHour(true);
  }

  getPhase(): GamePhase {
    return this.phase;
  }

  /** How many drivers share the screen. */
  getPlayerCount(): number {
    return this.drivers.length;
  }

  refreshViewport(): void {
    this.resize();
  }

  setPerformanceMonitoring(enabled: boolean): void {
    this.performanceMonitoring = enabled;
    this.performanceMonitor.reset();
  }

  setGraphicsQuality(mode: GraphicsQualityMode): void {
    this.graphicsQualityMode = mode;
    // Re-selecting the current tier clears stale adaptive samples. Fixed
    // presets are applied inside the render loop so resizing the drawing
    // buffer and repainting always happen in the same animation frame.
    const level = mode === 'auto' ? this.adaptiveQuality.settings.level : mode;
    const settings = this.adaptiveQuality.setLevel(level);
    if (mode !== 'auto') this.pendingRenderQuality = settings;
  }

  /** Switches the time of day and weather; repaints immediately, even on menus. */
  setConditions(conditions: DrivingConditions): void {
    const current = this.look?.conditions;
    if (current?.timeOfDay === conditions.timeOfDay && current.weather === conditions.weather) {
      return;
    }
    const look = createEnvironmentLook(conditions);
    this.look = look;
    setAtmosphericScattering(look.lightDirection, look.scatterColor);
    setKeyLightGlint(look.keyLightGlint);
    this.fog.color.copy(look.fogColor);
    this.fog.density = look.fogDensity;
    (this.scene.background as THREE.Color).copy(look.fogColor);
    this.sky.setLook(look);
    this.scene.environment = this.sky.createEnvironment(this.renderer);
    this.scene.environmentIntensity = look.environmentIntensity;
    this.renderer.toneMappingExposure = look.exposure;
    applySceneLighting(this.lighting, look);
    for (const driver of this.drivers) driver.view.setLook(look);
    this.vehicleAssets.setRunningLights(look.vehicleLights);
    const cars = [
      ...this.drivers.map((driver) => driver.mesh),
      ...this.traffic.map((traffic) => traffic.mesh),
    ];
    for (const car of cars) {
      this.vehicleAssets.setBrakeLights(car, this.vehicleAssets.isBraking(car));
    }
    this.applyWetness(look.wetness);
    this.lastIdleRender = 0;
  }

  /**
   * Turns a driver's adaptive cruise on (it drives toward the set speed, even
   * from a standstill) or off. Only while driving forward.
   */
  toggleCruise(playerIndex = 0): void {
    const driver = this.drivers[playerIndex];
    if (this.phase !== 'playing' || !driver || driver.crashed) return;
    if (driver.cruiseOn) {
      driver.cruiseOn = false;
      driver.cruiseStatus = 'off';
      this.showNotice(driver, 'CRUISE OFF');
    } else if (driver.speed < -0.3) {
      this.showNotice(driver, 'STOP BEFORE CRUISE');
    } else {
      driver.cruiseOn = true;
      driver.cruiseStatus = 'cruising';
    }
  }

  /** Raises (+1) or lowers (−1) a driver's cruise set speed in 5 km/h steps, on or off. */
  adjustCruise(direction: 1 | -1, playerIndex = 0): void {
    const driver = this.drivers[playerIndex];
    if (driver) driver.cruiseSetKph = adjustCruise(driver.cruiseSetKph, direction);
  }

  whenReady(): Promise<void> {
    return this.sceneAssetsReady;
  }

  /**
   * Chooses the cars. Passing `secondDriverCar` makes it a split-screen game
   * for two players; the player count is fixed once the cars are applied.
   */
  async setCars(
    driverCar: CarModelId = DEFAULT_CAR_MODEL_ID,
    trafficCount: number = GAME.trafficCount,
    modelCount = 1,
    secondDriverCar?: CarModelId,
  ): Promise<void> {
    if (!this.carModelsApplied) {
      this.drivers[0].carModel = driverCar;
      if (secondDriverCar && this.drivers.length === 1) {
        this.addDriver(secondDriverCar);
        this.resize();
      }
    }
    this.setTrafficCount(trafficCount);
    if (this.drivers.length > 1 && !this.carModelsApplied) this.reset();
    await this.loadCarModels(this.traffic.length === 0 ? 1 : modelCount);
  }

  dispose(): void {
    cancelAnimationFrame(this.animationFrame);
    window.removeEventListener('resize', this.resize);
    for (const driver of this.drivers) {
      driver.view.dispose();
      driver.postProcessing?.dispose();
    }
    this.mountainRange.dispose();
    this.sky.dispose();
    this.sceneryAssets.dispose();
    this.groundGeometry.dispose();
    this.textureStore.dispose();
    this.renderer.dispose();
  }

  private addDriver(carModel: CarModelId): Driver {
    const index = this.drivers.length;
    const view = new WorldView({
      road: this.roadMaterial,
      shoulder: this.shoulderMaterial,
      ground: this.groundMaterial,
      groundGeometry: this.groundGeometry,
    });
    this.scene.add(view.root);
    if (this.look) view.setLook(this.look);
    if (this.pineTree) view.setTreeModel(this.pineTree);
    view.forest.setDense(this.denseForest);
    const driver: Driver = {
      index,
      mesh: new THREE.Group(),
      carModel,
      camera: new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 2400),
      view,
      viewport: { x: 0, y: 0, width: 1, height: 1 },
      distance: 0,
      speed: 0,
      lateral: 0,
      worldX: 0,
      vehicleHeading: 0,
      travelHeading: 0,
      rearWheelsLocked: false,
      skid: 0,
      steeringVisual: 0,
      longitudinalAcceleration: 0,
      reverseHoldSeconds: 0,
      facing: 1,
      viewAlong: 1,
      odometer: 0,
      cruiseOn: false,
      cruiseSetKph: CRUISE_DEFAULT_KPH,
      cruiseStatus: 'off',
      notice: { message: '', seconds: 0 },
      overtakes: 0,
      assistMessage: 'READY',
      crashed: false,
      laps: createLapState(),
      holdSeconds: 0,
      ghostSeconds: 0,
      nitroSeconds: 0,
      boosting: false,
      nitroFx: 0,
      nitroKick: 0,
      collectedNitro: new Set(),
      nitroMeshes: Array.from({ length: NITRO_MESHES_PER_DRIVER }, () => this.createNitroMesh()),
      forward: new THREE.Vector3(),
      desiredCamera: new THREE.Vector3(),
      cameraTarget: new THREE.Vector3(),
      viewDirection: new THREE.Vector3(),
      lastPosition: new THREE.Vector3(),
      hasLastPosition: false,
      snapCamera: true,
    };
    this.resetDriver(driver);
    this.scene.add(driver.mesh, ...driver.nitroMeshes);
    this.drivers.push(driver);
    for (const car of this.traffic) car.counted.push(false);
    return driver;
  }

  private resetDriver(driver: Driver): void {
    const lateral = laneOffsets[DRIVER_START_LANES[driver.index] ?? 0];
    driver.distance = 0;
    driver.speed = 0;
    driver.lateral = lateral;
    driver.worldX = roadCenter(0) + Math.cos(roadHeading(0)) * lateral;
    driver.vehicleHeading = roadHeading(0);
    driver.travelHeading = driver.vehicleHeading;
    driver.rearWheelsLocked = false;
    driver.skid = 0;
    driver.overtakes = 0;
    driver.assistMessage = 'READY';
    driver.reverseHoldSeconds = 0;
    driver.facing = 1;
    driver.viewAlong = 1;
    driver.odometer = 0;
    driver.cruiseOn = false;
    driver.cruiseStatus = 'off';
    driver.notice.seconds = 0;
    driver.crashed = false;
    driver.laps = createLapState();
    driver.holdSeconds = 0;
    driver.ghostSeconds = 0;
    driver.nitroSeconds = 0;
    driver.boosting = false;
    driver.nitroFx = 0;
    driver.nitroKick = 0;
    driver.collectedNitro.clear();
    driver.snapCamera = true;
    driver.longitudinalAcceleration = 0;
    this.vehicleAssets.setBrakeLights(driver.mesh, false);
    driver.view.reset();
  }

  private setupTraffic(): void {
    let ongoingSpawnCursor = 45;
    let incomingSpawnCursor = 62;
    for (let index = 0; index < GAME.trafficCount; index += 1) {
      const direction: 1 | -1 = index === 0 ? 1 : index === 1 ? -1 : Math.random() < 0.56 ? 1 : -1;
      const car = this.createTrafficCar(direction, index % this.drivers.length, false);
      if (direction === 1) {
        ongoingSpawnCursor += 34 + Math.random() * 48;
        this.spawnTraffic(car, ongoingSpawnCursor);
      } else {
        incomingSpawnCursor += 38 + Math.random() * 58;
        this.spawnTraffic(car, incomingSpawnCursor);
      }
      this.traffic.push(car);
      this.scene.add(car.mesh);
    }
  }

  private createTrafficCar(direction: 1 | -1, owner: number, rush: boolean): TrafficCar {
    return {
      mesh: new THREE.Group(),
      distance: 0,
      lane: 0,
      laneOffset: 0,
      speed: 0,
      targetSpeed: 0,
      speedChangeTimer: 0,
      direction,
      owner,
      counted: this.drivers.map(() => false),
      length: GAME.collisionLength,
      width: GAME.collisionWidth,
      restOffset: 0,
      laneChangeTimer: 0,
      rush,
    };
  }

  /** Counts down to the next wave, warns of it, and starts and ends it. */
  private updateRushHour(dt: number): void {
    if (!this.rushHourEnabled || this.rushReserve.length + this.rushCarsOnRoad() === 0) return;
    this.rushClock -= dt;
    if (!this.rushActive) {
      if (!this.rushWarned && this.rushClock <= RUSH_WARNING_SECONDS) {
        this.rushWarned = true;
        for (const driver of this.drivers) this.showNotice(driver, 'RUSH HOUR AHEAD!', 3);
      }
      if (this.rushClock <= 0) this.startRushHour();
    } else if (this.rushClock <= 0) {
      this.endRushHour(false);
      for (const driver of this.drivers) this.showNotice(driver, 'TRAFFIC CLEARING', 2.5);
    }
  }

  private rushCarsOnRoad(): number {
    return this.traffic.filter((car) => car.rush).length;
  }

  /** Brings the wave cars on just past the drawn road, mostly going the drivers' way. */
  private startRushHour(): void {
    this.rushActive = true;
    this.rushClock = RUSH_DURATION_SECONDS;
    const live = this.drivers.filter((driver) => !driver.crashed);
    if (live.length === 0) return;
    this.rushReserve.splice(0).forEach((car, index) => {
      const owner = live[index % live.length];
      car.owner = owner.index;
      car.direction = index % 4 === 3 ? (-owner.facing as 1 | -1) : owner.facing;
      let ahead = RUSH_SPAWN_AHEAD + Math.floor(index / live.length) * 55 + Math.random() * 30;
      this.spawnTraffic(car, ahead);
      // Take whichever of its two lanes is free there, moving further out if both are taken.
      const firstLane = car.direction === 1 ? 0 : 2;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const lane = [firstLane, firstLane + 1].find((candidate) =>
          this.laneClear(car, candidate, car.distance),
        );
        if (lane !== undefined) {
          car.lane = lane;
          break;
        }
        ahead += 40;
        car.distance = owner.distance + owner.facing * ahead;
      }
      // Rush-hour traffic crawls along, so it bunches up and blocks lanes.
      car.speed = car.targetSpeed = this.rushSpeed(car);
      this.traffic.push(car);
      this.scene.add(car.mesh);
    });
  }

  /**
   * Ends the wave. Its cars leave the road once they fall behind the drivers,
   * or straight away when `immediately` (a reset, or rush hour turned off).
   */
  private endRushHour(immediately: boolean): void {
    this.rushActive = false;
    this.rushWarned = false;
    this.rushClock =
      RUSH_INTERVAL_SECONDS[0] + Math.random() * (RUSH_INTERVAL_SECONDS[1] - RUSH_INTERVAL_SECONDS[0]);
    if (!immediately) return;
    for (const car of this.traffic.filter((other) => other.rush)) this.retireRushCar(car);
  }

  private retireRushCar(car: TrafficCar): void {
    const index = this.traffic.indexOf(car);
    if (index >= 0) this.traffic.splice(index, 1);
    this.scene.remove(car.mesh);
    this.rushReserve.push(car);
  }

  /** Wave cars crawl at 45–75 km/h with the drivers, 60–90 km/h oncoming. */
  private rushSpeed(car: TrafficCar): number {
    return car.direction === this.ownerOf(car).facing
      ? fromKph(45 + Math.random() * 30)
      : fromKph(60 + Math.random() * 30);
  }

  /** No other traffic within reach of `distance` in `lane`. */
  private laneClear(car: TrafficCar, lane: number, distance: number): boolean {
    return this.traffic.every(
      (other) =>
        other === car ||
        other.lane !== lane ||
        Math.abs(other.distance - distance) > LANE_CHANGE_CLEARANCE,
    );
  }

  /**
   * During rush hour traffic switches to the other lane on its side of the
   * road now and then, when that lane is clear and no driver is right there.
   * The car keeps its position and eases across over a couple of seconds.
   */
  private maybeChangeLane(car: TrafficCar, dt: number): void {
    car.laneOffset = damp(car.laneOffset, car.restOffset, 1.1, dt);
    car.laneChangeTimer -= dt;
    if (!this.rushActive || car.laneChangeTimer > 0) return;
    car.laneChangeTimer = 4 + Math.random() * 6;
    if (Math.abs(car.laneOffset - car.restOffset) > 0.5) return;
    const target = car.lane < 2 ? 1 - car.lane : 5 - car.lane;
    if (!this.laneClear(car, target, car.distance)) return;
    const driverNear = this.drivers.some(
      (driver) =>
        !driver.crashed &&
        Math.abs(driver.distance - car.distance) < LANE_CHANGE_DRIVER_CLEARANCE + car.length,
    );
    if (driverNear) return;
    car.laneOffset += laneOffsets[car.lane] - laneOffsets[target];
    car.lane = target;
  }

  private setTrafficCount(requestedCount: number): void {
    const trafficCount = Math.round(clamp(requestedCount, 0, GAME.trafficCount));
    while (this.traffic.length > trafficCount) {
      const removed = this.traffic.pop();
      if (removed) this.scene.remove(removed.mesh);
    }
  }

  private async loadCarModels(modelCount: number): Promise<void> {
    if (this.carModelsApplied) return;
    const [first, ...others] = this.drivers.map((driver) => driver.carModel);
    const trafficIds = selectCarModelIds(first, modelCount);
    this.carModelsPromise ??= this.vehicleAssets.loadCarModels(first, modelCount, others);
    const available = await this.carModelsPromise;
    const expectedModelCount = new Set([...trafficIds, ...others]).size;
    if (available.length !== expectedModelCount) {
      throw new Error('One or more selected car models could not be loaded.');
    }

    for (const driver of this.drivers) {
      const model = available.find(({ id }) => id === driver.carModel);
      if (!model?.playerPrototype) {
        throw new Error('The selected driver car could not be loaded.');
      }
      this.vehicleAssets.replaceVisual(
        driver.mesh,
        model.playerPrototype,
        true,
        model.id,
        driver.index === 1 ? SECOND_DRIVER_COLOR : undefined,
      );
    }

    const trafficModels = available.filter(({ id }) => trafficIds.includes(id));
    const trafficStart = Math.floor(Math.random() * trafficModels.length);
    this.traffic.forEach((car, index) => {
      const model = trafficModels[(trafficStart + index) % trafficModels.length];
      this.vehicleAssets.replaceVisual(car.mesh, model.trafficPrototype, false, model.id);
      const size = this.vehicleAssets.collisionSize(model.id);
      car.length = size.length;
      car.width = size.width;
    });
    // The rush-hour wave cars, kept off the road until a wave starts.
    if (this.traffic.length > 0) {
      for (let index = 0; index < RUSH_EXTRA_CARS; index += 1) {
        const car = this.createTrafficCar(1, 0, true);
        const model = trafficModels[(trafficStart + index + 3) % trafficModels.length];
        this.vehicleAssets.replaceVisual(car.mesh, model.trafficPrototype, false, model.id);
        const size = this.vehicleAssets.collisionSize(model.id);
        car.length = size.length;
        car.width = size.width;
        this.rushReserve.push(car);
      }
    }
    this.carModelsApplied = true;
  }

  private ownerOf(car: TrafficCar): Driver {
    return this.drivers[car.owner] ?? this.drivers[0];
  }

  /**
   * Places a car `ahead` units in front of its owner along the way that driver
   * faces (or behind the furthest car going the same way). Slightly more cars
   * travel with the driver, and they drive a little slower so they can be overtaken.
   */
  private spawnTraffic(car: TrafficCar, ahead?: number, randomizeDirection = false): void {
    const owner = this.ownerOf(car);
    const facing = owner.facing;
    if (randomizeDirection) car.direction = Math.random() < 0.56 ? facing : (-facing as 1 | -1);
    const furthest = this.traffic
      .filter(
        (other) => other !== car && other.owner === car.owner && other.direction === car.direction,
      )
      .reduce(
        (max, other) => Math.max(max, (other.distance - owner.distance) * facing),
        TRAFFIC_SPAWN_AHEAD,
      );
    car.distance = owner.distance + facing * (ahead ?? furthest + 48 + Math.random() * 95);
    // Traffic keeps left: lanes 0-1 run toward increasing distance, 2-3 the other way.
    car.lane = (car.direction === 1 ? 0 : 2) + (Math.random() < 0.5 ? 0 : 1);
    car.laneOffset = (Math.random() * 2 - 1) * GAME.trafficLaneJitter;
    car.restOffset = car.laneOffset;
    car.laneChangeTimer = 2 + Math.random() * 6;
    // Highway speeds: 80–120 km/h with the driver, 90–130 km/h oncoming.
    car.speed =
      car.direction === facing
        ? fromKph(80 + Math.random() * 40)
        : fromKph(90 + Math.random() * 40);
    car.targetSpeed = car.speed;
    car.speedChangeTimer = 2.5 + Math.random() * 6;
    // A car that appears behind another driver can no longer be overtaken by them.
    car.counted = this.drivers.map(
      (driver) => driver !== owner && (car.distance - driver.distance) * driver.facing < 0,
    );
    this.vehicleAssets.setBrakeLights(car.mesh, false);
  }

  private updateSimulation(dt: number): void {
    if (this.countdown > 0) {
      // Everything waits on the grid until the lights go green.
      this.countdown -= dt;
      return;
    }
    if (this.countdown > -1) this.countdown -= dt;
    this.raceTime += dt;
    for (const driver of this.drivers) {
      if (driver.crashed) continue;
      driver.ghostSeconds = Math.max(0, driver.ghostSeconds - dt);
      if (driver.holdSeconds > 0) {
        driver.holdSeconds -= dt;
        driver.speed = 0;
        driver.assistMessage = `CRASHED · RESPAWN ${Math.ceil(Math.max(driver.holdSeconds, 0.01))}`;
        continue;
      }
      this.stepDriver(driver, dt);
      this.collectNitro(driver);
      this.updateRace(driver);
    }
    if (this.finishGrace !== null) {
      this.finishGrace -= dt;
      for (const driver of this.drivers) {
        if (driver.laps.finishTime === null && driver.notice.seconds <= 0) {
          driver.assistMessage = `FINISH IN ${Math.ceil(Math.max(this.finishGrace, 0))}`;
        }
      }
      if (this.finishGrace <= 0) {
        this.endRace();
        return;
      }
    }
    // endRace() may have run while drivers stepped.
    if (this.getPhase() !== 'playing') return;

    this.updateRushHour(dt);
    // Everyone on the road, for traffic to see what is ahead of it; drivers are last.
    const roadUsers: RoadUser[] = this.traffic.map((car) => ({
      distance: car.distance,
      lateral: laneOffsets[car.lane] + car.laneOffset,
      length: car.length,
      width: car.width,
      velocity: car.speed * car.direction,
    }));
    for (const driver of this.drivers) {
      const size = this.vehicleAssets.collisionSize(driver.carModel);
      roadUsers.push({
        distance: driver.distance,
        lateral: driver.lateral,
        length: size.length,
        width: size.width,
        velocity: driver.speed * Math.cos(driver.travelHeading - roadHeading(driver.distance)),
      });
    }
    let trafficIndex = 0;
    const retired: TrafficCar[] = [];
    for (const car of this.traffic) {
      const owner = this.ownerOf(car);
      car.speedChangeTimer -= dt;
      if (car.speedChangeTimer <= 0) {
        car.targetSpeed = car.rush
          ? this.rushSpeed(car)
          : car.direction === owner.facing
            ? fromKph(75 + Math.random() * 50)
            : fromKph(85 + Math.random() * 45);
        car.speedChangeTimer = 2.5 + Math.random() * 7;
      }
      // Traffic brakes for whatever is ahead in its lane, the drivers included,
      // and stops behind it rather than driving into it.
      const self = roadUsers[trafficIndex];
      const lead = findTrafficLead(self, car.direction, roadUsers);
      const acceleration = trafficAcceleration(car.speed, car.targetSpeed, lead);
      this.vehicleAssets.setBrakeLights(car.mesh, acceleration < -TRAFFIC_BRAKE_LIGHT_DECELERATION);
      car.speed = Math.max(0, car.speed + acceleration * dt);
      car.distance += car.speed * car.direction * dt;
      this.maybeChangeLane(car, dt);
      self.distance = car.distance;
      self.lateral = laneOffsets[car.lane] + car.laneOffset;
      self.velocity = car.speed * car.direction;
      trafficIndex += 1;

      for (const driver of this.drivers) {
        if (driver.crashed || driver.holdSeconds > 0) continue;
        const size = this.vehicleAssets.collisionSize(driver.carModel);
        const gap = car.distance - driver.distance;
        // How far ahead the car is along the way the driver faces.
        const aheadGap = gap * driver.facing;
        const laneGap = Math.abs(laneOffsets[car.lane] + car.laneOffset - driver.lateral);
        if (
          car.direction === driver.facing &&
          !car.counted[driver.index] &&
          aheadGap < -size.length
        ) {
          car.counted[driver.index] = true;
          driver.overtakes += 1;
        }
        if (Math.abs(gap) < size.length && laneGap < size.width && !this.passesThrough(driver)) {
          this.crashDriver(driver);
        }
      }
      if (this.phase === 'crashed') return;

      const ownerGap = (car.distance - this.ownerOf(car).distance) * this.ownerOf(car).facing;
      if (ownerGap < (car.direction === this.ownerOf(car).facing ? -70 : -45)) {
        if (car.rush && !this.rushActive) {
          retired.push(car);
          continue;
        }
        this.spawnTraffic(car, undefined, true);
        if (car.rush) car.speed = car.targetSpeed = this.rushSpeed(car);
        Object.assign(self, {
          distance: car.distance,
          lateral: laneOffsets[car.lane] + car.laneOffset,
          velocity: car.speed * car.direction,
        });
      }
    }
    // A finished wave's cars leave once they are behind; the list is only changed after the loop.
    for (const car of retired) this.retireRushCar(car);
    this.collideDrivers();
  }

  /** Drives one car for a frame: speed, steering, the road edges and its facing. */
  private stepDriver(driver: Driver, dt: number): void {
    const control =
      driver.laps.finishTime !== null ? FINISHED_CONTROL : this.getControl(driver.index);
    const { length: collisionLength } = this.vehicleAssets.collisionSize(driver.carModel);

    driver.reverseHoldSeconds = updateReverseHold(
      driver.reverseHoldSeconds,
      control,
      driver.speed,
      dt,
    );
    if (driver.cruiseOn && !cruiseStaysEngaged(control)) driver.cruiseOn = false;
    const lead = driver.cruiseOn
      ? findLeadVehicle(
          driver.distance,
          driver.lateral,
          driver.facing,
          collisionLength,
          this.cruiseLeadCandidates(driver),
        )
      : null;
    const speedPlan = createSpeedPlan(control, driver.speed, {
      reverseHoldSeconds: driver.reverseHoldSeconds,
      cruiseKph: driver.cruiseOn ? driver.cruiseSetKph : null,
      lead,
    });
    // A keyboard driver overtaking on the accelerator keeps cruise armed.
    driver.cruiseStatus = driver.cruiseOn ? (speedPlan.cruiseStatus ?? 'cruising') : 'off';
    let { targetSpeed, acceleration } = speedPlan;
    const { autoBraking } = speedPlan;
    driver.assistMessage = speedPlan.assistMessage;
    // Nitro pushes the car past its usual top speed, unless the driver (or
    // cruise, behind a car) is braking or the hands have let go.
    driver.nitroSeconds = Math.max(0, driver.nitroSeconds - dt);
    const boosting = (driver.boosting =
      driver.nitroSeconds > 0 &&
      control.active &&
      !speedPlan.braking &&
      !autoBraking &&
      targetSpeed > 0 &&
      driver.speed >= 0 &&
      driver.cruiseStatus !== 'following' &&
      driver.cruiseStatus !== 'braking');
    if (boosting) {
      targetSpeed = NITRO_MAX_SPEED;
      acceleration = NITRO_ACCELERATION;
      driver.assistMessage = `NITRO! ${driver.nitroSeconds.toFixed(1)}s`;
    }
    if (driver.notice.seconds > 0) {
      driver.notice.seconds -= dt;
      driver.assistMessage = driver.notice.message;
    }
    const previousSpeed = driver.speed;
    this.vehicleAssets.setBrakeLights(driver.mesh, autoBraking || speedPlan.braking);
    // Speed is signed: negative while reversing.
    driver.speed = damp(
      driver.speed,
      targetSpeed,
      acceleration / Math.max(8, Math.abs(targetSpeed - driver.speed)),
      dt,
    );
    if (targetSpeed === 0 && Math.abs(driver.speed) < 0.3) driver.speed = 0;
    driver.longitudinalAcceleration = damp(
      driver.longitudinalAcceleration,
      (driver.speed - previousSpeed) / Math.max(dt, 1e-3),
      5,
      dt,
    );

    driver.steeringVisual = damp(driver.steeringVisual, control.steering, 10, dt);
    const reversing = driver.speed < 0;
    // The handbrake locks the rear wheels: steering swings the nose round past
    // the grip limit and the car slides, travelling where it was heading.
    driver.rearWheelsLocked = control.active && control.handbrake === true;
    const sliding = driver.rearWheelsLocked && Math.abs(driver.speed) > HANDBRAKE_SLIDE_MIN_SPEED;
    const yawBoost = sliding ? HANDBRAKE_YAW_BOOST : 1;
    driver.vehicleHeading -= steeringYawRate(driver.steeringVisual, driver.speed) * yawBoost * dt;
    driver.travelHeading = followTravelHeading(
      driver.travelHeading,
      driver.vehicleHeading,
      sliding,
      dt,
    );
    const slideAngle = Math.abs(
      Math.atan2(
        Math.sin(driver.vehicleHeading - driver.travelHeading),
        Math.cos(driver.vehicleHeading - driver.travelHeading),
      ),
    );
    // Locked tyres scrub as long as the car moves; sliding sideways screeches hardest.
    const skidTarget = sliding
      ? clamp(toKph(Math.abs(driver.speed)) / 45, 0, 1) *
        (0.55 + 0.45 * clamp(slideAngle / 0.35, 0, 1))
      : 0;
    driver.skid = damp(driver.skid, skidTarget, 12, dt);
    // Plain planar motion: the car can turn around and drive back down the road.
    driver.worldX += -Math.sin(driver.travelHeading) * driver.speed * dt;
    driver.distance += Math.cos(driver.travelHeading) * driver.speed * dt;
    if (driver.speed > 0) driver.odometer += driver.speed * dt;

    const currentRoadHeading = roadHeading(driver.distance);
    const currentRoadCenter = roadCenter(driver.distance);
    const roadConstraint = constrainToRoad(
      driver.worldX,
      currentRoadCenter,
      currentRoadHeading,
      GAME.roadWidth,
      GAME.roadEdgeMargin,
    );
    driver.worldX = roadConstraint.worldX;
    driver.lateral = roadConstraint.lateral;
    const boundaryLimit = GAME.roadWidth / 2 - GAME.roadEdgeMargin;
    const edgeProximity = clamp((Math.abs(driver.lateral) - (boundaryLimit - 1.6)) / 1.6, 0, 1);
    if (edgeProximity > 0) {
      const relativeHeading = Math.atan2(
        Math.sin(driver.vehicleHeading - currentRoadHeading),
        Math.cos(driver.vehicleHeading - currentRoadHeading),
      );
      // Sideways drift across the road; positive moves toward positive lateral.
      const drift = -Math.sin(relativeHeading) * driver.speed;
      if (drift * driver.lateral > 0) {
        // Straighten toward whichever way along the road the nose is nearer,
        // so a U-turn that reaches the verge completes instead of unwinding.
        const along =
          Math.abs(relativeHeading) > Math.PI / 2 ? Math.sign(relativeHeading) * Math.PI : 0;
        const softenedHeading = damp(relativeHeading, along, 2.5 + edgeProximity * 5.5, dt);
        driver.vehicleHeading = currentRoadHeading + softenedHeading;
        // The verge ends any slide.
        driver.travelHeading = driver.vehicleHeading;
        const scrub = (2 + edgeProximity * 5) * dt;
        driver.speed = reversing
          ? Math.min(0, driver.speed + scrub)
          : Math.max(0, driver.speed - scrub);
      }
      driver.assistMessage = 'ROAD EDGE';
      if (edgeProximity > 0.55) this.vehicleAssets.setBrakeLights(driver.mesh, true);
    }

    this.updateFacing(driver, currentRoadHeading);
  }

  /** Adaptive cruise follows traffic and the other drivers alike. */
  private cruiseLeadCandidates(driver: Driver): readonly RadarTarget[] {
    if (this.drivers.length === 1) return this.traffic;
    const others = this.drivers
      .filter((other) => other !== driver)
      .map((other): RadarTarget => {
        // Velocity along the road, so a reversing car reads as moving backward.
        const velocity = other.speed * Math.cos(other.travelHeading - roadHeading(other.distance));
        return {
          distance: other.distance,
          lane: 0,
          laneOffset: other.lateral - laneOffsets[0],
          speed: Math.abs(velocity),
          direction: velocity >= 0 ? 1 : -1,
        };
      });
    return [...this.traffic, ...others];
  }

  /** Two drivers who touch both end their runs. */
  private collideDrivers(): void {
    if (this.drivers.length < 2 || this.phase === 'crashed') return;
    const [a, b] = this.drivers;
    if (a.crashed && b.crashed) return;
    if (this.passesThrough(a) || this.passesThrough(b)) return;
    const sizeA = this.vehicleAssets.collisionSize(a.carModel);
    const sizeB = this.vehicleAssets.collisionSize(b.carModel);
    const gap = Math.abs(a.distance - b.distance);
    const laneGap = Math.abs(a.lateral - b.lateral);
    if (gap < (sizeA.length + sizeB.length) / 2 && laneGap < (sizeA.width + sizeB.width) / 2) {
      if (!a.crashed) this.crashDriver(a);
      if (!b.crashed) this.crashDriver(b);
    }
  }

  /**
   * Ends one driver's run. The wrecked car stays on the road for traffic to
   * stop behind; the run ends once every driver has crashed.
   */
  private crashDriver(driver: Driver): void {
    if (this.lapLength !== null) {
      this.respawnDriver(driver);
      return;
    }
    driver.crashed = true;
    driver.speed = 0;
    driver.skid = 0;
    driver.cruiseOn = false;
    driver.cruiseStatus = 'off';
    this.vehicleAssets.setBrakeLights(driver.mesh, true);
    driver.assistMessage = 'COLLISION';
    const survivor = this.drivers.find((other) => !other.crashed);
    if (survivor) {
      // The wreck's traffic now queues around whoever is still driving.
      for (const car of this.traffic) {
        if (car.owner === driver.index) car.owner = survivor.index;
      }
      return;
    }
    this.phase = 'crashed';
    this.onCrash();
  }

  /**
   * Flips which way traffic treats as ahead once the car has clearly turned
   * around. Cars already behind in the new direction cannot count as overtakes.
   */
  private updateFacing(driver: Driver, currentRoadHeading: number): void {
    const along = Math.cos(driver.vehicleHeading - currentRoadHeading);
    const flipped =
      (driver.facing === 1 && along < -FACING_HYSTERESIS) ||
      (driver.facing === -1 && along > FACING_HYSTERESIS);
    if (!flipped) return;
    driver.facing = driver.facing === 1 ? -1 : 1;
    for (const car of this.traffic) {
      car.counted[driver.index] = (car.distance - driver.distance) * driver.facing < 0;
    }
  }

  private updateWorld(dt: number): void {
    for (const driver of this.drivers) this.updateDriverView(driver, dt);

    // Traffic is placed once for every view; each view then shows what it can see.
    for (const car of this.traffic) {
      let nearest = Number.POSITIVE_INFINITY;
      let inAnyView = false;
      for (const driver of this.drivers) {
        const gap = car.distance - driver.distance;
        nearest = Math.min(nearest, Math.abs(gap));
        if (this.inView(driver, car)) inAnyView = true;
      }
      if (!inAnyView) continue;
      const carHeading = roadHeading(car.distance);
      const offset = laneOffsets[car.lane] + car.laneOffset;
      car.mesh.position.set(
        roadCenter(car.distance) + Math.cos(carHeading) * offset,
        0.02,
        -car.distance - Math.sin(carHeading) * offset,
      );
      car.mesh.rotation.y = carHeading + (car.direction === -1 ? Math.PI : 0);
      if (nearest < 70) {
        this.vehicleAssets.updateWheelAnimation(car.mesh, car.speed * dt, 0, dt);
      }
    }
  }

  private inView(driver: Driver, car: TrafficCar): boolean {
    const aheadGap = (car.distance - driver.distance) * driver.facing;
    return aheadGap > -90 && aheadGap < GAME.lookAhead + 80;
  }

  /** Poses one driver's car and chase camera, and recycles their scenery. */
  private updateDriverView(driver: Driver, dt: number): void {
    // Scenery follows the way the camera looks, so a U-turn finds road ahead.
    const { camera } = driver;
    camera.getWorldDirection(driver.viewDirection);
    const viewHeading = roadHeading(driver.distance);
    const viewLength = Math.hypot(driver.viewDirection.x, driver.viewDirection.z);
    if (viewLength > 1e-3) {
      driver.viewAlong =
        (-Math.sin(viewHeading) * driver.viewDirection.x -
          Math.cos(viewHeading) * driver.viewDirection.z) /
        viewLength;
    }
    driver.view.update(driver.distance, driver.viewAlong, dt);

    const { mesh } = driver;
    mesh.position.set(driver.worldX, 0.02, -driver.distance);
    mesh.rotation.y = driver.vehicleHeading;
    // Body roll leans away from the turn and pitch follows braking/acceleration;
    // both act on the sprung body only so the tyres stay on the road.
    const lateralLoad =
      driver.steeringVisual * clamp(Math.abs(driver.speed) / 30, 0, 1) * Math.sign(driver.speed);
    this.vehicleAssets.updateSuspension(
      mesh,
      lateralLoad * 0.04,
      driver.longitudinalAcceleration * 0.0024,
      dt,
    );
    this.vehicleAssets.updateWheelAnimation(
      mesh,
      driver.speed * dt,
      driver.steeringVisual,
      dt,
      driver.rearWheelsLocked,
    );

    // The camera follows the direction of travel, so a handbrake slide shows
    // the car turned across its path rather than the road swinging round.
    driver.forward.set(-Math.sin(driver.travelHeading), 0, -Math.cos(driver.travelHeading));
    // Carry the camera with the car so it never trails further behind at
    // speed; the lerp below only smooths turns and the speed pull-back.
    if (driver.hasLastPosition) {
      const moved = mesh.position.distanceTo(driver.lastPosition);
      if (moved < 40) {
        camera.position.add(driver.lastPosition.sub(mesh.position).negate());
      }
    }
    driver.lastPosition.copy(mesh.position);
    driver.hasLastPosition = true;
    const speedFraction = clamp(Math.abs(driver.speed) / GAME.maxSpeed, 0, 1);
    // Nitro: the effect slams in and fades out slowly; the grab itself is a sharp jolt.
    const nitroLive = driver.boosting && !driver.crashed && this.phase === 'playing';
    driver.nitroFx = damp(driver.nitroFx, nitroLive ? 1 : 0, nitroLive ? 9 : 1.6, dt);
    driver.nitroKick *= Math.exp(-3.2 * dt);
    const { nitroFx: fx, nitroKick: kick } = driver;
    // The car surges away from the camera, which drops low and trails behind.
    driver.desiredCamera
      .copy(mesh.position)
      .addScaledVector(
        driver.forward,
        -(CAMERA_DISTANCE + CAMERA_SPEED_PULLBACK * speedFraction + 3.5 * fx + 5 * kick),
      );
    driver.desiredCamera.y += 4.3 - 0.9 * fx;
    if (driver.snapCamera) {
      camera.position.copy(driver.desiredCamera);
      driver.snapCamera = false;
    } else {
      camera.position.lerp(driver.desiredCamera, 1 - Math.exp(-5 * dt));
    }
    driver.cameraTarget.copy(mesh.position).addScaledVector(driver.forward, 12);
    // A faint high-frequency judder from the road surface grows with speed.
    const time = performance.now() * 0.001;
    const judder = Math.sin(time * 37) * 0.6 + Math.sin(time * 23.7 + 1.3) * 0.4;
    driver.cameraTarget.y += 1 + judder * CAMERA_SHAKE * speedFraction * speedFraction;
    // Under nitro the whole view rattles hard, sideways and up and down.
    const rattle = 0.32 * fx + 0.6 * kick;
    if (rattle > 0.001) {
      const side = Math.sin(time * 53) * 0.6 + Math.sin(time * 31.3 + 0.7) * 0.4;
      const lift = Math.sin(time * 61.7 + 2.1) * 0.6 + Math.sin(time * 27.1) * 0.4;
      driver.cameraTarget.x += side * rattle;
      driver.cameraTarget.y += lift * rattle;
    }
    camera.lookAt(driver.cameraTarget);
    if (rattle > 0.001) camera.rotateZ(Math.sin(time * 41.3 + 0.4) * 0.012 * (fx + kick));
    driver.postProcessing?.setSpeedBlur(0.2 * fx + 0.14 * kick);
    // Widen the lens with speed for a stronger sense of velocity.
    const baseFov = this.drivers.length > 1 ? SPLIT_BASE_FOV : BASE_FOV;
    const fov =
      baseFov +
      SPEED_FOV_BOOST * clamp(driver.speed / GAME.maxSpeed, 0, 1) ** 1.5 +
      NITRO_FOV_BOOST * fx +
      NITRO_FOV_KICK * kick;
    if (Math.abs(camera.fov - fov) > 0.01) {
      // The lens snaps wide when the nitro fires, then eases back.
      camera.fov = damp(camera.fov, fov, fx > 0.05 || kick > 0.05 ? 10 : 3, dt);
      camera.updateProjectionMatrix();
    }
  }

  /**
   * Readies the shared scene to be drawn from one driver's camera: only their
   * world view shows, and the sky, sun shadow, rain and lamps follow them.
   */
  private prepareView(driver: Driver, rainSeconds: number): void {
    for (const other of this.drivers) {
      other.view.root.visible = other === driver;
      if (other !== driver) for (const mesh of other.nitroMeshes) mesh.visible = false;
    }
    this.placeNitro(driver);
    for (const car of this.traffic) {
      const visible = this.inView(driver, car);
      car.mesh.visible = visible;
      if (!visible) continue;
      const detailDistance = Math.abs(car.distance - driver.distance);
      this.vehicleAssets.setDetail(car.mesh, detailDistance);
      this.vehicleAssets.setShadowCasting(car.mesh, detailDistance < 65);
    }
    this.shadowCenter.copy(driver.mesh.position).addScaledVector(driver.forward, 32);
    updateSceneShadow(this.lighting, this.shadowCenter);
    this.sky.update(driver.camera, performance.now() * 0.001);
    this.mountainRange.update(driver.camera.position);
    driver.view.rain.update(driver.camera, rainSeconds, driver.view.vehicleLights.headlight);
    driver.view.applyGroundOffset();
    this.updateVehicleLights(driver);
  }

  /** A glowing canister with a ring round it, so it reads from far down the road. */
  private createNitroMesh(): THREE.Group {
    const group = new THREE.Group();
    const canister = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 0.9, 2.6, 18),
      new THREE.MeshStandardMaterial({
        color: 0x1fb6ff,
        emissive: 0x0a8cff,
        emissiveIntensity: 1.6,
        metalness: 0.4,
        roughness: 0.3,
      }),
    );
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.9, 0.6, 18),
      new THREE.MeshStandardMaterial({ color: 0xe8f6ff, metalness: 0.8, roughness: 0.25 }),
    );
    cap.position.y = 1.6;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.1, 0.16, 8, 36),
      new THREE.MeshBasicMaterial({ color: 0x7fe3ff, transparent: true, opacity: 0.85 }),
    );
    ring.name = 'nitro-ring';
    group.add(canister, cap, ring);
    group.visible = false;
    return group;
  }

  /** The canisters on this driver's stretch of road that they have not taken yet. */
  private nitroAhead(driver: Driver): ReturnType<typeof nitroPickupsBetween> {
    const behind = driver.distance - 40 * driver.facing;
    const ahead = driver.distance + (GAME.lookAhead + 60) * driver.facing;
    return nitroPickupsBetween(behind, ahead, this.lapLength).filter(
      (pickup) => !driver.collectedNitro.has(pickup.index),
    );
  }

  /** Driving through a canister fires the boost straight away. */
  private collectNitro(driver: Driver): void {
    for (const pickup of this.nitroAhead(driver)) {
      if (!touchesNitro(pickup, driver.distance, driver.lateral, laneOffsets[pickup.lane])) continue;
      driver.collectedNitro.add(pickup.index);
      driver.nitroSeconds = NITRO_SECONDS;
      driver.nitroKick = 1;
      this.showNotice(driver, 'NITRO!', 1);
    }
  }

  /** Stands this driver's untaken canisters on the road, bobbing and spinning. */
  private placeNitro(driver: Driver): void {
    const pickups = this.nitroAhead(driver);
    const time = performance.now() * 0.001;
    driver.nitroMeshes.forEach((mesh, slot) => {
      const pickup = pickups[slot];
      mesh.visible = pickup !== undefined && this.phase !== 'ready';
      if (!pickup) return;
      const heading = roadHeading(pickup.distance);
      const offset = laneOffsets[pickup.lane];
      mesh.position.set(
        roadCenter(pickup.distance) + Math.cos(heading) * offset,
        2.1 + Math.sin(time * 3 + pickup.index) * 0.3,
        -pickup.distance - Math.sin(heading) * offset,
      );
      mesh.rotation.y = time * 2;
      const ring = mesh.getObjectByName('nitro-ring');
      if (ring) ring.rotation.x = Math.PI / 2 + Math.sin(time * 2 + pickup.index) * 0.25;
    });
  }

  private showNotice(driver: Driver, message: string, seconds = 1.6): void {
    driver.notice.message = message;
    driver.notice.seconds = seconds;
  }

  /** Cars just respawned or already finished drive through others. */
  private passesThrough(driver: Driver): boolean {
    return driver.ghostSeconds > 0 || driver.holdSeconds > 0 || driver.laps.finishTime !== null;
  }

  /**
   * In a race a crash costs time instead of ending the run: the car goes
   * back to its own lane facing the right way, waits, then drives on as a
   * ghost for a moment so the car it hit can get clear.
   */
  private respawnDriver(driver: Driver): void {
    const lateral = laneOffsets[DRIVER_START_LANES[driver.index] ?? 0];
    const heading = roadHeading(driver.distance);
    driver.speed = 0;
    driver.skid = 0;
    driver.lateral = lateral;
    driver.worldX = roadCenter(driver.distance) + Math.cos(heading) * lateral;
    driver.vehicleHeading = heading;
    driver.travelHeading = heading;
    driver.steeringVisual = 0;
    driver.reverseHoldSeconds = 0;
    driver.longitudinalAcceleration = 0;
    driver.cruiseOn = false;
    driver.cruiseStatus = 'off';
    if (driver.facing === -1) {
      driver.facing = 1;
      for (const car of this.traffic) {
        car.counted[driver.index] = car.distance < driver.distance;
      }
    }
    driver.snapCamera = true;
    driver.nitroSeconds = 0;
    driver.boosting = false;
    driver.holdSeconds = RESPAWN_HOLD_SECONDS;
    driver.ghostSeconds = RESPAWN_HOLD_SECONDS + RESPAWN_GHOST_SECONDS;
    this.vehicleAssets.setBrakeLights(driver.mesh, true);
  }

  /** Everyone has finished, or time ran out for those still racing. */
  private endRace(): void {
    this.phase = 'finished';
    this.finishGrace = null;
    for (const driver of this.drivers) driver.skid = 0;
    this.onRaceFinish(this.snapshots());
  }

  /** Counts finish lines crossed and announces each lap and the flag. */
  private updateRace(driver: Driver): void {
    if (this.lapLength === null) return;
    const { laps } = driver;
    const event = updateLaps(laps, driver.distance, this.lapLength, this.totalLaps, this.raceTime);
    if (event === 'lap') {
      const label =
        laps.lapsDone + 1 === this.totalLaps
          ? 'FINAL LAP'
          : `LAP ${laps.lapsDone + 1}/${this.totalLaps}`;
      this.showNotice(driver, `${label} · ${formatLapTime(laps.lastLap)}`, 3);
    } else if (event === 'finish') {
      this.showNotice(driver, `FINISHED · ${formatLapTime(laps.finishTime)}`, 3);
      driver.cruiseOn = false;
      driver.cruiseStatus = 'off';
      if (this.drivers.every((other) => other.laps.finishTime !== null)) this.endRace();
      else this.finishGrace ??= RACE_FINISH_GRACE_SECONDS;
    }
    if (laps.finishTime !== null && driver.notice.seconds <= 0) {
      driver.assistMessage = `FINISHED · ${formatLapTime(laps.finishTime)}`;
    }
  }

  private raceSnapshot(driver: Driver, position: number): RaceSnapshot | null {
    if (this.lapLength === null) return null;
    const { laps } = driver;
    const finished = laps.finishTime !== null;
    const totalTime = laps.finishTime ?? this.raceTime;
    return {
      lap: Math.min(laps.lapsDone + 1, this.totalLaps),
      laps: this.totalLaps,
      lapTime: finished ? totalTime : this.raceTime - laps.lapStart,
      lastLap: laps.lastLap,
      bestLap: laps.bestLap,
      totalTime,
      position,
      finished,
      countdown: Number.isFinite(this.countdown) ? Math.max(this.countdown, -1) : -1,
      roadDistance: driver.distance,
    };
  }

  private updateVehicleLights(driver: Driver): void {
    const bufferHeight = this.renderer.getDrawingBufferSize(this.drawingBufferSize).y;
    const { vehicleLights, streetLights } = driver.view;
    streetLights.update(
      driver.distance,
      driver.viewAlong,
      driver.camera,
      bufferHeight,
      driver.mesh.position,
    );
    if (!vehicleLights.beginFrame(driver.camera, bufferHeight)) return;
    const playerRig = this.vehicleAssets.lightRig(driver.mesh);
    if (playerRig) vehicleLights.placeHeadlight(driver.mesh, playerRig);
    for (const other of this.drivers) {
      if (other === driver) continue;
      const rig = this.vehicleAssets.lightRig(other.mesh);
      if (rig) vehicleLights.addVehicle(other.mesh, rig, this.vehicleAssets.isBraking(other.mesh));
    }
    for (const car of this.traffic) {
      if (!car.mesh.visible) continue;
      const rig = this.vehicleAssets.lightRig(car.mesh);
      if (!rig) continue;
      vehicleLights.addVehicle(car.mesh, rig, this.vehicleAssets.isBraking(car.mesh));
    }
    vehicleLights.endFrame();
  }

  private applyWetness(wetness: number): void {
    const surfaces = [
      [this.roadMaterial, SURFACE_WETNESS.road],
      [this.shoulderMaterial, SURFACE_WETNESS.shoulder],
      [this.groundMaterial, SURFACE_WETNESS.ground],
    ] as const;
    for (const [material, response] of surfaces) {
      const mix = (range: readonly [number, number]): number =>
        THREE.MathUtils.lerp(range[0], range[1], wetness);
      material.roughness = mix(response.roughness);
      material.color.setScalar(mix(response.brightness));
      material.envMapIntensity = mix(response.reflection);
    }
  }

  private renderViews(dt: number, rainSeconds: number): void {
    const usePostProcessing = this.adaptiveQuality.settings.postProcessing;
    // Low quality has no effect pipeline; it borrows one (without bloom) while the nitro blur shows.
    const pipelineFor = (driver: Driver): PostProcessing | undefined => {
      const blurring = driver.nitroFx > 0.01 || driver.nitroKick > 0.01;
      if (!usePostProcessing && !blurring) return undefined;
      if (!driver.postProcessing) {
        driver.postProcessing = new PostProcessing(this.renderer, this.scene, driver.camera);
        this.resize();
      }
      driver.postProcessing.setBloomEnabled(usePostProcessing);
      return driver.postProcessing;
    };
    if (this.drivers.length === 1) {
      const [driver] = this.drivers;
      this.prepareView(driver, rainSeconds);
      const pipeline = pipelineFor(driver);
      if (pipeline) pipeline.render(dt);
      else this.renderer.render(this.scene, driver.camera);
      return;
    }
    // Split screen: each driver draws into their own part of the canvas.
    this.renderer.setScissorTest(true);
    for (const driver of this.drivers) {
      this.prepareView(driver, rainSeconds);
      const { x, y, width, height } = driver.viewport;
      this.renderer.setViewport(x, y, width, height);
      this.renderer.setScissor(x, y, width, height);
      const pipeline = pipelineFor(driver);
      if (pipeline) pipeline.render(dt);
      else this.renderer.render(this.scene, driver.camera);
    }
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, this.container.clientWidth, this.container.clientHeight);
  }

  private animate = (): void => {
    this.animationFrame = requestAnimationFrame(this.animate);
    const frameSeconds = this.clock.getDelta();
    const dt = Math.min(frameSeconds, 0.05);
    const now = performance.now();
    const playing = this.phase === 'playing';
    if (!playing && now - this.lastIdleRender < IDLE_RENDER_INTERVAL_MS) return;
    if (playing) this.updateSimulation(dt);
    this.updateWorld(dt);
    let qualitySettings = this.pendingRenderQuality;
    this.pendingRenderQuality = undefined;
    if (playing && this.graphicsQualityMode === 'auto') {
      const settings = this.adaptiveQuality.recordFrame(frameSeconds);
      if (settings) qualitySettings = settings;
    }
    if (qualitySettings) this.applyRenderQuality(qualitySettings);
    this.renderer.info.reset();
    // Quality changes resize and clear the WebGL drawing buffer. Rendering
    // afterward fills it in the same animation frame and prevents a black flash.
    // Rain keeps real time on menus, where the world only repaints a few times a second.
    this.renderViews(dt, Math.min(frameSeconds, 0.25));
    if (this.performanceMonitoring && playing) {
      const render = this.renderer.info.render;
      const memory = this.renderer.info.memory;
      const snapshot = this.performanceMonitor.recordFrame(
        frameSeconds,
        {
          drawCalls: render.calls,
          triangles: render.triangles,
          geometries: memory.geometries,
          textures: memory.textures,
        },
        this.adaptiveQuality.settings.level,
      );
      if (snapshot) this.onPerformanceUpdate(snapshot);
    }
    if (!playing) this.lastIdleRender = now;

    if (now - this.lastSnapshot > 80) {
      this.lastSnapshot = now;
      this.onUpdate(this.snapshots());
    }
  };

  private snapshots(): GameSnapshot[] {
    const positions = racePositions(
      this.drivers.map((driver) => ({
        distance: driver.distance,
        finishTime: driver.laps.finishTime,
        crashed: driver.crashed,
      })),
    );
    return this.drivers.map((driver) => this.snapshot(driver, positions[driver.index]));
  }

  private snapshot(driver: Driver, position: number): GameSnapshot {
    return {
      speedKph: toKph(Math.abs(driver.speed)),
      distance: toMeters(driver.odometer),
      overtakes: driver.overtakes,
      score: Math.floor(toMeters(driver.odometer) + driver.overtakes * 250),
      cruise: { status: driver.cruiseStatus, setKph: driver.cruiseSetKph },
      phase: driver.crashed ? 'crashed' : this.phase,
      assistMessage: driver.assistMessage,
      skid: this.phase === 'playing' && !driver.crashed ? driver.skid : 0,
      nitro: driver.crashed ? 0 : driver.nitroSeconds / NITRO_SECONDS,
      race: this.raceSnapshot(driver, position),
    };
  }

  private resize = (): void => {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.renderer.setSize(width, height, false);
    // Split screen sits side by side, matching where the two players sit.
    const count = this.drivers.length;
    this.drivers.forEach((driver, index) => {
      const left = Math.round((width * index) / count);
      const right = Math.round((width * (index + 1)) / count);
      driver.viewport = { x: left, y: 0, width: right - left, height };
      driver.camera.aspect = (right - left) / Math.max(height, 1);
      driver.camera.updateProjectionMatrix();
      driver.postProcessing?.syncSize(right - left, height);
    });
  };

  private applyRenderQuality(settings: RenderQualitySettings): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.pixelRatioCap));
    this.denseForest = settings.denseForest;
    for (const driver of this.drivers) {
      driver.view.forest.setDense(settings.denseForest);
      if (settings.postProcessing) {
        driver.postProcessing ??= new PostProcessing(this.renderer, this.scene, driver.camera);
      }
    }
    // Pixel ratio changes resize the drawing buffer and every effect target.
    this.resize();
    const shadow = this.lighting.sun.shadow;
    if (shadow.mapSize.x !== settings.shadowMapSize) {
      shadow.mapSize.set(settings.shadowMapSize, settings.shadowMapSize);
      shadow.map?.dispose();
      shadow.map = null;
    }
  }
}
