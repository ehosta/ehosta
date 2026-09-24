// render.mjs — a radar screen. Repos are airports, recent commits are planes.
//
// Airports sit on a polar grid: the angle is stable (hash of the name), the
// distance from the tower in the middle is how long ago the repo was pushed.
// Consecutive commits in the same repo make one flight. Flights are replayed
// in order on a loop, each taking off from where the previous one landed, so
// there are only ever one or two planes in the air.

import { MONO, PLANE, langOf, hash, esc } from '../lib.mjs';

const W = 920, H = 540;
const CX = 280, CY = 270, R = 236;
const SWEEP = 6;   // seconds per radar turn
const SLOT = 1.8;  // seconds between two take-offs
const FLY = 3.4;   // seconds in the air
const LEGS = 10;   // flights replayed
const GREEN = '#3ddc84';

/** "42-minishell" → "MNS", "brainfxcker" → "BRN", unique within `taken` */
function iata(name, taken) {
  const letters = name.replace(/^42[-_]/, '').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'XXX';
  const c0 = letters[0];
  const cons = letters.slice(1).replace(/[AEIOU]/g, '');
  const rest = letters.slice(1);
  const cands = [];
  for (const pool of [cons, rest]) {
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) cands.push(c0 + pool[i] + pool[j]);
    }
  }
  for (let n = 10; n < 100; n++) cands.push(c0 + n);
  const code = cands.find((c) => c.length === 3 && !taken.has(c));
  taken.add(code);
  return code;
}

const polar = (deg, r) => [CX + r * Math.cos(deg * Math.PI / 180), CY + r * Math.sin(deg * Math.PI / 180)];
const f1 = (n) => n.toFixed(1);

export function renderRadar({ login, repos, commits, now, timeZone, days }) {
  // ---- airports
  const taken = new Set();
  const order = repos.slice().sort((a, b) => hash(a.full_name) - hash(b.full_name));
  const airports = new Map();
  order.forEach((r, i) => {
    const deg = (i / order.length) * 360 + (hash(r.name) % 11) - 5;
    const age = Math.max(0, (now - Date.parse(r.pushed_at)) / 86400000);
    const dist = R * (0.24 + 0.68 * Math.min(1, Math.log1p(age) / Math.log1p(1500)));
    const [x, y] = polar(deg, dist);
    airports.set(r.full_name, {
      repo: r, deg, x, y, code: iata(r.name, taken), color: langOf(r.language)[1],
      active: commits.some((c) => c.repo === r.full_name),
    });
  });
  const tower = { x: CX, y: CY, code: 'TWR' };

  // ---- flights: runs of commits in one repo, oldest first
  const chrono = commits.slice().sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const legs = [];
  for (const c of chrono) {
    const last = legs.at(-1);
    if (last?.repo === c.repo) last.commits.push(c);
    else if (airports.has(c.repo)) legs.push({ repo: c.repo, commits: [c] });
  }
  legs.forEach((l, i) => { l.from = i ? airports.get(legs[i - 1].repo) : tower; l.to = airports.get(l.repo); });
  const shown = legs.slice(-LEGS);
  const T = (shown.length - 1) * SLOT + FLY + 2;
  const kt = (...ts) => ts.map((t) => (t / T).toFixed(4)).join(';');
  let flights = '', trails = '';
  shown.forEach((l, i) => {
    const { from, to } = l;
    const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
    const dx = to.x - from.x, dy = to.y - from.y;
    const bend = i % 2 ? 0.2 : -0.2;
    const d = `M${f1(from.x)} ${f1(from.y)}Q${f1(mx - dy * bend)} ${f1(my + dx * bend)} ${f1(to.x)} ${f1(to.y)}`;
    trails += `<path d="${d}"/>`;
    const t0 = i * SLOT, t1 = t0 + FLY;
    const loop = `dur="${T.toFixed(2)}s" repeatCount="indefinite"`;
    flights += `<g opacity="0"><animate attributeName="opacity" ${loop} values="0;0;1;1;0;0" keyTimes="${kt(0, t0, t0 + 0.3, t1 - 0.3, t1, T)}"/>`
      + `<animateMotion ${loop} path="${d}" rotate="auto" calcMode="linear" keyPoints="0;0;1;1" keyTimes="${kt(0, t0, t1, T)}"/>`
      + `<path d="${PLANE}" transform="translate(-9 -9) scale(.62)" fill="${to.color}"/></g>`
      // the destination flares on touchdown
      + `<circle cx="${f1(to.x)}" cy="${f1(to.y)}" r="7" fill="none" stroke="${to.color}" stroke-width="2" opacity="0">`
      + `<animate attributeName="opacity" ${loop} values="0;0;.9;0;0" keyTimes="${kt(0, t1 - 0.05, t1, Math.min(t1 + 1, T - 0.01), T)}"/>`
      + `<animate attributeName="r" ${loop} values="7;7;7;22;22" keyTimes="${kt(0, t1 - 0.05, t1, Math.min(t1 + 1, T - 0.01), T)}"/></circle>`;
  });

  // ---- scope: rings, bearings, the sweep
  let scope = '';
  for (const k of [0.25, 0.5, 0.75, 1]) scope += `<circle cx="${CX}" cy="${CY}" r="${R * k}"/>`;
  for (let a = 0; a < 360; a += 30) {
    const [x, y] = polar(a, R);
    scope += `<line x1="${CX}" y1="${CY}" x2="${f1(x)}" y2="${f1(y)}"/>`;
  }
  let ticks = '';
  for (let a = 0; a < 360; a += 5) {
    const [x1, y1] = polar(a, R), [x2, y2] = polar(a, R - (a % 30 ? 4 : 9));
    ticks += `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}"/>`;
  }
  // the beam: thin wedges trailing the leading edge at 0°, fading out behind it
  let beam = '';
  for (let k = 0; k < 16; k++) {
    const [x1, y1] = polar(-(k + 1) * 2.5, R), [x2, y2] = polar(-k * 2.5, R);
    beam += `<path d="M${CX} ${CY}L${f1(x1)} ${f1(y1)}A${R} ${R} 0 0 1 ${f1(x2)} ${f1(y2)}Z" opacity="${(0.34 * (1 - k / 16) ** 2).toFixed(3)}"/>`;
  }
  const [ex, ey] = polar(0, R);

  // ---- airports on the scope; each flares when the beam crosses it
  let blips = '';
  for (const a of airports.values()) {
    const delay = ((((a.deg % 360) + 360) % 360) / 360 * SWEEP).toFixed(2);
    blips += `<g>${a.active ? `<circle cx="${f1(a.x)}" cy="${f1(a.y)}" r="9" fill="${a.color}" class="ping" style="animation-delay:${delay}s"/>` : ''}`
      + `<circle cx="${f1(a.x)}" cy="${f1(a.y)}" r="${a.active ? 4.5 : 3}" fill="${a.active ? a.color : '#0b0c0e'}" stroke="${a.color}" stroke-width="1.5"/>`
      + `<text x="${f1(a.x)}" y="${f1(a.y + 18)}" class="code"${a.active ? '' : ' opacity=".35"'}>${a.code}</text></g>`;
  }

  // ---- traffic panel
  const PX = 560;
  const parts = (d) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((p) => [p.type, p.value]));
  const stamp = (d) => { const p = parts(d); return `${p.day} ${p.month.slice(0, 3).toUpperCase()} ${p.hour}:${p.minute}`; };
  const recent = legs.slice().reverse().slice(0, 10);
  let panel = '';
  recent.forEach((l, i) => {
    const y = 128 + i * 38;
    const c = l.commits.at(-1);
    const n = l.commits.length;
    const msg = c.private ? '[ CLASSIFIED ]' : c.message.length > 44 ? c.message.slice(0, 43) + '…' : c.message;
    panel += `<text x="${PX}" y="${y}" class="row">${stamp(new Date(c.date))}`
      + `<tspan x="${PX + 118}" fill="#8a8f98">${l.from.code} →</tspan>`
      + `<tspan x="${PX + 170}" fill="${l.to.color}">${l.to.code}</tspan>`
      + `<tspan x="${PX + 212}" fill="#8a8f98">${n > 1 ? `×${n} COMMITS` : c.sha.slice(0, 7)}</tspan></text>`
      + `<text x="${PX}" y="${y + 15}" class="msg"${c.private ? ' fill="#6cb6ff"' : ''}>${esc(msg)}</text>`;
  });
  if (!recent.length) panel = `<text x="${PX}" y="140" class="row">NO TRAFFIC — CLEAR SKIES</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">
<title id="t">Radar — ${esc(login)}</title>
<desc id="d">${commits.length} commits in the last ${days} days across ${[...airports.values()].filter((a) => a.active).length} repos</desc>
<style>
text{font-family:${MONO};font-weight:700}
.scope{fill:none;stroke:${GREEN};stroke-opacity:.16}
.ticks{stroke:${GREEN};stroke-opacity:.4}
.trails{fill:none;stroke:#f2f2f2;stroke-opacity:.13;stroke-dasharray:3 5}
.beam{fill:${GREEN};transform-origin:${CX}px ${CY}px;animation:turn ${SWEEP}s linear infinite}
@keyframes turn{to{transform:rotate(360deg)}}
.ping{opacity:0;animation:ping ${SWEEP}s ease-out infinite}
@keyframes ping{0%{opacity:.55}35%,100%{opacity:0}}
.code{font-size:10px;fill:#e6e6e6;text-anchor:middle;letter-spacing:1px}
.row{font-size:11px;fill:#f2f2f2}
.msg{font-size:10.5px;fill:#8a8f98;font-weight:500}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style>
<defs>
<radialGradient id="glow"><stop offset="0" stop-color="${GREEN}" stop-opacity=".07"/><stop offset="1" stop-color="${GREEN}" stop-opacity="0"/></radialGradient>
<clipPath id="disc"><circle cx="${CX}" cy="${CY}" r="${R}"/></clipPath>
</defs>
<rect width="${W}" height="${H}" rx="14" fill="#0b0c0e"/>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="13" fill="none" stroke="#26282d"/>

<circle cx="${CX}" cy="${CY}" r="${R}" fill="url(#glow)"/>
<g class="scope">${scope}</g>
<g class="ticks">${ticks}</g>
<g clip-path="url(#disc)"><g class="beam">${beam}<line x1="${CX}" y1="${CY}" x2="${f1(ex)}" y2="${f1(ey)}" stroke="${GREEN}" stroke-opacity=".8"/></g></g>
<g class="trails">${trails}</g>
${blips}
<rect x="${CX - 15}" y="${CY - 9}" width="30" height="18" rx="3" fill="#0b0c0e" stroke="#ffcc00"/>
<text x="${CX}" y="${CY + 4}" class="code" fill="#ffcc00" style="fill:#ffcc00">TWR</text>
${flights}

<text x="${PX}" y="56" font-size="22" fill="#f2f2f2" letter-spacing="3">LIVE TRAFFIC</text>
<text x="${PX}" y="78" font-size="11" fill="#8a8f98" letter-spacing="1.5">${commits.length} COMMITS · ${legs.length} FLIGHTS · ${days} DAYS · TWR = ${esc(login.toUpperCase())}</text>
<rect x="${PX}" y="94" width="${W - PX - 24}" height="3" fill="#ffcc00"/>
${panel}
</svg>
`;
}
