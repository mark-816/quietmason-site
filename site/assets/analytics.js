/* Analytics slot — config driven.
   Nothing is loaded and no request is made until window.QM_ANALYTICS has a token.
   Cloudflare Web Analytics is preferred: free, no cookies, no personal data, so the site
   needs no consent banner. Enable it in the Cloudflare dashboard (Web Analytics -> Add site)
   and paste the token into the inline config in each page's <head>.
   Measured behaviour with an empty token: zero third-party requests, zero cookies.
*/
(function () {
  var cfg = window.QM_ANALYTICS || {};
  var token = (cfg.cfToken || '').trim();
  if (!token) return;                       /* not configured: do nothing at all */

  var s = document.createElement('script');
  s.defer = true;
  s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  s.setAttribute('data-cf-beacon', JSON.stringify({ token: token }));
  document.head.appendChild(s);

  /* First-party, cookie-free event ping (optional). Left in place so CTA/inquiry clicks can be
     counted later without adding a third party; it only fires when an endpoint is configured.
     Deliberately NOT wired to any existing site's collector: table and event names of our other
     properties are themselves a fingerprint, so this line stays unused until a separate one exists. */
  if (!cfg.eventEndpoint) return;
  function ping(name) {
    try {
      var body = JSON.stringify({ e: name, p: location.pathname });
      if (navigator.sendBeacon) navigator.sendBeacon(cfg.eventEndpoint, body);
      else fetch(cfg.eventEndpoint, { method: 'POST', body: body, keepalive: true });
    } catch (err) {}
  }
  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a') : null;
    if (!a) return;
    if (a.getAttribute('href') === '/contact/' || (a.getAttribute('href') || '').indexOf('mailto:') === 0) ping('contact_click');
  }, { passive: true });
})();
