export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function catmullRomPoint(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x:
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y:
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

/** Uniform Catmull-Rom interpolation through every supplied control point. */
export function sampleCatmullRom(points, samplesPerSegment = 36) {
  if (points.length < 2) return points.map((point) => ({ ...point }));

  const sampled = [];
  for (let segment = 0; segment < points.length - 1; segment += 1) {
    const p0 = points[Math.max(0, segment - 1)];
    const p1 = points[segment];
    const p2 = points[segment + 1];
    const p3 = points[Math.min(points.length - 1, segment + 2)];
    for (let step = 0; step < samplesPerSegment; step += 1) {
      sampled.push(catmullRomPoint(p0, p1, p2, p3, step / samplesPerSegment));
    }
  }
  sampled.push({ ...points.at(-1) });
  return annotatePath(sampled);
}

export function annotatePath(points) {
  if (points.length < 2) return points;
  let totalLength = 0;
  const lengths = [0];
  for (let index = 1; index < points.length; index += 1) {
    totalLength += distance(points[index - 1], points[index]);
    lengths.push(totalLength);
  }

  return points.map((point, index) => {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const tangentLength = Math.max(0.0001, distance(previous, next));
    const tangent = {
      x: (next.x - previous.x) / tangentLength,
      y: (next.y - previous.y) / tangentLength,
    };
    return {
      ...point,
      tangent,
      normal: { x: -tangent.y, y: tangent.x },
      arcLength: lengths[index],
      progress: totalLength ? lengths[index] / totalLength : 0,
      totalLength,
    };
  });
}

export function pointAtProgress(path, progress) {
  if (!path.length) return null;
  const target = clamp(progress, 0, 1) * path[0].totalLength;
  let upperIndex = path.findIndex((point) => point.arcLength >= target);
  if (upperIndex <= 0) return path[0];
  if (upperIndex === -1) return path.at(-1);
  const lower = path[upperIndex - 1];
  const upper = path[upperIndex];
  const span = Math.max(0.0001, upper.arcLength - lower.arcLength);
  const amount = (target - lower.arcLength) / span;
  return {
    x: lower.x + (upper.x - lower.x) * amount,
    y: lower.y + (upper.y - lower.y) * amount,
    tangent: {
      x: lower.tangent.x + (upper.tangent.x - lower.tangent.x) * amount,
      y: lower.tangent.y + (upper.tangent.y - lower.tangent.y) * amount,
    },
    normal: {
      x: lower.normal.x + (upper.normal.x - lower.normal.x) * amount,
      y: lower.normal.y + (upper.normal.y - lower.normal.y) * amount,
    },
    arcLength: target,
    progress: clamp(progress, 0, 1),
    totalLength: path[0].totalLength,
  };
}

export function curvatureMetrics(path, canvasWidth, physicalSpanMm = 600) {
  if (path.length < 5) {
    return {
      minRadiusMm: Infinity,
      minRadiusPx: Infinity,
      worstIndex: 0,
      bendSeverity: 0,
      equivalentTurns: 0,
      tightEquivalentTurns: 0,
    };
  }

  const millimetersPerPixel = physicalSpanMm / Math.max(1, canvasWidth);
  let minRadiusPx = Infinity;
  let worstIndex = 0;
  let weightedSeverity = 0;
  let totalTurnRadians = 0;
  let tightTurnRadians = 0;

  for (let index = 2; index < path.length - 2; index += 1) {
    const a = path[index - 2];
    const b = path[index];
    const c = path[index + 2];
    const ab = distance(a, b);
    const bc = distance(b, c);
    const ca = distance(c, a);
    const twiceArea = Math.abs(
      (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
    );
    if (twiceArea < 0.0001) continue;
    const radius = (ab * bc * ca) / (2 * twiceArea);
    const radiusMm = radius * millimetersPerPixel;
    if (radius < minRadiusPx) {
      minRadiusPx = radius;
      worstIndex = index;
    }
    weightedSeverity += 1 / Math.max(radius * radius, 1);

    const previousTangent = path[index - 1].tangent;
    const nextTangent = path[index + 1].tangent;
    const dot = clamp(
      previousTangent.x * nextTangent.x + previousTangent.y * nextTangent.y,
      -1,
      1,
    );
    const turn = Math.acos(dot);
    totalTurnRadians += turn;
    if (radiusMm < 35) tightTurnRadians += turn;
  }

  return {
    minRadiusPx,
    minRadiusMm: minRadiusPx * millimetersPerPixel,
    worstIndex,
    bendSeverity: weightedSeverity * 10000,
    millimetersPerPixel,
    equivalentTurns: totalTurnRadians / (2 * Math.PI),
    tightEquivalentTurns: tightTurnRadians / (2 * Math.PI),
  };
}

export function triangleWave(value) {
  const wrapped = ((value % 1) + 1) % 1;
  return 1 - 4 * Math.abs(Math.round(wrapped) - wrapped);
}
