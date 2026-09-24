// index.mjs — issue a boarding pass to whoever opened the "Boarding pass" issue.
//
//   PASSENGER     their GitHub login                            (required)
//   HOST          whose airline this is                         (required)
//   GITHUB_TOKEN  raises the rate limit                         (optional locally)
//   TZ_NAME       timezone printed on the pass   (default: Europe/Paris)
//
// Writes assets/passes/<login>.svg and puts them at the top of
// assets/passengers.json, which the departures board reads.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { renderPass } from './render.mjs';
import { gh } from '../lib.mjs';

const MANIFEST = 'assets/passengers.json';

async function avatarURI(url) {
  try {
    const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}s=120`);
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || 'image/png';
    return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
  } catch { return null; }
}

async function main() {
  const login = process.env.PASSENGER;
  const host = process.env.HOST;
  if (!/^[A-Za-z0-9-]{1,39}$/.test(login || '')) throw new Error(`bad PASSENGER "${login}"`);
  if (!host) throw new Error('HOST is not set');
  const token = process.env.GITHUB_TOKEN;

  const user = await gh(`/users/${login}`, token);
  if (!user) throw new Error(`no such user ${login}`);
  const repos = await gh(`/users/${login}/repos?per_page=100&type=owner&sort=pushed`, token) || [];
  const count = {};
  for (const r of repos) if (!r.fork && r.language) count[r.language] = (count[r.language] || 0) + 1;
  const top = Object.entries(count).sort((a, b) => b[1] - a[1]).map(([l]) => l);

  const svg = renderPass({
    host, user, top,
    avatar: await avatarURI(user.avatar_url),
    now: new Date(), timeZone: process.env.TZ_NAME || 'Europe/Paris',
  });
  await mkdir('assets/passes', { recursive: true });
  const out = `assets/passes/${login.toLowerCase()}.svg`;
  await writeFile(out, svg, 'utf8');

  const list = await readFile(MANIFEST, 'utf8').then(JSON.parse, () => []);
  const manifest = [
    { login: user.login, to: top[0] || null, at: new Date().toISOString() },
    ...list.filter((p) => p.login.toLowerCase() !== login.toLowerCase()),
  ].slice(0, 100);
  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`${out} — ${user.login} to ${top[0] || 'nowhere'}`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
