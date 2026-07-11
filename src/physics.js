import { clamp } from "./geometry.js";

export const WAVELENGTHS = [
  { nm: 375, name: "UV", band: "Ultraviolet", color: "#9a63ff", visible: false },
  { nm: 405, name: "405", band: "Violet", color: "#816bff", visible: true },
  { nm: 532, name: "532", band: "Green", color: "#57f08d", visible: true },
  { nm: 650, name: "650", band: "Red", color: "#ff5e57", visible: true },
  { nm: 850, name: "850", band: "Near IR", color: "#ff3e43", visible: false },
  { nm: 1310, name: "1310", band: "O band · IR", color: "#e83136", visible: false },
  { nm: 1490, name: "1490", band: "S band · IR", color: "#c91f2a", visible: false },
  { nm: 1550, name: "1550", band: "C band · IR", color: "#ad1826", visible: false },
  { nm: 1625, name: "1625", band: "L band · IR", color: "#891523", visible: false },
];

export const DEFAULT_STATE = Object.freeze({
  wavelengthNm: 1550,
  profile: "graded",
  mode: "single",
  fiberLengthKm: 2,
  bitRateGbps: 10,
  inputPowerDbm: -3,
  laserAngleDeg: 0,
  launchOffsetRatio: 0,
  spliceAlignment: "core",
  spliceQuality: 88,
  endFace: "clean",
  contamination: 62,
});

export function wavelengthDefinition(wavelengthNm) {
  return WAVELENGTHS.find((entry) => entry.nm === Number(wavelengthNm)) ?? WAVELENGTHS[6];
}

/** Malitson fused-silica Sellmeier equation; wavelength is expressed in nm. */
export function silicaIndex(wavelengthNm) {
  const lambda = wavelengthNm / 1000;
  const lambdaSquared = lambda * lambda;
  const terms = [
    [0.6961663, 0.0684043 ** 2],
    [0.4079426, 0.1162414 ** 2],
    [0.8974794, 9.896161 ** 2],
  ];
  const nSquared =
    1 +
    terms.reduce(
      (sum, [coefficient, resonance]) =>
        sum + (coefficient * lambdaSquared) / (lambdaSquared - resonance),
      0,
    );
  return Math.sqrt(Math.max(1, nSquared));
}

export function fiberDefinition(mode, wavelengthNm) {
  const isSingle = mode === "single";
  const numericalAperture = isSingle ? 0.12 : 0.2;
  const claddingIndex = silicaIndex(wavelengthNm);
  const coreIndex = Math.sqrt(claddingIndex ** 2 + numericalAperture ** 2);
  return {
    coreDiameterUm: isSingle ? 8.2 : 50,
    claddingDiameterUm: 125,
    numericalAperture,
    coreIndex,
    claddingIndex,
    acceptanceAngleDeg: toDegrees(Math.asin(numericalAperture)),
    criticalAngleDeg: toDegrees(Math.asin(claddingIndex / coreIndex)),
    recommendedBendRadiusMm: isSingle ? 30 : 20,
  };
}

export function vNumber(mode, wavelengthNm) {
  const fiber = fiberDefinition(mode, wavelengthNm);
  const radiusUm = fiber.coreDiameterUm / 2;
  return (2 * Math.PI * radiusUm * fiber.numericalAperture) / (wavelengthNm / 1000);
}

export function estimatedModeCount(mode, profile, wavelengthNm) {
  const v = vNumber(mode, wavelengthNm);
  if (v < 2.405) return 1;
  return Math.max(2, Math.round(v ** 2 / (profile === "graded" ? 4 : 2)));
}

export function materialAttenuation(wavelengthNm) {
  const wavelengthUm = wavelengthNm / 1000;
  const rayleighDbPerKm = 0.8 / wavelengthUm ** 4;
  const ultravioletTail = 2.2 * Math.max(0, (450 - wavelengthNm) / 75) ** 2;
  const waterPeak = 0.26 * Math.exp(-0.5 * ((wavelengthNm - 1383) / 28) ** 2);
  const infraredTail = 0.018 * Math.exp(Math.max(0, wavelengthNm - 1550) / 70);
  const residualAbsorption = 0.025 + ultravioletTail + waterPeak + infraredTail;
  return {
    rayleighDbPerKm,
    absorptionDbPerKm: residualAbsorption,
    totalDbPerKm: rayleighDbPerKm + residualAbsorption,
  };
}

export function bendLoss(mode, wavelengthNm, minRadiusMm, equivalentTightTurns = 0.25) {
  if (!Number.isFinite(minRadiusMm) || minRadiusMm >= 30) return 0;
  const anchors =
    mode === "single"
      ? [
          [10, 0.5],
          [15, 0.005],
          [30, 0.0001],
        ]
      : wavelengthNm <= 1000
        ? [
            [7.5, 0.1],
            [15, 0.05],
            [20, 0.005],
            [30, 0.0001],
          ]
        : [
            [7.5, 0.25],
            [15, 0.15],
            [20, 0.02],
            [30, 0.001],
          ];
  let perTurn = logInterpolateAnchors(anchors, Math.max(1.5, minRadiusMm));
  if (mode === "single") perTurn *= clamp((wavelengthNm / 1550) ** 8, 0.01, 3.2);
  // A detected local macrobend occupies at least a quarter-turn in the teaching
  // model; the integrated spline turn then adds route-specific exposure.
  const turns = 0.25 + 0.15 * Math.max(0, Number(equivalentTightTurns) || 0);
  return clamp(perTurn * turns, 0, 18);
}

export function spliceModel(state) {
  const quality = clamp(Number(state.spliceQuality) / 100, 0, 1);
  const coreAligned = state.spliceAlignment === "core";
  const methodOffset = coreAligned ? 0.05 : 0.3;
  const methodAngle = coreAligned ? 0.05 : 0.1;
  const offsetUm = methodOffset + (1 - quality) * (coreAligned ? 0.45 : 0.9);
  const angleDeg = methodAngle + (1 - quality) * (coreAligned ? 0.35 : 0.75);
  const baseLoss = 0.005;
  const fiber = fiberDefinition(state.mode, state.wavelengthNm);
  let offsetLoss;

  if (state.mode === "single") {
    const modeFieldDiameterUm = clamp(9.2 + (state.wavelengthNm - 1310) * 0.005, 4.2, 10.8);
    const modeRadius = modeFieldDiameterUm / 2;
    offsetLoss = -10 * Math.log10(Math.exp(-((offsetUm / modeRadius) ** 2)));
  } else {
    const radius = fiber.coreDiameterUm / 2;
    const normalizedOffset = clamp(offsetUm / (2 * radius), 0, 0.999);
    const overlap =
      (2 / Math.PI) *
      (Math.acos(normalizedOffset) -
        normalizedOffset * Math.sqrt(1 - normalizedOffset ** 2));
    offsetLoss = -10 * Math.log10(Math.max(0.001, overlap));
  }

  const wavelengthUm = state.wavelengthNm / 1000;
  const modeRadius =
    state.mode === "single"
      ? clamp(9.2 + (state.wavelengthNm - 1310) * 0.005, 4.2, 10.8) / 2
      : fiber.coreDiameterUm / 2;
  const angleRadians = toRadians(angleDeg);
  const angularEfficiency =
    state.mode === "single"
      ? Math.exp(
          -(
            ((Math.PI * modeRadius) / wavelengthUm) ** 2 *
            Math.sin(angleRadians) ** 2
          ),
        )
      : clamp(1 - Math.abs(angleDeg) / fiber.acceptanceAngleDeg, 0.001, 1);
  const angularLoss = -10 * Math.log10(Math.max(0.0001, angularEfficiency));
  const lossDb = clamp(baseLoss + offsetLoss + angularLoss, 0, 6);

  return { lossDb, offsetUm, angleDeg, baseLoss, offsetLoss, angularLoss };
}

export function endFaceModel(state) {
  if (state.endFace === "clean") {
    return { lossDb: 0.02, reflectanceDb: -48, coverage: 0.003 };
  }
  const severity = clamp(Number(state.contamination) / 100, 0, 1);
  const wavelengthFactor = clamp((850 / state.wavelengthNm) ** 0.38, 0.72, 1.45);
  const lossDb = 0.18 + 2.35 * severity ** 1.55 * wavelengthFactor;
  return {
    lossDb,
    reflectanceDb: -31 + 14 * severity,
    coverage: 0.025 + 0.24 * severity,
  };
}

export function dispersionModel(state, fiber) {
  const lengthKm = Number(state.fiberLengthKm);
  const delta = (fiber.coreIndex - fiber.claddingIndex) / fiber.coreIndex;
  const lightSpeed = 299_792_458;
  let modalNs = 0;
  if (state.mode === "multi") {
    const lengthMeters = lengthKm * 1000;
    modalNs =
      state.profile === "graded"
        ? 0.06625 * lengthKm
        : ((fiber.coreIndex * delta * lengthMeters) / lightSpeed) * 1e9;
  }

  const lambda = state.wavelengthNm;
  const zeroDispersionNm = 1310;
  const zeroDispersionSlope = 0.086;
  const chromaticCoefficientPsNmKm =
    (zeroDispersionSlope / 4) * (lambda - zeroDispersionNm ** 4 / lambda ** 3);
  const sourceLinewidthNm = lambda < 850 ? 1.1 : state.mode === "single" ? 0.18 : 1.8;
  const chromaticNs =
    (Math.abs(chromaticCoefficientPsNmKm) * sourceLinewidthNm * lengthKm) / 1000;
  const totalNs = Math.hypot(modalNs, chromaticNs);

  return {
    modalNs,
    chromaticNs,
    totalNs,
    chromaticCoefficientPsNmKm,
    sourceLinewidthNm,
  };
}

export function launchModel(state, fiber) {
  const relativeAngleDeg = Number(state.laserAngleDeg);
  const angle = Math.abs(relativeAngleDeg);
  const offset = Math.abs(Number(state.launchOffsetRatio || 0));
  const angularExcess = Math.max(0, angle - fiber.acceptanceAngleDeg);
  const angularLoss = angularExcess
    ? 0.8 + 10 * (angularExcess / fiber.acceptanceAngleDeg) ** 1.7
    : 0.04 * (angle / Math.max(0.1, fiber.acceptanceAngleDeg)) ** 2;
  const offsetLoss = offset <= 0.22 ? 0.04 * (offset / 0.22) ** 2 : 0.15 + 8 * (offset - 0.22) ** 1.65;
  const internalAngleDeg = toDegrees(
    Math.asin(clamp(Math.sin(toRadians(Math.min(angle, 89))) / fiber.coreIndex, -1, 1)),
  );
  const incidenceAngleDeg = 90 - internalAngleDeg;
  const incidenceRadians = toRadians(incidenceAngleDeg);
  const boundary = snellInteraction(
    { x: Math.sin(incidenceRadians), y: Math.cos(incidenceRadians) },
    { x: 0, y: 1 },
    fiber.coreIndex,
    fiber.claddingIndex,
  );
  const transmissionAngleDeg = boundary.transmitted
    ? toDegrees(Math.acos(clamp(boundary.transmitted.y, -1, 1)))
    : null;
  return {
    lossDb: clamp(angularLoss + offsetLoss, 0, 30),
    angularLossDb: angularLoss,
    offsetLossDb: offsetLoss,
    incidenceAngleDeg,
    tirMarginDeg: incidenceAngleDeg - fiber.criticalAngleDeg,
    relativeAngleDeg,
    transmissionAngleDeg,
    boundary,
    isTir: boundary.tir && offset < 0.95,
  };
}

export function calculateLink(state, geometry = {}) {
  const fiber = fiberDefinition(state.mode, state.wavelengthNm);
  const attenuation = materialAttenuation(state.wavelengthNm);
  const materialLossDb = attenuation.totalDbPerKm * Number(state.fiberLengthKm);
  const bendLossDb = bendLoss(
    state.mode,
    state.wavelengthNm,
    geometry.minRadiusMm ?? Infinity,
    geometry.tightEquivalentTurns ?? geometry.equivalentTurns ?? 0,
  );
  const splice = spliceModel(state);
  const endFace = endFaceModel(state);
  const launch = launchModel(state, fiber);
  const dispersion = dispersionModel(state, fiber);
  const totalLossDb = Math.max(
    0,
    materialLossDb + bendLossDb + splice.lossDb + endFace.lossDb + launch.lossDb,
  );
  const receivedPowerDbm = Number(state.inputPowerDbm) - totalLossDb;
  const amplitudeRatio = 10 ** (-totalLossDb / 20);
  const bitPeriodNs = 1 / Number(state.bitRateGbps);
  const transmitterRiseNs = 0.35 / Math.max(1, Number(state.bitRateGbps));
  const receiverRiseNs = Math.hypot(transmitterRiseNs, dispersion.totalNs);
  const dispersionPenalty = Math.exp(-1.8 * (dispersion.totalNs / Math.max(bitPeriodNs, 0.001)) ** 1.2);
  const powerPenalty = clamp(1 - Math.max(0, totalLossDb - 3) / 32, 0, 1);
  const eyeOpening = clamp(dispersionPenalty * powerPenalty, 0, 1);
  const qFactor = clamp(0.65 + eyeOpening * 7.2 - Math.max(0, -receivedPowerDbm - 24) * 0.12, 0.05, 8);
  const ber = clamp(0.5 * erfc(qFactor / Math.SQRT2), 1e-18, 0.5);
  const v = vNumber(state.mode, state.wavelengthNm);

  return {
    fiber,
    attenuation,
    materialLossDb,
    bendLossDb,
    splice,
    endFace,
    launch,
    dispersion,
    totalLossDb,
    receivedPowerDbm,
    amplitudeRatio,
    bitPeriodNs,
    transmitterRiseNs,
    receiverRiseNs,
    eyeOpening,
    qFactor,
    ber,
    vNumber: v,
    modeCount: estimatedModeCount(state.mode, state.profile, state.wavelengthNm),
    physicallySingleMode: v < 2.405,
    geometry,
  };
}

export function formatBer(value) {
  if (value <= 1e-17) return "< 1e−17";
  return value.toExponential(1).replace("e-", "e−");
}

export function toDegrees(radians) {
  return (radians * 180) / Math.PI;
}

export function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

/** Vector Snell interaction. The normal points from medium 1 toward medium 2. */
export function snellInteraction(incident, normal, n1, n2) {
  const incidentLength = Math.hypot(incident.x, incident.y) || 1;
  const normalLength = Math.hypot(normal.x, normal.y) || 1;
  const i = { x: incident.x / incidentLength, y: incident.y / incidentLength };
  let n = { x: normal.x / normalLength, y: normal.y / normalLength };
  let cosine = i.x * n.x + i.y * n.y;
  if (cosine < 0) {
    n = { x: -n.x, y: -n.y };
    cosine = -cosine;
  }
  const ratio = n1 / n2;
  const discriminant = 1 - ratio ** 2 * (1 - cosine ** 2);
  const reflected = {
    x: i.x - 2 * cosine * n.x,
    y: i.y - 2 * cosine * n.y,
  };
  if (discriminant < 0) return { tir: true, reflected, transmitted: null };
  const tangent = { x: i.x - cosine * n.x, y: i.y - cosine * n.y };
  const transmitted = {
    x: ratio * tangent.x + Math.sqrt(discriminant) * n.x,
    y: ratio * tangent.y + Math.sqrt(discriminant) * n.y,
  };
  return { tir: false, reflected, transmitted };
}

function logInterpolateAnchors(anchors, radiusMm) {
  if (radiusMm <= anchors[0][0]) {
    return Math.min(50, anchors[0][1] * Math.exp((anchors[0][0] - radiusMm) * 0.62));
  }
  for (let index = 1; index < anchors.length; index += 1) {
    const [rightRadius, rightLoss] = anchors[index];
    const [leftRadius, leftLoss] = anchors[index - 1];
    if (radiusMm <= rightRadius) {
      const amount = (radiusMm - leftRadius) / (rightRadius - leftRadius);
      return Math.exp(Math.log(leftLoss) + (Math.log(rightLoss) - Math.log(leftLoss)) * amount);
    }
  }
  return anchors.at(-1)[1] * Math.exp(-(radiusMm - anchors.at(-1)[0]) * 0.3);
}

function erfc(value) {
  const z = Math.abs(value);
  const t = 1 / (1 + 0.5 * z);
  const coefficients = [
    0.17087277,
    -0.82215223,
    1.48851587,
    -1.13520398,
    0.27886807,
    -0.18628806,
    0.09678418,
    0.37409196,
    1.00002368,
  ];
  let polynomial = coefficients[0];
  for (let index = 1; index < coefficients.length; index += 1) {
    polynomial = coefficients[index] + t * polynomial;
  }
  const result = t * Math.exp(-z * z - 1.26551223 + t * polynomial);
  return value >= 0 ? result : 2 - result;
}
