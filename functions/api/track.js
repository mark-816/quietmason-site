/**
 * POST /api/track  — first-party page events (same contract as js/track.js).
 *
 * Body: { site, page, event, ref, dur, ua? }
 * Storage: D1 (schema in schema.sql, reused from our existing tracker) or KV, or neither —
 * an unconfigured deployment accepts and drops rather than 500-ing the page.
 */
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });

const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max);

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad_json' }, 400); }

  const row = {
    site: clean(body.site, 40) || 'quietmason',
    page: clean(body.page, 300),
    event: clean(body.event, 40) || 'pageview',
    ref: clean(body.ref, 300),
    dur: Number(body.dur) || 0,
    ip: request.headers.get('cf-connecting-ip') || '',
    country: request.headers.get('cf-ipcountry') || '',
    ua: clean(request.headers.get('user-agent'), 300),
    created_at: new Date().toISOString().slice(0, 19).replace('T', ' ')
  };

  if (env.DB) {
    try {
      await env.DB.prepare(
        'INSERT INTO events (site, page, event, ip, country, device, browser, source, ref, dur, created_at) ' +
        'VALUES (?,?,?,?,?,?,?,?,?,?,?)'
      ).bind(row.site, row.page, row.event, row.ip, row.country, '', '', '', row.ref, row.dur, row.created_at).run();
      return json({ ok: true, stored: 'd1' });
    } catch (e) { return json({ ok: false, error: 'd1_failed' }, 500); }
  }
  if (env.QM_EVENTS) {
    try {
      await env.QM_EVENTS.put(`ev:${row.created_at}:${Math.random().toString(36).slice(2, 7)}`, JSON.stringify(row));
      return json({ ok: true, stored: 'kv' });
    } catch (e) { return json({ ok: false, error: 'kv_failed' }, 500); }
  }
  return json({ ok: true, stored: 'none' });   /* not configured: accept and drop */
}

export async function onRequestGet() { return json({ ok: false, error: 'method_not_allowed' }, 405); }
