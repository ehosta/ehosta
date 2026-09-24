// lib.mjs — what the board, the radar and the boarding pass share.

// a plane seen from above, nose pointing right (+x), about 29×29 around (14.5, 14.5).
// Pointing right matters: animateMotion's rotate="auto" lines +x up with the path.
export const PLANE = 'M27 14.5l-6-.4-5.6-9.1h-3.2l3 9-7.2-.5-2.5-3.3h-2.3l1.4 4.8-1.4 4.8h2.3l2.5-3.3 7.2-.5-3 9h3.2L21 16.9l6-.4z';

export const MONO = `ui-monospace,'SF Mono',SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace`;

// short code, and a colour legible on black
export const LANGS = {
  TypeScript: ['TS', '#4a9eff'], JavaScript: ['JS', '#f1e05a'],
  C: ['C', '#a8b9cc'], 'C++': ['CPP', '#f34b7d'], Python: ['PY', '#5a9fd4'],
  Rust: ['RS', '#dea584'], Go: ['GO', '#00add8'], Shell: ['SH', '#89e051'],
  Makefile: ['MK', '#7fbf3f'], Assembly: ['ASM', '#c79a5b'],
  Dockerfile: ['DKR', '#2496ed'], HTML: ['HTM', '#e34c26'],
  CSS: ['CSS', '#9b6bdf'], Java: ['JAV', '#d98b2b'], Brainfuck: ['BF', '#d0d0d0'],
  Vue: ['VUE', '#41b883'], PHP: ['PHP', '#8892bf'], Ruby: ['RB', '#e0115f'],
  Kotlin: ['KT', '#a97bff'], Swift: ['SW', '#f05138'], 'C#': ['CS', '#68b04d'],
  Lua: ['LUA', '#6b8cff'], Haskell: ['HS', '#8f6fd1'], Dart: ['DRT', '#00b4ab'],
  Zig: ['ZIG', '#ec915c'], OCaml: ['ML', '#ef7a08'], Elixir: ['EX', '#a57bc7'],
};
export const langOf = (name) => LANGS[name] || ['--', '#5a5a5a'];

export function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash(str) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** "HirumaBot" → "HB", "SpinUp-CLI" → "SU", "mdourdoi" → "MD" */
export function airline(owner) {
  const head = owner.split(/[-_.]/)[0];
  const caps = head.replace(/[^A-Z]/g, '');
  return (caps.length >= 2 ? caps : head).slice(0, 2).toUpperCase();
}

export const flightNo = (fullName) => `${airline(fullName.split('/')[0])} ${100 + (hash(fullName) % 900)}`;

/** GET on the REST API. Returns null instead of throwing on 404/409 (missing, no access, empty repo). */
export async function gh(path, token) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ehosta-airport',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (res.status === 404 || res.status === 409) return null;
  if (!res.ok) throw new Error(`GitHub API ${res.status} on ${path}`);
  return res.json();
}

/** REPOS env → full names. A bare name belongs to `user`. */
export const repoList = (env, user) => String(env || '')
  .split(',').map((s) => s.trim()).filter(Boolean)
  .map((n) => (n.includes('/') ? n : `${user}/${n}`));
