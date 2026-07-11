import test from "node:test";
import assert from "node:assert/strict";

import {
  bendLoss,
  calculateLink,
  DEFAULT_STATE,
  dispersionModel,
  endFaceModel,
  fiberDefinition,
  launchModel,
  materialAttenuation,
  silicaIndex,
  snellInteraction,
  spliceModel,
  vNumber,
} from "../src/physics.js";
import { pointAtProgress, sampleCatmullRom } from "../src/geometry.js";

test("Catmull-Rom path passes through all control endpoints", () => {
  const points = [
    { x: 10, y: 40 },
    { x: 50, y: 20 },
    { x: 90, y: 70 },
    { x: 140, y: 30 },
    { x: 180, y: 50 },
  ];
  const path = sampleCatmullRom(points, 20);
  assert.deepEqual({ x: path[0].x, y: path[0].y }, points[0]);
  assert.deepEqual({ x: path.at(-1).x, y: path.at(-1).y }, points.at(-1));
  const midpoint = pointAtProgress(path, 0.5);
  assert.ok(midpoint.x > 60 && midpoint.x < 125);
  assert.ok(path[0].totalLength > 170);
});

test("Sellmeier silica index stays in the expected optical range", () => {
  assert.ok(silicaIndex(405) > 1.46 && silicaIndex(405) < 1.48);
  assert.ok(silicaIndex(1550) > 1.43 && silicaIndex(1550) < 1.46);
  assert.ok(silicaIndex(405) > silicaIndex(1550));
});

test("Rayleigh attenuation follows inverse fourth-power wavelength behavior", () => {
  const violet = materialAttenuation(405);
  const telecom = materialAttenuation(1550);
  assert.ok(violet.rayleighDbPerKm > telecom.rayleighDbPerKm * 150);
  assert.ok(telecom.totalDbPerKm > 0.15 && telecom.totalDbPerKm < 0.22);
});

test("8.2 micrometer fiber is single-mode at 1550 nm but not 405 nm", () => {
  assert.ok(vNumber("single", 1550) < 2.405);
  assert.ok(vNumber("single", 405) > 2.405);
});

test("Snell vector math distinguishes refraction from total internal reflection", () => {
  const refracted = snellInteraction({ x: 0.1, y: 0.995 }, { x: 0, y: 1 }, 1.46, 1.0);
  assert.equal(refracted.tir, false);
  assert.ok(refracted.transmitted);
  const grazing = snellInteraction({ x: 0.995, y: 0.1 }, { x: 0, y: 1 }, 1.46, 1.0);
  assert.equal(grazing.tir, true);
  assert.equal(grazing.transmitted, null);
});

test("launch acceptance is decided by the core-cladding Snell boundary", () => {
  const fiber = fiberDefinition("single", 1550);
  const guided = launchModel(
    { ...DEFAULT_STATE, laserAngleDeg: 0, launchOffsetRatio: 0 },
    fiber,
  );
  const escaping = launchModel(
    { ...DEFAULT_STATE, laserAngleDeg: 18, launchOffsetRatio: 0 },
    fiber,
  );
  assert.equal(guided.boundary.tir, true);
  assert.equal(guided.isTir, true);
  assert.equal(escaping.boundary.tir, false);
  assert.ok(escaping.transmissionAngleDeg > escaping.incidenceAngleDeg);
});

test("active core alignment produces less splice loss than cladding alignment", () => {
  const common = { ...DEFAULT_STATE, wavelengthNm: 1550, mode: "single", spliceQuality: 88 };
  const core = spliceModel({ ...common, spliceAlignment: "core" });
  const cladding = spliceModel({ ...common, spliceAlignment: "cladding" });
  assert.ok(core.lossDb < cladding.lossDb);
  assert.ok(core.offsetUm < cladding.offsetUm);
  assert.ok(core.lossDb < 0.1);
});

test("dirty end face causes greater insertion loss and reflectance", () => {
  const clean = endFaceModel({ ...DEFAULT_STATE, endFace: "clean" });
  const dirty = endFaceModel({
    ...DEFAULT_STATE,
    endFace: "dirty",
    contamination: 80,
  });
  assert.ok(dirty.lossDb > clean.lossDb * 10);
  assert.ok(dirty.reflectanceDb > clean.reflectanceDb);
});

test("tighter bends and more turns increase estimated bend loss", () => {
  const gentle = bendLoss("single", 1550, 25, 0.1);
  const tight = bendLoss("single", 1550, 10, 0.25);
  const extraTurn = bendLoss("single", 1550, 10, 0.5);
  assert.ok(tight > gentle);
  assert.ok(extraTurn > tight);
});

test("step-index multimode dispersion exceeds graded-index and single-mode", () => {
  const mmFiber = fiberDefinition("multi", 850);
  const step = dispersionModel(
    { ...DEFAULT_STATE, mode: "multi", profile: "step", wavelengthNm: 850, fiberLengthKm: 1 },
    mmFiber,
  );
  const graded = dispersionModel(
    { ...DEFAULT_STATE, mode: "multi", profile: "graded", wavelengthNm: 850, fiberLengthKm: 1 },
    mmFiber,
  );
  const smFiber = fiberDefinition("single", 1310);
  const single = dispersionModel(
    { ...DEFAULT_STATE, mode: "single", profile: "step", wavelengthNm: 1310, fiberLengthKm: 1 },
    smFiber,
  );
  assert.ok(step.modalNs > graded.modalNs * 10);
  assert.equal(single.modalNs, 0);
});

test("link budget is the sum of every modeled loss mechanism", () => {
  const state = {
    ...DEFAULT_STATE,
    endFace: "dirty",
    contamination: 70,
    spliceAlignment: "cladding",
    launchOffsetRatio: 0.1,
  };
  const link = calculateLink(state, {
    minRadiusMm: 10,
    equivalentTurns: 0.25,
    tightEquivalentTurns: 0.25,
  });
  const expected =
    link.materialLossDb +
    link.bendLossDb +
    link.splice.lossDb +
    link.endFace.lossDb +
    link.launch.lossDb;
  assert.ok(Math.abs(link.totalLossDb - expected) < 1e-10);
  assert.ok(link.receivedPowerDbm < state.inputPowerDbm);
});

test("extreme physical loss is retained instead of being capped below ledger rows", () => {
  const link = calculateLink(
    {
      ...DEFAULT_STATE,
      wavelengthNm: 375,
      fiberLengthKm: 50,
      launchOffsetRatio: 0,
    },
    { minRadiusMm: Infinity },
  );
  assert.ok(link.materialLossDb > 2000);
  assert.ok(link.totalLossDb > 2000);
  assert.ok(link.totalLossDb >= link.materialLossDb);
});
