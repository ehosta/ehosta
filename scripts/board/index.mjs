// index.mjs — fetch the flights, hand them to the renderer, write the file.
//
//   GITHUB_USER   whose board this is                          (required)
//   GITHUB_TOKEN  needed for private repos, raises rate limit  (optional locally)
//   REPOS         comma-separated. A bare name is one of yours,
//                 owner/name is anyone's.                      (required)
//   OUT           output path                    (default: assets/departures.svg)
//   TZ_NAME       timezone for the TIME column   (default: Europe/Paris)

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { renderBoard } from './render.mjs';

async function gh(path, token) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'departures-board',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (res.status === 404) return null; // gone, private without access, or a typo
  if (!res.ok) throw new Error(`GitHub API ${res.status} on ${path}`);
  return res.json();
}

async function main() {
  const user = process.env.GITHUB_USER;
  if (!user) throw new Error('GITHUB_USER is not set');
  const token = process.env.GITHUB_TOKEN;
  const out = process.env.OUT || 'assets/departures.svg';

  const names = String(process.env.REPOS || '')
    .split(',').map((s) => s.trim()).filter(Boolean)
    .map((n) => (n.includes('/') ? n : `${user}/${n}`));
  if (!names.length) throw new Error('REPOS is empty');

  const repos = [];
  for (const full of names) {
    const r = await gh(`/repos/${full}`, token);
    if (!r) { console.warn(`skipping ${full} — not found or no access`); continue; }
    repos.push(r);
  }
  const profile = await gh(`/users/${encodeURIComponent(user)}`, token);

  const svg = renderBoard({
    login: user,
    profile,
    repos,
    timeZone: process.env.TZ_NAME || 'Europe/Paris',
    now: new Date(),
  });

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, svg, 'utf8');
  console.log(`${out} — ${repos.length} flights, ${(svg.length / 1024).toFixed(0)} kB`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
