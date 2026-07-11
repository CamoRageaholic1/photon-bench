import { clamp } from "./geometry.js";

export class SpliceView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  }

  render(link, state, phase = 0) {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) {
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, width, height);
    if (width <= 1 || height <= 1) return;
    this.draw(width, height, link, state, phase);
  }

  draw(width, height, link, state, phase) {
    const ctx = this.ctx;
    const cx = width * 0.5;
    const cy = height * 0.47;
    const radius = Math.min(width * 0.28, height * 0.38, 66);
    const coreRadius = state.mode === "single" ? radius * 0.075 : radius * 0.4;
    const coreAligned = state.spliceAlignment === "core";
    const exaggeratedOffset = clamp(link.splice.offsetUm * (state.mode === "single" ? 10 : 3), 0.8, 13);
    const residualCoreOffset = coreAligned ? clamp(exaggeratedOffset * 0.18, 0.35, 1.4) : exaggeratedOffset;
    const fiberA = coreAligned
      ? {
          cladding: { x: cx - 2.1, y: cy },
          core: { x: cx - residualCoreOffset / 2, y: cy },
        }
      : {
          cladding: { x: cx - 0.3, y: cy },
          core: { x: cx - 0.3, y: cy - residualCoreOffset / 2 },
        };
    const fiberB = coreAligned
      ? {
          cladding: { x: cx + 2.1, y: cy },
          core: { x: cx + residualCoreOffset / 2, y: cy },
        }
      : {
          cladding: { x: cx + 0.3, y: cy },
          core: { x: cx + 0.3, y: cy + residualCoreOffset / 2 },
        };

    const background = ctx.createRadialGradient(cx, cy, 0, cx, cy, width * 0.7);
    background.addColorStop(0, "#111a20");
    background.addColorStop(0.58, "#080d12");
    background.addColorStop(1, "#030609");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.025)";
    for (let y = 9; y < height; y += 13) {
      for (let x = 8; x < width; x += 13) {
        ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 7, 0, Math.PI * 2);
    ctx.fillStyle = "#030608";
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 18;
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = "#4b5459";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();
    const glass = ctx.createRadialGradient(cx - radius * 0.26, cy - radius * 0.28, 0, cx, cy, radius);
    glass.addColorStop(0, "rgba(225,242,247,0.30)");
    glass.addColorStop(0.18, "rgba(120,158,170,0.18)");
    glass.addColorStop(0.72, "rgba(37,66,77,0.28)");
    glass.addColorStop(1, "rgba(8,19,25,0.85)");
    ctx.fillStyle = glass;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

    drawFiberOverlay(ctx, fiberA, radius, coreRadius, "#55ded2", 0.62);
    drawFiberOverlay(ctx, fiberB, radius, coreRadius, "#e3c37d", 0.52);

    if (state.endFace === "dirty") {
      drawContamination(ctx, cx, cy, radius, state.contamination, state.wave.color, phase);
    } else {
      drawCleanTexture(ctx, cx, cy, radius);
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(233,239,244,0.16)";
    ctx.lineWidth = 0.7;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(cx - radius - 16, cy);
    ctx.lineTo(cx + radius + 16, cy);
    ctx.moveTo(cx, cy - radius - 12);
    ctx.lineTo(cx, cy + radius + 12);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#55ded2";
    ctx.font = '8px "SFMono-Regular", monospace';
    ctx.textAlign = "left";
    ctx.fillText("A", 12, 17);
    ctx.fillStyle = "#e3c37d";
    ctx.fillText("B", 27, 17);
    ctx.fillStyle = "#65737e";
    ctx.fillText("MICROSCOPE · OFFSET EXAGGERATED", 45, 17);

    ctx.fillStyle = "rgba(4,7,10,0.88)";
    ctx.fillRect(8, height - 25, width - 16, 17);
    ctx.fillStyle = state.endFace === "dirty" ? "#ff8a7f" : "#85dcae";
    ctx.font = '8px "SFMono-Regular", monospace';
    ctx.textAlign = "left";
    ctx.fillText(
      `${coreAligned ? "CORES TRACKED" : "CLADDING TRACKED"} · ${state.endFace === "dirty" ? "CONTAMINATION EST." : "END FACE CLEAN"}`,
      14,
      height - 14,
    );
    ctx.textAlign = "right";
    ctx.fillStyle = "#b5c0c8";
    ctx.fillText(`${link.splice.lossDb.toFixed(3)} dB`, width - 14, height - 14);
    ctx.restore();
  }
}

function drawFiberOverlay(ctx, fiber, radius, coreRadius, color, alpha) {
  const { cladding, core } = fiber;
  ctx.save();
  ctx.strokeStyle = colorWithAlpha(color, alpha * 0.46);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(cladding.x, cladding.y, radius * 0.93, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = colorWithAlpha(color, alpha);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(core.x, core.y, coreRadius, 0, Math.PI * 2);
  ctx.stroke();
  const glow = ctx.createRadialGradient(core.x, core.y, 0, core.x, core.y, coreRadius * 1.5);
  glow.addColorStop(0, colorWithAlpha(color, alpha * 0.26));
  glow.addColorStop(1, colorWithAlpha(color, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(
    core.x - coreRadius * 1.6,
    core.y - coreRadius * 1.6,
    coreRadius * 3.2,
    coreRadius * 3.2,
  );
  ctx.restore();
}

function drawContamination(ctx, cx, cy, radius, contamination, waveColor, phase) {
  const severity = clamp(Number(contamination) / 100, 0, 1);
  const count = Math.round(7 + severity * 20);
  ctx.save();
  for (let index = 0; index < count; index += 1) {
    const angle = hash(index * 7.1) * Math.PI * 2;
    const distance = Math.sqrt(hash(index * 4.7 + 3)) * radius * 0.86;
    const x = cx + Math.cos(angle) * distance;
    const y = cy + Math.sin(angle) * distance;
    const particleRadius = 1.2 + hash(index * 9.3) * (2 + severity * 4.8);
    const particle = ctx.createRadialGradient(
      x - particleRadius * 0.3,
      y - particleRadius * 0.35,
      0,
      x,
      y,
      particleRadius,
    );
    particle.addColorStop(0, index % 4 === 0 ? "rgba(177,132,73,0.85)" : "rgba(8,8,7,0.94)");
    particle.addColorStop(0.7, "rgba(18,16,13,0.82)");
    particle.addColorStop(1, "rgba(0,0,0,0.25)");
    ctx.fillStyle = particle;
    ctx.beginPath();
    ctx.arc(x, y, particleRadius, 0, Math.PI * 2);
    ctx.fill();
    if (index < 6) {
      const ring = 4 + ((phase + hash(index * 2.3)) % 1) * 11;
      ctx.beginPath();
      ctx.arc(x, y, ring, 0, Math.PI * 2);
      ctx.strokeStyle = colorWithAlpha(waveColor, 0.14 * (1 - ring / 16) * severity);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = "rgba(15,12,10,0.48)";
  ctx.lineWidth = 5 + severity * 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx + radius * 0.16, cy - radius * 0.13, radius * 0.48, 2.9, 5.3);
  ctx.stroke();
  ctx.strokeStyle = "rgba(220,235,239,0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - radius * 0.65, cy + radius * 0.41);
  ctx.lineTo(cx + radius * 0.6, cy - radius * 0.55);
  ctx.stroke();
  ctx.restore();
}

function drawCleanTexture(ctx, cx, cy, radius) {
  ctx.save();
  ctx.strokeStyle = "rgba(220,239,244,0.1)";
  ctx.lineWidth = 0.5;
  for (let ring = 0.22; ring < 0.9; ring += 0.18) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * ring, 0.1, Math.PI * 1.72);
    ctx.stroke();
  }
  ctx.restore();
}

function hash(seed) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function colorWithAlpha(hex, alpha) {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
}
