// index.mjs — fetch recent commits on each repo, draw the radar.
//
//   GITHUB_USER   whose commits to track                        (required)
//   GITHUB_TOKEN  needed for private repos                      (optional locally)
//   REPOS         same list as the departures board             (required)
//   DAYS          how far back to look                          (default: 60)
//   OUT           output path                    (default: assets/radar.svg)
//   TZ_NAME       timezone for the traffic list  (default: Europe/Paris)

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { renderRadar } from './render.mjs';
import { gh, repoList } from '../lib.mjs';

async function main() {
  const user = process.env.GITHUB_USER;
  if (!user) throw new Error('GITHUB_USER is not set');
  const token = process.env.GITHUB_TOKEN;
  const out = process.env.OUT || 'assets/radar.svg';
  const days = Number(process.env.DAYS || 60);
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const repos = [], commits = [];
  for (const full of repoList(process.env.REPOS, user)) {
    const r = await gh(`/repos/${full}`, token);
    if (!r) { console.warn(`skipping ${full} — not found or no access`); continue; }
    repos.push(r);
    const list = await gh(`/repos/${full}/commits?author=${encodeURIComponent(user)}&since=${since}&per_page=50`, token) || [];
    for (const c of list) {
      commits.push({
        repo: r.full_name,
        sha: c.sha,
        date: c.commit.author?.date || c.commit.committer?.date,
        message: c.commit.message.split('\n')[0],
        private: r.private,
      });
    }
  }
  // enough history to fill the last few flights; the renderer keeps the latest ones
  commits.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  commits.splice(120);

  const svg = renderRadar({
    login: user, repos, commits, days,
    now: new Date(), timeZone: process.env.TZ_NAME || 'Europe/Paris',
  });
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, svg, 'utf8');
  console.log(`${out} — ${repos.length} airports, ${commits.length} commits, ${(svg.length / 1024).toFixed(0)} kB`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
