// render.mjs — a split-flap departures board, one flight per repo.
//
// Every character is its own flap. Its glyphs are stacked in a strip above
// the cell, and a CSS `steps()` animation drops the strip down so the
// letters rattle through a few random characters before settling. At rest
// (and under prefers-reduced-motion) the strip sits on the final glyph.

import { MONO, langOf, mulberry32, hash, esc, flightNo } from '../lib.mjs';

const CW = 18;          // flap width
const CH = 26;          // flap height
const PITCH = CW + 2;   // flap + gap
const COL_GAP = 14;     // space between columns
const ROW_H = CH + 6;
const STEP = 0.075;     // seconds per flip
const FLIP = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const COLUMNS = [
  { key: 'time', label: 'TIME', len: 5 },
  { key: 'dest', label: 'DESTINATION', len: 16 },
  { key: 'flight', label: 'FLIGHT', len: 6 },
  { key: 'gate', label: 'GATE', len: 4 },
  { key: 'remark', label: 'REMARKS', len: 9 },
];

const REMARKS = {
  BOARDING: '#3ddc84', 'ON TIME': '#f2f2f2', DELAYED: '#ffb000',
  DEPARTED: '#7c7c7c', CANCELLED: '#ff4d4d',
};

function remark(repo, now) {
  if (repo.archived) return 'CANCELLED';
  const days = (now - Date.parse(repo.pushed_at)) / 86400000;
  if (days <= 7) return 'BOARDING';
  if (days <= 45) return 'ON TIME';
  if (days <= 365) return 'DELAYED';
  return 'DEPARTED';
}

function toFlight(repo, now, timeZone) {
  const [owner, name] = repo.full_name.split('/');
  const [gate, color] = langOf(repo.language);
  return {
    time: new Intl.DateTimeFormat('en-GB', {
      timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(repo.pushed_at)),
    dest: name.toUpperCase(),
    flight: flightNo(repo.full_name),
    gate,
    color,
    remark: remark(repo, now),
    owner,
    private: repo.private,
    description: repo.description,
    stars: repo.stargazers_count || 0,
  };
}

/** One row of flaps for a string. Returns [backgrounds, glyph strips, seams]. */
function flaps(str, len, x0, y0, row, col0, rand) {
  let bg = '', txt = '', seam = '';
  for (let j = 0; j < len; j++) {
    const x = x0 + j * PITCH;
    const ch = str[j] || ' ';
    bg += `<rect x="${x}" y="${y0}" width="${CW}" height="${CH}" rx="2"/>`;
    seam += `<rect x="${x}" y="${y0 + CH / 2 - 0.5}" width="${CW}" height="1"/>`;

    const k = ch === ' ' ? 1 + Math.floor(rand() * 3) : 3 + Math.floor(rand() * 7);
    const seq = Array.from({ length: k - 1 }, () => FLIP[Math.floor(rand() * FLIP.length)]);
    seq.push(ch);
    if (seq.every((c) => c === ' ')) continue;
    const delay = 0.4 + row * 0.09 + (col0 + j) * 0.018 + rand() * 0.15;
    const base = y0 + CH / 2 + 7;
    const spans = seq.map((c, i) =>
      c === ' ' ? '' : `<tspan x="${x + CW / 2}" y="${base - (k - 1 - i) * CH}">${esc(c)}</tspan>`).join('');
    txt += k > 1
      ? `<text class="k${k}" style="animation-delay:${delay.toFixed(2)}s">${spans}</text>`
      : `<text>${spans}</text>`;
  }
  return [bg, txt, seam];
}

// a little plane, pointing right, about 28px wide
const PLANE = 'M2 14.5l6-.4 5.6-9.1h3.2l-3 9 7.2-.5 2.5-3.3h2.3l-1.4 4.8 1.4 4.8h-2.3l-2.5-3.3-7.2-.5 3 9h-3.2L8 16.9l-6-.4z';

export function renderBoard({ login, profile, repos, passengers = [], timeZone, now }) {
  const rand = mulberry32(hash(login) ^ Math.floor(now / 86400000));
  const flights = repos
    .slice()
    .sort((a, b) => Date.parse(b.pushed_at) - Date.parse(a.pushed_at))
    .map((r) => toFlight(r, now, timeZone));

  const X0 = 36;          // after the language stripe
  const colX = [];
  let cx = X0;
  for (const c of COLUMNS) { colX.push(cx); cx += c.len * PITCH + COL_GAP; }
  const W = cx - COL_GAP + 24;
  const ROWS_Y = 158;
  const TICKER_Y = ROWS_Y + flights.length * ROW_H + 18;
  const H = TICKER_Y + 34 + 18;

  // ---- rows
  let rows = '', clips = '';
  flights.forEach((f, i) => {
    const y = ROWS_Y + i * ROW_H;
    clips += `<clipPath id="r${i}"><rect x="0" y="${y}" width="${W}" height="${CH}"/></clipPath>`;
    let bg = '', txt = '', seam = '', col0 = 0;
    COLUMNS.forEach((c, ci) => {
      const [b, t, s] = flaps(f[c.key], c.len, colX[ci], y, i, col0, rand);
      bg += b; seam += s; col0 += c.len;
      const fill = c.key === 'remark' ? REMARKS[f.remark] : c.key === 'gate' ? f.color : '#f2f2f2';
      const blink = c.key === 'remark' && f.remark === 'BOARDING' ? ' class="blink"' : '';
      txt += `<g fill="${fill}"${blink}>${t}</g>`;
    });
    rows += `<g><rect x="18" y="${y + 3}" width="6" height="${CH - 6}" rx="1.5" fill="${f.color}"/>`
      + `<g class="flap">${bg}</g><g class="fl" clip-path="url(#r${i})">${txt}</g><g class="seam">${seam}</g></g>`;
  });

  // ---- column labels
  const labels = COLUMNS.map((c, i) =>
    `<text x="${colX[i]}" y="${ROWS_Y - 12}">${c.label}</text>`).join('');

  // ---- header
  const stars = repos.reduce((n, r) => n + (r.stargazers_count || 0), 0);
  const langs = new Set(repos.map((r) => r.language).filter(Boolean)).size;
  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(now).split(':');
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone, day: '2-digit', month: 'short', year: 'numeric',
  }).format(now).toUpperCase();
  const city = timeZone.split('/').pop().replace(/_/g, ' ').toUpperCase();
  const summary = [
    `${esc(login.toUpperCase())} INTERNATIONAL`,
    `${flights.length} FLIGHTS`,
    `${langs} GATES`,
    `★ ${stars}`,
    ...(profile ? [`${profile.followers} FOLLOWERS`] : []),
  ].join('   ·   ');

  // ---- ticker: codeshares first, then what each flight is about
  const partners = [...new Set(flights.map((f) => f.owner).filter((o) => o.toLowerCase() !== login.toLowerCase()))];
  const items = [
    ...(partners.length ? [`CODESHARE WITH ${partners.join(' · ').toUpperCase()}`] : []),
    ...flights.filter((f) => f.description && !f.private)
      .map((f) => `${f.flight} ${f.dest} — ${f.description}`),
    ...(passengers.length ? [`WELCOME ABOARD ${passengers.slice(0, 8).map((p) => '@' + p.login).join(' · ')}`] : []),
    `THANK YOU FOR FLYING ${login.toUpperCase()}`,
  ];
  // one <text> per item, placed on an estimated monospace advance; the
  // gaps between items soak up the error, so the loop seam stays clean
  const charW = 7.9, gap = 60;
  let tickerLen = 0, tickerItems = '';
  for (const it of items) {
    tickerItems += `<text x="${tickerLen}" y="0">${esc(it)}</text><text x="${Math.round(tickerLen + [...it].length * charW + gap / 2 - 6)}" y="0" fill="#5a5a5a">✦</text>`;
    tickerLen += Math.round([...it].length * charW + gap);
  }
  const tickerDur = (tickerLen / 45).toFixed(1);

  const keyframes = Array.from({ length: 8 }, (_, i) => i + 2).map((k) =>
    `@keyframes s${k}{from{transform:translateY(${(k - 1) * CH}px)}to{transform:none}}`
    + `.k${k}{animation:s${k} ${((k - 1) * STEP).toFixed(3)}s steps(${k - 1},end) backwards}`).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">
<title id="t">Departures — ${esc(login)}</title>
<desc id="d">${esc(flights.map((f) => `${f.flight} to ${f.dest}, ${f.remark.toLowerCase()}`).join('; '))}</desc>
<style>
text{font-family:${MONO};font-weight:700}
.flap rect{fill:#1b1c1f}
.seam rect{fill:#000;opacity:.55}
.fl text{font-size:19px;text-anchor:middle}
.lbl text{font-size:11px;fill:#8a8f98;letter-spacing:2px}
${keyframes}
@keyframes bl{0%,60%{opacity:1}61%,100%{opacity:.25}}
.blink{animation:bl 1.4s 3.5s infinite}
@keyframes colon{50%{opacity:0}}
.colon{animation:colon 2s steps(1) infinite}
@keyframes tick{to{transform:translateX(-${tickerLen}px)}}
.tick{animation:tick ${tickerDur}s linear infinite}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style>
<defs>${clips}<clipPath id="tk"><rect x="18" y="${TICKER_Y}" width="${W - 36}" height="34"/></clipPath></defs>
<rect width="${W}" height="${H}" rx="14" fill="#0b0c0e"/>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="13" fill="none" stroke="#26282d"/>

<g transform="translate(24 30)"><path d="${PLANE}" transform="translate(38 0) scale(-1.35 1.35)" fill="#ffcc00"/></g>
<text x="68" y="56" font-size="30" fill="#f2f2f2" letter-spacing="3">DEPARTURES</text>
<text x="70" y="78" font-size="13" fill="#8a8f98" font-style="italic" letter-spacing="2">DÉPARTS · ABFLUG · SALIDAS</text>
<text x="${W - 24}" y="58" font-size="34" fill="#ffb000" text-anchor="end">${clock[0]}<tspan class="colon">:</tspan>${clock[1]}</text>
<text x="${W - 24}" y="78" font-size="11" fill="#8a8f98" text-anchor="end" letter-spacing="1.5">UPDATED ${day} · ${esc(city)}</text>
<rect x="18" y="94" width="${W - 36}" height="3" fill="#ffcc00"/>
<text x="24" y="120" font-size="11" fill="#c8ccd2" letter-spacing="1.5">${summary}</text>

<g class="lbl">${labels}</g>
${rows}

<rect x="18" y="${TICKER_Y}" width="${W - 36}" height="34" rx="4" fill="#15161a"/>
<g clip-path="url(#tk)"><g transform="translate(30 ${TICKER_Y + 22})"><g class="tick" font-size="13" fill="#ffb000">
<g>${tickerItems}</g><g transform="translate(${tickerLen} 0)">${tickerItems}</g>
</g></g></g>
</svg>
`;
}
