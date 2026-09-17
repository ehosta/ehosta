// render.mjs — draws the chart.
//
// Look: an engraved coastal chart, c. 1650. The sea carries most of the
// frame and gets the hatching; the land is bright linen. One red — a red
// lead (minium) — and it is spent only on the capital and the title rule.

import {
  buildHeightField, contour, simplify, toPath, polygonArea,
  sampleField, traceRiver, mulberry32, hashString, makeFbm,
} from './geo.mjs';

export const PALETTE = {
  sea: '#A8BAC0',
  seaDeep: '#93A8B0',
  linen: '#E9E2CC',
  linenLit: '#F2ECD9',
  ink: '#2E3B46',
  inkSoft: '#6E7C87',
  sage: '#77896A',
  ochre: '#9A8557',
  minium: '#A93C2B',
};

const FONT = "'Iowan Old Style','Palatino Linotype',Palatino,'Book Antiqua',Georgia,serif";

const LANG_INK = {
  TypeScript: '#33556E', JavaScript: '#9A7B2E', Python: '#3E6B57',
  C: '#6A5B7B', 'C++': '#7A4A5E', Rust: '#8A5230', Go: '#3A6E77',
  Shell: '#5B6650', Java: '#8A5A3C', Ruby: '#8E3A44', PHP: '#4F5680',
  HTML: '#8A5238', CSS: '#4A6580', Swift: '#8A5A2E', Kotlin: '#6A4E80',
  Vue: '#3E7A63', Lua: '#3A4E80', Assembly: '#6B5548', Nim: '#7A6A2E',
  Zig: '#8A6A2E', Haskell: '#5E4A7A', Elixir: '#6A4A7E', Dart: '#2E6A78',
};
const LANG_FALLBACK = ['#4A5F6E', '#6B5B72', '#5E6B4E', '#7A5E4A', '#45606B', '#77604E'];

const r1 = (n) => Number(n.toFixed(1));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* ---------- naming ---------- */

const SUFFIX = ['holm', 'gard', 'vik', 'burgh', 'fell', 'mere', 'wold', 'stead',
  'thorpe', 'haven', 'crag', 'moor', 'dale', 'reach', 'keep'];
const PREFIX = ['Old ', 'Upper ', 'Lower ', 'North ', 'East ', 'Port ', 'Little ', '', '', ''];

/** Turn a repo name into something that reads like a place, but stays recognisable. */
function placeName(repo, rand) {
  const raw = repo.name.replace(/[-_.]+/g, ' ').trim();
  const words = raw.split(/\s+/).filter(Boolean);
  let core = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  if (core.length > 16) core = core.slice(0, 15).trimEnd();
  if (rand() < 0.42 && words.length === 1 && core.length < 11) {
    core += SUFFIX[Math.floor(rand() * SUFFIX.length)];
  } else if (rand() < 0.22) {
    core = PREFIX[Math.floor(rand() * PREFIX.length)] + core;
  }
  return core;
}

/* ---------- settlement placement ---------- */

function placeSettlements(repos, field, GW, GH, rand) {
  // candidate land cells: not mountain, not shore-edge
  const cands = [];
  for (let y = 3; y < GH - 3; y++) {
    for (let x = 3; x < GW - 3; x++) {
      const h = field[y * GW + x];
      if (h > 0.012 && h < 0.26) cands.push([x, y, h]);
    }
  }
  if (!cands.length) return [];

  const cx = GW / 2;
  const cy = GH / 2;
  const placed = [];

  repos.forEach((repo, rank) => {
    // Rank position, not raw weight: a single 180k-star repo would otherwise
    // push every other share to ~0 and pile them all on the shoreline.
    const spread = repos.length > 1 ? rank / (repos.length - 1) : 0;
    const standing = 1 - spread;
    const wantR = (0.16 + spread * 0.72) * Math.min(GW, GH) * 0.62;
    const minGap = rank === 0 ? 0 : 5.5 + standing * 5;

    let best = null;
    let bestScore = -Infinity;
    const tries = 260;
    for (let t = 0; t < tries; t++) {
      const c = cands[Math.floor(rand() * cands.length)];
      const d = Math.hypot(c[0] - cx, c[1] - cy);
      let gap = Infinity;
      for (const p of placed) gap = Math.min(gap, Math.hypot(c[0] - p.gx, c[1] - p.gy));
      if (gap < minGap) continue;
      // prefer: right distance band, near water (low h reads as a port), open space
      const score =
        -Math.abs(d - wantR) * 1.0 +
        Math.min(gap, 22) * 0.9 +
        (0.26 - c[2]) * 16;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (!best) best = cands[Math.floor(rand() * cands.length)];

    placed.push({
      repo, rank, share: standing,
      gx: best[0] + rand() * 0.6 - 0.3,
      gy: best[1] + rand() * 0.6 - 0.3,
      name: placeName(repo, rand),
      tier: rank === 0 ? 3 : spread < 0.2 ? 2 : spread < 0.5 ? 1 : 0,
    });
  });

  return placed;
}

/** Minimum spanning tree — the road network. */
function roadNetwork(nodes) {
  if (nodes.length < 2) return [];
  const inTree = [0];
  const rest = nodes.map((_, i) => i).slice(1);
  const edges = [];
  while (rest.length) {
    let bi = 0; let bj = 0; let bd = Infinity;
    for (const i of inTree) {
      for (let k = 0; k < rest.length; k++) {
        const j = rest[k];
        const d = Math.hypot(nodes[i].gx - nodes[j].gx, nodes[i].gy - nodes[j].gy);
        if (d < bd) { bd = d; bi = i; bj = k; }
      }
    }
    const j = rest.splice(bj, 1)[0];
    inTree.push(j);
    if (bd < 60) edges.push([bi, j]);
  }
  return edges;
}

/* ---------- glyphs ---------- */

function treeGlyph(x, y, s, conifer) {
  if (conifer) {
    return `<path d="M${r1(x)} ${r1(y)}l0 ${r1(-s * 0.3)}M${r1(x - s * 0.42)} ${r1(y - s * 0.26)}`
      + `l${r1(s * 0.42)} ${r1(-s * 0.78)}l${r1(s * 0.42)} ${r1(s * 0.78)}z"/>`;
  }
  return `<path d="M${r1(x)} ${r1(y)}l0 ${r1(-s * 0.34)}"/>`
    + `<circle cx="${r1(x)}" cy="${r1(y - s * 0.62)}" r="${r1(s * 0.4)}"/>`;
}

function mountainGlyph(x, y, w, h, rand) {
  const k = 0.55 + rand() * 0.35;
  const peak = `M${r1(x - w)} ${r1(y)}L${r1(x - w * 0.34)} ${r1(y - h * 0.72)}`
    + `L${r1(x)} ${r1(y - h)}L${r1(x + w * 0.4)} ${r1(y - h * k)}`
    + `L${r1(x + w)} ${r1(y)}Z`;
  // hatch the lee face
  let hatch = '';
  const n = 3 + Math.floor(h / 7);
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    const sx = x + w * 0.06 * i;
    const sy = y - h * (1 - t) * 0.92;
    hatch += `M${r1(sx)} ${r1(sy)}L${r1(sx + w * (0.22 + t * 0.5))} ${r1(y - h * 0.04 * i)}`;
  }
  return { peak, hatch };
}

function settlementGlyph(x, y, tier) {
  const g = [];
  const b = (bx, by, w, h) => g.push(`M${r1(bx)} ${r1(by)}h${r1(w)}v${r1(-h)}h${r1(-w)}z`);
  const roof = (bx, by, w, h) =>
    g.push(`M${r1(bx)} ${r1(by)}l${r1(w / 2)} ${r1(-h)}l${r1(w / 2)} ${r1(h)}z`);

  if (tier === 0) {
    b(x - 3, y, 6, 4.4); roof(x - 3.9, y - 4.4, 7.8, 3.2);
  } else if (tier === 1) {
    b(x - 6, y, 5.4, 4.6); roof(x - 6.8, y - 4.6, 7, 3);
    b(x + 0.6, y, 5.4, 5.6); roof(x - 0.2, y - 5.6, 7, 3.2);
  } else if (tier === 2) {
    b(x - 9, y, 5.2, 4.8); roof(x - 9.8, y - 4.8, 6.8, 2.8);
    b(x - 3, y, 5.6, 6.2); roof(x - 3.8, y - 6.2, 7.2, 3);
    b(x + 3.4, y, 4.6, 9.4); roof(x + 2.6, y - 9.4, 6.2, 4.4);
  } else {
    // capital: curtain wall between two towers
    b(x - 11, y, 22, 6.4);
    for (let i = 0; i < 7; i++) b(x - 10.4 + i * 3.1, y - 6.4, 1.7, 1.8);
    b(x - 12.4, y, 5.2, 12.2); roof(x - 13.4, y - 12.2, 7.2, 5.4);
    b(x + 7.2, y, 5.2, 14.4); roof(x + 6.2, y - 14.4, 7.2, 5.8);
  }
  return g.join('');
}

function compassRose(x, y, s) {
  const pt = (a, r) => [x + Math.sin(a) * r, y - Math.cos(a) * r];
  let d = '';
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const [tx, ty] = pt(a, s);
    const [lx, ly] = pt(a - Math.PI / 4, s * 0.26);
    const [rx, ry] = pt(a + Math.PI / 4, s * 0.26);
    d += `M${r1(x)} ${r1(y)}L${r1(lx)} ${r1(ly)}L${r1(tx)} ${r1(ty)}L${r1(rx)} ${r1(ry)}Z`;
  }
  let minor = '';
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const [tx, ty] = pt(a, s * 0.56);
    minor += `M${r1(x)} ${r1(y)}L${r1(tx)} ${r1(ty)}`;
  }
  return { d, minor };
}

/* ---------- labels ---------- */

function layoutLabels(items, W, H) {
  const boxes = [];
  const hit = (b) => boxes.some((o) =>
    b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);

  for (const it of items) {
    const w = it.text.length * it.size * 0.47 + 4;
    const h = it.size * 1.15;
    const opts = [
      [it.x, it.y + it.size + 4, 'middle'],
      [it.x, it.y - it.lift - 4, 'middle'],
      [it.x + it.pad, it.y + it.size * 0.34, 'start'],
      [it.x - it.pad, it.y + it.size * 0.34, 'end'],
      [it.x, it.y + it.size * 2.1 + 4, 'middle'],
    ];
    let chosen = opts[0];
    for (const o of opts) {
      const bx = o[2] === 'middle' ? o[0] - w / 2 : o[2] === 'start' ? o[0] : o[0] - w;
      const box = { x: bx, y: o[1] - h * 0.8, w, h };
      if (box.x < 30 || box.x + box.w > W - 30 || box.y < 30 || box.y + box.h > H - 30) continue;
      if (!hit(box)) { chosen = o; boxes.push(box); break; }
    }
    it.lx = chosen[0];
    it.ly = chosen[1];
    it.anchor = chosen[2];
  }
  return items;
}

/* ---------- main ---------- */

export function renderKingdom({ login, repos, oceanName, kingdomName }) {
  const W = 1240;
  const H = 800;
  const GW = 208;
  const GH = 134;
  const SX = W / GW;
  const SY = H / GH;
  const gx2x = (v) => v * SX;
  const gy2y = (v) => v * SY;

  const seed = hashString(login);
  const rand = mulberry32(seed);
  const field = buildHeightField(seed, GW, GH, { shoreBias: 0.04, warpStrength: 1.0 });
  const detail = makeFbm(mulberry32(seed ^ 0x5151), { octaves: 3 });

  /* coast + offshore echo lines. contour() works in grid space — scale it up. */
  const project = (pts) => pts.map(([x, y]) => [gx2x(x), gy2y(y)]);
  const ring = (level, minArea) =>
    contour(field, GW, GH, level)
      .filter((p) => polygonArea(p) > minArea)
      .map((p) => toPath(simplify(project(p), 2.2)));

  const coast = ring(0, 4);
  const echoes = [-0.016, -0.038, -0.066, -0.1].map((lv) => ring(lv, 8).join(''));
  const upland = ring(0.2, 5).join('');

  /* forests */
  let forest = '';
  for (let y = 4; y < GH - 4; y += 1.55) {
    for (let x = 4; x < GW - 4; x += 1.55) {
      const jx = x + (rand() - 0.5) * 1.5;
      const jy = y + (rand() - 0.5) * 1.5;
      const h = sampleField(field, GW, GH, jx, jy);
      if (h < 0.04 || h > 0.27) continue;
      const dens = detail(jx * 0.075, jy * 0.075);
      if (dens < 0.14) continue;
      if (rand() > 0.42) continue;
      const s = 7 + rand() * 3.5;
      forest += treeGlyph(gx2x(jx), gy2y(jy), s, dens > 0.34);
    }
  }

  /* mountains — a handful of ranges, each a row of peaks along the local ridge */
  const summits = [];
  for (let y = 4; y < GH - 4; y++) {
    for (let x = 4; x < GW - 4; x++) {
      const h = field[y * GW + x];
      if (h < 0.26) continue;
      let isMax = true;
      for (let dy = -2; dy <= 2 && isMax; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (field[(y + dy) * GW + (x + dx)] > h) { isMax = false; break; }
        }
      }
      if (isMax) summits.push([x, y, h]);
    }
  }
  summits.sort((a, b) => b[2] - a[2]);

  const ranges = [];
  for (const s of summits) {
    if (ranges.length >= 14) break;
    if (ranges.some((p) => Math.hypot(p[0] - s[0], p[1] - s[1]) < 8.5)) continue;
    ranges.push(s);
  }

  /** The ridge runs along whichever direction stays highest. */
  const ridgeAngle = (px, py) => {
    let best = 0;
    let bestH = -Infinity;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 8;
      const h = sampleField(field, GW, GH, px + Math.cos(a) * 2.6, py + Math.sin(a) * 2.6)
        + sampleField(field, GW, GH, px - Math.cos(a) * 2.6, py - Math.sin(a) * 2.6);
      if (h > bestH) { bestH = h; best = a; }
    }
    return best;
  };

  const drawn = [];
  for (const [px, py, ph] of ranges) {
    const a = ridgeAngle(px, py);
    const n = 2 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const t = (i - (n - 1) / 2) * (2.4 + rand() * 1.1);
      const mx = px + Math.cos(a) * t;
      const my = py + Math.sin(a) * t * 0.72;
      const fall = 1 - Math.abs(i - (n - 1) / 2) / (n + 1.2);
      drawn.push({
        x: gx2x(mx),
        y: gy2y(my) + 2,
        w: (7.5 + rand() * 3) * (0.75 + ph * 0.7),
        h: (11 + rand() * 6) * (0.6 + ph * 1.1) * (0.66 + fall * 0.5),
      });
    }
  }
  drawn.sort((a, b) => a.y - b.y); // back to front

  let mtnFill = '';
  let mtnHatch = '';
  for (const m of drawn) {
    const g = mountainGlyph(m.x, m.y, m.w, m.h, rand);
    mtnFill += `<path d="${g.peak}"/>`;
    if (g.hatch) mtnHatch += `<path d="${g.hatch}"/>`;
  }
  const peaks = ranges;

  /* rivers */
  let rivers = '';
  let riverCount = 0;
  const sources = peaks.filter((p) => p[2] > 0.26);
  const nRivers = Math.min(5, Math.max(2, Math.floor(sources.length / 3)));
  for (let i = 0; i < nRivers * 3 && sources.length && riverCount < nRivers; i++) {
    const s = sources[Math.floor(rand() * sources.length)];
    const pts = traceRiver(field, GW, GH, [s[0], s[1]], rand,
      { outward: [GW / 2, GH / 2], pull: 0.38 });
    if (!pts || pts.length < 30) continue;
    const scaled = simplify(pts.map(([x, y]) => [gx2x(x), gy2y(y)]), 3);
    rivers += `<path d="${toPath(scaled, false)}"/>`;
    riverCount++;
  }

  /* settlements + roads */
  const towns = placeSettlements(repos, field, GW, GH, rand)
    .map((t) => ({ ...t, x: gx2x(t.gx), y: gy2y(t.gy) }));
  const edges = roadNetwork(towns);

  let roads = '';
  for (const [i, j] of edges) {
    const a = towns[i];
    const b = towns[j];
    const mx = (a.x + b.x) / 2 + (rand() - 0.5) * 34;
    const my = (a.y + b.y) / 2 + (rand() - 0.5) * 34;
    roads += `<path d="M${r1(a.x)} ${r1(a.y)}Q${r1(mx)} ${r1(my)} ${r1(b.x)} ${r1(b.y)}"/>`;
  }

  /* language colours */
  const langs = [...new Set(towns.map((t) => t.repo.language).filter(Boolean))];
  const langColor = new Map();
  langs.forEach((l, i) => langColor.set(l, LANG_INK[l] || LANG_FALLBACK[i % LANG_FALLBACK.length]));

  let glyphs = '';
  let banners = '';
  let capitalGlyph = '';
  for (const t of towns) {
    const lift = t.tier === 3 ? 20 : t.tier === 2 ? 14 : t.tier === 1 ? 9 : 8;
    t.lift = lift;
    t.pad = t.tier === 3 ? 17 : t.tier === 2 ? 12 : 9;
    const path = `<path d="${settlementGlyph(t.x, t.y, t.tier)}"/>`;
    if (t.tier === 3) capitalGlyph += path;
    else glyphs += path;

    const col = langColor.get(t.repo.language) || PALETTE.inkSoft;
    if (t.tier >= 1) {
      const bx = t.tier === 3 ? t.x + 9.8 : t.tier === 2 ? t.x + 5.7 : t.x + 3.3;
      const by = t.y - lift - 2;
      banners += `<path d="M${r1(bx)} ${r1(by)}l0 ${r1(lift * 0.42)}" stroke="${PALETTE.ink}" `
        + `stroke-width="1" fill="none"/>`
        + `<path d="M${r1(bx)} ${r1(by)}l8 2.6l-8 2.6z" fill="${col}" `
        + `stroke="${PALETTE.ink}" stroke-width="0.7" stroke-linejoin="round"/>`;
    } else {
      banners += `<circle cx="${r1(t.x + 4.4)}" cy="${r1(t.y - 6.4)}" r="1.9" fill="${col}"/>`;
    }
  }

  /* labels */
  const labelItems = layoutLabels(towns.map((t) => ({
    text: t.name,
    x: t.x,
    y: t.y,
    lift: t.lift,
    pad: t.pad,
    size: t.tier === 3 ? 19 : t.tier === 2 ? 15 : t.tier === 1 ? 13 : 11.5,
    tier: t.tier,
  })), W, H);

  const labelText = (it, halo) =>
    `<text x="${r1(it.lx)}" y="${r1(it.ly)}" text-anchor="${it.anchor}" `
    + `font-size="${it.size}" font-style="italic" `
    + `letter-spacing="${it.tier === 3 ? 1.6 : 0.3}" `
    + (halo
      ? `fill="none" stroke="${PALETTE.linen}" stroke-width="${it.tier === 3 ? 4.4 : 3.2}" `
        + `stroke-linejoin="round" opacity="0.88"`
      : `fill="${it.tier === 3 ? PALETTE.minium : PALETTE.ink}"`)
    + `>${esc(it.text)}</text>`;

  const labelHalo = labelItems.map((it) => labelText(it, true)).join('');
  const labels = labelItems.map((it) => labelText(it, false)).join('');

  /* pick the emptiest corner for the cartouche, next-emptiest for the rose */
  const corners = [
    { x: 118, y: 108, qx: 0.16, qy: 0.16 },
    { x: W - 118, y: 108, qx: 0.84, qy: 0.16 },
    { x: 118, y: H - 118, qx: 0.16, qy: 0.84 },
    { x: W - 118, y: H - 118, qx: 0.84, qy: 0.84 },
  ].map((c) => {
    let cost = 0;
    for (const t of towns) cost += 1 / (1 + Math.hypot(t.x - c.x, t.y - c.y) / 90);
    if (sampleField(field, GW, GH, (c.x / W) * GW, (c.y / H) * GH) > 0) cost += 2.5;
    return { ...c, cost };
  }).sort((a, b) => a.cost - b.cost);

  const cart = corners[0];
  const rose = corners[1];
  const roseG = compassRose(rose.x, rose.y, 46);

  const span = Math.hypot(W, H);
  let rhumbs = '';
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI * 2) / 16;
    rhumbs += `<path d="M${r1(rose.x)} ${r1(rose.y)}`
      + `L${r1(rose.x + Math.cos(a) * span)} ${r1(rose.y + Math.sin(a) * span)}"/>`;
  }

  const totalStars = repos.reduce((a, r) => a + r.stars, 0);
  const legend = langs.slice(0, 6).map((l, i) =>
    `<g transform="translate(0 ${r1(i * 17)})">`
    + `<path d="M0 0l9 3l-9 3z" fill="${langColor.get(l)}" stroke="${PALETTE.ink}" stroke-width="0.7"/>`
    + `<text x="15" y="6.4" font-size="11.5" fill="${PALETTE.ink}">${esc(l)}</text></g>`).join('');

  const cartW = 214;
  const cartH = 96 + langs.slice(0, 6).length * 17;
  const cartX = cart.x - cartW / 2;
  const cartY = cart.y - cartH / 2;

  /* sea name, placed in open water on the side away from the cartouche */
  const seaX = cart.qx > 0.5 ? W * 0.2 : W * 0.8;
  const seaY = cart.qy > 0.5 ? H * 0.2 : H * 0.82;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}">
<defs>
  <filter id="grain" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.62" numOctaves="4" seed="${seed % 9973}" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.18 0 0 0 0 0.22 0 0 0 0 0.26 0 0 0 0.42 0"/>
  </filter>
  <filter id="wash" x="-10%" y="-10%" width="120%" height="120%">
    <feTurbulence type="fractalNoise" baseFrequency="0.009" numOctaves="3" seed="${(seed >> 3) % 9973}" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.35 0 0 0 0 0.3 0 0 0 0 0.2 0 0 0 0.3 0"/>
  </filter>
  <radialGradient id="vig" cx="50%" cy="46%" r="72%">
    <stop offset="55%" stop-color="#000" stop-opacity="0"/>
    <stop offset="100%" stop-color="#3A2E1E" stop-opacity="0.2"/>
  </radialGradient>
  <clipPath id="frame"><rect x="14" y="14" width="${W - 28}" height="${H - 28}"/></clipPath>
</defs>

<rect width="${W}" height="${H}" fill="${PALETTE.sea}"/>
<rect width="${W}" height="${H}" filter="url(#wash)" opacity="0.32"/>

<g clip-path="url(#frame)">
  <!-- rhumb lines -->
  <g fill="none" stroke="${PALETTE.ink}" stroke-width="0.55" opacity="0.17">${rhumbs}</g>
  <circle cx="${r1(rose.x)}" cy="${r1(rose.y)}" r="${r1(span * 0.42)}" fill="none"
          stroke="${PALETTE.ink}" stroke-width="0.55" opacity="0.13"/>

  <!-- offshore soundings: coastlines echoed out to sea -->
  <g fill="none" stroke="${PALETTE.ink}" stroke-linejoin="round">
${echoes.map((d, i) => `    <path d="${d}" stroke-width="${1.15 - i * 0.16}" opacity="${0.4 - i * 0.075}"/>`).join('\n')}
  </g>

  <!-- land -->
  <g>
${coast.map((d) => `    <path d="${d}" fill="${PALETTE.linen}"/>`).join('\n')}
  </g>
  <g fill="none" stroke="${PALETTE.linenLit}" stroke-width="7" opacity="0.5">
${coast.map((d) => `    <path d="${d}"/>`).join('\n')}
  </g>
  <path d="${upland}" fill="${PALETTE.linenLit}" opacity="0.62"/>
  <g fill="none" stroke="${PALETTE.ink}" stroke-width="1.7" stroke-linejoin="round">
${coast.map((d) => `    <path d="${d}"/>`).join('\n')}
  </g>

  <!-- rivers -->
  <g fill="none" stroke="${PALETTE.seaDeep}" stroke-width="2.6" stroke-linecap="round" opacity="1">${rivers}</g>
  <g fill="none" stroke="${PALETTE.ink}" stroke-width="0.8" stroke-linecap="round" opacity="0.5">${rivers}</g>

  <!-- woodland -->
  <g fill="${PALETTE.sage}" stroke="${PALETTE.sage}" stroke-width="0.8"
     stroke-linejoin="round" opacity="0.8">${forest}</g>

  <!-- ranges, drawn in profile -->
  <g fill="${PALETTE.linen}" stroke="${PALETTE.ink}" stroke-width="1.1"
     stroke-linejoin="round">${mtnFill}</g>
  <g fill="none" stroke="${PALETTE.ink}" stroke-width="0.75" opacity="0.62"
     stroke-linecap="round">${mtnHatch}</g>

  <!-- roads -->
  <g fill="none" stroke="${PALETTE.ochre}" stroke-width="1.5"
     stroke-dasharray="5 4.5" opacity="0.8">${roads}</g>

  <!-- settlements -->
  <g fill="${PALETTE.linenLit}" stroke="${PALETTE.ink}" stroke-width="1.15"
     stroke-linejoin="round">${glyphs}</g>
  <g fill="${PALETTE.linenLit}" stroke="${PALETTE.minium}" stroke-width="1.5"
     stroke-linejoin="round">${capitalGlyph}</g>
  ${banners}

  <g>${labelHalo}</g>
  <g>${labels}</g>

  <!-- hydronym -->
  <text x="${r1(seaX)}" y="${r1(seaY)}" text-anchor="middle" font-size="26" font-style="italic"
        letter-spacing="7" fill="${PALETTE.ink}" opacity="0.32">${esc(oceanName)}</text>

  <!-- compass -->
  <g transform="translate(0 0)">
    <circle cx="${r1(rose.x)}" cy="${r1(rose.y)}" r="52" fill="none"
            stroke="${PALETTE.ink}" stroke-width="0.9" opacity="0.5"/>
    <circle cx="${r1(rose.x)}" cy="${r1(rose.y)}" r="46" fill="none"
            stroke="${PALETTE.ink}" stroke-width="0.6" opacity="0.35"/>
    <path d="${roseG.minor}" stroke="${PALETTE.ink}" stroke-width="0.8" opacity="0.6" fill="none"/>
    <path d="${roseG.d}" fill="${PALETTE.linen}" stroke="${PALETTE.ink}" stroke-width="1.1"
          stroke-linejoin="round"/>
    <path d="M${r1(rose.x)} ${r1(rose.y)}L${r1(rose.x - 12)} ${r1(rose.y - 12)}L${r1(rose.x)} ${r1(rose.y - 46)}Z"
          fill="${PALETTE.minium}" stroke="${PALETTE.ink}" stroke-width="0.9"/>
    <text x="${r1(rose.x)}" y="${r1(rose.y - 60)}" text-anchor="middle" font-size="13"
          letter-spacing="2" fill="${PALETTE.ink}">N</text>
  </g>

  <!-- cartouche -->
  <g transform="translate(${r1(cartX)} ${r1(cartY)})">
    <rect width="${cartW}" height="${cartH}" fill="${PALETTE.linen}" opacity="0.93"
          stroke="${PALETTE.ink}" stroke-width="1.3" rx="2"/>
    <rect x="5" y="5" width="${cartW - 10}" height="${cartH - 10}" fill="none"
          stroke="${PALETTE.ink}" stroke-width="0.6" opacity="0.55" rx="1"/>
    <text x="18" y="32" font-size="17" letter-spacing="2.4" fill="${PALETTE.ink}">${esc(kingdomName)}</text>
    <path d="M18 41h${cartW - 36}" stroke="${PALETTE.minium}" stroke-width="1.6"/>
    <text x="18" y="60" font-size="11.5" font-style="italic" fill="${PALETTE.inkSoft}">${repos.length} settlements · ${totalStars} stars</text>
    <g transform="translate(18 74)">${legend}</g>
  </g>
</g>

<rect width="${W}" height="${H}" fill="url(#vig)"/>
<rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.14"/>

<rect x="8" y="8" width="${W - 16}" height="${H - 16}" fill="none"
      stroke="${PALETTE.ink}" stroke-width="2.4"/>
<rect x="15" y="15" width="${W - 30}" height="${H - 30}" fill="none"
      stroke="${PALETTE.ink}" stroke-width="0.8" opacity="0.6"/>
</svg>`;
}
