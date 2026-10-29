/**
 * POST /api/check — free tier of the SEO/GEO checker used by /seo-check/.
 *
 * Body: { url }
 * Returns the 12 deterministic checks plus a few facts. No email, no account.
 *
 * Limits: 8 scans an hour per IP (edge counter, no IP stored) and a 6-hour result cache
 * keyed by the normalised URL, so re-scanning the same site costs nothing.
 */
import { scan, parseTarget } from '../_shared/scan.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });

const LIMIT = 8;
const WINDOW = 60 * 60;
const CACHE_TTL = 6 * 60 * 60;

async function sha16(salt, value) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + '|' + value));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

async function bumpCounter(request, env) {
  try {
    const ip = request.headers.get('cf-connecting-ip') || '0.0.0.0';
    const salt = env.QM_RATE_SALT || 'qm-rate-v1';
    const key = new Request('https://quietmason.com/__rl/scan/' + await sha16(salt, ip));
    const now = Math.floor(Date.now() / 1000);
    let n = 0, reset = now + WINDOW;
    const hit = await caches.default.match(key);
    if (hit) {
      const d = await hit.json().catch(() => null);
      if (d && d.reset > now) { n = d.n || 0; reset = d.reset; }
    }
    if (n >= LIMIT) return { limited: true };
    await caches.default.put(key, new Response(JSON.stringify({ n: n + 1, reset }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=' + WINDOW }
    }));
    return { limited: false };
  } catch (e) {
    return { limited: false };
  }
}

const ERRORS = {
  empty: 'Enter a website address.',
  bad_url: 'That does not look like a web address.',
  bad_scheme: 'Only http and https addresses can be checked.',
  bad_port: 'Only the standard web ports are allowed.',
  private_host: 'That address is private, so it cannot be checked from here.',
  too_many_redirects: 'The address redirected too many times.',
  not_html: 'That address did not return an HTML page.',
  timeout: 'The site did not answer in time.'
};

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad_json' }, 400); }
  if (!body || typeof body !== 'object') return json({ ok: false, error: 'bad_json' }, 400);

  const target = parseTarget(body.url);
  if (target.error) return json({ ok: false, error: target.error, message: ERRORS[target.error] }, 422);

  const cacheKey = new Request('https://quietmason.com/__scan/' + await sha16('scan-cache', target.url.href));
  try {
    const hit = await caches.default.match(cacheKey);
    if (hit) {
      const cached = await hit.json();
      return json({ ...cached, cached: true });
    }
  } catch (e) { /* cache read failure: just scan */ }

  /* Only real scans are charged against the hourly budget: a cached result costs us nothing,
     and blocking someone from seeing a result we already hold would be a poor trade. */
  const rl = await bumpCounter(request, env);
  if (rl.limited) {
    return json({
      ok: false,
      error: 'rate_limited',
      message: 'That is a lot of scans in one hour. Try again later, or write to hello@quietmason.com and we will run it for you.'
    }, 429);
  }

  let result;
  try {
    result = await scan(target.url.href);
  } catch (e) {
    const code = /timeout|abort/i.test(e && e.name + ' ' + e.message) ? 'timeout' : 'fetch_failed';
    return json({ ok: false, error: code, message: ERRORS[code] || 'The site could not be reached from here.' }, 502);
  }
  if (!result.ok) {
    return json({ ok: false, error: result.error, message: ERRORS[result.error] || 'That page could not be read.' },
      result.error === 'not_html' ? 422 : 502);
  }

  const payload = { ...result, cached: false };
  delete payload.facts_images_detail;
  try {
    await caches.default.put(cacheKey, new Response(JSON.stringify(payload), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=' + CACHE_TTL }
    }));
  } catch (e) { /* storing is best effort */ }
  return json(payload);
}

export async function onRequestGet() {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
