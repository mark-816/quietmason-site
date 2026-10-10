(function() {
    'use strict';

    var site = document.currentScript && document.currentScript.getAttribute('data-site') || 'quietmason';
    // Resolve the API base ONCE while the script is executing: document.currentScript
    // is only valid synchronously here — inside load/visibility/beacon callbacks it is
    // null, so a naive per-call computation falls back to a RELATIVE '/track/api.php'
    // and when the script is served from a different host to the collector endpoint
    // silently POST to their own origin and 404. Caching fixes cross-domain embeds.
    var scriptSrc = document.currentScript && document.currentScript.src;
    var apiBase = (window.QM_TRACK_ENDPOINT || '/api/track');

    var startTime = Date.now();
    var sent = false;

    function send(eventType, extra) {
        // Only dedupe pageview (one per page load). Custom events via
        // window.trackEvent (pay_choice, pay_submit, ...) and exit must always
        // pass through (2026-09-08 fix: they were silently dropped before).
        if (eventType === 'pageview' && sent) return;
        if (eventType === 'pageview') sent = true;

        var data = {
            site: site,
            page: window.location.pathname,
            event: eventType,
            ref: document.referrer || '',
            ua: navigator.userAgent,
            screen: screen.width + 'x' + screen.height,
            tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
            dur: eventType === 'exit' ? Math.round((Date.now() - startTime) / 1000) : 0
        };
        if (extra) Object.assign(data, extra);

        var payload = JSON.stringify(data);
        if (navigator.sendBeacon) {
            navigator.sendBeacon(apiBase, payload);
        } else {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', apiBase, true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.send(payload);
        }
    }

    // Page view on load
    if (document.readyState === 'complete') {
        send('pageview');
    } else {
        window.addEventListener('load', function() { send('pageview'); });
    }

    // Exit tracking (dwell time)
    window.addEventListener('beforeunload', function() {
        send('exit', {page: window.location.pathname});
    });

    // Visibility change (tab switch / minimize)
    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'hidden') {
            send('exit', {page: window.location.pathname});
        }
    });

    // Expose for manual events (add to cart etc.)
    window.trackEvent = function(eventName, extra) {
        send(eventName, extra);
    };
})();
