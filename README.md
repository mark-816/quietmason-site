# quietmason.com

Source of the quietmason.com site: a small studio site for automation, data pipelines and
technical SEO. Static pages plus three small Cloudflare Pages Functions (`/api/contact`,
`/api/chat`, `/api/track`).

Published for transparency. No licence is granted for reuse of the copy, the design or the
brand; the code is here so that anything we claim about how the site works can be checked.

## Layout

```
site/                  the static site (one directory per route; 404.html for misses)
  _headers             security headers and cache policy
  _redirects           www -> apex, /index.html -> /
  _routes.json         runs Functions on /api/* only
functions/api/         contact form, chat rules layer, first-party page events
schema.sql             D1 schema for events / chat logs / leads
wrangler.toml          Pages project config (no secrets live here)
```

## Run it locally

```bash
npx wrangler pages dev site --port 8788 --local
curl -s -X POST -H 'Content-Type: application/json' \
     -d '{"message":"how much does it cost"}' http://127.0.0.1:8788/api/chat
```

`functions/api/_facts.json` is generated from the chat widget's own FAQ map, so the browser
fallback and the server rules layer cannot drift apart.

## Notes

- No cookies and no third-party analytics by default: the analytics slot stays inert until a
  Cloudflare Web Analytics token is configured.
- The chat panel answers from a rules layer built from this site's own copy, and says so rather
  than pretending to be a person.
- Contact submissions are validated server-side and dropped silently when the honeypot is
  filled. Delivery needs a mail-provider key that is not in this repository.
