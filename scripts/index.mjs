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

export function rankRepos(raw, { includeForks = false, max = 26, only, ignore } = {}) {
  const allow = matcher(only);
  const deny = matcher(ignore);
  const now = Date.now();
  return raw
    .filter((r) => {
      if (r.private) return false;
      if (deny && deny(r.name)) return false;
      // an explicit allow-list wins over the fork rule: if you named it, you want it
      if (allow) return allow(r.name);
      return includeForks || !r.fork;
    })
    .map((r) => {
      const ageDays = (now - Date.parse(r.pushed_at || r.updated_at)) / 86400000;
      const freshness = Math.exp(-ageDays / 420); // 0..1, halves roughly every 10 months
      return {
        name: r.name,
        language: r.language,
        stars: r.stargazers_count || 0,
        forks: r.forks_count || 0,
        size: r.size || 0,
        archived: !!r.archived,
        weight:
          (r.stargazers_count || 0) * 4 +
          (r.forks_count || 0) * 2 +
          Math.log2((r.size || 0) + 2) * 1.4 +
          freshness * 6 +
          1,
      };
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, max);
}

async function main() {
  const user = process.env.GITHUB_USER;
  if (!user) throw new Error('GITHUB_USER is not set');
  const out = process.env.OUT || 'kingdom.svg';

  const raw = await fetchRepos(user, process.env.GITHUB_TOKEN);
  const repos = rankRepos(raw, {
    includeForks: process.env.INCLUDE_FORKS === 'true',
    max: Number(process.env.MAX_REPOS || 26),
    only: process.env.ONLY_REPOS,
    ignore: process.env.IGNORE_REPOS,
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
  console.log(`${out} — ${repos.length} settlements, ${(svg.length / 1024).toFixed(0)} kB`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
