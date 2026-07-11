import {
  clamp,
  curvatureMetrics,
  distance,
  pointAtProgress,
  sampleCatmullRom,
  triangleWave,
} from "./geometry.js";
import { snellInteraction } from "./physics.js";

const SHAPES = {
  nominal: [
    { x: 0.25, y: 0.53 },
    { x: 0.41, y: 0.53 },
    { x: 0.57, y: 0.55 },
    { x: 0.74, y: 0.39 },
    { x: 0.92, y: 0.53 },
  ],
  straight: [
    { x: 0.25, y: 0.5 },
    { x: 0.42, y: 0.5 },
    { x: 0.58, y: 0.5 },
    { x: 0.75, y: 0.5 },
    { x: 0.92, y: 0.5 },
  ],
  stressed: [
    { x: 0.25, y: 0.52 },
    { x: 0.48, y: 0.2 },
    { x: 0.65, y: 0.68 },
    { x: 0.48, y: 0.78 },
    { x: 0.92, y: 0.51 },
  ],
};

export class FiberBench {
  constructor(canvas, onStateChange, onInteractionEnd, onSelectionChange) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.onStateChange = onStateChange;
    this.onInteractionEnd = onInteractionEnd;
    this.onSelectionChange = onSelectionChange;
    this.normalizedPoints = clonePoints(SHAPES.nominal);
    this.width = 0;
    this.height = 0;
    this.path = [];
    this.geometry = { minRadiusMm: Infinity, bendSeverity: 0, worstIndex: 0 };
    this.drag = null;
    this.selected = { type: "node", index: 2 };
    this.hitRegions = {};
    this.pointer = { x: -1000, y: -1000 };
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.bindEvents();
    this.resize();
  }

  resetShape(name = "nominal") {
    this.normalizedPoints = clonePoints(SHAPES[name] ?? SHAPES.nominal);
    this.selected = { type: "node", index: 2 };
    this.rebuildGeometry();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (
      this.canvas.width !== Math.round(width * dpr) ||
      this.canvas.height !== Math.round(height * dpr)
    ) {
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = width;
    this.height = height;
    this.rebuildGeometry();
  }

  rebuildGeometry() {
    const points = this.normalizedPoints.map((point) => ({
      x: point.x * this.width,
      y: point.y * this.height,
    }));
    this.path = sampleCatmullRom(points, 52);
    this.geometry = curvatureMetrics(this.path, this.width, 600);
  }

  getLaunchOffsetRatio(state) {
    return this.getLaunchGeometry(state).offsetRatio;
  }

  getLaunchGeometry(state) {
    if (!this.path.length) {
      return {
        offsetRatio: 0,
        relativeAngleDeg: Number(state.laserAngleDeg) || 0,
        axisAngleDeg: 0,
        intersection: { x: 0, y: 0 },
      };
    }
    const start = this.path[0];
    const tip = this.emitterTip(state);
    const emitterAngle = (Number(state.laserAngleDeg) * Math.PI) / 180;
    const ray = { x: Math.cos(emitterAngle), y: Math.sin(emitterAngle) };
    const axis = start.tangent;
    const denominator = ray.x * axis.x + ray.y * axis.y;
    const towardEntrance = {
      x: start.x - tip.x,
      y: start.y - tip.y,
    };
    const travel =
      Math.abs(denominator) < 0.001
        ? distance(tip, start)
        : (towardEntrance.x * axis.x + towardEntrance.y * axis.y) / denominator;
    const intersection = {
      x: tip.x + ray.x * travel,
      y: tip.y + ray.y * travel,
    };
    const lateralOffset =
      (intersection.x - start.x) * start.normal.x +
      (intersection.y - start.y) * start.normal.y;
    const visibleCoreRadius = state.mode === "single" ? 5 : 12;
    const axisAngleDeg = (Math.atan2(axis.y, axis.x) * 180) / Math.PI;
    return {
      offsetRatio: lateralOffset / visibleCoreRadius,
      relativeAngleDeg: normalizeAngle(Number(state.laserAngleDeg) - axisAngleDeg),
      axisAngleDeg,
      intersection,
    };
  }

  getSelectionDescription(state) {
    if (this.selected?.type === "node") {
      const point = this.normalizedPoints[this.selected.index];
      return `Control node ${this.selected.index + 1}, x ${Math.round(point.x * 100)} percent, y ${Math.round(point.y * 100)} percent.`;
    }
    return `Laser emitter, vertical position ${Math.round(Number(state.emitterYRatio) * 100)} percent, housing angle ${Number(state.laserAngleDeg).toFixed(1)} degrees.`;
  }

  render(time, state, link, paused = false) {
    if (!this.width || !this.height || !this.path.length) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    this.drawBreadboard(ctx);
    this.drawMountingRail(ctx);
    this.drawAcceptanceCone(ctx, state, link);
    this.drawFiberBody(ctx, state, link);
    this.drawRays(ctx, state, link);
    this.drawScatter(ctx, time, state, link, paused);
    this.drawBendLeak(ctx, time, state, link, paused);
    this.drawPhotonWake(ctx, time, state, link, paused);
    this.drawSpliceFixture(ctx, state, link);
    this.drawEmitter(ctx, state, link);
    this.drawControlNodes(ctx, state, link);
  }

  drawBreadboard(ctx) {
    const gradient = ctx.createRadialGradient(
      this.width * 0.52,
      this.height * 0.46,
      0,
      this.width * 0.52,
      this.height * 0.46,
      Math.max(this.width, this.height) * 0.75,
    );
    gradient.addColorStop(0, "#0d141a");
    gradient.addColorStop(0.62, "#080d12");
    gradient.addColorStop(1, "#05080b");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);

    const spacing = 34;
    ctx.save();
    ctx.globalAlpha = 0.38;
    for (let y = 22; y < this.height; y += spacing) {
      for (let x = 24; x < this.width; x += spacing) {
        ctx.beginPath();
        ctx.arc(x, y, 2.4, 0, Math.PI * 2);
        ctx.fillStyle = "#030608";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x - 0.4, y - 0.4, 1.4, 0, Math.PI * 2);
        ctx.strokeStyle = "#27343c";
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }
    }
    ctx.restore();

    const topSheen = ctx.createLinearGradient(0, 0, 0, 110);
    topSheen.addColorStop(0, "rgba(255,255,255,0.025)");
    topSheen.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = topSheen;
    ctx.fillRect(0, 0, this.width, 110);
  }

  drawMountingRail(ctx) {
    const start = this.path[0];
    const x = Math.max(27, start.x - 190);
    ctx.save();
    const rail = ctx.createLinearGradient(x - 7, 0, x + 7, 0);
    rail.addColorStop(0, "#080b0d");
    rail.addColorStop(0.28, "#293038");
    rail.addColorStop(0.5, "#62686a");
    rail.addColorStop(0.72, "#252b30");
    rail.addColorStop(1, "#080a0c");
    ctx.fillStyle = rail;
    ctx.fillRect(x - 7, 24, 14, this.height - 48);
    ctx.strokeStyle = "rgba(198,163,101,0.34)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 10, 24);
    ctx.lineTo(x + 10, this.height - 24);
    ctx.stroke();
    for (let y = 37; y < this.height - 25; y += 28) {
      ctx.fillStyle = "#080b0d";
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawAcceptanceCone(ctx, state, link) {
    const start = this.path[0];
    const tip = this.emitterTip(state);
    const angle = Math.atan2(start.tangent.y, start.tangent.x);
    const acceptance = (link.fiber.acceptanceAngleDeg * Math.PI) / 180;
    const length = Math.max(80, distance(start, tip) + 35);
    ctx.save();
    ctx.translate(start.x, start.y);
    ctx.rotate(angle);
    const cone = ctx.createLinearGradient(0, 0, -length, 0);
    cone.addColorStop(0, "rgba(198,163,101,0.11)");
    cone.addColorStop(1, "rgba(198,163,101,0)");
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-length, Math.tan(acceptance) * length);
    ctx.lineTo(-length, -Math.tan(acceptance) * length);
    ctx.closePath();
    ctx.fill();
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = "rgba(198,163,101,0.26)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-length, Math.tan(acceptance) * length);
    ctx.moveTo(0, 0);
    ctx.lineTo(-length, -Math.tan(acceptance) * length);
    ctx.stroke();
    ctx.restore();
  }

  drawFiberBody(ctx, state, link) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = 17;
    ctx.shadowOffsetY = 9;
    tracePath(ctx, this.path);
    ctx.strokeStyle = "#030507";
    ctx.lineWidth = 72;
    ctx.stroke();

    ctx.shadowColor = "transparent";
    tracePath(ctx, this.path);
    ctx.strokeStyle = "#111820";
    ctx.lineWidth = 64;
    ctx.stroke();

    tracePath(ctx, this.path);
    const jacketGradient = ctx.createLinearGradient(0, 0, 0, this.height);
    jacketGradient.addColorStop(0, "#26323b");
    jacketGradient.addColorStop(0.47, "#10171d");
    jacketGradient.addColorStop(0.55, "#080d12");
    jacketGradient.addColorStop(1, "#1a232b");
    ctx.strokeStyle = jacketGradient;
    ctx.lineWidth = 56;
    ctx.stroke();

    tracePath(ctx, this.path);
    ctx.strokeStyle = "rgba(103,132,148,0.19)";
    ctx.lineWidth = 40;
    ctx.stroke();

    tracePath(ctx, this.path);
    ctx.strokeStyle = "rgba(196,220,231,0.12)";
    ctx.lineWidth = 30;
    ctx.stroke();

    const coreWidth = state.mode === "single" ? 9 : 22;
    tracePath(ctx, this.path);
    ctx.strokeStyle = "rgba(3,8,11,0.86)";
    ctx.lineWidth = coreWidth + 6;
    ctx.stroke();

    tracePath(ctx, this.path);
    ctx.strokeStyle = hexToRgba(state.wave.color, 0.11 + 0.08 * link.amplitudeRatio);
    ctx.lineWidth = coreWidth;
    ctx.stroke();

    tracePath(ctx, this.path);
    ctx.strokeStyle = "rgba(230,244,249,0.08)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  drawRays(ctx, state, link) {
    const multimode = state.mode === "multi";
    const rayCount = multimode ? 5 : 1;
    const coreRadius = multimode ? 9 : 2.2;
    const acceptedAlpha = clamp(1 - link.launch.lossDb / 18, 0.07, 0.9);
    const bendLeakIndex = link.bendLossDb > 0.04 ? this.geometry.worstIndex : this.path.length;
    const launchLeakIndex = link.launch.isTir ? this.path.length : Math.min(18, this.path.length - 1);
    const stopIndex = Math.min(bendLeakIndex + 3, launchLeakIndex);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (let rayIndex = 0; rayIndex < rayCount; rayIndex += 1) {
      const spread = rayCount === 1 ? 0 : rayIndex / (rayCount - 1) - 0.5;
      const amplitude = multimode ? coreRadius * (0.46 + Math.abs(spread) * 0.95) : 0.8;
      const cycles =
        state.profile === "step"
          ? 1.3 + Math.abs(Number(link.launch.relativeAngleDeg)) * 0.11 + Math.abs(spread) * 3.4
          : 1.1 + Math.abs(spread) * 2.15;
      ctx.beginPath();
      for (let index = 0; index < this.path.length; index += 1) {
        const point = this.path[index];
        const phase = point.progress * cycles + spread * 0.23;
        let offset;
        if (!multimode) {
          offset = Math.sin(point.progress * Math.PI * 2) * amplitude;
        } else if (state.profile === "step") {
          offset = triangleWave(phase) * amplitude;
        } else {
          offset = Math.sin(phase * Math.PI * 2) * amplitude;
        }
        const x = point.x + point.normal.x * offset;
        const y = point.y + point.normal.y * offset;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        if (index >= stopIndex) break;
      }
      ctx.strokeStyle = hexToRgba(
        state.wave.color,
        acceptedAlpha * (multimode ? 0.24 + (1 - Math.abs(spread)) * 0.22 : 0.78),
      );
      ctx.lineWidth = multimode ? 1.2 : 2.2;
      ctx.shadowColor = state.wave.color;
      ctx.shadowBlur = multimode ? 5 : 11;
      ctx.stroke();

      if (state.profile === "step" && multimode && link.launch.isTir) {
        for (let bounce = 1; bounce < 7; bounce += 1) {
          const progress = (bounce + spread * 0.25) / (6.8 + Math.abs(spread));
          const point = pointAtProgress(this.path, progress);
          if (!point) continue;
          const wave = triangleWave(progress * cycles + spread * 0.23);
          if (Math.abs(wave) < 0.72) continue;
          ctx.beginPath();
          ctx.arc(
            point.x + point.normal.x * wave * amplitude,
            point.y + point.normal.y * wave * amplitude,
            1.7,
            0,
            Math.PI * 2,
          );
          ctx.fillStyle = hexToRgba(state.wave.color, 0.6);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  drawScatter(ctx, time, state, link, paused) {
    const distributedLoss = link.materialLossDb;
    const count = Math.round(clamp(4 + distributedLoss * 4.5, 4, 34));
    const motion = paused ? 0.35 : (time % 2400) / 2400;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let index = 0; index < count; index += 1) {
      const progress = 0.04 + hash(index * 13.17 + state.wavelengthNm) * 0.92;
      const point = pointAtProgress(this.path, progress);
      if (!point) continue;
      const sign = hash(index * 4.9) > 0.5 ? 1 : -1;
      const intensity = clamp(0.08 + distributedLoss / 8, 0.08, 0.62);
      const length = 4 + hash(index * 2.31) * (8 + distributedLoss * 1.5);
      const phase = (motion + hash(index * 8.21)) % 1;
      const originX = point.x + point.normal.x * sign * 11;
      const originY = point.y + point.normal.y * sign * 11;
      ctx.strokeStyle = hexToRgba(state.wave.color, intensity * (1 - phase));
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(originX, originY);
      ctx.lineTo(
        originX + point.normal.x * sign * length,
        originY + point.normal.y * sign * length,
      );
      ctx.stroke();
      if (index % 3 === 0) {
        ctx.beginPath();
        ctx.arc(originX, originY, 2 + phase * 8, 0, Math.PI * 2);
        ctx.strokeStyle = hexToRgba(state.wave.color, intensity * 0.35 * (1 - phase));
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawBendLeak(ctx, time, state, link, paused) {
    if (link.bendLossDb <= 0.025 && link.launch.isTir) return;
    const launchFailure = !link.launch.isTir;
    const point = launchFailure
      ? this.path[Math.min(12, this.path.length - 1)]
      : this.path[clamp(this.geometry.worstIndex, 0, this.path.length - 1)];
    if (!point) return;
    const phase = paused ? 0.35 : (time % 1300) / 1300;
    const incidenceAngleDeg = launchFailure
      ? link.launch.incidenceAngleDeg
      : Math.max(
          0,
          link.fiber.criticalAngleDeg - clamp(1 + link.bendLossDb * 1.6, 1, 14),
        );
    const incidenceRadians = (incidenceAngleDeg * Math.PI) / 180;
    const localBoundary = launchFailure
      ? link.launch.boundary
      : snellInteraction(
          { x: Math.sin(incidenceRadians), y: Math.cos(incidenceRadians) },
          { x: 0, y: 1 },
          link.fiber.coreIndex,
          link.fiber.claddingIndex,
        );
    let transmittedWorld;
    if (localBoundary?.transmitted) {
      transmittedWorld = {
        x:
          point.tangent.x * localBoundary.transmitted.x +
          point.normal.x * localBoundary.transmitted.y,
        y:
          point.tangent.y * localBoundary.transmitted.x +
          point.normal.y * localBoundary.transmitted.y,
      };
    } else {
      const emitterRadians = (Number(state.laserAngleDeg) * Math.PI) / 180;
      transmittedWorld = { x: Math.cos(emitterRadians), y: Math.sin(emitterRadians) };
    }
    const baseAngle = Math.atan2(transmittedWorld.y, transmittedWorld.x);
    const fanStrength = clamp((launchFailure ? link.launch.lossDb : link.bendLossDb) / 3, 0.16, 1);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let ray = -3; ray <= 3; ray += 1) {
      const direction = baseAngle + ray * 0.11 + 0.15;
      const length = (32 + Math.abs(ray) * 9 + phase * 15) * fanStrength;
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(point.x + Math.cos(direction) * length, point.y + Math.sin(direction) * length);
      ctx.strokeStyle = hexToRgba(state.wave.color, (0.38 - Math.abs(ray) * 0.045) * fanStrength);
      ctx.lineWidth = ray === 0 ? 1.8 : 0.85;
      ctx.shadowColor = state.wave.color;
      ctx.shadowBlur = 8;
      ctx.stroke();
    }
    ctx.restore();

    if (!launchFailure && Number.isFinite(this.geometry.minRadiusMm)) {
      const labelX = clamp(point.x + point.normal.x * 54, 10, this.width - 118);
      const labelY = clamp(point.y + point.normal.y * 54, 22, this.height - 15);
      ctx.save();
      ctx.strokeStyle = link.bendLossDb > 0.5 ? "#ff6b5e" : "#c6a365";
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(labelX, labelY);
      ctx.stroke();
      ctx.fillStyle = "rgba(5,8,11,0.9)";
      ctx.fillRect(labelX - 3, labelY - 13, 111, 20);
      ctx.fillStyle = link.bendLossDb > 0.5 ? "#ff9288" : "#d9bd83";
      ctx.font = '9px "SFMono-Regular", monospace';
      ctx.fillText(`Rmin ${this.geometry.minRadiusMm.toFixed(1)} mm`, labelX + 4, labelY);
      ctx.restore();
    }
  }

  drawPhotonWake(ctx, time, state, link, paused) {
    const head = paused ? 0.54 : (time % 4100) / 4100;
    const wakeLength = 0.14;
    const coreWidth = state.mode === "single" ? 5 : 13;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (let index = 1; index < this.path.length; index += 1) {
      const point = this.path[index];
      let behind = head - point.progress;
      if (behind < 0) behind += 1;
      if (behind > wakeLength) continue;
      const alpha = (1 - behind / wakeLength) * clamp(0.2 + link.amplitudeRatio, 0.2, 1);
      ctx.beginPath();
      ctx.moveTo(this.path[index - 1].x, this.path[index - 1].y);
      ctx.lineTo(point.x, point.y);
      ctx.strokeStyle = hexToRgba(state.wave.color, alpha * 0.76);
      ctx.lineWidth = coreWidth * (0.55 + alpha * 0.55);
      ctx.shadowColor = state.wave.color;
      ctx.shadowBlur = 11 + alpha * 15;
      ctx.stroke();
    }

    const headPoint = pointAtProgress(this.path, head);
    if (headPoint) {
      ctx.beginPath();
      ctx.arc(headPoint.x, headPoint.y, 2.4 + link.amplitudeRatio * 2.5, 0, Math.PI * 2);
      ctx.fillStyle = hexToRgba(state.wave.color, 0.9);
      ctx.shadowColor = state.wave.color;
      ctx.shadowBlur = 18;
      ctx.fill();
    }
    ctx.restore();
  }

  drawSpliceFixture(ctx, state, link) {
    const point = pointAtProgress(this.path, 0.68);
    if (!point) return;
    const angle = Math.atan2(point.tangent.y, point.tangent.x);
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(angle);
    ctx.shadowColor = "rgba(0,0,0,0.75)";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "#090c0f";
    roundRect(ctx, -29, -35, 58, 70, 5);
    ctx.fill();
    ctx.shadowColor = "transparent";
    const metal = ctx.createLinearGradient(0, -33, 0, 33);
    metal.addColorStop(0, "#4c5459");
    metal.addColorStop(0.15, "#171d21");
    metal.addColorStop(0.48, "#080b0e");
    metal.addColorStop(0.78, "#222a2f");
    metal.addColorStop(1, "#5c6263");
    ctx.fillStyle = metal;
    roundRect(ctx, -25, -31, 50, 62, 4);
    ctx.fill();
    ctx.strokeStyle = "rgba(198,163,101,0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -31);
    ctx.lineTo(0, 31);
    ctx.stroke();
    ctx.fillStyle = state.endFace === "dirty" ? "#ff6b5e" : "#6ed6a0";
    ctx.beginPath();
    ctx.arc(15, -20, 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "rgba(5,8,11,0.88)";
    ctx.fillRect(point.x - 47, point.y + 40, 94, 18);
    ctx.fillStyle = "#8d99a3";
    ctx.font = '8px "SFMono-Regular", monospace';
    ctx.textAlign = "center";
    ctx.fillText(
      `${state.spliceAlignment === "core" ? "CORE" : "CLAD"} SPLICE  ${link.splice.lossDb.toFixed(2)} dB`,
      point.x,
      point.y + 52,
    );
    ctx.restore();
  }

  drawEmitter(ctx, state, link) {
    const tip = this.emitterTip(state);
    const start = this.path[0];
    const angle = (Number(state.laserAngleDeg) * Math.PI) / 180;
    const launchGeometry = this.getLaunchGeometry(state);
    const beamEnd = launchGeometry.intersection;
    const pivot = {
      x: tip.x + Math.cos(angle) * 67,
      y: tip.y + Math.sin(angle) * 67,
    };
    this.hitRegions.emitterTip = tip;
    this.hitRegions.pivot = pivot;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(beamEnd.x, beamEnd.y);
    ctx.strokeStyle = hexToRgba(state.wave.color, clamp(0.25 + 1 - link.launch.lossDb / 14, 0.12, 0.92));
    ctx.lineWidth = 2;
    ctx.shadowColor = state.wave.color;
    ctx.shadowBlur = 13;
    ctx.stroke();
    ctx.restore();

    if (distance(beamEnd, start) > 3) {
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = "rgba(255,107,94,0.58)";
      ctx.beginPath();
      ctx.moveTo(beamEnd.x, beamEnd.y);
      ctx.lineTo(start.x, start.y);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(tip.x, tip.y);
    ctx.rotate(angle);
    const housingScaleX = clamp((tip.x - 4) / 101, 0.56, 1);
    ctx.scale(housingScaleX, 1);
    ctx.shadowColor = "rgba(0,0,0,0.72)";
    ctx.shadowBlur = 13;
    ctx.shadowOffsetY = 5;
    const body = ctx.createLinearGradient(0, -19, 0, 19);
    body.addColorStop(0, "#70787b");
    body.addColorStop(0.16, "#242a2e");
    body.addColorStop(0.53, "#090c0f");
    body.addColorStop(0.8, "#343b3e");
    body.addColorStop(1, "#808586");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-91, -17);
    ctx.lineTo(-14, -17);
    ctx.lineTo(-5, -10);
    ctx.lineTo(-5, 10);
    ctx.lineTo(-14, 17);
    ctx.lineTo(-91, 17);
    ctx.lineTo(-101, 10);
    ctx.lineTo(-101, -10);
    ctx.closePath();
    ctx.fill();
    ctx.shadowColor = "transparent";

    const brass = ctx.createLinearGradient(-16, -12, 1, 12);
    brass.addColorStop(0, "#806631");
    brass.addColorStop(0.28, "#f0d493");
    brass.addColorStop(0.62, "#ae8846");
    brass.addColorStop(1, "#614b25");
    ctx.fillStyle = brass;
    ctx.beginPath();
    ctx.moveTo(-18, -12);
    ctx.lineTo(-2, -7);
    ctx.lineTo(3, 0);
    ctx.lineTo(-2, 7);
    ctx.lineTo(-18, 12);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 0.8;
    for (let x = -83; x < -25; x += 9) {
      ctx.beginPath();
      ctx.moveTo(x, -15);
      ctx.lineTo(x + 4, 15);
      ctx.stroke();
    }

    ctx.fillStyle = "#07090b";
    ctx.font = '7px "SFMono-Regular", monospace';
    ctx.textAlign = "center";
    ctx.fillText("LASER · CLASS 1", -54, 2.5);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(198,163,101,0.38)";
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 67, -0.55, 0.55);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(pivot.x, pivot.y);
    ctx.strokeStyle = "rgba(198,163,101,0.5)";
    ctx.lineWidth = 1;
    ctx.stroke();
    const knob = ctx.createRadialGradient(pivot.x - 2, pivot.y - 2, 0, pivot.x, pivot.y, 9);
    knob.addColorStop(0, "#f5dda4");
    knob.addColorStop(0.42, "#bd9550");
    knob.addColorStop(1, "#4b371c");
    ctx.fillStyle = knob;
    ctx.beginPath();
    ctx.arc(pivot.x, pivot.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#f0d28f";
    ctx.stroke();
    ctx.fillStyle = "#a88c5d";
    ctx.font = '7px "SFMono-Regular", monospace';
    ctx.textAlign = "center";
    ctx.fillText("PIVOT", pivot.x, pivot.y - 14);
    ctx.restore();
  }

  drawControlNodes(ctx, state, link) {
    const points = this.normalizedPoints.map((point) => ({
      x: point.x * this.width,
      y: point.y * this.height,
    }));
    this.hitRegions.nodes = points;
    ctx.save();
    points.forEach((point, index) => {
      const selected = this.selected?.type === "node" && this.selected.index === index;
      const hovered = distance(point, this.pointer) < 25;
      if (selected || hovered) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 17, 0, Math.PI * 2);
        ctx.strokeStyle = selected ? "rgba(227,195,125,0.5)" : "rgba(198,163,101,0.28)";
        ctx.setLineDash([2, 3]);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      const gradient = ctx.createRadialGradient(point.x - 2, point.y - 2, 1, point.x, point.y, 8);
      gradient.addColorStop(0, selected ? "#f5dda0" : "#c8d0d4");
      gradient.addColorStop(0.38, selected ? "#b38a47" : "#69757c");
      gradient.addColorStop(1, "#11171b");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(point.x, point.y, selected ? 8 : 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = selected ? "#f0cf88" : "#859198";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = selected ? "#fff4d7" : "#c3ccd1";
      ctx.font = '7px "SFMono-Regular", monospace';
      ctx.textAlign = "center";
      ctx.fillText(String(index + 1), point.x, point.y + 2.4);
    });
    ctx.restore();
  }

  emitterTip(state) {
    const start = this.path[0] ?? { x: this.width * 0.16, y: this.height * 0.5 };
    return {
      x: Math.min(start.x - 28, Math.max(104, start.x - 102)),
      y: Number(state.emitterYRatio ?? start.y / this.height) * this.height,
    };
  }

  bindEvents() {
    this.canvas.addEventListener("pointerdown", (event) => this.pointerDown(event));
    this.canvas.addEventListener("pointermove", (event) => this.pointerMove(event));
    this.canvas.addEventListener("pointerup", (event) => this.pointerUp(event));
    this.canvas.addEventListener("pointercancel", (event) => this.pointerUp(event));
    this.canvas.addEventListener("keydown", (event) => this.keyDown(event));
  }

  eventPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  pointerDown(event) {
    const point = this.eventPoint(event);
    this.pointer = point;
    const nodeIndex = (this.hitRegions.nodes ?? []).findIndex((node) => distance(node, point) <= 24);
    if (nodeIndex >= 0) {
      this.drag = { type: "node", index: nodeIndex };
      this.selected = { type: "node", index: nodeIndex };
    } else if (this.hitRegions.pivot && distance(this.hitRegions.pivot, point) <= 25) {
      this.drag = { type: "pivot" };
      this.selected = { type: "emitter" };
    } else if (this.isEmitterHit(point)) {
      this.drag = { type: "emitter" };
      this.selected = { type: "emitter" };
    }
    if (this.drag) {
      this.onSelectionChange?.(this.selected);
      this.canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
    }
  }

  pointerMove(event) {
    const point = this.eventPoint(event);
    this.pointer = point;
    if (!this.drag) {
      const nodeHover = (this.hitRegions.nodes ?? []).some((node) => distance(node, point) <= 24);
      const pivotHover = this.hitRegions.pivot && distance(this.hitRegions.pivot, point) <= 25;
      this.canvas.style.cursor = nodeHover || pivotHover || this.isEmitterHit(point) ? "grab" : "default";
      return;
    }

    this.canvas.style.cursor = "grabbing";
    if (this.drag.type === "node") {
      this.normalizedPoints[this.drag.index] = {
        x: clamp(point.x / this.width, 0.07, 0.94),
        y: clamp(point.y / this.height, 0.09, 0.91),
      };
      this.rebuildGeometry();
    } else if (this.drag.type === "emitter") {
      this.onStateChange({ emitterYRatio: clamp(point.y / this.height, 0.09, 0.91) });
    } else if (this.drag.type === "pivot") {
      const tip = this.hitRegions.emitterTip;
      const angle = (Math.atan2(point.y - tip.y, point.x - tip.x) * 180) / Math.PI;
      this.onStateChange({ laserAngleDeg: clamp(angle, -28, 28) });
    }
  }

  pointerUp(event) {
    if (this.drag && this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    if (this.drag) this.onInteractionEnd?.();
    this.drag = null;
    this.canvas.style.cursor = "default";
  }

  isEmitterHit(point) {
    const tip = this.hitRegions.emitterTip;
    if (!tip) return false;
    return point.x >= tip.x - 113 && point.x <= tip.x + 8 && Math.abs(point.y - tip.y) <= 34;
  }

  keyDown(event) {
    if (/^[1-5]$/.test(event.key)) {
      this.selected = { type: "node", index: Number(event.key) - 1 };
      this.onSelectionChange?.(this.selected);
      event.preventDefault();
      return;
    }
    if (event.key.toLowerCase() === "e") {
      this.selected = { type: "emitter" };
      this.onSelectionChange?.(this.selected);
      event.preventDefault();
      return;
    }
    if (!event.key.startsWith("Arrow")) return;
    const pixels = event.shiftKey ? 10 : 2;
    if (this.selected?.type === "node") {
      const point = this.normalizedPoints[this.selected.index];
      const dx = event.key === "ArrowLeft" ? -pixels : event.key === "ArrowRight" ? pixels : 0;
      const dy = event.key === "ArrowUp" ? -pixels : event.key === "ArrowDown" ? pixels : 0;
      point.x = clamp(point.x + dx / this.width, 0.07, 0.94);
      point.y = clamp(point.y + dy / this.height, 0.09, 0.91);
      this.rebuildGeometry();
      this.onInteractionEnd?.();
    } else if (this.selected?.type === "emitter") {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const direction = event.key === "ArrowUp" ? -1 : 1;
        const current = this.hitRegions.emitterTip?.y / this.height || 0.5;
        this.onStateChange({ emitterYRatio: clamp(current + (direction * pixels) / this.height, 0.09, 0.91) });
      } else {
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        this.onStateChange({ relativeLaserAngle: direction * (event.shiftKey ? 2 : 0.25) });
      }
      this.onInteractionEnd?.();
    }
    event.preventDefault();
  }
}

function clonePoints(points) {
  return points.map((point) => ({ ...point }));
}

function tracePath(ctx, path) {
  ctx.beginPath();
  path.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
}

function hash(seed) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const integer = Number.parseInt(value, 16);
  const red = (integer >> 16) & 255;
  const green = (integer >> 8) & 255;
  const blue = integer & 255;
  return `rgba(${red},${green},${blue},${clamp(alpha, 0, 1)})`;
}

function normalizeAngle(angle) {
  let normalized = ((angle + 180) % 360 + 360) % 360 - 180;
  if (normalized === -180) normalized = 180;
  return normalized;
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}
