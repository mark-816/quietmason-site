/**
 * POST /api/contact — Cloudflare Pages Function.
 *
 * Body: { email, topic, message, website (honeypot), source }
 * Behaviour:
 *   · validates and drops bots (honeypot + minimum message length)
 *   · stores every accepted submission in KV when QM_LEADS is bound (leads ledger for the dashboard)
 *   · emails it when RESEND_API_KEY is set; otherwise answers {ok:true, delivered:false} so the
 *     page tells the visitor to send it by email instead of pretending it was delivered
 *
 * Bindings (Pages -> Settings -> Functions):
 *   RESEND_API_KEY   secret   optional, enables delivery
 *   CONTACT_TO       var      default hello@quietmason.com
 *   CONTACT_FROM     var      must be a verified sender on the domain, e.g. site@quietmason.com
 *   QM_LEADS         KV       optional, stores every accepted submission
 */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });

const looksLikeEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim());
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max);

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ ok: false, error: 'bad_json' }, 400);
  }

  const email = clean(body.email, 200).trim();
  const message = clean(body.message, 5000).trim();
  const topic = clean(body.topic, 40) || 'other';
  const source = clean(body.source, 120);
  const honeypot = clean(body.website, 100);

  if (honeypot) return json({ ok: true, delivered: false, note: 'dropped' });          /* bot */
  if (!looksLikeEmail(email)) return json({ ok: false, error: 'bad_email' }, 422);
  if (message.length < 10) return json({ ok: false, error: 'too_short' }, 422);

  const record = {
    at: new Date().toISOString(),
    email, topic, source,
    country: request.headers.get('cf-ipcountry') || '',
    ua: clean(request.headers.get('user-agent'), 200),
    message
  };

  // Record it first, in whichever store is bound. An enquiry that only exists in an email
  // inbox is one we can lose; this is also what feeds /admin/.
  if (env.DB) {
    try {
      await env.DB.prepare(
        'INSERT INTO leads (email, topic, message, source, country) VALUES (?, ?, ?, ?, ?)'
      ).bind(email, topic, message, source, record.country).run();
    } catch (err) { /* fall through: email delivery is still worth trying */ }
  } else if (env.QM_LEADS) {
    try {
      await env.QM_LEADS.put(`lead:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, JSON.stringify(record));
    } catch (err) { /* storage failure must not lose the message we can still email */ }
  }

  if (!env.RESEND_API_KEY) {
    return json({ ok: true, delivered: false, reason: 'email_not_configured' });
  }

  const mail = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.CONTACT_FROM || 'site@quietmason.com',
      to: [env.CONTACT_TO || 'hello@quietmason.com'],
      reply_to: email,
      subject: `[site] ${topic} — ${email}`,
      text: `From:  ${email}\nTopic: ${topic}\nPage:  ${source}\nCountry: ${record.country}\n\n${message}\n`
    })
  });

  if (!mail.ok) return json({ ok: false, error: 'send_failed', status: mail.status }, 502);
  return json({ ok: true, delivered: true });
}

export async function onRequestGet() {
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
