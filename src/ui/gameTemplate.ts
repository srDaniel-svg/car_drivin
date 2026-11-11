import { TRAFFIC_COUNT_OPTIONS } from '../game/config';
import {
  CAR_MODEL_OPTIONS,
  CAR_MODEL_VARIETY_OPTIONS,
  DEFAULT_CAR_MODEL_ID,
} from '../game/vehicleCatalog';
import { TIME_OF_DAY_OPTIONS, WEATHER_OPTIONS } from '../game/conditionsCatalog';
import { createTrackPickerMarkup } from './TrackSettings';

const optionList = (options: readonly { id: string; label: string }[]): string =>
  options.map(({ id, label }) => `<option value="${id}">${label}</option>`).join('');

/** Builds the static application shell. Dynamic overlays remain in the app controller. */
export function createGameTemplate(): string {
  const loadingPosterPath = `${import.meta.env.BASE_URL}images/hands-on-highway-poster-loading.webp`;
  const carGroups = [...new Set(CAR_MODEL_OPTIONS.map(({ group }) => group))];
  const carOptions = carGroups
    .map((group) => {
      const options = CAR_MODEL_OPTIONS.filter((option) => option.group === group)
        .map(
          ({ id, label }) =>
            `<option value="${id}"${id === DEFAULT_CAR_MODEL_ID ? ' selected' : ''}>${label}</option>`,
        )
        .join('');
      return `<optgroup label="${group}">${options}</optgroup>`;
    })
    .join('');
  const trafficOptions = TRAFFIC_COUNT_OPTIONS.map(
    (count) =>
      `<option value="${count}"${count === 4 ? ' selected' : ''}>${count === 0 ? 'NO TRAFFIC' : `${count} CARS`}</option>`,
  ).join('');
  const varietyOptions = CAR_MODEL_VARIETY_OPTIONS.map(
    (count) =>
      `<option value="${count}"${count === 1 ? ' selected' : ''}>${count} ${count === 1 ? 'MODEL' : 'MODELS'}</option>`,
  ).join('');
  const timeOfDayOptions = optionList(TIME_OF_DAY_OPTIONS);
  const weatherOptions = optionList(WEATHER_OPTIONS);

  return `
    <main class="game-shell">
      <div id="viewport" class="viewport" aria-label="3D driving game"></div>

      <header class="topbar">
        <a class="brand" href="#" aria-label="Hands-On Highway home">
          <span class="brand-mark"></span><span class="brand-name"><span>HANDS-ON</span> <span>HIGHWAY</span></span>
        </a>
        <div class="topbar-actions">
          <div id="tracking-pill" class="tracking-pill">
            <span class="status-dot"></span><span id="tracking-label">INPUT NOT SET</span>
          </div>
          <button id="graphics-button" class="icon-button" aria-label="Open graphics settings"><span class="graphics-button-label">GRAPHICS</span><span class="graphics-button-label-compact">GFX</span></button>
          <button id="fullscreen-button" class="icon-button" aria-label="Enter full screen" aria-pressed="false">FULL SCREEN</button>
          <button id="mute-button" class="icon-button" aria-label="Toggle sound">SOUND ON</button>
          <button id="pause-button" class="icon-button" aria-label="Pause game">PAUSE</button>
        </div>
      </header>

      <section id="hud" class="hud is-hidden" aria-live="polite">
        <div class="speed-panel">
          <div id="cruise-panel" class="cruise-panel" data-state="off" role="group" aria-label="Adaptive cruise control">
            <button id="cruise-toggle" class="cruise-toggle" type="button" aria-pressed="false" title="Adaptive cruise on or off (C)"><i></i><span id="cruise-status">ACC OFF</span></button>
            <button id="cruise-down" class="cruise-step" type="button" aria-label="Lower cruise speed" title="Lower set speed (−)">−</button>
            <span class="cruise-set" aria-live="polite"><b id="cruise-speed">80</b><small>KM/H</small></span>
            <button id="cruise-up" class="cruise-step" type="button" aria-label="Raise cruise speed" title="Raise set speed (+)">+</button>
          </div>
          <div class="speed-number"><span id="speed">000</span><small>KM/H</small></div>
          <div class="speed-track"><span id="speed-fill"></span></div>
        </div>
        <div id="run-stats" class="run-stats">
          <div class="race-stat"><span>POSITION</span><strong id="race-position">1<small>ST</small></strong></div>
          <div class="race-stat"><span>LAP</span><strong id="race-lap">1<small>/3</small></strong></div>
          <div class="race-stat"><span id="race-time-label">LAP TIME</span><strong id="race-time">0:00.00</strong></div>
          <div class="race-stat"><span>BEST LAP</span><strong id="race-best">-:--.--</strong></div>
          <div class="free-stat"><span>DISTANCE</span><strong id="distance">0.00 <small>KM</small></strong></div>
          <div class="free-stat"><span>OVERTAKES</span><strong id="overtakes">0</strong></div>
          <div class="free-stat"><span>SCORE</span><strong id="score">000000</strong></div>
        </div>
        <div id="assist" class="assist"><i></i><span>READY</span></div>
        <div class="steer-meter">
          <span>L</span><div class="steer-track"><i id="steer-indicator"></i></div><span>R</span>
        </div>
      </section>

      <section id="split-hud" class="split-hud is-hidden" aria-live="polite"></section>
      <div id="race-countdown" class="race-countdown is-hidden" aria-live="assertive"></div>
      <div id="minimap" class="minimap is-hidden" aria-hidden="true">
        <svg viewBox="0 0 100 100">
          <path class="minimap-road"></path>
          <path class="minimap-line"></path>
          <g class="minimap-finish">
            <rect x="45.5" y="11" width="9" height="14"></rect>
            <path d="M45.5 11h3v3.5h-3zM51.5 11h3v3.5h-3zM48.5 14.5h3v3.5h-3zM45.5 18h3v3.5h-3zM51.5 18h3v3.5h-3zM48.5 21.5h3v3.5h-3z"></path>
          </g>
          <g class="minimap-cars"></g>
        </svg>
      </div>

      <aside id="performance-hud" class="performance-hud is-hidden" aria-label="Performance diagnostics">
        <div class="performance-hud-title"><span>PERFORMANCE</span><small>F3</small></div>
        <div class="performance-hud-grid">
          <span>FPS<strong id="perf-fps">--</strong></span>
          <span>FRAME<strong id="perf-frame">--</strong></span>
          <span>P90<strong id="perf-p90">--</strong></span>
          <span>CALLS<strong id="perf-calls">--</strong></span>
          <span>TRIS<strong id="perf-triangles">--</strong></span>
          <span>GEOMETRY<strong id="perf-geometries">--</strong></span>
          <span>TEXTURES<strong id="perf-textures">--</strong></span>
          <span>QUALITY<strong id="perf-quality">--</strong></span>
        </div>
      </aside>

      <aside class="camera-shell is-offline is-hidden" aria-label="Camera tracking preview">
        <video id="camera-video" playsinline muted></video>
        <canvas id="camera-canvas"></canvas>
        <canvas id="camera-canvas-2" class="camera-canvas-second"></canvas>
        <div class="camera-divider" aria-hidden="true"><span>P1</span><span>P2</span></div>
        <div class="camera-topline"><span><i></i> HAND CAM</span><button id="hide-camera">HIDE</button></div>
        <div id="camera-hint" class="camera-hint">WAITING FOR CAMERA</div>
      </aside>
      <button id="show-camera" class="show-camera is-hidden">SHOW HAND CAM</button>

      <section id="graphics-settings" class="graphics-settings is-hidden" role="dialog" aria-modal="true" aria-labelledby="graphics-title">
        <button id="graphics-backdrop" class="graphics-backdrop" type="button" aria-label="Close graphics settings"></button>
        <div class="graphics-settings-card">
          <div class="graphics-settings-heading">
            <div><small>DISPLAY</small><h2 id="graphics-title">GRAPHICS</h2></div>
            <button id="graphics-close" type="button" aria-label="Close graphics settings">CLOSE</button>
          </div>
          <label class="graphics-setting-row" for="graphics-quality">
            <span><strong>QUALITY PRESET</strong><small>Resolution and shadow quality</small></span>
            <select id="graphics-quality">
              <option value="auto">AUTO</option>
              <option value="low">LOW</option>
              <option value="medium">MEDIUM</option>
              <option value="high">HIGH</option>
            </select>
          </label>
          <p id="graphics-quality-description" class="graphics-quality-description"></p>
          <div class="graphics-section-title">CONDITIONS</div>
          <label class="graphics-setting-row graphics-setting-row-compact" for="settings-time-of-day">
            <span><strong>TIME OF DAY</strong><small>Midday sun, sunset or a moonlit night</small></span>
            <select id="settings-time-of-day">${timeOfDayOptions}</select>
          </label>
          <label class="graphics-setting-row graphics-setting-row-compact" for="settings-weather">
            <span><strong>WEATHER</strong><small>Rain and fog reduce visibility</small></span>
            <select id="settings-weather">${weatherOptions}</select>
          </label>
          <p class="graphics-settings-note"><i></i> Changes apply immediately and are saved for future runs.</p>
        </div>
      </section>

      <section id="overlay" class="overlay">
        <div class="modal intro-modal">
          <div class="eyebrow"><span></span> TWO-HAND DRIVING EXPERIENCE</div>
          <h1>YOUR HANDS.<br><em>YOUR ROAD.</em></h1>
          <p class="lead">Grip an invisible wheel. Raise both thumbs to slow down, or show both palms to stop.</p>
          <div class="wheel-guide" aria-hidden="true">
            <div class="hand hand-left"><span></span><b>LEFT HAND</b></div>
            <div class="virtual-wheel"><span class="wheel-center"></span></div>
            <div class="hand hand-right"><span></span><b>RIGHT HAND</b></div>
          </div>
          <div class="instruction-row">
            <div><b>01</b><span>Allow camera<br>access</span></div>
            <div><b>02</b><span>Hold two closed<br>hands apart</span></div>
            <div><b>03</b><span>Thumbs up: slow to 40<br>open palms: full brake</span></div>
          </div>
          <div id="car-options" class="car-options">
            <label><span>PLAYERS</span><select id="player-count" aria-label="Choose one player or two-player split screen"><option value="1">1 PLAYER</option><option value="2">2 PLAYERS · SPLIT</option></select></label>
            <label><span id="driver-car-label">YOUR CAR</span><select id="driver-car" aria-label="Choose your car model">${carOptions}</select></label>
            <label class="second-driver-option is-hidden"><span>PLAYER 2 CAR</span><select id="second-driver-car" aria-label="Choose player two's car model">${carOptions}</select></label>
            <label class="second-driver-option player-name-option is-hidden"><span>NOMBRE J1</span><input id="player-one-name" type="text" maxlength="16" placeholder="JUGADOR 1" autocomplete="off" aria-label="Nombre del jugador 1"></label>
            <label class="second-driver-option player-name-option is-hidden"><span>NOMBRE J2</span><input id="player-two-name" type="text" maxlength="16" placeholder="JUGADOR 2" autocomplete="off" aria-label="Nombre del jugador 2"></label>
            <label class="second-driver-option is-hidden" title="En carreras de 2 jugadores, quien llega primero debe acertar una pregunta para ser campeón."><span>PREGUNTA SORPRESA</span><select id="quiz-mode" aria-label="Pregunta sorpresa al final de la carrera"><option value="on" selected>ACTIVADA</option><option value="off">DESACTIVADA</option></select></label>
            <label><span>TRAFFIC CARS</span><select id="traffic-count" aria-label="Choose number of traffic cars">${trafficOptions}</select></label>
            <label title="Every so often a wave of slow traffic floods the road and cars start changing lanes."><span>RUSH HOUR</span><select id="rush-hour" aria-label="Choose whether waves of extra traffic appear"><option value="on" selected>WAVES ON</option><option value="off">OFF</option></select></label>
            <label><span>CAR VARIETY</span><select id="car-model-count" aria-label="Choose number of different car models">${varietyOptions}</select></label>
            <label class="condition-option"><span>TIME OF DAY</span><select id="time-of-day" aria-label="Choose the time of day">${timeOfDayOptions}</select></label>
            <label class="condition-option"><span>WEATHER</span><select id="weather" aria-label="Choose the weather">${weatherOptions}</select></label>
          </div>
          ${createTrackPickerMarkup()}
          <p class="traffic-performance-note"><i>!</i> More traffic cars or model variety may reduce frame rates on lower-powered devices.</p>
          <p id="split-note" class="split-note is-hidden"><i>2P</i> One camera, split down the middle: sit side by side, each player keeping both hands on their own half. Player 1 drives the left screen, player 2 the right.</p>
          <div class="modal-actions">
            <button id="camera-start" class="primary-button"><span>START WITH HANDS</span><i>→</i></button>
            <button id="remote-start" class="secondary-button">📡 USE REMOTE CAMERA <small>ANOTHER DEVICE</small></button>
            <button id="keyboard-start" class="secondary-button">USE KEYBOARD INSTEAD <small id="keyboard-start-keys">WASD / ARROWS</small></button>
          </div>
          <p class="privacy"><i>●</i> Camera processing stays on this device. No video is saved or uploaded.</p>
        </div>
      </section>

      <section id="asset-gate" class="asset-gate" role="dialog" aria-modal="true" aria-labelledby="asset-gate-title">
        <img class="asset-gate-poster" src="${loadingPosterPath}" alt="" aria-hidden="true" decoding="async" fetchpriority="high">
        <div class="modal asset-gate-modal">
          <div class="asset-gate-copy">
            <div class="eyebrow"><span></span> GAME STARTUP</div>
            <h2 id="asset-gate-title">GETTING ROAD READY</h2>
            <p id="asset-gate-message">Saving core game assets now for faster future starts.</p>
          </div>
          <div class="asset-gate-progress">
            <div id="asset-loader" class="asset-loader" aria-hidden="true"><span id="asset-download-percent">0%</span></div>
            <div id="asset-download" class="asset-download" data-state="checking" role="status" aria-live="polite">
              <div class="asset-download-head"><span id="asset-download-label">CHECKING ASSETS</span></div>
              <div class="asset-download-track"><i id="asset-download-fill"></i></div>
              <small id="asset-download-detail">Checking browser storage...</small>
            </div>
            <button id="asset-download-retry" class="secondary-button is-hidden" type="button">RETRY DOWNLOAD</button>
          </div>
        </div>
      </section>

      <div class="corner corner-tl"></div><div class="corner corner-tr"></div>
      <div class="corner corner-bl"></div><div class="corner corner-br"></div>
    </main>
  `;
}
