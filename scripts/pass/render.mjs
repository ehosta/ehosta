// render.mjs — a boarding pass for one visitor, bound for their main language.

import { MONO, PLANE, langOf, hash, esc, mulberry32 } from '../lib.mjs';

const W = 780, H = 290;
const STUB = 580;   // where the perforation is
const INK = '#16171a', MUTED = '#7a7468', PAPER = '#f6f2e8', YELLOW = '#ffcc00';

const cut = (s, n) => ([...s].length > n ? [...s].slice(0, n - 1).join('') + '…' : s);

function barcode(seed, x, y, w, h) {
  const rand = mulberry32(seed);
  let bars = '', cx = x;
  while (cx < x + w - 4) {
    const bw = 1 + Math.floor(rand() * 3);
    bars += `<rect x="${cx}" y="${y}" width="${bw}" height="${h}"/>`;
    cx += bw + 1 + Math.floor(rand() * 3);
  }
  return bars;
}

function field(x, y, label, value, size = 16) {
  return `<text x="${x}" y="${y}" class="lbl">${label}</text>`
    + `<text x="${x}" y="${y + size + 6}" font-size="${size}" fill="${INK}">${esc(value)}</text>`;
}

/**
 * user     GitHub user object of the passenger
 * top      [language, language, ...] by how many of their repos use it
 * avatar   data: URI or null
 */
export function renderPass({ host, user, top, avatar, now, timeZone }) {
  const dest = top[0] || null;
  const [code, color] = dest ? langOf(dest) : ['???', '#7a7468'];
  const city = (user.location || '').split(/[,/]/)[0].trim();
  const fromCode = (city.replace(/[^A-Za-z]/g, '').slice(0, 3) || 'GIT').toUpperCase().padEnd(3, 'X');
  const name = cut((user.name || user.login).toUpperCase(), 24);
  const flight = `${host.slice(0, 2).toUpperCase()} ${100 + (hash(user.login) % 900)}`;
  const seat = `${(user.id % 38) + 1}${'ABCDEF'[user.id % 6]}`;
  const cls = user.followers >= 500 ? 'FIRST' : user.followers >= 50 ? 'BUSINESS' : 'ECONOMY';
  const gate = `G${(user.public_repos % 40) + 1}`;
  const d = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  const date = `${d.day} ${d.month.slice(0, 3).toUpperCase()} ${d.year}`;
  const since = new Date(user.created_at).getUTCFullYear();
  const via = top[1] ? `VIA ${top[1].toUpperCase()}` : 'NON-STOP';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t">
<title id="t">Boarding pass — ${esc(user.login)} to ${esc(dest || 'somewhere')}</title>
<style>
text{font-family:${MONO};font-weight:700}
.lbl{font-size:9px;fill:${MUTED};letter-spacing:1.5px}
</style>
<defs>
<mask id="notch"><rect width="${W}" height="${H}" rx="16" fill="#fff"/>
<circle cx="${STUB}" cy="0" r="14" fill="#000"/><circle cx="${STUB}" cy="${H}" r="14" fill="#000"/></mask>
<clipPath id="av"><circle cx="58" cy="100" r="26"/></clipPath>
</defs>
<g mask="url(#notch)">
<rect width="${W}" height="${H}" fill="${PAPER}"/>
<rect width="${W}" height="54" fill="#0b0c0e"/>
<rect y="54" width="${W}" height="3" fill="${YELLOW}"/>
<rect x="${W - 12}" y="57" width="12" height="${H - 57}" fill="${color}"/>
</g>
<line x1="${STUB}" y1="18" x2="${STUB}" y2="${H - 18}" stroke="${MUTED}" stroke-opacity=".6" stroke-dasharray="2 5"/>

<path d="${PLANE}" transform="translate(24 12) scale(1.1)" fill="${YELLOW}"/>
<text x="62" y="34" font-size="15" fill="#f2f2f2" letter-spacing="3">${esc(host.toUpperCase())} AIRLINES</text>
<text x="${STUB - 24}" y="34" font-size="12" fill="${YELLOW}" letter-spacing="3" text-anchor="end">BOARDING PASS</text>
<text x="${STUB + 24}" y="34" font-size="12" fill="#8a8f98" letter-spacing="2">${flight}</text>

${avatar ? `<image href="${avatar}" x="32" y="74" width="52" height="52" clip-path="url(#av)"/>` : `<circle cx="58" cy="100" r="26" fill="${color}"/>`}
<circle cx="58" cy="100" r="26" fill="none" stroke="${INK}" stroke-opacity=".15"/>
<text x="98" y="84" class="lbl">PASSENGER</text>
<text x="98" y="106" font-size="19" fill="${INK}">${esc(name)}</text>
<text x="98" y="124" font-size="11" fill="${MUTED}">@${esc(user.login)} · FREQUENT FLYER SINCE ${since}</text>

<text x="32" y="162" class="lbl">FROM</text>
<text x="32" y="206" font-size="46" fill="${INK}" letter-spacing="2">${esc(fromCode)}</text>
<text x="32" y="226" font-size="10" fill="${MUTED}">${esc(cut((city || 'GITHUB').toUpperCase(), 18))}</text>
<g transform="translate(180 176)"><line x1="0" y1="14" x2="110" y2="14" stroke="${MUTED}" stroke-dasharray="3 4"/>
<path d="${PLANE}" transform="translate(112 0)" fill="${INK}"/></g>
<text x="190" y="226" font-size="10" fill="${MUTED}">${esc(via)}</text>
<text x="330" y="162" class="lbl">TO</text>
<text x="330" y="206" font-size="46" fill="${INK}" letter-spacing="2">${esc(code)}</text>
<rect x="${340 + code.length * 30}" y="176" width="14" height="30" rx="3" fill="${color}"/>
<text x="330" y="226" font-size="10" fill="${MUTED}">${esc((dest || 'UNCHARTED').toUpperCase())}</text>

${field(32, 252, 'DATE', date, 12)}
${field(150, 252, 'BOARDING', `${d.hour}:${d.minute}`, 12)}
${field(250, 252, 'GATE', gate, 12)}
${field(330, 252, 'SEAT', seat, 12)}
${field(410, 252, 'CLASS', cls, 12)}

<text x="${STUB + 24}" y="84" class="lbl">PASSENGER</text>
<text x="${STUB + 24}" y="102" font-size="13" fill="${INK}">${esc(cut(user.login.toUpperCase(), 18))}</text>
<text x="${STUB + 24}" y="132" class="lbl">TO</text>
<text x="${STUB + 24}" y="152" font-size="15" fill="${INK}">${esc(cut((dest || 'UNCHARTED').toUpperCase(), 16))}</text>
${field(STUB + 24, 180, 'SEAT', seat, 22)}
${field(STUB + 100, 180, 'GATE', gate, 22)}
<g fill="${INK}">${barcode(hash(user.login), STUB + 24, 234, 140, 34)}</g>
</svg>
`;
}
