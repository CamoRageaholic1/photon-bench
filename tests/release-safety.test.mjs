import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { FIBER_SHAPES, SIMULATION_PRESETS } from "../src/config.js";
import { FiberBench } from "../src/fiber-bench.js";
import { sampleCatmullRom } from "../src/geometry.js";
import { fiberDefinition, launchModel } from "../src/physics.js";
import { resolveBuildOutput } from "../scripts/build-paths.mjs";

function presetLaunchGeometry(preset, width, height) {
  const bench = Object.create(FiberBench.prototype);
  bench.width = width;
  bench.height = height;
  bench.path = sampleCatmullRom(
    FIBER_SHAPES[preset.shape].map((point) => ({
      x: point.x * width,
      y: point.y * height,
    })),
    52,
  );
  return bench.getLaunchGeometry(preset);
}

test("clean baseline presets launch coaxially on desktop and mobile benches", () => {
  for (const presetName of ["default", "telecom", "om3"]) {
    const preset = SIMULATION_PRESETS[presetName];
    for (const [width, height] of [[964, 390], [378, 420]]) {
      const geometry = presetLaunchGeometry(preset, width, height);
      const launch = launchModel(
        {
          ...preset,
          laserAngleDeg: geometry.relativeAngleDeg,
          launchOffsetRatio: geometry.offsetRatio,
        },
        fiberDefinition(preset.mode, preset.wavelengthNm),
      );
      assert.ok(Math.abs(geometry.relativeAngleDeg) < 0.2, `${presetName} angle`);
      assert.ok(Math.abs(geometry.offsetRatio) < 0.01, `${presetName} offset`);
      assert.ok(launch.lossDb < 0.01, `${presetName} launch loss`);
      assert.equal(launch.isTir, true, `${presetName} total internal reflection`);
    }
  }
});

test("build output resolver rejects destructive destinations", () => {
  const projectRoot = resolve("/workspace/photon-bench");
  assert.equal(resolveBuildOutput(projectRoot), resolve(projectRoot, "dist"));
  assert.equal(
    resolveBuildOutput(projectRoot, resolve(tmpdir(), "photon-bench-release-test")),
    resolve(tmpdir(), "photon-bench-release-test"),
  );
  assert.throws(() => resolveBuildOutput(projectRoot, projectRoot), /Unsafe BUILD_DIR/);
  assert.throws(() => resolveBuildOutput(projectRoot, resolve(projectRoot, "src")), /Unsafe BUILD_DIR/);
  assert.throws(() => resolveBuildOutput(projectRoot, tmpdir()), /Unsafe BUILD_DIR/);
  assert.throws(
    () => resolveBuildOutput(projectRoot, resolve(tmpdir(), "unrelated-output")),
    /Unsafe BUILD_DIR/,
  );
});
