import { clamp } from "./geometry.js";

const PRBS = [
  1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1,
  1, 1, 1, 0, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1, 0, 1, 1, 0, 0, 0,
  1, 0, 1, 1, 0, 1, 0, 1, 1, 1, 0, 0,
];

export class ScopeRenderer {
  constructor(timeCanvas, eyeCanvas) {
    this.timeCanvas = timeCanvas;
    this.eyeCanvas = eyeCanvas;
    this.timeCtx = timeCanvas.getContext("2d");
    this.eyeCtx = eyeCanvas.getContext("2d");
  }

  render(link, state, phase = 0) {
    const timeSize = prepareCanvas(this.timeCanvas, this.timeCtx);
    const eyeSize = prepareCanvas(this.eyeCanvas, this.eyeCtx);
    if (timeSize.width > 1 && timeSize.height > 1) {
      this.drawTimeDomain(this.timeCtx, timeSize, link, state, phase);
    }
    if (eyeSize.width > 1 && eyeSize.height > 1) {
      this.drawEye(this.eyeCtx, eyeSize, link, state, phase);
    }
  }

  drawTimeDomain(ctx, size, link, state, phase) {
    const { width, height } = size;
    drawScopeBackground(ctx, width, height);
    const left = 35;
    const right = width - 11;
    const plotWidth = Math.max(1, right - left);
    const txBaseline = height * 0.42;
    const rxBaseline = height * 0.88;
    const amplitude = Math.min(41, height * 0.25);
    const samples = Math.max(220, Math.round(plotWidth * 1.2));
    const tx = new Array(samples);
    const rx = new Array(samples);
    let filtered = PRBS[0];
    const visibleBits = 10;
    const samplesPerBit = samples / visibleBits;
    const riseRatio = clamp(link.receiverRiseNs / Math.max(link.bitPeriodNs, 0.0001), 0.012, 18);
    const alpha = clamp(1 / (1 + riseRatio * samplesPerBit * 0.72), 0.002, 0.82);
    const receivedAmplitude = clamp(link.amplitudeRatio, 0.018, 1);
    const noiseFloor = clamp(0.009 + (1 - link.eyeOpening) * 0.045, 0.009, 0.08);

    for (let index = 0; index < samples; index += 1) {
      const bitIndex = Math.min(visibleBits - 1, Math.floor(index / samplesPerBit));
      const target = PRBS[bitIndex];
      filtered += (target - filtered) * alpha;
      const deterministicNoise =
        Math.sin(index * 0.73 + bitIndex * 1.3) * noiseFloor +
        Math.sin(index * 0.173 + 1.7) * noiseFloor * 0.45;
      tx[index] = target;
      rx[index] = clamp(filtered * receivedAmplitude + deterministicNoise, -0.09, 1.04);
    }

    drawTrace(ctx, tx, left, plotWidth, txBaseline, amplitude, "#f4c84a", 1.4);
    drawTrace(ctx, rx, left, plotWidth, rxBaseline, amplitude, state.wave.color, 1.65);

    ctx.save();
    ctx.fillStyle = "#f4c84a";
    ctx.font = '8px "SFMono-Regular", monospace';
    ctx.fillText("CH1", 7, txBaseline - amplitude + 8);
    ctx.fillStyle = state.wave.color;
    ctx.fillText("CH2", 7, rxBaseline - amplitude + 8);
    ctx.fillStyle = "#52635f";
    ctx.fillText("TX", 8, txBaseline + 2);
    ctx.fillText("RX", 8, rxBaseline + 2);

    const cursorX = left + (phase % 1) * plotWidth;
    ctx.strokeStyle = "rgba(233,239,244,0.22)";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(cursorX, 9);
    ctx.lineTo(cursorX, height - 8);
    ctx.stroke();
    ctx.fillStyle = "rgba(233,239,244,0.54)";
    ctx.beginPath();
    ctx.arc(cursorX, 8, 2, 0, Math.PI * 2);
    ctx.fill();

    const timeSpanNs = visibleBits * link.bitPeriodNs;
    ctx.fillStyle = "#65756f";
    ctx.textAlign = "right";
    ctx.fillText(`${formatTime(timeSpanNs)} span`, width - 8, height - 7);
    ctx.restore();
  }

  drawEye(ctx, size, link, state, phase) {
    const { width, height } = size;
    drawScopeBackground(ctx, width, height);
    const left = 17;
    const right = width - 13;
    const top = 19;
    const bottom = height - 20;
    const plotWidth = right - left;
    const plotHeight = bottom - top;
    const samplesPerBit = 64;
    const totalSamples = PRBS.length * samplesPerBit;
    const filtered = new Float64Array(totalSamples);
    const riseRatio = clamp(link.receiverRiseNs / Math.max(link.bitPeriodNs, 0.0001), 0.01, 22);
    const alpha = clamp(1 / (1 + riseRatio * samplesPerBit * 0.72), 0.0012, 0.85);
    let value = PRBS[0];
    for (let index = 0; index < totalSamples; index += 1) {
      const target = PRBS[Math.floor(index / samplesPerBit) % PRBS.length];
      value += (target - value) * alpha;
      filtered[index] = value;
    }

    const traceCount = Math.min(28, PRBS.length - 4);
    ctx.save();
    ctx.lineWidth = 0.8;
    ctx.globalCompositeOperation = "lighter";
    for (let trace = 0; trace < traceCount; trace += 1) {
      const start = (trace + 1) * samplesPerBit;
      const jitterSamples = Math.round(
        Math.sin(trace * 17.13) * clamp((1 - link.eyeOpening) * 9, 0.2, 9),
      );
      ctx.beginPath();
      for (let xIndex = 0; xIndex <= 128; xIndex += 1) {
        const sourceIndex = clamp(start + xIndex + jitterSamples, 0, totalSamples - 1);
        const noise =
          (Math.sin(trace * 8.7 + xIndex * 0.49) + Math.sin(trace + xIndex * 0.11) * 0.5) *
          (1 - link.eyeOpening) *
          0.032;
        const sample = clamp(
          filtered[sourceIndex] * clamp(link.amplitudeRatio, 0.025, 1) + noise,
          -0.12,
          1.1,
        );
        const x = left + (xIndex / 128) * plotWidth;
        const y = bottom - sample * plotHeight * 0.83 - plotHeight * 0.07;
        if (xIndex === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = colorWithAlpha(state.wave.color, 0.085 + link.eyeOpening * 0.035);
      ctx.stroke();
    }
    ctx.restore();

    const centerX = left + plotWidth / 2;
    const eyeTop = bottom - (0.07 + 0.83 * clamp(link.amplitudeRatio, 0.025, 1)) * plotHeight;
    const eyeBottom = bottom - plotHeight * 0.07;
    const openingHeight = Math.max(0, (eyeBottom - eyeTop) * link.eyeOpening);
    const bracketTop = (eyeTop + eyeBottom) / 2 - openingHeight / 2;
    const bracketBottom = bracketTop + openingHeight;
    ctx.save();
    ctx.strokeStyle = link.eyeOpening > 0.45 ? "#55ded2" : "#ff6b5e";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(centerX, bracketTop);
    ctx.lineTo(centerX, bracketBottom);
    ctx.moveTo(centerX - 4, bracketTop);
    ctx.lineTo(centerX + 4, bracketTop);
    ctx.moveTo(centerX - 4, bracketBottom);
    ctx.lineTo(centerX + 4, bracketBottom);
    ctx.stroke();

    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = "rgba(233,239,244,0.18)";
    ctx.beginPath();
    ctx.moveTo(centerX, top);
    ctx.lineTo(centerX, bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = link.eyeOpening > 0.45 ? "#71dcd5" : "#ff877c";
    ctx.font = '8px "SFMono-Regular", monospace';
    ctx.textAlign = "center";
    ctx.fillText(`${Math.round(link.eyeOpening * 100)}%`, centerX, 11);
    ctx.fillStyle = "#576963";
    ctx.textAlign = "left";
    ctx.fillText("0 UI", left, height - 6);
    ctx.textAlign = "center";
    ctx.fillText("1 UI", centerX, height - 6);
    ctx.textAlign = "right";
    ctx.fillText("2 UI", right, height - 6);

    const samplePhaseX = left + ((phase % 1) * 2 % 2) * (plotWidth / 2);
    ctx.fillStyle = "rgba(244,200,74,0.65)";
    ctx.beginPath();
    ctx.arc(samplePhaseX, bottom + 4, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function prepareCanvas(canvas, ctx) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { width, height };
}

function drawScopeBackground(ctx, width, height) {
  ctx.fillStyle = "#030807";
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.lineWidth = 0.5;
  for (let division = 0; division <= 10; division += 1) {
    const x = (division / 10) * width;
    ctx.strokeStyle = division === 5 ? "rgba(102,141,130,0.26)" : "rgba(75,106,97,0.18)";
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let division = 0; division <= 8; division += 1) {
    const y = (division / 8) * height;
    ctx.strokeStyle = division === 4 ? "rgba(102,141,130,0.26)" : "rgba(75,106,97,0.18)";
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(56,84,75,0.12)";
  for (let x = width / 20; x < width; x += width / 10) {
    for (let y = height / 16; y < height; y += height / 8) {
      ctx.fillRect(x, y, 1, 1);
    }
  }
  ctx.restore();
}

function drawTrace(ctx, samples, left, width, baseline, amplitude, color, lineWidth) {
  ctx.save();
  ctx.beginPath();
  samples.forEach((sample, index) => {
    const x = left + (index / (samples.length - 1)) * width;
    const y = baseline - sample * amplitude;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();
}

function colorWithAlpha(hex, alpha) {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
}

function formatTime(nanoseconds) {
  if (nanoseconds < 0.001) return `${(nanoseconds * 1000).toFixed(1)} ps`;
  if (nanoseconds < 1) return `${nanoseconds.toFixed(2)} ns`;
  return `${nanoseconds.toFixed(1)} ns`;
}
