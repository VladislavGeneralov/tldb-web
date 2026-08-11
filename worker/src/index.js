// TLDB admin password check — Cloudflare Worker.
//
// Holds the real admin password server-side (set via `wrangler secret put
// ADMIN_PASSWORD`, never committed to the repo). The static site on GitHub
// Pages calls this endpoint instead of comparing the password in client JS,
// so the password itself is never shipped to the browser.

const ALLOWED_ORIGIN = 'https://vladislavgeneralov.github.io';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);
    if (url.pathname !== '/check-password') {
      return withCors(new Response('Not found', { status: 404 }));
    }
    if (request.method !== 'POST') {
      return withCors(new Response('Method not allowed', { status: 405 }));
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return withCors(jsonResponse({ ok: false, error: 'bad request' }, 400));
    }

    const submitted = typeof body.password === 'string' ? body.password : '';
    const correct = timingSafeEqual(submitted, env.ADMIN_PASSWORD || '');

    return withCors(jsonResponse({ ok: correct }, correct ? 200 : 401));
  },
};

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
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
