// geo.mjs — terrain field, contour extraction, rivers.
// No dependencies. Everything is seeded, so the same account always
// produces the same landmass; only the settlements move as repos change.

/* ---------- deterministic randomness ---------- */

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

/* ---------- value noise + fbm ---------- */

function makeValueNoise(rand, size = 256) {
  const grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i++) grid[i] = rand();
  const at = (x, y) => grid[(y & (size - 1)) * size + (x & (size - 1))];

  return function noise2(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const tx = smooth(x - xi);
    const ty = smooth(y - yi);
    const top = lerp(at(xi, yi), at(xi + 1, yi), tx);
    const bot = lerp(at(xi, yi + 1), at(xi + 1, yi + 1), tx);
    return lerp(top, bot, ty) * 2 - 1; // -1..1
  };
}

export function makeFbm(rand, { octaves = 5, lacunarity = 2.03, gain = 0.5 } = {}) {
  const noise2 = makeValueNoise(rand);
  return function fbm(x, y) {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += noise2(x * freq, y * freq) * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  };
}

/* ---------- the landmass ---------- */

/**
 * Height field on a W x H grid. Values above 0 are land.
 * Two fbm passes warp the coordinates before the third samples height —
 * that domain warp is what stops the coastline looking like a blob.
 */
export function buildHeightField(seed, W, H, opts = {}) {
  const {
    scale = 3.1,
    warpStrength = 0.85,
    shoreBias = 0.1,
    edgeFalloff = 1.35,
  } = opts;

  const warpA = makeFbm(mulberry32(seed ^ 0x1f3d), { octaves: 4 });
  const warpB = makeFbm(mulberry32(seed ^ 0x77a1), { octaves: 4 });
  const base = makeFbm(mulberry32(seed ^ 0xbeef), { octaves: 6, gain: 0.52 });
  const coast = makeFbm(mulberry32(seed ^ 0x2c9e), { octaves: 3 });
  const fray = makeFbm(mulberry32(seed ^ 0x4d17), { octaves: 4 });
  // ridged: folding the noise at zero turns smooth hills into sharp spines
  const ridgeN = makeFbm(mulberry32(seed ^ 0x9e11), { octaves: 5, gain: 0.55 });

  const field = new Float32Array(W * H);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const v = y / H;
      const nx = u * scale;
      const ny = v * scale;

      const wx = nx + warpStrength * warpA(nx * 1.7 + 4.2, ny * 1.7 + 1.3);
      const wy = ny + warpStrength * warpB(nx * 1.7 + 9.8, ny * 1.7 + 6.1);

      const land = base(wx, wy) * 0.5 + 0.5; // 0..1

      // elliptical falloff, wobbled twice: broad lobes, then a finer fray
      // that cuts the bays, headlands and offshore islets
      const dx = (u - 0.5) * 2.08;
      const dy = (v - 0.5) * 2.34;
      let d = Math.sqrt(dx * dx + dy * dy);
      d *= 1 + 0.4 * coast(u * 2.2 + 3, v * 2.2 + 7)
             + 0.17 * fray(u * 7.5 + 11, v * 7.5 + 2);

      const mask = Math.max(0, 1 - Math.pow(Math.max(0, d), edgeFalloff));
      let h = land * 0.62 + mask * 0.52 - 0.5 + shoreBias;

      // spines, inland only — they rise with distance from the shore
      if (h > 0) {
        const ridge = 1 - Math.abs(ridgeN(wx * 1.45 + 2.5, wy * 1.45 + 8.1));
        const inland = Math.min(1, h * 5.5);
        h += Math.pow(Math.max(0, ridge - 0.42) / 0.58, 1.5) * 0.46 * inland * mask;
      }

      field[y * W + x] = h;
    }
  }
  return field;
}

export function sampleField(field, W, H, x, y) {
  const xi = Math.min(W - 2, Math.max(0, Math.floor(x)));
  const yi = Math.min(H - 2, Math.max(0, Math.floor(y)));
  const tx = Math.min(1, Math.max(0, x - xi));
  const ty = Math.min(1, Math.max(0, y - yi));
  const a = field[yi * W + xi];
  const b = field[yi * W + xi + 1];
  const c = field[(yi + 1) * W + xi + 1];
  const d = field[(yi + 1) * W + xi];
  return lerp(lerp(a, b, tx), lerp(d, c, tx), ty);
}

/* ---------- marching squares ---------- */

const CASES = [
  [], [[3, 2]], [[2, 1]], [[3, 1]],
  [[1, 0]], [[3, 0], [2, 1]], [[2, 0]], [[3, 0]],
  [[0, 3]], [[0, 2]], [[0, 1], [2, 3]], [[0, 1]],
  [[1, 3]], [[1, 2]], [[2, 3]], [],
];

/** Extract iso-lines at `level`, returned as arrays of [x,y] grid points. */
export function contour(field, W, H, level) {
  const segs = [];
  const f = (x, y) => field[y * W + x];

  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const a = f(x, y);
      const b = f(x + 1, y);
      const c = f(x + 1, y + 1);
      const d = f(x, y + 1);
      const idx =
        (a > level ? 8 : 0) | (b > level ? 4 : 0) |
        (c > level ? 2 : 0) | (d > level ? 1 : 0);
      const cs = CASES[idx];
      if (!cs.length) continue;

      const edge = (e) => {
        let t;
        switch (e) {
          case 0: t = (level - a) / (b - a); return [x + t, y];
          case 1: t = (level - b) / (c - b); return [x + 1, y + t];
          case 2: t = (level - d) / (c - d); return [x + t, y + 1];
          default: t = (level - a) / (d - a); return [x, y + t];
        }
      };
      for (const [e1, e2] of cs) segs.push([edge(e1), edge(e2)]);
    }
  }
  return stitch(segs);
}

function stitch(segs) {
  const key = (p) => `${Math.round(p[0] * 1000)}:${Math.round(p[1] * 1000)}`;
  const buckets = new Map();
  segs.forEach((s, i) => {
    for (const p of s) {
      const k = key(p);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(i);
    }
  });

  const used = new Array(segs.length).fill(false);
  const paths = [];

  const extend = (points, fromEnd) => {
    for (;;) {
      const tip = fromEnd ? points[points.length - 1] : points[0];
      const cands = buckets.get(key(tip)) || [];
      let next = -1;
      for (const i of cands) if (!used[i]) { next = i; break; }
      if (next === -1) return;
      used[next] = true;
      const [p, q] = segs[next];
      const other = key(p) === key(tip) ? q : p;
      if (fromEnd) points.push(other);
      else points.unshift(other);
    }
  };

  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const points = [segs[i][0], segs[i][1]];
    extend(points, true);
    extend(points, false);
    if (points.length > 6) paths.push(points);
  }
  return paths;
}

/* ---------- path helpers ---------- */

export function simplify(points, tolerance = 0.55) {
  if (points.length < 3) return points;
  const out = [points[0]];
  for (const p of points) {
    const last = out[out.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= tolerance) out.push(p);
  }
  return out.length > 2 ? out : points;
}

/** Quadratic through midpoints — cheap, stable, and reads as a drawn line. */
export function toPath(points, close = true, precision = 1) {
  if (points.length < 3) return '';
  const r = (n) => Number(n.toFixed(precision));
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const n = points.length;

  let start = close ? mid(points[n - 1], points[0]) : points[0];
  let d = `M${r(start[0])} ${r(start[1])}`;
  const end = close ? n : n - 1;
  for (let i = close ? 0 : 1; i < end; i++) {
    const cp = points[i % n];
    const nx = points[(i + 1) % n];
    const m = mid(cp, nx);
    d += `Q${r(cp[0])} ${r(cp[1])} ${r(m[0])} ${r(m[1])}`;
  }
  if (!close) d += `L${r(points[n - 1][0])} ${r(points[n - 1][1])}`;
  else d += 'Z';
  return d;
}

export function polygonArea(points) {
  let a = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    a += (points[j][0] + points[i][0]) * (points[j][1] - points[i][1]);
  }
  return Math.abs(a / 2);
}

/* ---------- rivers ---------- */

/** Walk downhill from high ground to the sea, with a little meander. */
export function traceRiver(field, W, H, start, rand, opts = {}) {
  const { maxSteps = 900, outward = null, pull = 0.42 } = opts;
  let [x, y] = start;
  const pts = [[x, y]];
  let vx = 0;
  let vy = 0;

  for (let step = 0; step < maxSteps; step++) {
    const eps = 0.9;
    const gx = sampleField(field, W, H, x + eps, y) - sampleField(field, W, H, x - eps, y);
    const gy = sampleField(field, W, H, x, y + eps) - sampleField(field, W, H, x, y - eps);
    let dx = -gx;
    let dy = -gy;
    const len = Math.hypot(dx, dy) || 1e-6;
    dx /= len;
    dy /= len;

    // Ridged terrain is full of closed basins, so pure descent gets trapped.
    // Leaning away from the island's centre keeps the river headed for a coast.
    if (outward) {
      let ox = x - outward[0];
      let oy = y - outward[1];
      const ol = Math.hypot(ox, oy) || 1e-6;
      ox /= ol;
      oy /= ol;
      dx = dx * (1 - pull) + ox * pull;
      dy = dy * (1 - pull) + oy * pull;
      const bl = Math.hypot(dx, dy) || 1e-6;
      dx /= bl;
      dy /= bl;
    }

    // meander + momentum, so it does not read as a gradient-descent trace
    const ang = (rand() - 0.5) * 0.55;
    const rx = dx * Math.cos(ang) - dy * Math.sin(ang);
    const ry = dx * Math.sin(ang) + dy * Math.cos(ang);
    vx = vx * 0.8 + rx * 0.2;
    vy = vy * 0.8 + ry * 0.2;
    const vl = Math.hypot(vx, vy) || 1e-6;

    x += (vx / vl) * 0.75;
    y += (vy / vl) * 0.75;
    if (x < 1 || y < 1 || x > W - 2 || y > H - 2) break;

    pts.push([x, y]);
    if (sampleField(field, W, H, x, y) <= 0) return pts; // reached the sea

    // flat ground makes gradient descent spiral; bail out instead of looping
    if (step > 0 && step % 40 === 0) {
      const back = pts[pts.length - 41];
      // stalled on flat ground: keep it if it is long enough to read as a
      // river feeding a lake, otherwise throw it away
      if (Math.hypot(x - back[0], y - back[1]) < 4) return null;
    }
  }
  return null; // never found the sea — not worth drawing
}
