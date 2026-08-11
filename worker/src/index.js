// TLDB backend — Cloudflare Worker + D1.
//
// Holds the real admin password server-side (set via `wrangler secret put
// ADMIN_PASSWORD`, never committed to the repo) and now also the catalog
// itself (D1 database `tldb-db`, table `books`), replacing the static
// libraryDB.csv as the live source of truth. The CSV stays in the repo as
// an independent weekly-refreshed backup (see backupToGithub below), but
// the site reads and writes through this Worker.
//
// Routes:
//   POST /check-password      { password } -> { ok }
//   GET  /books                            -> { books: [...] }  (public read)
//   POST /books   { password, book: {...} } -> { ok, book } | { ok:false, error }
//     Upserts by bookId (INSERT OR REPLACE) — used by admin.js's Approve
//     button. Requires the same password as the gate; there's no separate
//     session/token system yet, matching the "shared password" model this
//     whole admin tool already uses.
//   POST /backup-now  { password } -> { ok, committed }
//     Manual trigger for the same export the weekly cron runs (see
//     scheduled() below) — lets us test/force a backup without waiting a
//     week.

const ALLOWED_ORIGIN = 'https://vladislavgeneralov.github.io';

const DB_COLUMNS = [
  'bookId', 'num', 'authors', 'name', 'publisher', 'year', 'isbn',
  'languages', 'genres', 'condition', 'status', 'createdAt', 'updatedAt',
  'storageCell', 'qrLink', 'imageLink',
];
const REQUIRED_FIELDS = ['bookId', 'name', 'authors', 'status', 'createdAt', 'updatedAt'];
const BOOK_ID_PATTERN = /^TL\d{9}$/;

// Column id -> CSV header label, in the exact order/wording of the
// original libraryDB.csv (data.js's COLUMNS on the frontend) — kept
// separate from DB_COLUMNS (storage order, bookId-first for the PRIMARY
// KEY) so the weekly backup's CSV stays diff-clean against history.
const CSV_COLUMNS = [
  ['num', '№'], ['bookId', 'BOOK ID'], ['authors', 'AUTHOR(S)'],
  ['name', 'BOOK NAME'], ['publisher', 'PUBLISHER'], ['year', 'YEAR'],
  ['isbn', 'ISBN'], ['languages', 'LANGUAGE(S)'], ['genres', 'GENRE(S)'],
  ['condition', 'CONDITION (0-5)'], ['status', 'STATUS'],
  ['createdAt', 'REC CREATION DATE'], ['updatedAt', 'REC UPDATE DATE'],
  ['storageCell', 'STORAGE CELL'], ['qrLink', 'QR LINK'], ['imageLink', 'IMAGE LINK'],
];

const GITHUB_OWNER = 'VladislavGeneralov';
const GITHUB_REPO = 'tldb-web';
const GITHUB_CSV_PATH = 'docs/data/libraryDB.csv';
const GITHUB_BRANCH = 'master';

// Shared budget across every password-protected route (not per-route) —
// an attacker splitting attempts across /check-password, POST /books and
// /backup-now shouldn't get a bigger effective allowance than someone
// hammering just one of them.
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_SECONDS = 60;

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);
    const isPasswordRoute =
      (url.pathname === '/check-password' && request.method === 'POST') ||
      (url.pathname === '/books' && request.method === 'POST') ||
      (url.pathname === '/backup-now' && request.method === 'POST');

    if (isPasswordRoute && !(await checkRateLimit(request, env))) {
      return withCors(jsonResponse(
        { ok: false, error: 'Too many attempts — try again in a minute.' },
        429
      ));
    }

    if (url.pathname === '/check-password' && request.method === 'POST') {
      return withCors(await handleCheckPassword(request, env));
    }
    if (url.pathname === '/books' && request.method === 'GET') {
      return withCors(await handleListBooks(env));
    }
    if (url.pathname === '/books' && request.method === 'POST') {
      return withCors(await handleSaveBook(request, env));
    }
    if (url.pathname === '/backup-now' && request.method === 'POST') {
      return withCors(await handleBackupNow(request, env));
    }

    return withCors(new Response('Not found', { status: 404 }));
  },

  // Weekly cron (see [triggers] in wrangler.toml) — independent backup of
  // the D1 catalog outside Cloudflare, since D1's own Time Travel only
  // covers a rolling window and lives in the same account/provider.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(backupToGithub(env));
  },
};

async function handleCheckPassword(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'bad request' }, 400);
  }
  const submitted = typeof body.password === 'string' ? body.password : '';
  const correct = timingSafeEqual(submitted, env.ADMIN_PASSWORD || '');
  return jsonResponse({ ok: correct }, correct ? 200 : 401);
}

async function handleListBooks(env) {
  const { results } = await env.DB.prepare(
    `SELECT ${DB_COLUMNS.join(', ')} FROM books ORDER BY bookId`
  ).all();
  return jsonResponse({ ok: true, books: results });
}

async function handleSaveBook(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'bad request' }, 400);
  }

  const submitted = typeof body.password === 'string' ? body.password : '';
  if (!timingSafeEqual(submitted, env.ADMIN_PASSWORD || '')) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
  }

  const book = body.book && typeof body.book === 'object' ? body.book : {};
  if (!BOOK_ID_PATTERN.test(String(book.bookId || '').trim())) {
    return jsonResponse({ ok: false, error: 'invalid or missing bookId' }, 400);
  }
  const missing = REQUIRED_FIELDS.filter((f) => !String(book[f] || '').trim());
  if (missing.length > 0) {
    return jsonResponse({ ok: false, error: `missing required fields: ${missing.join(', ')}` }, 400);
  }

  const values = DB_COLUMNS.map((id) => String(book[id] ?? '').trim());
  const placeholders = DB_COLUMNS.map(() => '?').join(', ');
  await env.DB.prepare(
    `INSERT OR REPLACE INTO books (${DB_COLUMNS.join(', ')}) VALUES (${placeholders})`
  ).bind(...values).run();

  return jsonResponse({ ok: true, book }, 200);
}

async function handleBackupNow(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'bad request' }, 400);
  }
  const submitted = typeof body.password === 'string' ? body.password : '';
  if (!timingSafeEqual(submitted, env.ADMIN_PASSWORD || '')) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    const committed = await backupToGithub(env);
    return jsonResponse({ ok: true, committed }, 200);
  } catch (e) {
    return jsonResponse({ ok: false, error: e.message }, 500);
  }
}

// Exports every row currently in D1 to CSV (same column order/escaping as
// the original libraryDB.csv) and commits it to GitHub via the Contents
// API, but only if the content actually changed — a weekly cron shouldn't
// produce a no-op commit every single week. Returns true if a commit was
// made, false if the content was already up to date.
async function backupToGithub(env) {
  // ORDER BY bookId, not rowid: INSERT OR REPLACE deletes-then-reinserts
  // on a bookId conflict, which assigns the row a new (higher) rowid — so
  // editing an existing book would silently move it to the bottom of
  // every future backup CSV under rowid ordering. bookId order is stable
  // regardless of edit history, and happens to already be the order the
  // public GET /books uses.
  const { results } = await env.DB.prepare(
    `SELECT ${DB_COLUMNS.join(', ')} FROM books ORDER BY bookId`
  ).all();

  const header = CSV_COLUMNS.map(([, label]) => csvField(label)).join(',');
  const lines = results.map((row) =>
    CSV_COLUMNS.map(([id]) => csvField(String(row[id] ?? ''))).join(',')
  );
  const csv = [header, ...lines].join('\n') + '\n';

  return commitCsvToGithub(csv, env);
}

async function commitCsvToGithub(csvText, env) {
  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_CSV_PATH}`;
  const headers = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    'User-Agent': 'tldb-admin-auth-worker',
    Accept: 'application/vnd.github+json',
  };

  const getRes = await fetch(`${apiUrl}?ref=${GITHUB_BRANCH}`, { headers });
  if (!getRes.ok) {
    throw new Error(`GitHub GET failed: ${getRes.status} ${await getRes.text()}`);
  }
  const current = await getRes.json();
  const currentText = base64DecodeUtf8(current.content);

  if (currentText === csvText) {
    return false; // no change since last backup, skip the commit
  }

  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Weekly catalog backup (${new Date().toISOString().slice(0, 10)})`,
      content: base64EncodeUtf8(csvText),
      sha: current.sha,
      branch: GITHUB_BRANCH,
    }),
  });
  if (!putRes.ok) {
    throw new Error(`GitHub PUT failed: ${putRes.status} ${await putRes.text()}`);
  }
  return true;
}

// Spreading the whole byte array into String.fromCharCode's arguments
// overflows V8's call-argument limit once the CSV gets past a few tens of
// KB (ours is ~140KB) — "Maximum call stack size exceeded". Chunking
// avoids that; 8192 is comfortably under the limit either way.
function base64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

function base64DecodeUtf8(b64) {
  const bytes = Uint8Array.from(atob(b64.replace(/\n/g, '')), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function csvField(value) {
  if (/[",\n]/.test(value)) return '"' + value.replace(/"/g, '""') + '"';
  return value;
}

// Fixed-window limiter (5 requests/60s per IP) backed by Workers KV, gating
// every password-protected route. Best-effort, not airtight — KV writes
// are eventually consistent across Cloudflare's edge, so a request racing
// in from two nearby PoPs at the exact same instant could both read the
// same pre-increment count. That's an acceptable gap for what this is
// actually defending against (a script hammering the password), not a
// hard security boundary.
async function checkRateLimit(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const window = Math.floor(Date.now() / (RATE_LIMIT_WINDOW_SECONDS * 1000));
  const key = `rl:${ip}:${window}`;

  const current = parseInt((await env.RATE_LIMIT.get(key)) || '0', 10);
  if (current >= RATE_LIMIT_MAX) return false;

  // TTL is longer than the window itself just so the key reliably expires
  // instead of relying on us to ever clean it up — the fixed window
  // (Date.now() bucketing above) is what actually enforces the reset time.
  await env.RATE_LIMIT.put(key, String(current + 1), {
    expirationTtl: RATE_LIMIT_WINDOW_SECONDS * 2,
  });
  return true;
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return new Response(response.body, { status: response.status, headers });
}

// Constant-time-ish string compare so a wrong guess doesn't leak how many
// leading characters matched via response timing.
function timingSafeEqual(a, b) {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) {
    let dummy = 0;
    for (let i = 0; i < aBytes.length; i++) dummy |= aBytes[i];
    return false;
  }
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}
