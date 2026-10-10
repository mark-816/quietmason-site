/**
 * GET /api/admin — read-only aggregates for the private dashboard at /admin/.
 *
 * Not public: requires the header `x-admin-token` to match env.ADMIN_TOKEN. Without a
 * configured token it refuses rather than exposing visitor data (fail closed).
 * Reads D1 (`DB`) when bound; otherwise falls back to KV (`QM_EVENTS` / `QM_LOGS` / `QM_LEADS`).
 *
 * Every response carries `source` so a dashboard can never present preview data as live data.
 */
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });

export async function onRequestGet({ request, env }) {
  const expected = env.ADMIN_TOKEN || '';
  const given = request.headers.get('x-admin-token') || new URL(request.url).searchParams.get('t') || '';
  if (!expected) return json({ ok: false, error: 'admin_not_configured' }, 503);
  if (given !== expected) return json({ ok: false, error: 'unauthorized' }, 401);

  if (!env.DB) {
    const events = await kvAll(env.QM_EVENTS);
    const chats = await kvAll(env.QM_LOGS);
    const leads = await kvAll(env.QM_LEADS);
    return json({ ok: true, source: 'kv', ...aggregate(events, chats, leads) });
  }

  const q = async (sql) => (await env.DB.prepare(sql).all()).results || [];
  const [today, week, pages, refs, countries, kinds, recentChats, leadRows, botRows] = await Promise.all([
    q("SELECT COUNT(*) pv, COUNT(DISTINCT ip) uv FROM events WHERE date(created_at,'+8 hours') = date('now','+8 hours')"),
    q("SELECT COUNT(*) pv, COUNT(DISTINCT ip) uv FROM events WHERE created_at >= datetime('now','-7 days')"),
    q("SELECT page AS k, COUNT(*) n FROM events WHERE event='pageview' AND created_at >= datetime('now','-7 days') GROUP BY page ORDER BY n DESC LIMIT 20"),
    q("SELECT COALESCE(NULLIF(ref,''),'direct') AS k, COUNT(*) n FROM events WHERE created_at >= datetime('now','-7 days') GROUP BY k ORDER BY n DESC LIMIT 12"),
    q("SELECT COALESCE(NULLIF(country,''),'?') AS k, COUNT(*) n FROM events WHERE created_at >= datetime('now','-7 days') GROUP BY k ORDER BY n DESC LIMIT 12"),
    q("SELECT event AS k, COUNT(*) n FROM events WHERE created_at >= datetime('now','-7 days') GROUP BY k ORDER BY n DESC"),
    q("SELECT created_at, ip, msg, reply, layer FROM chat_logs ORDER BY id DESC LIMIT 25"),
    q("SELECT created_at, email, topic, source FROM leads ORDER BY id DESC LIMIT 25"),
    q("SELECT bot, COUNT(*) n FROM bot_visits WHERE created_at >= datetime('now','-7 days') GROUP BY bot ORDER BY n DESC LIMIT 10")
  ]);
  return json({
    ok: true, source: 'd1',
    today: today[0] || { pv: 0, uv: 0 },
    week: week[0] || { pv: 0, uv: 0 },
    pages, referrers: refs, countries, kinds,
    chats: { total: recentChats.length, recent: recentChats },
    leads: { total: leadRows.length, recent: leadRows },
    bots: botRows
  });
}

async function kvAll(ns) {
  if (!ns) return [];
  try {
    const out = [];
    let cursor;
    do {
      const page = await ns.list({ cursor, limit: 1000 });
      for (const k of page.keys) {
        const v = await ns.get(k.name, 'json');
        if (v) out.push(v);
      }
      cursor = page.cursor;
    } while (cursor);
    return out;
  } catch (e) {
    return [];
  }
}

function aggregate(events, chats, leads) {
  const since = Date.now() - 7 * 24 * 3600 * 1000;
  const recent = events.filter((e) => Date.parse(e.created_at || e._at || 0) >= since);
  const day = (d) => new Date(d).toISOString().slice(0, 10);
  const todayKey = day(Date.now());
  const uniq = (arr, f) => new Set(arr.map(f).filter(Boolean)).size;
  const top = (arr, f) => {
    const m = new Map();
    for (const x of arr) {
      const k = f(x) || '(none)';
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, n]) => ({ k, n }));
  };
  const t = recent.filter((e) => day(e.created_at || e._at) === todayKey);
  return {
    today: { pv: t.length, uv: uniq(t, (e) => e.ip) },
    week: { pv: recent.length, uv: uniq(recent, (e) => e.ip) },
    pages: top(recent.filter((e) => (e.event || 'pageview') === 'pageview'), (e) => e.page),
    referrers: top(recent, (e) => e.ref),
    countries: top(recent, (e) => e.country),
    kinds: top(recent, (e) => e.event || 'pageview'),
    chats: { total: chats.length, recent: chats.slice(-25).reverse() },
    leads: { total: leads.length, recent: leads.slice(-25).reverse() },
    bots: []
  };
}

export async function onRequestPost() { return json({ ok: false, error: 'read_only' }, 405); }
