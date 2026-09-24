// index.mjs — fetch the flights, hand them to the renderer, write the file.
//
//   GITHUB_USER   whose board this is                          (required)
//   GITHUB_TOKEN  needed for private repos, raises rate limit  (optional locally)
//   REPOS         comma-separated. A bare name is one of yours,
//                 owner/name is anyone's.                      (required)
//   OUT           output path                    (default: assets/departures.svg)
//   TZ_NAME       timezone for the TIME column   (default: Europe/Paris)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { renderBoard } from './render.mjs';
import { gh, repoList } from '../lib.mjs';

async function main() {
  const user = process.env.GITHUB_USER;
  if (!user) throw new Error('GITHUB_USER is not set');
  const token = process.env.GITHUB_TOKEN;
  const out = process.env.OUT || 'assets/departures.svg';

  const names = repoList(process.env.REPOS, user);
  if (!names.length) throw new Error('REPOS is empty');

  const repos = [];
  for (const full of names) {
    const r = await gh(`/repos/${full}`, token);
    if (!r) { console.warn(`skipping ${full} — not found or no access`); continue; }
    repos.push(r);
  }
  const profile = await gh(`/users/${encodeURIComponent(user)}`, token);
  // written by the boarding-pass workflow, newest first
  const passengers = await readFile('assets/passengers.json', 'utf8').then(JSON.parse, () => []);

  const svg = renderBoard({
    login: user,
    profile,
    repos,
    passengers,
    timeZone: process.env.TZ_NAME || 'Europe/Paris',
    now: new Date(),
  });

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, svg, 'utf8');
  console.log(`${out} — ${repos.length} flights, ${(svg.length / 1024).toFixed(0)} kB`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
