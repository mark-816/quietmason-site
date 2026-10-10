/* quietmason motion — zero dependencies
   Rules (skill: frontend-motion-library):
     · animate transform/opacity only            · honour prefers-reduced-motion, never hide content
     · no scroll hijacking                       · every effect is gated on html[data-fx~="name"]
   Nothing is hidden unless the JS that reveals it is running, so a JS failure leaves the page plain
   but fully readable. ?fx=1 opens the fitting room to toggle each effect.
*/
(function () {
  var d = document, root = d.documentElement;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- effect registry ---------- */
  var ALL = [
    ['reveal',    'Fade + rise on scroll'],
    ['stagger',   'Stagger children (70ms)'],
    ['progress',  'Reading progress bar'],
    ['tilt',      'Card 3D tilt (pointer)'],
    ['magnetic',  'Magnetic buttons'],
    ['glow',      'Cursor glow in hero'],
    ['underline', 'Nav underline sweep'],
    ['shimmer',   'Gradient shimmer on eyebrows'],
    ['words',     'Headline word-by-word'],
    ['scale',     'Console scale-in'],
    ['mask',      'Headline mask sweep'],
    ['wipe',      'Blocks wipe in from left'],
    ['burst',     'Confetti on CTA click'],
    ['type',      'Rotating eyebrow text']
  ];
  var DEFAULT_ON = ['reveal', 'stagger', 'progress', 'tilt', 'magnetic', 'glow', 'underline', 'shimmer', 'words', 'scale'];
  var KEY = 'qm-fx';

  function loadSet() {
    if (reduce) return {};
    var qs = /[?&]fx=([^&]*)/.exec(location.search);
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) {}
    var list = raw !== null ? raw.split(',').filter(Boolean) : DEFAULT_ON.slice();
    if (qs && raw === null) list = DEFAULT_ON.slice();
    var set = {};
    list.forEach(function (n) { set[n] = true; });
    return set;
  }
  var fx = loadSet();
  function has(n) { return !!fx[n]; }
  function save() {
    var list = Object.keys(fx).filter(function (k) { return fx[k]; });
    try { localStorage.setItem(KEY, list.join(',')); } catch (e) {}
    apply();
  }
  function apply() {
    var list = Object.keys(fx).filter(function (k) { return fx[k]; });
    root.setAttribute('data-fx', list.join(' '));
  }
  apply();

  if (reduce) return;   /* reduced motion: no effects, everything visible */

  /* ---------- reading progress ---------- */
  var bar = d.createElement('div');
  bar.id = 'qm-progress';
  d.body.appendChild(bar);
  if (!has('progress')) bar.style.display = 'none';
  function syncProgress() { bar.style.display = has('progress') ? '' : 'none'; }

  var header = d.querySelector('header');
  var raf = 0;
  var consoleEl = d.querySelector('.console');

  function onScroll() {
    var h = d.documentElement.scrollHeight - window.innerHeight;
    var y = window.scrollY || d.documentElement.scrollTop || 0;
    bar.style.transform = 'scaleX(' + (h > 0 ? Math.min(y / h, 1) : 0) + ')';
    if (header) header.classList.toggle('scrolled', y > 8);
    if (has('scale') && consoleEl) {   /* gentle parallax on the console mock */
      var cap = (consoleEl.parentElement && consoleEl.parentElement.offsetHeight) || 600;
      consoleEl.style.transform = 'translate3d(0,' + Math.min(y * 0.05, cap * 0.04).toFixed(1) + 'px,0)';
    }
    raf = 0;
  }
  function queue() { if (!raf) raf = requestAnimationFrame(onScroll); }
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);
  onScroll();

  /* ---------- reveal targets (skipping elements owned by another effect) ---------- */
  var SEL = ['section > .wrap > .section-head', 'section > .wrap > h2', 'section > .wrap > p.lede',
             '.grid > .card', '.steps > .step', '.strip', '.stats', '.stat', 'table', 'ul.clean', '.note',
             '.cta', '.hero .lede', '.hero .cta', '.hero-note', '.card', 'p.lede',
             '.artifact', '.case', '.trow', 'details'];
  if (!has('words') && !has('mask')) SEL.push('.hero h1');
  if (!has('scale')) SEL.push('.console');

  var seen = [], targets = [];
  SEL.forEach(function (s) {
    Array.prototype.forEach.call(d.querySelectorAll(s), function (el) {
      if (seen.indexOf(el) === -1) { seen.push(el); targets.push(el); }
    });
  });

  if (has('stagger')) {
    ['.grid', '.steps', '.strip', '.stats', 'ul.clean', '.case-metas', 'section > .wrap'].forEach(function (g) {
      Array.prototype.forEach.call(d.querySelectorAll(g), function (parent) {
        var kids = Array.prototype.filter.call(parent.children, function (c) { return targets.indexOf(c) !== -1; });
        kids.forEach(function (k, i) { k.style.transitionDelay = Math.min(i * 70, 350) + 'ms'; });
      });
    });
  }

  if (has('reveal') || has('wipe')) targets.forEach(function (el) { el.classList.add('rv'); });

  function show(el) {
    if (has('reveal')) el.classList.add('in');
    if (has('wipe')) el.classList.add('in');
  }

  var io = null;
  function scan() {
    var vh = window.innerHeight;
    targets.forEach(function (el) {
      if (el.classList.contains('in')) return;
      var r = el.getBoundingClientRect();
      if (r.top < vh * 0.92 || r.bottom < 0) show(el);
    });
    if (has('scale') && consoleEl && !consoleEl.classList.contains('in')) {
      var c = consoleEl.getBoundingClientRect();
      if (c.top < window.innerHeight * 0.95) consoleEl.classList.add('in');
    }
    if (has('mask')) {
      var h1 = d.querySelector('.hero h1');
      if (h1 && !h1.classList.contains('in')) h1.classList.add('in');
    }
    if (has('words')) {
      var w = d.querySelector('.hero h1');
      if (w && !w.classList.contains('in')) w.classList.add('in');
    }
  }

  if (has('reveal') && 'IntersectionObserver' in window) {
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { show(e.target); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });
    targets.forEach(function (el) { io.observe(el); });
  }

  /* no throttle: a skipped scan is how content ends up stuck hidden */
  ['scroll', 'resize', 'hashchange', 'pageshow', 'wheel', 'touchmove'].forEach(function (ev) {
    window.addEventListener(ev, scan, { passive: true });
  });
  window.addEventListener('keydown', scan);
  d.addEventListener('visibilitychange', scan);
  scan();
  var poll = setInterval(function () {
    scan();
    if (targets.every(function (t) { return t.classList.contains('in'); })) clearInterval(poll);
  }, 600);
  setTimeout(function () { clearInterval(poll); }, 45000);
  [400, 1500].forEach(function (t) { setTimeout(scan, t); });

  /* ---------- console lines ---------- */
  Array.prototype.forEach.call(d.querySelectorAll('.console-body .row'), function (r, i) {
    setTimeout(function () { r.classList.add('in'); }, 180 + i * 130);
  });

  /* ---------- counters ---------- */
  function countUp(el) {
    var real = el.getAttribute('data-count');
    if (real === null || isNaN(parseFloat(real))) return;
    var target = parseFloat(real), suffix = el.getAttribute('data-suffix') || '', done = false;
    function finish() { if (!done) { done = true; el.textContent = Math.round(target) + suffix; } }
    el.textContent = '0' + suffix;
    var t0 = null;
    function step(ts) {
      if (done) return;
      if (t0 === null) t0 = ts;
      var p = Math.min((ts - t0) / 900, 1);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))) + suffix;
      if (p < 1) requestAnimationFrame(step); else finish();
    }
    requestAnimationFrame(step);
    setTimeout(finish, 1100);
  }
  var counters = d.querySelectorAll('[data-count]');
  if ('IntersectionObserver' in window) {
    var io2 = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { countUp(e.target); io2.unobserve(e.target); } });
    }, { threshold: 0.4 });
    Array.prototype.forEach.call(counters, function (el) { io2.observe(el); });
  } else {
    Array.prototype.forEach.call(counters, function (el) { countUp(el); });
  }
  setTimeout(function () {
    Array.prototype.forEach.call(counters, function (el) {
      if (el.textContent === '0') {
        var real = el.getAttribute('data-count');
        var r = el.getBoundingClientRect();
        if (real !== null && (r.top < window.innerHeight || r.bottom < 0)) countUp(el);
      }
    });
  }, 1200);
  setTimeout(function () {
    Array.prototype.forEach.call(counters, function (el) {
      if (el.textContent === '0') {
        var real = el.getAttribute('data-count');
        if (real !== null) el.textContent = Math.round(parseFloat(real)) + (el.getAttribute('data-suffix') || '');
      }
    });
  }, 3500);

  /* ---------- headline word-by-word ---------- */
  var h1 = d.querySelector('.hero h1');
  if (has('words') && h1 && h1.textContent.indexOf('||') === -1) {
    var words = h1.textContent.split(/(\s+)/);
    h1.textContent = '';
    var wi = 0;
    words.forEach(function (piece) {
      if (/^\s+$/.test(piece)) { h1.appendChild(d.createTextNode(' ')); return; }
      var span = d.createElement('span');
      span.className = 'w';
      span.textContent = piece;
      span.style.animationDelay = Math.min(wi * 55, 700) + 'ms';
      wi++;
      h1.appendChild(span);
    });
    h1.classList.add('in');
  }
  if (has('mask')) { /* handled by scan(), time-based transition */ }

  /* ---------- rotating eyebrow ---------- */
  if (has('type')) {
    var eb = d.querySelector('.hero .eyebrow');
    if (eb) {
      var words3 = ['Automation', 'Data pipelines', 'Technical SEO'];
      var n = 0;
      setInterval(function () {
        n = (n + 1) % words3.length;
        eb.textContent = words3[n];
      }, 2600);
    }
  }

  /* ---------- pointer effects: tilt / magnetic / glow ---------- */
  var fine = window.matchMedia && window.matchMedia('(hover:hover) and (pointer:fine)').matches;
  if (fine && has('tilt')) {
    Array.prototype.forEach.call(d.querySelectorAll('.card, .case, .artifact'), function (el) {
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width - 0.5;
        var py = (e.clientY - r.top) / r.height - 0.5;
        el.style.transform = 'perspective(900px) rotateY(' + (px * 4).toFixed(2) + 'deg) rotateX(' + (-py * 4).toFixed(2) + 'deg) translateY(-2px)';
      });
      el.addEventListener('pointerleave', function () { el.style.transform = ''; });
    });
  }
  if (fine && has('magnetic')) {
    Array.prototype.forEach.call(d.querySelectorAll('.btn'), function (el) {
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        var dx = (e.clientX - r.left - r.width / 2) / (r.width / 2);
        var dy = (e.clientY - r.top - r.height / 2) / (r.height / 2);
        el.style.transform = 'translate3d(' + (dx * 5).toFixed(2) + 'px,' + (dy * 4 - 2).toFixed(2) + 'px,0)';
      });
      el.addEventListener('pointerleave', function () { el.style.transform = ''; });
    });
  }
  var heroEl = d.querySelector('.hero');
  var glowEl = null;
  if (heroEl && has('glow')) {
    glowEl = d.createElement('div');
    glowEl.className = 'fxGlow';
    heroEl.insertBefore(glowEl, heroEl.firstChild);
    heroEl.addEventListener('pointermove', function (e) {
      var r = heroEl.getBoundingClientRect();
      glowEl.style.transform = 'translate3d(' + (e.clientX - r.left).toFixed(0) + 'px,' + (e.clientY - r.top).toFixed(0) + 'px,0)';
    });
  }

  /* ---------- confetti (opt-in, fired by the fitting room demo) ---------- */
  function burst(x, y) {
    for (var i = 0; i < 22; i++) {
      var p = d.createElement('span');
      p.className = 'mk-burst';
      p.style.left = x + 'px';
      p.style.top = y + 'px';
      p.style.background = ['#2a5bd7', '#8cb0ff', '#5fd39a', '#e0b34f'][i % 4];
      d.body.appendChild(p);
      (function (node, angle, dist) {
        node.animate([
          { transform: 'translate3d(0,0,0) rotate(0deg)', opacity: 1 },
          { transform: 'translate3d(' + (Math.cos(angle) * dist).toFixed(0) + 'px,' + (Math.sin(angle) * dist).toFixed(0) + 'px,0) rotate(' + (angle * 90).toFixed(0) + 'deg)', opacity: 0 }
        ], { duration: 900 + Math.random() * 400, easing: 'cubic-bezier(.16,.84,.44,1)' });
      })(p, Math.random() * Math.PI * 2, 60 + Math.random() * 120);
      setTimeout(function (n) { return function () { n.remove(); }; }(p), 1400);
    }
  }
  if (has('burst')) {
    Array.prototype.forEach.call(d.querySelectorAll('a.btn'), function (a) {
      a.addEventListener('click', function (e) {
        burst(e.clientX || 200, e.clientY || 200);
      });
    });
  }

  /* ---------- fitting room (?fx=1) ---------- */
  if (/[?&]fx=1/.test(location.search)) {
    var panel = d.createElement('div');
    panel.id = 'fxPanel';
    var html = '<h4>Motion fitting room</h4>';
    ALL.forEach(function (pair) {
      html += '<div class="row2"><label><input type="checkbox" data-fxname="' + pair[0] + '"' +
              (has(pair[0]) ? ' checked' : '') + '> ' + pair[1] + '</label>' +
              '<button type="button" data-try="' + pair[0] + '">try</button></div>';
    });
    html += '<div class="hint">Saved in this browser. Defaults: ' + DEFAULT_ON.length + ' on. ' +
            '?fx=1 only shows this panel — visitors never see it.</div>';
    panel.innerHTML = html;
    d.body.appendChild(panel);

    panel.addEventListener('change', function (e) {
      var name = e.target.getAttribute && e.target.getAttribute('data-fxname');
      if (!name) return;
      fx[name] = e.target.checked;
      if (name === 'progress') syncProgress();
      save();
      if (e.target.checked) location.reload();   /* re-init the effect cleanly */
    });

    panel.addEventListener('click', function (e) {
      var name = e.target.getAttribute && e.target.getAttribute('data-try');
      if (!name) return;
      e.preventDefault();
      var t = d.querySelector('.hero') || d.body;
      if (name === 'burst') { burst(window.innerWidth / 2, window.innerHeight / 2); return; }
      if (!has(name)) {   /* switch it on, then show it */
        fx[name] = true; save();
        if (name === 'progress') syncProgress();
        location.reload();
        return;
      }
      t.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (name === 'glow' && heroEl) heroEl.classList.add('fxForce');
      setTimeout(function () { if (heroEl) heroEl.classList.remove('fxForce'); }, 2200);
    });
  }

  var forced = /[?&]force=([a-z]+)/.exec(location.search);
  if (forced && heroEl) heroEl.classList.add('fxForce');
})();
