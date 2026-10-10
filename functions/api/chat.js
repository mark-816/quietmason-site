/**
 * POST /api/chat  ->  { reply: "..." }
 *
 * Same two-layer design as the widget it serves: a rule layer that answers instantly and
 * for free, then a model fallback constrained to the site's own facts.
 * The client falls back to its local FAQ map if this endpoint fails, so the widget still
 * answers when the backend is down.
 *
 * Env (Pages -> Settings -> Functions):
 *   DEEPSEEK_KEY  secret, optional  enables the model layer
 *   QM_LOGS       KV,     optional  conversation log (same shape as chat_logs elsewhere)
 */
import FACTS from './_facts.json';   /* [{k:"keyword phrase", a:"answer"}], generated from the widget's own FAQ map */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });

const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max);

/* rule layer: first key whose words appear in the message wins, longest key first */
function rule(text) {
  const t = text.toLowerCase();
  let best = null, bestScore = 0;
  for (const row of FACTS) {
    const words = row.k.split(/[\s_]+/);
    let longest = 0, hits = 0;
    /* multi-word phrases (how much, cited by chatgpt, website maintenance) outrank single words */
    for (let i = 0; i < words.length; i++) {
      for (let j = i + 2; j <= Math.min(i + 3, words.length); j++) {
        const phrase = words.slice(i, j).join(' ');
        if (!t.includes(phrase)) continue;
        const score = 1000 + phrase.length;
        if (score > bestScore) { bestScore = score; best = row.a; }
      }
    }
    for (const w of words) {
      if (w.length < 3 || !t.includes(w)) continue;
      hits += 1;
      if (w.length > longest) longest = w.length;
    }
    /* ties: the row matching more of its own words wins */
    const score = longest * 10 + hits;
    if (score > bestScore) { bestScore = score; best = row.a; }
  }
  return best;
}

const SYSTEM = [
  'You are the assistant on quietmason.com, a one-person studio doing automation, data pipelines',
  'and technical SEO for small teams. Answer only from these facts, in 1-2 short sentences,',
  'in plain English, no hype, no emoji.',
  'Facts: ' + FACTS.map((f) => f.a).join(' '),
  'If the question needs a price for a specific job, say the published ranges and ask for one',
  'sample (a URL or an export). Never promise rankings, traffic or that an AI will recommend them.',
  'If you do not know, say so and point to hello@quietmason.com.'
].join(' ');

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ reply: 'Please resend that as text.' }, 400); }

  const message = clean(body.message, 800).trim();
  if (!message) return json({ reply: 'Ask me anything about scope, price or how we work.' });

  const ip = request.headers.get('cf-connecting-ip') || '0.0.0.0';
  const logged = { at: new Date().toISOString(), ip, message, layer: 'rule', reply: '' };

  const canned = rule(message);
  if (canned) {
    logged.reply = canned;
    await log(env, logged);
    return json({ reply: canned, layer: 'rule' });
  }

  if (!env.DEEPSEEK_KEY) {
    const reply = 'I answer from this site only, and that one is not in my notes. Leave your email in the contact form and a person replies within one business day — or write to hello@quietmason.com.';
    logged.layer = 'no_key';
    logged.reply = reply;
    await log(env, logged);
    return json({ reply, layer: 'no_key' });
  }

  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.DEEPSEEK_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-chat',
        temperature: 0.4,
        max_tokens: 220,
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: message }]
      })
    });
    const data = await res.json();
    const reply = clean(((data.choices || [])[0] || {}).message ? data.choices[0].message.content : '', 600)
      || 'I could not reach my notes just now. Email hello@quietmason.com and a person will answer.';
    logged.layer = 'model';
    logged.reply = reply;
    await log(env, logged);
    return json({ reply, layer: 'model' });
  } catch (e) {
    logged.layer = 'error';
    await log(env, logged);
    return json({ reply: 'Something on my side failed. Email hello@quietmason.com — same inbox, one business day.' });
  }
}

async function log(env, row) {
  if (!env.QM_LOGS) return;
  try { await env.QM_LOGS.put(`chat:${row.at}:${Math.random().toString(36).slice(2, 7)}`, JSON.stringify(row)); } catch (e) {}
}

export async function onRequestGet() { return json({ reply: 'POST a message instead.' }, 405); }
