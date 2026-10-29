/**
 * POST /api/report — full report for /seo-check/, delivered by email.
 *
 * Body: { url, email }
 * Scans the homepage plus up to four URLs from its sitemap, then emails the result:
 * the same 12 checks per page, what to fix first, and what the free scan does not cover.
 *
 * Limits: 3 reports an hour per IP. Leads are recorded the same way as /api/contact.
 * If RESEND_API_KEY is not bound the endpoint says so instead of pretending it sent anything.
 */
import { scan, sitemapUrls, priorityFixes, parseTarget } from '../_shared/scan.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });

const LIMIT = 3;
const WINDOW = 60 * 60;
const looksLikeEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim());
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max);

async function sha16(salt, value) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + '|' + value));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

async function bumpCounter(request, env) {
  try {
    const ip = request.headers.get('cf-connecting-ip') || '0.0.0.0';
    const salt = env.QM_RATE_SALT || 'qm-rate-v1';
    const key = new Request('https://quietmason.com/__rl/report/' + await sha16(salt, ip));
    const now = Math.floor(Date.now() / 1000);
    let n = 0, reset = now + WINDOW;
    const hit = await caches.default.match(key);
    if (hit) {
      const d = await hit.json().catch(() => null);
      if (d && d.reset > now) { n = d.n || 0; reset = d.reset; }
    }
    if (n >= LIMIT) return true;
    await caches.default.put(key, new Response(JSON.stringify({ n: n + 1, reset }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=' + WINDOW }
    }));
    return false;
  } catch (e) {
    return false;
  }
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const PILL = {
  pass: 'background:#e8f5ec;color:#1c6b35',
  warn: 'background:#fff4e0;color:#8a5a00',
  fail: 'background:#fde8e8;color:#8c1d1d'
};

function pageBlock(r) {
  const rows = r.checks.map((c) => `
    <tr>
      <td style="padding:7px 10px;border-bottom:1px solid #eee;width:64px">
        <span style="display:inline-block;padding:2px 7px;border-radius:9px;font-size:11px;font-weight:600;${PILL[c.status]}">${c.status}</span>
      </td>
      <td style="padding:7px 10px;border-bottom:1px solid #eee;font-size:13px">
        <b>${esc(c.label)}</b><br><span style="color:#555">${esc(c.detail)}</span>
      </td>
    </tr>`).join('');
  return `
  <h3 style="margin:26px 0 6px;font-size:16px">${esc(r.url)}</h3>
  <p style="margin:0 0 10px;font-size:13px;color:#555">${r.score.passed} pass · ${r.score.warned} warn · ${r.score.failed} fail (of ${r.score.total})</p>
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #eee;border-radius:8px">${rows}</table>`;
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad_json' }, 400); }
  if (!body || typeof body !== 'object') return json({ ok: false, error: 'bad_json' }, 400);

  const email = clean(body.email, 200).trim();
  const target = parseTarget(body.url);
  if (target.error) return json({ ok: false, error: target.error, message: 'Check the website address.' }, 422);
  if (!looksLikeEmail(email)) return json({ ok: false, error: 'bad_email', message: 'Check the email address.' }, 422);

  if (await bumpCounter(request, env)) {
    return json({ ok: false, error: 'rate_limited', message: 'Three reports an hour is the limit. Try again later.' }, 429);
  }

  const origin = target.url.origin;
  const urls = [target.url.href];
  for (const u of await sitemapUrls(origin, 6)) {
    if (urls.length >= 5) break;
    if (!urls.includes(u)) urls.push(u);
  }

  const results = [];
  for (const u of urls) {
    try {
      const r = await scan(u);
      if (r.ok) results.push(r);
    } catch (e) { /* a page that fails to load is left out, not faked */ }
  }
  if (!results.length) {
    return json({ ok: false, error: 'fetch_failed', message: 'The site could not be read from here.' }, 502);
  }

  const totals = results.reduce((a, r) => ({
    passed: a.passed + r.score.passed, warned: a.warned + r.score.warned,
    failed: a.failed + r.score.failed, total: a.total + r.score.total
  }), { passed: 0, warned: 0, failed: 0, total: 0 });
  const fixes = priorityFixes(results);

  const host = target.url.host;
  const subject = `SEO/GEO report — ${host} (${totals.failed} fail, ${totals.warned} warn)`;
  const html = `<!doctype html><html><body style="margin:0;background:#f5f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1d">
  <div style="max-width:640px;margin:0 auto;padding:28px 22px">
    <div style="background:#0e1218;color:#fff;border-radius:12px 12px 0 0;padding:18px 22px">
      <div style="font-size:18px;font-weight:700">quietmason</div>
      <div style="font-size:11px;letter-spacing:.14em;color:#9aa4b2;margin-top:2px">SEO / GEO CHECK</div>
    </div>
    <div style="background:#fff;border:1px solid #e8e8ed;border-top:0;border-radius:0 0 12px 12px;padding:22px">
      <h2 style="margin:0 0 6px;font-size:19px">${esc(host)} — ${totals.passed}/${totals.total} checks pass</h2>
      <p style="margin:0 0 4px;font-size:14px;color:#333">Pages scanned: ${results.length}. Failed: ${totals.failed}. Warnings: ${totals.warned}.</p>
      <p style="margin:0;font-size:12px;color:#666">Run on ${new Date().toISOString().slice(0, 10)}. These are twelve deterministic checks on the HTML you serve — not a full audit, and no Core Web Vitals (that needs a real browser).</p>

      ${results.map(pageBlock).join('')}

      <h3 style="margin:28px 0 8px;font-size:16px">What to fix first</h3>
      <ol style="margin:0;padding-left:20px;font-size:13px;line-height:1.65">
        ${fixes.map((f) => `<li><b>${esc(f.label)}</b> (${f.status}) — ${esc(f.url)}<br><span style="color:#555">${esc(f.fix)}</span></li>`).join('') || '<li>Nothing failed. Work on the warnings next.</li>'}
      </ol>

      <h3 style="margin:26px 0 8px;font-size:16px">What this report does not cover</h3>
      <ul style="margin:0;padding-left:20px;font-size:13px;line-height:1.65;color:#333">
        <li>Core Web Vitals (LCP, CLS, INP) — needs a real browser, not a fetch.</li>
        <li>Search Console data: impressions, clicks, which queries each page earns.</li>
        <li>Internal linking at scale, redirect chains, duplicate clusters, thin pages across the whole site.</li>
        <li>Whether the content is worth reading. No tool can answer that one.</li>
      </ul>

      <p style="margin:26px 0 0;font-size:13px;color:#333">If you want the full audit — Search Console, every page, before/after — reply to this email or send the site at
      <a href="https://quietmason.com/brief/" style="color:#2a5bd7">quietmason.com/brief</a>.</p>
    </div>
    <p style="font-size:11px;color:#8a8f98;text-align:center;margin:14px 0 0">
      You asked for this report at ${esc(email)}. We do not add you to a list. Reply to this message and it reaches a person.
    </p>
  </div></body></html>`;
  const text = `SEO/GEO report — ${host}\n\n${results.length} page(s) scanned. ${totals.passed}/${totals.total} checks pass, ${totals.failed} fail, ${totals.warned} warn.\n\n` +
    results.map((r) => `${r.url}\n` + r.checks.map((c) => `  [${c.status}] ${c.label}: ${c.detail}`).join('\n')).join('\n\n') +
    `\n\nFix first:\n` + (fixes.map((f) => `- ${f.label} (${f.status}) ${f.url}: ${f.fix}`).join('\n') || '- nothing failed') +
    `\n\nFull audit: https://quietmason.com/brief/\n`;

  // Record the lead first, in whichever store is bound (same shape as /api/contact).
  const record = {
    at: new Date().toISOString(), email, topic: 'seo-check', source: target.url.href,
    country: request.headers.get('cf-ipcountry') || '',
    ua: clean(request.headers.get('user-agent'), 200),
    message: `SEO/GEO report requested for ${target.url.href} (${results.length} pages, ${totals.failed} fail)`
  };
  if (env.DB) {
    try {
      await env.DB.prepare('INSERT INTO leads (email, topic, message, source, country) VALUES (?, ?, ?, ?, ?)')
        .bind(email, 'seo-check', `Report for ${target.url.href} (${results.length} pages)`, target.url.href, record.country).run();
    } catch (e) {}
  } else if (env.QM_LEADS) {
    try { await env.QM_LEADS.put(`lead:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, JSON.stringify(record)); } catch (e) {}
  }

  if (!env.RESEND_API_KEY) {
    return json({ ok: false, error: 'email_not_configured', message: 'Email delivery is not set up right now. Write to hello@quietmason.com and we will send it.' }, 503);
  }

  const mail = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.CONTACT_FROM || 'site@quietmason.com',
      to: [email],
      reply_to: 'hello@quietmason.com',
      subject,
      html,
      text
    })
  });
  if (!mail.ok) {
    return json({ ok: false, error: 'send_failed', status: mail.status, message: 'The report was built but the email could not be sent.' }, 502);
  }
  return json({ ok: true, sent_to: email, pages: results.length, score: totals, cached_result: false });
}

export async function onRequestGet() {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
