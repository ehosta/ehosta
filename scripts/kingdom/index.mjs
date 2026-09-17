// index.mjs — fetch the repos, hand them to the renderer, write the file.
//
//   GITHUB_USER   whose repos to map     (required)
//   GITHUB_TOKEN  raises the rate limit  (optional locally, set in Actions)
//   OUT           output path            (default: kingdom.svg)
//   INCLUDE_FORKS "true" to map forks    (default: false)
//   MAX_REPOS     cap the settlements    (default: 26)
//   ONLY_REPOS    allow-list, comma-separated, `*` allowed. If set, nothing
//                 else is mapped — forks included if you name them.
//   IGNORE_REPOS  deny-list, same format. Applied before ONLY_REPOS.
//   EXTRA_REPOS   other people's public repos to map too, as owner/name,
//                 comma-separated. Fetched one by one.
//   EXTRA_WEIGHT  how much those count toward becoming the capital
//                 (default: 0.6, so a 20k-star project you touched once
//                 does not outrank your own work)
//   CAPITAL       pin one repo as the capital, by name or owner/name,
//                 whatever its weight

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { renderKingdom } from './render.mjs';
import { mulberry32, hashString } from './geo.mjs';

const OCEANS = [
  'Mare Incognitum', 'The Sundering Sea', 'Sea of Forks',
  'The Deprecated Deep', 'Mare Refactorum', 'The Unmerged Waters',
  'Sea of Open Issues', 'The Detached Head',
];
const REALM_FORMS = [
  (n) => `Realm of ${n}`,
  (n) => `Dominion of ${n}`,
  (n) => `The ${n} Reach`,
  (n) => `Marches of ${n}`,
];

/** One repo by owner/name. Returns null instead of throwing on 404. */
async function fetchOne(fullName, token) {
  const res = await fetch(`https://api.github.com/repos/${fullName}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'kingdom-of-repos',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (res.status === 404) return null; // gone, private, or a typo
  if (!res.ok) throw new Error(`GitHub API ${res.status} on ${fullName}`);
  return res.json();
}

async function fetchRepos(user, token) {
  const out = [];
  for (let page = 1; page <= 4; page++) {
    const url = `https://api.github.com/users/${encodeURIComponent(user)}`
      + `/repos?per_page=100&page=${page}&type=owner&sort=updated`;
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'kingdom-of-repos',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const batch = await res.json();
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

/** Comma-separated list of repo names, `*` allowed. Returns null if empty. */
function matcher(list) {
  const pats = String(list || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!pats.length) return null;
  const rx = pats.map((p) => new RegExp(
    `^${p.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i'));
  return (name) => rx.some((r) => r.test(name));
}

export function rankRepos(raw, {
  includeForks = false, max = 26, only, ignore, extraWeight = 0.6, capital,
} = {}) {
  const allow = matcher(only);
  const isCapital = matcher(capital);
  const deny = matcher(ignore);
  const now = Date.now();
  const named = (r) => [r.name, r.full_name];
  return raw
    .filter((r) => {
      if (r.private) return false;
      if (deny && named(r).some(deny)) return false;
      // an explicit allow-list wins over the fork rule: if you named it, you want it
      if (allow) return named(r).some(allow);
      if (r._external) return true; // listed in EXTRA_REPOS, so always wanted
      return includeForks || !r.fork;
    })
    .map((r) => {
      const ageDays = (now - Date.parse(r.pushed_at || r.updated_at)) / 86400000;
      const freshness = Math.exp(-ageDays / 420); // 0..1, halves roughly every 10 months
      return {
        name: r.name,
        fullName: r.full_name,
        language: r.language,
        stars: r.stargazers_count || 0,
        forks: r.forks_count || 0,
        size: r.size || 0,
        archived: !!r.archived,
        external: !!r._external,
        weight: (
          (r.stargazers_count || 0) * 4 +
          (r.forks_count || 0) * 2 +
          Math.log2((r.size || 0) + 2) * 1.4 +
          freshness * 6 +
          1
        ) * (r._external ? extraWeight : 1),
      };
    })
    .sort((a, b) => {
      if (isCapital) {
        const ca = isCapital(a.name) || isCapital(a.fullName);
        const cb = isCapital(b.name) || isCapital(b.fullName);
        if (ca !== cb) return ca ? -1 : 1;
      }
      return b.weight - a.weight;
    })
    .slice(0, max);
}

async function main() {
  const user = process.env.GITHUB_USER;
  if (!user) throw new Error('GITHUB_USER is not set');
  const out = process.env.OUT || 'kingdom.svg';

  const token = process.env.GITHUB_TOKEN;
  const raw = await fetchRepos(user, token);

  const extraNames = String(process.env.EXTRA_REPOS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  for (const full of extraNames) {
    if (!full.includes('/')) {
      console.warn(`skipping "${full}" — EXTRA_REPOS wants owner/name`);
      continue;
    }
    if (raw.some((r) => r.full_name?.toLowerCase() === full.toLowerCase())) continue;
    const repo = await fetchOne(full, token);
    if (!repo) { console.warn(`skipping ${full} — not found or not public`); continue; }
    raw.push({ ...repo, _external: true });
  }

  const repos = rankRepos(raw, {
    includeForks: process.env.INCLUDE_FORKS === 'true',
    max: Number(process.env.MAX_REPOS || 26),
    only: process.env.ONLY_REPOS,
    ignore: process.env.IGNORE_REPOS,
    extraWeight: Number(process.env.EXTRA_WEIGHT || 0.6),
    capital: process.env.CAPITAL,
  });
  if (!repos.length) {
    throw new Error(`Nothing left to map for ${user} — `
      + `${raw.length} repos fetched, all filtered out by ONLY_REPOS/IGNORE_REPOS`);
  }

  const rand = mulberry32(hashString(user) ^ 0xa11ce);
  const svg = renderKingdom({
    login: user,
    repos,
    oceanName: OCEANS[Math.floor(rand() * OCEANS.length)],
    kingdomName: REALM_FORMS[Math.floor(rand() * REALM_FORMS.length)](user),
  });

  await mkdir(dirname(out), { recursive: true }).catch(() => {});
  await writeFile(out, svg, 'utf8');
  const ext = repos.filter((r) => r.external).length;
  console.log(`${out} — ${repos.length} settlements`
    + (ext ? ` (${ext} from other owners)` : '')
    + `, ${(svg.length / 1024).toFixed(0)} kB`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
