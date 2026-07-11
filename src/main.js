import { clamp } from "./geometry.js";
import { FiberBench } from "./fiber-bench.js";
import {
  calculateLink,
  DEFAULT_STATE,
  formatBer,
  wavelengthDefinition,
  WAVELENGTHS,
} from "./physics.js";
import { ScopeRenderer } from "./scope.js";
import { SpliceView } from "./splice-view.js";

const initialWave = wavelengthDefinition(DEFAULT_STATE.wavelengthNm);
let state = {
  ...DEFAULT_STATE,
  emitterYRatio: 0.53,
  wave: initialWave,
};
let paused = false;
let frozenPhase = 0.54;
let dirty = true;
let lastDomUpdate = 0;
let announcementTimer = 0;

document.documentElement.style.setProperty("--active-wave", initialWave.color);
document.querySelector("#app").innerHTML = buildAppMarkup();

const elements = cacheElements();
const bench = new FiberBench(
  elements.fiberCanvas,
  handleBenchState,
  () => announceCurrentState(true),
  () => announceSelection(),
);
const scope = new ScopeRenderer(elements.timeCanvas, elements.eyeCanvas);
const spliceView = new SpliceView(elements.spliceCanvas);

bindControls();
syncControls();
requestAnimationFrame(frame);

function buildAppMarkup() {
  return `
    <div class="app-shell">
      <header class="instrument-bar">
        <div class="brand-lockup">
          <span class="brand-mark" aria-hidden="true"></span>
          <span>
            <strong class="brand-title">Photon Bench</strong>
            <small class="brand-subtitle">Fiber physics & digital link simulator</small>
          </span>
        </div>
        <div class="bar-readout" aria-label="Live link summary">
          <div class="bar-readout-item"><span>Source</span><strong id="bar-wave">1550 nm</strong></div>
          <div class="bar-readout-item"><span>Link</span><strong id="bar-link">SM · graded</strong></div>
          <div class="bar-readout-item"><span>Rx</span><strong id="bar-rx">−3.0 dBm</strong></div>
        </div>
        <div class="bar-actions">
          <button class="tool-button" id="pause-button" type="button" aria-pressed="false" aria-label="Pause photon animation">
            <span class="status-led" aria-hidden="true"></span><span class="button-label">Running</span>
          </button>
          <button class="tool-button" id="reset-button" type="button" aria-label="Reset simulator">
            <span aria-hidden="true">↺</span><span class="button-label">Reset</span>
          </button>
        </div>
      </header>

      <main class="workbench" id="simulator">
        <aside class="control-rack" aria-label="Optical controls">
          <section class="panel">
            <div class="panel-heading">
              <div class="panel-heading-copy">
                <span class="eyebrow">Source rack</span>
                <h2 class="panel-title">Laser & waveguide</h2>
              </div>
              <span class="live-pill">Live</span>
            </div>

            <div class="control-section">
              <div class="section-label"><span>Wavelength</span><span id="wave-band-label">C band · IR</span></div>
              <div class="wavelength-grid" role="group" aria-label="Laser wavelength">
                ${WAVELENGTHS.map(
                  (wave) => `
                    <button
                      class="wavelength-button"
                      type="button"
                      data-wavelength="${wave.nm}"
                      aria-pressed="${wave.nm === DEFAULT_STATE.wavelengthNm}"
                      style="--wave-color:${wave.color}"
                    >
                      <span class="wave-nm">${wave.nm}</span>
                      <span class="wave-band">${wave.visible ? wave.band : `${wave.band} · false`}</span>
                    </button>`,
                ).join("")}
              </div>
              <div class="field">
                <div class="field-row">
                  <label class="field-label" for="input-power">Launch power</label>
                  <output class="field-output" id="input-power-output">−3.0 dBm</output>
                </div>
                <input id="input-power" data-range-key="inputPowerDbm" type="range" min="-10" max="3" step="0.5" value="-3" />
                <div class="range-scale"><span>−10</span><span>+3 dBm</span></div>
              </div>
            </div>

            <div class="control-section">
              <div class="section-label"><span>Index profile</span><span id="profile-equation">n(r) parabolic</span></div>
              <div class="segmented" role="group" aria-label="Refractive index profile">
                <button class="seg-button" type="button" data-key="profile" data-value="step" aria-pressed="false">Step-index</button>
                <button class="seg-button" type="button" data-key="profile" data-value="graded" aria-pressed="true">Graded-index</button>
              </div>
              <div class="field">
                <div class="section-label"><span>Waveguide modes</span><span id="mode-count-label">LP₀₁</span></div>
                <div class="segmented" role="group" aria-label="Waveguide mode family">
                  <button class="seg-button" type="button" data-key="mode" data-value="multi" aria-pressed="false">Multi-mode</button>
                  <button class="seg-button" type="button" data-key="mode" data-value="single" aria-pressed="true">Single-mode</button>
                </div>
                <p class="field-note" id="mode-note">Thin 8.2 µm core. The V-number still decides whether the selected wavelength is physically single-mode.</p>
              </div>
              <div class="field">
                <div class="field-row">
                  <label class="field-label" for="fiber-length">Fiber length</label>
                  <output class="field-output" id="fiber-length-output">2.00 km</output>
                </div>
                <input id="fiber-length" data-range-key="fiberLengthKm" type="range" min="0.05" max="50" step="0.05" value="2" />
                <div class="range-scale"><span>50 m</span><span>50 km</span></div>
              </div>
              <div class="field">
                <div class="field-row"><span class="field-label">Line rate</span><output class="field-output" id="bitrate-output">10 Gb/s</output></div>
                <div class="segmented" role="group" aria-label="Digital line rate">
                  <button class="seg-button" type="button" data-key="bitRateGbps" data-value="1" aria-pressed="false">1G</button>
                  <button class="seg-button" type="button" data-key="bitRateGbps" data-value="10" aria-pressed="true">10G</button>
                  <button class="seg-button" type="button" data-key="bitRateGbps" data-value="25" aria-pressed="false">25G</button>
                  <button class="seg-button" type="button" data-key="bitRateGbps" data-value="40" aria-pressed="false">40G</button>
                </div>
              </div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-heading">
              <div class="panel-heading-copy">
                <span class="eyebrow">Calibrated scenes</span>
                <h2 class="panel-title">Starting conditions</h2>
              </div>
            </div>
            <div class="control-section">
              <div class="preset-grid">
                <button class="preset-button" type="button" data-preset="telecom">Clean 1550 nm telecom</button>
                <button class="preset-button" type="button" data-preset="om3">OM3 graded link</button>
                <button class="preset-button" type="button" data-preset="stress">Visible stress test</button>
              </div>
              <p class="interaction-note">
                On the bench: drag nodes or the emitter. Drag the gold pivot to aim.<br />
                Keyboard: <kbd>1</kbd>–<kbd>5</kbd> select nodes, <kbd>E</kbd> selects the emitter, arrows nudge.
              </p>
            </div>
          </section>
        </aside>

        <div class="stage-stack">
          <section class="panel bench-panel" aria-labelledby="bench-title">
            <div class="panel-heading">
              <div class="panel-heading-copy">
                <span class="eyebrow">Physical domain</span>
                <h1 class="panel-title" id="bench-title">Interactive optical bench</h1>
              </div>
              <div class="panel-heading-meta">
                <span id="false-color-pill" class="false-color-pill">IR false color</span>
                <span id="tir-pill" class="tir-pill">TIR guided</span>
                <button class="mini-button" id="straighten-button" type="button" aria-label="Straighten fiber" style="padding:0 8px;font:8px var(--font-mono);color:#9aa6af">Straighten</button>
              </div>
            </div>
            <div class="bench-canvas-wrap">
              <canvas
                id="fiber-canvas"
                tabindex="0"
                role="group"
                aria-roledescription="interactive optical bench"
                aria-label="Five-node fiber waveguide. Drag numbered nodes to bend the cable. Drag the laser housing vertically or its gold pivot to aim. Keyboard: press 1 through 5 to select a node, E to select the emitter, then use arrow keys to move; hold Shift for coarse movement."
              ></canvas>
              <div class="bench-overlay" aria-hidden="true">
                <div class="overlay-readout"><span>Launch / acceptance</span><strong id="launch-readout">0.0° / ±6.9°</strong></div>
                <div class="overlay-readout"><span>Critical angle</span><strong id="critical-readout">85.3°</strong></div>
                <div class="overlay-readout"><span>Minimum bend radius</span><strong id="bend-readout">—</strong></div>
              </div>
              <div class="bench-help">The light envelope is optical power. Speckles mark Rayleigh scatter; radiation fans identify escaped power.</div>
            </div>
            <div class="bench-status-strip" aria-label="Waveguide status">
              <div class="bench-status-item"><span>Guidance</span><strong id="guidance-readout">Total internal reflection</strong></div>
              <div class="bench-status-item"><span>Numerical aperture</span><strong id="na-readout">0.120</strong></div>
              <div class="bench-status-item"><span>Normalized frequency</span><strong id="v-readout">V = 1.99</strong></div>
              <div class="bench-status-item"><span>Pulse spread</span><strong id="spread-readout">0.06 ns</strong></div>
            </div>
          </section>

          <section class="panel scope-panel" aria-labelledby="scope-title">
            <div class="panel-heading">
              <div class="panel-heading-copy">
                <span class="eyebrow">Digital storage oscilloscope</span>
                <h2 class="panel-title" id="scope-title">Transmitted vs received signal</h2>
              </div>
              <div class="panel-heading-meta">
                <span class="channel-key" style="--channel-color:#f4c84a">CH1 TX</span>
                <span class="channel-key" id="rx-channel-key" style="--channel-color:#e83136">CH2 RX</span>
                <span id="scope-rate">10 Gb/s</span>
              </div>
            </div>
            <div class="scope-grid">
              <div class="scope-screen">
                <div class="scope-screen-bar"><span>Time domain · NRZ PRBS</span><span id="rise-readout">tr 6 ps</span></div>
                <canvas id="time-canvas" class="scope-canvas" aria-label="Time-domain comparison of transmitted and received pulse trains"></canvas>
              </div>
              <div class="scope-screen">
                <div class="scope-screen-bar"><span>Eye diagram · CH2</span><span id="eye-readout">100% open</span></div>
                <canvas id="eye-canvas" class="scope-canvas" aria-label="Received signal eye diagram"></canvas>
              </div>
            </div>
          </section>
        </div>

        <aside class="diagnostic-rack" aria-label="Link diagnostics">
          <section class="panel" aria-labelledby="budget-title">
            <div class="panel-heading">
              <div class="panel-heading-copy">
                <span class="eyebrow">Receiver plane</span>
                <h2 class="panel-title" id="budget-title">Link budget</h2>
              </div>
              <span class="live-pill">Computed</span>
            </div>
            <div class="metric-matrix">
              <div class="metric-cell">
                <span class="metric-label">Received power</span>
                <strong class="metric-value" id="metric-power">−3.3<small>dBm</small></strong>
                <span class="metric-hint" id="metric-power-hint">0.97× field amplitude</span>
              </div>
              <div class="metric-cell">
                <span class="metric-label">Total loss</span>
                <strong class="metric-value" id="metric-loss">0.3<small>dB</small></strong>
                <span class="metric-hint" id="metric-loss-hint">Nominal link</span>
              </div>
              <div class="metric-cell">
                <span class="metric-label">Eye opening</span>
                <strong class="metric-value" id="metric-eye">96<small>%</small></strong>
                <span class="metric-hint" id="metric-q">Q 7.6</span>
              </div>
              <div class="metric-cell">
                <span class="metric-label">Estimated BER</span>
                <strong class="metric-value" id="metric-ber" style="font-size:14px">&lt; 1e−17</strong>
                <span class="metric-hint">Gaussian estimate</span>
              </div>
            </div>
          </section>

          <section class="panel" aria-labelledby="splice-title">
            <div class="panel-heading">
              <div class="panel-heading-copy">
                <span class="eyebrow">Fusion splice microscope</span>
                <h2 class="panel-title" id="splice-title">Alignment & end face</h2>
              </div>
              <span id="splice-method-chip" class="tir-pill">Core tracking</span>
            </div>
            <div class="splice-panel-body">
              <div class="splice-canvas-wrap">
                <canvas id="splice-canvas" aria-label="Magnified overlay of fiber cores, cladding, and end-face contamination"></canvas>
              </div>
              <div class="splice-controls">
                <div class="compact-field-row">
                  <span>Alignment</span>
                  <div class="segmented" role="group" aria-label="Fusion splice alignment method">
                    <button class="seg-button" type="button" data-key="spliceAlignment" data-value="core" aria-pressed="true">Core</button>
                    <button class="seg-button" type="button" data-key="spliceAlignment" data-value="cladding" aria-pressed="false">Cladding</button>
                  </div>
                </div>
                <div class="compact-field-row">
                  <span>End face</span>
                  <div class="segmented" role="group" aria-label="Fiber end-face cleanliness">
                    <button class="seg-button" type="button" data-key="endFace" data-value="clean" aria-pressed="true">Clean</button>
                    <button class="seg-button" type="button" data-key="endFace" data-value="dirty" aria-pressed="false">Dirty</button>
                  </div>
                </div>
                <div class="compact-field-row">
                  <span>Splice quality</span>
                  <input data-range-key="spliceQuality" aria-label="Splice quality" type="range" min="50" max="100" step="1" value="88" />
                </div>
                <div class="compact-field-row" id="contamination-field" hidden>
                  <span>Soiling</span>
                  <input data-range-key="contamination" aria-label="Contamination severity" type="range" min="10" max="100" step="1" value="62" />
                </div>
              </div>
              <div class="splice-stats">
                <div class="splice-stat"><span>Offset</span><strong id="splice-offset">0.22 µm</strong></div>
                <div class="splice-stat"><span>Axis tilt</span><strong id="splice-angle">0.15°</strong></div>
                <div class="splice-stat"><span>Splice IL</span><strong id="splice-loss">0.03 dB</strong></div>
              </div>
            </div>
          </section>

          <section class="panel" aria-labelledby="ledger-title">
            <div class="panel-heading">
              <div class="panel-heading-copy">
                <span class="eyebrow">Distance-ordered events</span>
                <h2 class="panel-title" id="ledger-title">Loss ledger</h2>
              </div>
              <span class="panel-heading-meta" id="ledger-total">Σ 0.00 dB</span>
            </div>
            <ol class="loss-ledger" id="loss-ledger"></ol>
            <ul class="status-list" id="status-list"></ul>
            <details class="model-disclosure">
              <summary>Model boundaries & calibration</summary>
              <div>
                <p>Snell/TIR, silica refractive index, V-number, Rayleigh λ⁻⁴ loss, Gaussian splice overlap, and dispersion are equation-driven.</p>
                <p>Macrobend and dirt loss are estimates: exact results depend on the actual cable, coating, particle geometry, source, and receiver. UV/IR are always false color. Single-mode is rendered as a mode envelope—not a literal geometric ray.</p>
              </div>
            </details>
          </section>
        </aside>
      </main>

      <div class="sr-only" id="a11y-summary" aria-live="polite"></div>
    </div>
  `;
}

function cacheElements() {
  const byId = (id) => document.getElementById(id);
  return {
    fiberCanvas: byId("fiber-canvas"),
    timeCanvas: byId("time-canvas"),
    eyeCanvas: byId("eye-canvas"),
    spliceCanvas: byId("splice-canvas"),
    pauseButton: byId("pause-button"),
    resetButton: byId("reset-button"),
    straightenButton: byId("straighten-button"),
    falseColorPill: byId("false-color-pill"),
    tirPill: byId("tir-pill"),
    contaminationField: byId("contamination-field"),
    lossLedger: byId("loss-ledger"),
    statusList: byId("status-list"),
    a11ySummary: byId("a11y-summary"),
  };
}

function bindControls() {
  document.querySelectorAll("[data-wavelength]").forEach((button) => {
    button.addEventListener("click", () => {
      updateState({ wavelengthNm: Number(button.dataset.wavelength) }, true);
    });
  });

  document.querySelectorAll("[data-key][data-value]").forEach((button) => {
    button.addEventListener("click", () => {
      const numericKeys = new Set(["bitRateGbps"]);
      const value = numericKeys.has(button.dataset.key)
        ? Number(button.dataset.value)
        : button.dataset.value;
      updateState({ [button.dataset.key]: value }, true);
    });
  });

  document.querySelectorAll("[data-range-key]").forEach((input) => {
    input.addEventListener("input", () => {
      updateState({ [input.dataset.rangeKey]: Number(input.value) }, false);
    });
    input.addEventListener("change", () => announceCurrentState());
  });

  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.addEventListener("click", () => applyPreset(button.dataset.preset));
  });

  elements.pauseButton.addEventListener("click", () => {
    if (!paused) frozenPhase = (performance.now() % 4100) / 4100;
    paused = !paused;
    elements.pauseButton.setAttribute("aria-pressed", String(paused));
    elements.pauseButton.setAttribute(
      "aria-label",
      paused ? "Resume photon animation" : "Pause photon animation",
    );
    elements.pauseButton.querySelector(".button-label").textContent = paused ? "Paused" : "Running";
    elements.pauseButton.querySelector(".status-led").style.background = paused ? "#c6a365" : "#6ed6a0";
    elements.pauseButton.querySelector(".status-led").style.boxShadow = paused
      ? "0 0 8px #c6a365"
      : "0 0 8px #6ed6a0";
  });

  elements.resetButton.addEventListener("click", () => applyPreset("default"));
  elements.straightenButton.addEventListener("click", () => {
    bench.resetShape("straight");
    dirty = true;
    announceCurrentState();
  });
}

function handleBenchState(patch) {
  if (patch.relativeLaserAngle) {
    updateState(
      { laserAngleDeg: clamp(state.laserAngleDeg + patch.relativeLaserAngle, -28, 28) },
      false,
    );
    return;
  }
  updateState(patch, false);
}

function updateState(patch, announce) {
  state = { ...state, ...patch };
  state.wave = wavelengthDefinition(state.wavelengthNm);
  document.documentElement.style.setProperty("--active-wave", state.wave.color);
  dirty = true;
  syncControls();
  if (announce) announceCurrentState();
}

function syncControls() {
  document.querySelectorAll("[data-wavelength]").forEach((button) => {
    button.setAttribute("aria-pressed", String(Number(button.dataset.wavelength) === state.wavelengthNm));
  });
  document.querySelectorAll("[data-key][data-value]").forEach((button) => {
    button.setAttribute("aria-pressed", String(String(state[button.dataset.key]) === button.dataset.value));
  });
  document.querySelectorAll("[data-range-key]").forEach((input) => {
    input.value = state[input.dataset.rangeKey];
  });
  elements.contaminationField.hidden = state.endFace !== "dirty";
  setText("input-power-output", `${formatSigned(state.inputPowerDbm, 1)} dBm`);
  setText("fiber-length-output", formatLength(state.fiberLengthKm));
  setText("bitrate-output", `${state.bitRateGbps} Gb/s`);
  setText("wave-band-label", state.wave.visible ? state.wave.band : `${state.wave.band} · false color`);
  setText("profile-equation", state.profile === "graded" ? "n(r) parabolic" : "n₁ → n₂ boundary");
}

function applyPreset(name) {
  const presets = {
    default: {
      ...DEFAULT_STATE,
      emitterYRatio: 0.53,
      shape: "nominal",
    },
    telecom: {
      ...DEFAULT_STATE,
      wavelengthNm: 1550,
      mode: "single",
      profile: "graded",
      fiberLengthKm: 10,
      bitRateGbps: 10,
      spliceAlignment: "core",
      spliceQuality: 96,
      endFace: "clean",
      laserAngleDeg: 0,
      emitterYRatio: 0.53,
      shape: "nominal",
    },
    om3: {
      ...DEFAULT_STATE,
      wavelengthNm: 850,
      mode: "multi",
      profile: "graded",
      fiberLengthKm: 0.3,
      bitRateGbps: 10,
      spliceAlignment: "cladding",
      spliceQuality: 86,
      endFace: "clean",
      laserAngleDeg: 2.5,
      emitterYRatio: 0.53,
      shape: "straight",
    },
    stress: {
      ...DEFAULT_STATE,
      wavelengthNm: 405,
      mode: "multi",
      profile: "step",
      fiberLengthKm: 0.8,
      bitRateGbps: 25,
      inputPowerDbm: -3,
      spliceAlignment: "cladding",
      spliceQuality: 58,
      endFace: "dirty",
      contamination: 82,
      laserAngleDeg: 8.5,
      emitterYRatio: 0.47,
      shape: "stressed",
    },
  };
  const preset = presets[name] ?? presets.default;
  const { shape, ...nextState } = preset;
  state = { ...nextState, wave: wavelengthDefinition(nextState.wavelengthNm) };
  bench.resetShape(shape);
  document.documentElement.style.setProperty("--active-wave", state.wave.color);
  dirty = true;
  syncControls();
  announceCurrentState();
}

function frame(time) {
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const phase = paused || prefersReducedMotion ? frozenPhase : (time % 4100) / 4100;
  const launchGeometry = bench.getLaunchGeometry(state);
  const effectiveState = {
    ...state,
    launchOffsetRatio: launchGeometry.offsetRatio,
    emitterAngleDeg: state.laserAngleDeg,
    laserAngleDeg: launchGeometry.relativeAngleDeg,
    fiberAxisAngleDeg: launchGeometry.axisAngleDeg,
  };
  const link = calculateLink(effectiveState, bench.geometry);
  bench.render(time, state, link, paused || prefersReducedMotion);
  scope.render(link, effectiveState, phase);
  spliceView.render(link, effectiveState, phase);

  if (dirty || time - lastDomUpdate > 120) {
    updateLiveDom(link, effectiveState);
    lastDomUpdate = time;
    dirty = false;
  }
  requestAnimationFrame(frame);
}

function updateLiveDom(link, effectiveState) {
  const geometry = link.geometry;
  const wave = effectiveState.wave;
  const falseColor = !wave.visible;
  setText("bar-wave", `${wave.nm} nm${falseColor ? " · false" : ""}`);
  setText("bar-link", `${effectiveState.mode === "single" ? "SM" : "MM"} · ${effectiveState.profile}`);
  setText("bar-rx", `${formatSigned(link.receivedPowerDbm, 1)} dBm`);
  setText("scope-rate", `${effectiveState.bitRateGbps} Gb/s`);
  setText("wave-band-label", falseColor ? `${wave.band} · false color` : wave.band);
  elements.falseColorPill.hidden = !falseColor;
  elements.falseColorPill.textContent = `${wave.band.replace(" · IR", "")} false color`;

  const tirState = link.launch.isTir && link.bendLossDb < 0.5;
  elements.tirPill.textContent = tirState ? "TIR guided" : link.launch.isTir ? "Bend leakage" : "Refraction escape";
  elements.tirPill.style.borderColor = tirState ? "#315143" : "#643b3b";
  elements.tirPill.style.color = tirState ? "#86d9ad" : "#ff8c82";

  setText(
    "launch-readout",
    `${formatSigned(effectiveState.laserAngleDeg, 1)}° / ±${link.fiber.acceptanceAngleDeg.toFixed(1)}°`,
  );
  setText("critical-readout", `${link.fiber.criticalAngleDeg.toFixed(2)}° from normal`);
  setText(
    "bend-readout",
    Number.isFinite(geometry.minRadiusMm) ? `${geometry.minRadiusMm.toFixed(1)} mm` : "Straight",
  );
  setText(
    "guidance-readout",
    !link.launch.isTir ? "Snell refraction / escape" : link.bendLossDb > 0.5 ? "Macrobend radiation" : "Total internal reflection",
  );
  setText("na-readout", link.fiber.numericalAperture.toFixed(3));
  setText("v-readout", `V = ${link.vNumber.toFixed(2)} · ${formatModes(link)}`);
  setText("spread-readout", formatSpread(link.dispersion.totalNs));
  setText("mode-count-label", formatModes(link));
  setText(
    "mode-note",
    effectiveState.mode === "single"
      ? link.physicallySingleMode
        ? `V ${link.vNumber.toFixed(2)} < 2.405: only the fundamental mode is supported.`
        : `V ${link.vNumber.toFixed(2)} > 2.405: this 8.2 µm core becomes physically few/multi-mode at ${wave.nm} nm.`
      : `${link.modeCount} estimated guided modes; ${effectiveState.profile === "graded" ? "the parabolic index equalizes transit time" : "path-length differences create modal delay"}.`,
  );

  setHtml("metric-power", `${formatSigned(link.receivedPowerDbm, 1)}<small>dBm</small>`);
  setText("metric-power-hint", `${link.amplitudeRatio.toFixed(2)}× field amplitude`);
  setHtml("metric-loss", `${link.totalLossDb.toFixed(2)}<small>dB</small>`);
  setText(
    "metric-loss-hint",
    link.totalLossDb < 1 ? "Low-loss link" : link.totalLossDb < 6 ? "Usable margin" : "Severe attenuation",
  );
  setHtml("metric-eye", `${Math.round(link.eyeOpening * 100)}<small>%</small>`);
  setText("metric-q", `Q ${link.qFactor.toFixed(2)}`);
  setText("metric-ber", formatBer(link.ber));
  setText("rise-readout", `tr ${formatSpread(link.receiverRiseNs)}`);
  setText("eye-readout", `${Math.round(link.eyeOpening * 100)}% open`);
  setText("scope-rate", `${effectiveState.bitRateGbps} Gb/s`);
  const rxKey = document.getElementById("rx-channel-key");
  rxKey.style.setProperty("--channel-color", wave.color);

  setText("splice-method-chip", effectiveState.spliceAlignment === "core" ? "Core tracking" : "Cladding tracking");
  setText("splice-offset", `${link.splice.offsetUm.toFixed(2)} µm`);
  setText("splice-angle", `${link.splice.angleDeg.toFixed(2)}°`);
  setText("splice-loss", `${link.splice.lossDb.toFixed(3)} dB`);
  setText("ledger-total", `Σ ${link.totalLossDb.toFixed(2)} dB`);

  renderLossLedger(link, effectiveState);
  renderStatusList(link, effectiveState);
}

function renderLossLedger(link, effectiveState) {
  const radius = Number.isFinite(link.geometry.minRadiusMm)
    ? `${link.geometry.minRadiusMm.toFixed(1)} mm Rmin · estimated`
    : "No measurable curvature";
  const entries = [
    {
      name: "Launch coupling",
      detail: `${formatSigned(effectiveState.laserAngleDeg, 1)}° · ${Math.abs(effectiveState.launchOffsetRatio).toFixed(2)} core radii`,
      loss: link.launch.lossDb,
      color: link.launch.isTir ? "#55ded2" : "#ff6b5e",
    },
    {
      name: "Distributed silica",
      detail: `${link.attenuation.rayleighDbPerKm.toFixed(3)} dB/km Rayleigh · ${formatLength(effectiveState.fiberLengthKm)}`,
      loss: link.materialLossDb,
      color: effectiveState.wave.color,
    },
    {
      name: "Macrobend",
      detail: radius,
      loss: link.bendLossDb,
      color: link.bendLossDb > 0.5 ? "#ff6b5e" : "#c6a365",
    },
    {
      name: `${effectiveState.spliceAlignment === "core" ? "Core" : "Cladding"}-aligned splice`,
      detail: `${link.splice.offsetUm.toFixed(2)} µm offset · ${link.splice.angleDeg.toFixed(2)}° tilt`,
      loss: link.splice.lossDb,
      color: "#c6a365",
    },
    {
      name: `${effectiveState.endFace === "clean" ? "Clean" : "Dirty"} end face`,
      detail: `${link.endFace.reflectanceDb.toFixed(0)} dB reflectance${effectiveState.endFace === "dirty" ? " · contamination estimate" : ""}`,
      loss: link.endFace.lossDb,
      color: effectiveState.endFace === "dirty" ? "#ff6b5e" : "#6ed6a0",
    },
  ];
  const scale = Math.max(0.25, ...entries.map((entry) => entry.loss));
  elements.lossLedger.innerHTML = entries
    .map(
      (entry, index) => `
        <li class="loss-row" style="--loss-color:${entry.color};--loss-width:${Math.min(100, (entry.loss / scale) * 100)}%">
          <span class="loss-marker">${index + 1}</span>
          <span><span class="loss-name">${entry.name}</span><span class="loss-detail">${entry.detail}</span></span>
          <strong class="loss-value">${entry.loss.toFixed(entry.loss < 0.1 ? 3 : 2)} dB</strong>
        </li>`,
    )
    .join("");
}

function renderStatusList(link, effectiveState) {
  const guidanceTone = link.launch.isTir ? "ok" : "fault";
  const bendTone = link.bendLossDb < 0.1 ? "ok" : link.bendLossDb > 0.5 ? "fault" : "";
  const modeTone = effectiveState.mode === "single" && !link.physicallySingleMode ? "fault" : "ok";
  const rows = [
    [
      "Interface state",
      link.launch.isTir
        ? `TIR margin ${formatSigned(link.launch.tirMarginDeg, 2)}°`
        : link.launch.transmissionAngleDeg == null
          ? "Missed core aperture"
          : `Snell θt ${link.launch.transmissionAngleDeg.toFixed(1)}°`,
      guidanceTone,
    ],
    ["Bend model", link.bendLossDb < 0.025 ? "Below estimated threshold" : `${link.bendLossDb.toFixed(2)} dB radiation`, bendTone],
    ["Supported modes", formatModes(link), modeTone],
    ["Chromatic dispersion", `${link.dispersion.chromaticCoefficientPsNmKm.toFixed(1)} ps/(nm·km)`, ""],
    ["Modal / chromatic spread", `${formatSpread(link.dispersion.modalNs)} / ${formatSpread(link.dispersion.chromaticNs)}`, ""],
  ];
  elements.statusList.innerHTML = rows
    .map(
      ([label, value, tone]) => `
        <li class="status-line" ${tone ? `data-tone="${tone}"` : ""}>
          <span>${label}</span><strong>${value}</strong>
        </li>`,
    )
    .join("");
}

function announceCurrentState(includeSelection = false) {
  window.clearTimeout(announcementTimer);
  announcementTimer = window.setTimeout(() => {
    const launchGeometry = bench.getLaunchGeometry(state);
    const effectiveState = {
      ...state,
      launchOffsetRatio: launchGeometry.offsetRatio,
      laserAngleDeg: launchGeometry.relativeAngleDeg,
    };
    const link = calculateLink(effectiveState, bench.geometry);
    const selection = includeSelection ? ` ${bench.getSelectionDescription(state)}` : "";
    elements.a11ySummary.textContent = `Link updated. Total loss ${link.totalLossDb.toFixed(2)} decibels. Received power ${link.receivedPowerDbm.toFixed(1)} dBm. Eye opening ${Math.round(link.eyeOpening * 100)} percent. Minimum bend radius ${Number.isFinite(link.geometry.minRadiusMm) ? link.geometry.minRadiusMm.toFixed(1) + " millimeters" : "straight"}.${selection}`;
  }, 180);
}

function announceSelection() {
  window.clearTimeout(announcementTimer);
  elements.a11ySummary.textContent = `${bench.getSelectionDescription(state)} Use arrow keys to adjust; hold Shift for a larger step.`;
}

function formatModes(link) {
  if (link.modeCount === 1) return "LP₀₁ only";
  if (link.vNumber < 5) return "few-mode";
  return `≈${link.modeCount} modes`;
}

function formatSpread(valueNs) {
  if (valueNs < 0.001) return `${(valueNs * 1000).toFixed(1)} ps`;
  if (valueNs < 1) return `${valueNs.toFixed(3)} ns`;
  return `${valueNs.toFixed(1)} ns`;
}

function formatLength(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${Number(km).toFixed(km < 10 ? 2 : 1)} km`;
}

function formatSigned(value, places = 1) {
  const numeric = Number(value);
  if (numeric === 0) return numeric.toFixed(places);
  return `${numeric > 0 ? "+" : "−"}${Math.abs(numeric).toFixed(places)}`;
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element && element.textContent !== String(value)) element.textContent = value;
}

function setHtml(id, value) {
  const element = document.getElementById(id);
  if (element && element.innerHTML !== value) element.innerHTML = value;
}
