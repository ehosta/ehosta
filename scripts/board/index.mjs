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
import { gh, repoList } from '../lib.mjs';

const DAY = 86400000;

/**
 * Work that took off but hasn't landed: a branch you pushed to in the last
 * 14 days that still exists and is ahead of the default branch, or an open
 * PR of yours touched in the last 30. Returns { branch } / { pr } or null.
 */
async function inFlight(repo, user, token, now) {
  const mine = (login) => login?.toLowerCase() === user.toLowerCase();
  const pulls = await gh(`/repos/${repo.full_name}/pulls?state=open&sort=updated&direction=desc&per_page=20`, token) || [];
  const pr = pulls.find((p) => mine(p.user?.login) && now - Date.parse(p.updated_at) <= 30 * DAY);
  if (pr) return { pr: pr.number, title: pr.title };

  const events = await gh(`/repos/${repo.full_name}/events?per_page=100`, token) || [];
  const refs = new Set();
  for (const e of events) {
    if (e.type !== 'PushEvent' || !mine(e.actor?.login)) continue;
    if (now - Date.parse(e.created_at) > 14 * DAY) break; // newest first
    const branch = e.payload?.ref?.replace(/^refs\/heads\//, '');
    if (branch && branch !== repo.default_branch) refs.add(branch);
  }
  for (const branch of refs) {
    const cmp = await gh(`/repos/${repo.full_name}/compare/${encodeURIComponent(repo.default_branch)}...${encodeURIComponent(branch)}`, token);
    if (cmp?.ahead_by > 0) return { branch }; // null: branch deleted, i.e. it landed
  }
  return null;
}

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
    r._inFlight = r.archived ? null : await inFlight(r, user, token, Date.now());
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
