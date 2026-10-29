/**
 * Shared scanner for /seo-check/ (free tier) and /api/report (full report).
 *
 * One fetch per thing we inspect, hard caps everywhere, no third-party libraries:
 *   · only http(s), ports 80/443, public hosts (no localhost / RFC1918 / ULA / link-local)
 *   · redirects followed manually, max 3, each hop re-validated
 *   · 2 MB body cap, 9 s timeout, UA identifies the tool
 *
 * The 12 checks are deliberately deterministic and explainable: each one can be verified by
 * viewing source. Anything that needs a real browser (LCP/CLS/INP) is out of scope and the
 * page says so.
 */

export const CHECK_IDS = [
  'indexable', 'title', 'description', 'h1', 'canonical', 'structured_data',
  'answer_block', 'question_headings', 'freshness', 'robots_ai', 'llms_txt', 'sitemap'
];

const UA = 'quietmason-seo-check/1.0 (+https://quietmason.com/seo-check/)';
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 9000;

/* ── target validation (SSRF guard) ─────────────────────────────────────── */

function ipv4Private(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;   /* CGNAT */
  return false;
}

function ipv6Private(host) {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (!h.includes(':')) return false;
  if (h === '::1' || h === '::') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;        /* ULA */
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true;        /* link-local */
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
  return mapped ? ipv4Private(mapped[1]) : false;
}

export function parseTarget(input) {
  let raw = String(input == null ? '' : input).trim();
  if (!raw) return { error: 'empty' };
  if (raw.length > 300) return { error: 'too_long' };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !/^https?:\/\//i.test(raw)) return { error: 'bad_scheme' };
  if (/^(javascript|data|file|ftp|mailto|about|blob):/i.test(raw)) return { error: 'bad_scheme' };
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
  let u;
  try { u = new URL(raw); } catch (e) { return { error: 'bad_url' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'bad_scheme' };
  if (u.port && u.port !== '80' && u.port !== '443') return { error: 'bad_port' };
  const host = u.hostname.toLowerCase();
  if (!host || host.length > 200) return { error: 'bad_host' };
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      host.endsWith('.internal') || host.endsWith('.home.arpa')) return { error: 'private_host' };
  if (ipv4Private(host) || ipv6Private(host)) return { error: 'private_host' };
  u.hash = '';
  return { url: u };
}

async function readCapped(res, cap = MAX_BYTES) {
  if (!res.body) return { text: await res.text(), truncated: false };
  const reader = res.body.getReader();
  const chunks = [];
  let bytes = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > cap) {
      chunks.push(value.slice(0, Math.max(0, value.length - (bytes - cap))));
      truncated = true;
      try { await reader.cancel(); } catch (e) {}
      break;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.length; }
  return { text: new TextDecoder('utf-8', { fatal: false }).decode(all), truncated };
}

export async function fetchResource(target, { accept = '*/*', cap = MAX_BYTES } = {}) {
  let current = target;
  for (let hop = 0; hop <= 3; hop++) {
    const res = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': UA, 'Accept': accept }
    });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) return { status: res.status, url: current, text: '', headers: res.headers, truncated: false };
      const next = new URL(loc, current);
      const v = parseTarget(next.href);
      if (v.error) throw new Error('redirect_' + v.error);
      current = v.url.href;
      continue;
    }
    const { text, truncated } = await readCapped(res, cap);
    return { status: res.status, url: current, text, headers: res.headers, truncated };
  }
  throw new Error('too_many_redirects');
}

/* ── HTML helpers (regex only: no DOM in Workers) ───────────────────────── */

const decode = (s) => String(s || '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(Number(d)));

const textOf = (html) => decode(String(html || '')
  .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')).trim();

const attr = (tag, name) => {
  const m = new RegExp(name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(tag);
  return m ? decode(m[2] != null ? m[2] : m[3] != null ? m[3] : m[4]) : '';
};

export function parseHtml(html, pageUrl) {
  const head = (html.match(/<head[\s\S]*?<\/head>/i) || [html])[0];
  const title = (head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const metas = head.match(/<meta\b[^>]*>/gi) || [];
  let description = '', robots = '';
  for (const tag of metas) {
    const name = attr(tag, 'name').toLowerCase();
    if (name === 'description' && !description) description = attr(tag, 'content');
    if ((name === 'robots' || name === 'googlebot') && !robots) robots = attr(tag, 'content').toLowerCase();
  }
  const linkTags = head.match(/<link\b[^>]*>/gi) || [];
  let canonical = '';
  for (const tag of linkTags) {
    if (/rel\s*=\s*["']?canonical/i.test(tag)) { canonical = attr(tag, 'href'); break; }
  }
  const h1Blocks = html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi) || [];
  const h2Blocks = html.match(/<h2\b[^>]*>[\s\S]*?<\/h2>/gi) || [];
  const h3Blocks = html.match(/<h3\b[^>]*>[\s\S]*?<\/h3>/gi) || [];
  const ld = [];
  const ldRe = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = ldRe.exec(html))) ld.push(m[1]);
  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  const paras = (html.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || []).map(textOf).filter(Boolean);
  const firstH2 = html.search(/<h2\b/i);
  const beforeFirstH2 = firstH2 > 0 ? html.slice(0, firstH2) : html;
  return {
    title: textOf(title), description: textOf(description), robots, canonical,
    h1: h1Blocks.map(textOf), h2: h2Blocks.map(textOf), h3: h3Blocks.map(textOf),
    jsonld: ld, imgs, paras, beforeFirstH2
  };
}

function jsonLdTypes(blocks) {
  const types = new Set();
  const errors = [];
  for (const raw of blocks) {
    let data;
    try { data = JSON.parse(raw.trim()); } catch (e) { errors.push(e.message.slice(0, 80)); continue; }
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(walk);
      if (node['@type']) [].concat(node['@type']).forEach((t) => types.add(t));
      if (node['@graph']) walk(node['@graph']);
      if (node.mainEntity) walk(node.mainEntity);
    };
    walk(data);
  }
  return { types: [...types], errors };
}

function dateFromSchema(html) {
  const m = /"dateModified"\s*:\s*"([^"]+)"/i.exec(html);
  if (!m) return null;
  const d = new Date(m[1]);
  return isNaN(d) ? null : d;
}

function visibleDate(text) {
  const m = /(checked on|last updated|updated on|reviewed on)\s*:?\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i.exec(text);
  if (!m) return null;
  const d = new Date(m[2] + 'T00:00:00Z');
  return isNaN(d) ? null : d;
}

function parseRobots(text) {
  const groups = [];
  let cur = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const s = line.replace(/#.*$/, '').trim();
    if (!s) continue;
    const [k, ...rest] = s.split(':');
    const key = k.trim().toLowerCase();
    const val = rest.join(':').trim();
    if (key === 'user-agent') {
      if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
    } else if ((key === 'disallow' || key === 'allow') && cur) {
      cur.rules.push({ key, val });
    }
  }
  const blocked = (bot) => {
    const g = groups.find((x) => x.agents.includes(bot));
    if (!g) return false;
    const dis = g.rules.some((r) => r.key === 'disallow' && r.val === '/');
    const allow = g.rules.some((r) => r.key === 'allow' && r.val === '/');
    return dis && !allow;
  };
  return { blocked };
}

/* ── the 12 checks ──────────────────────────────────────────────────────── */

const P = (id, label, status, detail, fix, extra) => ({ id, label, status, detail, fix, ...(extra || {}) });

export function checksFor({ pageUrl, res, html, parsed, robots, sitemap, sitemapLocs, sitemapChildren, llms }) {
  const out = [];
  const host = new URL(pageUrl).host;

  const noindex = /noindex/i.test(parsed.robots) || /noindex/i.test(res.headers.get('x-robots-tag') || '');
  out.push(P('indexable', 'Search engines are allowed to index it', noindex ? 'fail' : 'pass',
    noindex ? 'The page sends noindex, so it cannot appear in results.' : 'No noindex directive found.',
    'Remove noindex from the meta robots tag or the X-Robots-Tag header.'));

  const tLen = parsed.title.length;
  const tStatus = !parsed.title ? 'fail' : (tLen < 15 || tLen > 65) ? 'warn' : 'pass';
  out.push(P('title', 'Page title', tStatus, parsed.title ? `${tLen} characters: “${parsed.title.slice(0, 90)}”` : 'No <title> found.',
    'Write one title of 15–65 characters that names the page and the thing it is about.'));

  const dLen = parsed.description.length;
  const dStatus = !parsed.description ? 'fail' : (dLen < 50 || dLen > 160) ? 'warn' : 'pass';
  out.push(P('description', 'Meta description', dStatus, parsed.description ? `${dLen} characters.` : 'No meta description.',
    'Write 50–160 characters that describe the page in the words a buyer would use.'));

  const h1n = parsed.h1.length;
  out.push(P('h1', 'One H1', h1n === 1 ? 'pass' : h1n === 0 ? 'fail' : 'warn',
    h1n === 0 ? 'No H1 on the page.' : h1n === 1 ? `H1: “${parsed.h1[0].slice(0, 80)}”` : `${h1n} H1 elements: ${parsed.h1.slice(0, 3).map((x) => `“${x.slice(0, 40)}”`).join(', ')}`,
    'Use exactly one H1 that matches the page title in meaning, not word for word.'));

  let cStatus = 'warn', cDetail = 'No canonical link.';
  if (parsed.canonical) {
    try {
      const cu = new URL(parsed.canonical, pageUrl);
      const sameOrigin = cu.origin === new URL(pageUrl).origin;
      const norm = (u) => u.pathname.replace(/\/+$/, '') || '/';
      if (!sameOrigin) { cStatus = 'fail'; cDetail = `Canonical points to another site: ${cu.href}`; }
      else if (norm(cu) !== norm(new URL(pageUrl))) { cStatus = 'warn'; cDetail = `Canonical points elsewhere on this site: ${cu.href}`; }
      else { cStatus = 'pass'; cDetail = `Self-referencing: ${cu.href}`; }
    } catch (e) { cStatus = 'fail'; cDetail = `Canonical is not a valid URL: ${parsed.canonical.slice(0, 80)}`; }
  }
  out.push(P('canonical', 'Canonical URL', cStatus, cDetail,
    'Add a self-referencing absolute canonical on every page that returns 200.'));

  const ld = jsonLdTypes(parsed.jsonld);
  out.push(P('structured_data', 'Structured data', ld.errors.length ? 'fail' : ld.types.length ? 'pass' : 'warn',
    ld.errors.length ? `JSON-LD does not parse: ${ld.errors[0]}`
      : ld.types.length ? `Parses. Types: ${ld.types.slice(0, 8).join(', ')}` : 'No JSON-LD blocks.',
    'Add one valid JSON-LD block (Organization, WebSite, Service, Product or FAQPage) and keep it identical to the visible text.'));

  const words = (s) => (s.match(/\S+/g) || []).length;
  const early = parsed.paras.filter((p) => parsed.beforeFirstH2.includes(p));
  const answer = early.find((p) => words(p) >= 40 && words(p) <= 130) ||
    parsed.paras.find((p) => words(p) >= 40 && words(p) <= 130);
  out.push(P('answer_block', 'A direct answer near the top', answer ? 'pass' : 'warn',
    answer ? `${words(answer)}-word paragraph: “${answer.slice(0, 120)}…”` : 'No 40–130 word paragraph near the top.',
    'Open with a paragraph that answers the page question in plain words; assistants quote paragraphs like that.'));

  const heads = [...parsed.h2, ...parsed.h3].filter(Boolean);
  const questions = heads.filter((h) => /\?\s*$/.test(h)).length;
  const ratio = heads.length ? questions / heads.length : 0;
  out.push(P('question_headings', 'Headings phrased as questions', ratio >= 0.5 ? 'pass' : questions > 0 ? 'warn' : 'fail',
    `${questions} of ${heads.length} H2/H3 headings are questions.`,
    'Rewrite at least half the H2s as the question a customer would type.'));

  const schemaDate = dateFromSchema(html);
  const visDate = visibleDate(textOf(html));
  const newest = [schemaDate, visDate].filter(Boolean).sort((a, b) => b - a)[0] || null;
  const ageDays = newest ? Math.round((Date.now() - newest.getTime()) / 86400000) : null;
  out.push(P('freshness', 'A visible date, and a recent one', !newest ? 'warn' : ageDays <= 365 ? 'pass' : 'warn',
    newest ? `Latest date found: ${newest.toISOString().slice(0, 10)} (${ageDays} days old).` : 'No visible date and no dateModified.',
    'Show a “Checked on YYYY-MM-DD” line and update it when the page changes.'));

  const rb = robots && robots.status === 200 ? parseRobots(robots.text) : { blocked: () => false };
  const bots = ['gptbot', 'claudebot', 'perplexitybot', 'google-extended', 'ccbot', 'meta-externalagent'];
  const blockedBots = robots && robots.status === 200 ? bots.filter((b) => rb.blocked(b)) : [];
  out.push(P('robots_ai', 'AI crawlers are allowed', !robots || robots.status !== 200 ? 'warn'
    : blockedBots.length === 0 ? 'pass' : blockedBots.length <= 2 ? 'warn' : 'fail',
    !robots ? 'No robots.txt found.'
      : robots.status !== 200 ? `robots.txt returned HTTP ${robots.status}, so it reads as absent here.`
        : blockedBots.length ? `Blocked by name: ${blockedBots.join(', ')}.` : 'No AI crawler is blocked by name.',
    'If you want answers engines to cite you, allow GPTBot, ClaudeBot, PerplexityBot and Google-Extended.'));

  const llmsOk = llms && llms.status === 200 && !/^\s*</.test(llms.text);
  out.push(P('llms_txt', 'An llms.txt for assistants', llmsOk ? 'pass' : 'warn',
    llmsOk ? `${llms.text.split(/\r?\n/).filter(Boolean).length} lines at /llms.txt.`
      : !llms || llms.status === 404 ? 'No /llms.txt.'
        : `No readable /llms.txt (HTTP ${llms.status}).`,
    'Add a short /llms.txt: one line about the business, then the pages worth quoting.'));

  const locs = typeof sitemapLocs === 'number' ? sitemapLocs
    : (sitemap && sitemap.status === 200 ? (sitemap.text.match(/<loc>/gi) || []).length : 0);
  out.push(P('sitemap', 'A sitemap', locs ? 'pass' : 'warn',
    locs ? (sitemapChildren ? `${locs} URLs across ${sitemapChildren} child sitemaps of a sitemap index${sitemapChildren >= SITEMAP_MAX_CHILDREN ? ` (first ${SITEMAP_MAX_CHILDREN} read)` : ''}.` : `${locs} URLs in /sitemap.xml.`)
      : sitemap && sitemap.status && sitemap.status !== 404 ? `No readable /sitemap.xml (HTTP ${sitemap.status}).`
        : 'No usable /sitemap.xml.',
    'Publish /sitemap.xml with every public URL and list it in robots.txt.'));

  return out;
}

/* ── sitemap: plain file or index ───────────────────────────────────────── */

const SITEMAP_MAX_CHILDREN = 5;

const countLocs = (xml) => (String(xml || '').match(/<loc[\s>]/gi) || []).length;

// All in One SEO and several shop platforms wrap every <loc> in <![CDATA[…]]>, which a plain
// [^<]+ capture misses. Strip the wrappers before parsing instead of writing two regexes.
const stripCdata = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

/**
 * A lot of CMSs (Yoast, WordPress core, most shop platforms) publish /sitemap.xml as an
 * <sitemapindex> that points at child sitemaps. Counting <loc> on the index alone reports
 * "11 URLs" for a 2,300-product shop, so expand up to SITEMAP_MAX_CHILDREN children.
 */
async function readSitemap(origin, entry) {
  if (!entry || entry.status !== 200) return { ok: false, locs: 0, children: 0, docs: [] };
  const xml = stripCdata(entry.text);
  if (!/<sitemapindex[\s>]/i.test(xml)) {
    return { ok: true, locs: countLocs(xml), children: 0, docs: [{ ...entry, text: xml }] };
  }
  const kids = [];
  for (const m of xml.matchAll(/<loc>\s*([^<>\s]+)\s*<\/loc>/gi)) {
    if (kids.length >= SITEMAP_MAX_CHILDREN) break;
    const t = parseTarget(decode(m[1]));
    if (!t.error && t.url.origin === origin) kids.push(t.url.href);
  }
  const fetched = await Promise.all(kids.map((u) =>
    fetchResource(u, { accept: 'application/xml,text/xml', cap: 500000 }).catch(() => null)));
  const docs = fetched.filter((f) => f && f.status === 200).map((f) => ({ ...f, text: stripCdata(f.text) }));
  return { ok: true, locs: docs.reduce((n, f) => n + countLocs(f.text), 0), children: docs.length, docs };
}

/* ── one scan ───────────────────────────────────────────────────────────── */

export async function scan(rawUrl) {
  const target = parseTarget(rawUrl);
  if (target.error) return { ok: false, error: target.error };

  const pageUrl = target.url.href;
  const origin = target.url.origin;
  const res = await fetchResource(pageUrl, { accept: 'text/html,application/xhtml+xml' });
  if (res.status >= 400) return { ok: false, error: 'http_' + res.status, url: pageUrl };

  const html = res.text;
  if (/^\s*</.test(html) === false && res.headers.get('content-type') && !/html/.test(res.headers.get('content-type'))) {
    return { ok: false, error: 'not_html', url: pageUrl };
  }
  const parsed = parseHtml(html, pageUrl);

  const [robots, sitemapEntry, llms] = await Promise.all([
    fetchResource(origin + '/robots.txt', { accept: 'text/plain', cap: 200000 }).catch(() => null),
    fetchResource(origin + '/sitemap.xml', { accept: 'application/xml,text/xml', cap: 500000 }).catch(() => null),
    fetchResource(origin + '/llms.txt', { accept: 'text/plain', cap: 200000 }).catch(() => null)
  ]);
  const sitemap = await readSitemap(origin, sitemapEntry);

  const checks = checksFor({
    pageUrl, res, html, parsed, robots, llms,
    sitemap: sitemapEntry, sitemapLocs: sitemap.locs, sitemapChildren: sitemap.children
  });
  const passed = checks.filter((c) => c.status === 'pass').length;
  const warned = checks.filter((c) => c.status === 'warn').length;
  const failed = checks.filter((c) => c.status === 'fail').length;

  return {
    ok: true,
    url: pageUrl,
    final_url: res.url,
    fetched_at: new Date().toISOString(),
    bytes: html.length,
    truncated: res.truncated,
    score: { passed, warned, failed, total: checks.length },
    checks,
    facts: {
      title: parsed.title, description: parsed.description, canonical: parsed.canonical,
      h1: parsed.h1.slice(0, 3), h2_count: parsed.h2.length, h3_count: parsed.h3.length,
      jsonld_types: jsonLdTypes(parsed.jsonld).types.slice(0, 12),
      images: parsed.imgs.length,
      images_without_dimensions: parsed.imgs.filter((t) => !/\bwidth\s*=/.test(t) || !/\bheight\s*=/.test(t)).length,
      robots_status: robots ? robots.status : 0,
      sitemap_urls: sitemap.locs,
      sitemap_children: sitemap.children,
      llms_status: llms ? llms.status : 0
    }
  };
}

/* ── helpers shared with /api/report ────────────────────────────────────── */

export async function sitemapUrls(origin, limit = 5) {
  const sm = await fetchResource(origin + '/sitemap.xml', { accept: 'application/xml,text/xml', cap: 500000 }).catch(() => null);
  const map = await readSitemap(origin, sm);
  const out = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  for (const doc of map.docs) {
    let m;
    while ((m = re.exec(doc.text)) && out.length < limit) {
      const raw = decode(m[1]);
      const t = parseTarget(raw);
      if (!t.error && t.url.origin === origin && !out.includes(t.url.href)) out.push(t.url.href);
    }
    if (out.length >= limit) break;
  }
  return out;
}

export function priorityFixes(results) {
  const rank = { fail: 0, warn: 1, pass: 2 };
  const items = [];
  for (const r of results) {
    for (const c of r.checks) {
      if (c.status === 'pass') continue;
      items.push({ url: r.url, ...c });
    }
  }
  return items.sort((a, b) => (rank[a.status] - rank[b.status]) || a.id.localeCompare(b.id)).slice(0, 12);
}
