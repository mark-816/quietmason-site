/* quietmason app.js — contact form + the "quick answers" panel.
   No dependencies. Nothing here is decorative: both paths end in a message a human reads.
   The endpoint is configurable (window.QM_CONTACT_ENDPOINT) so a preview can point at a mock.
*/
(function () {
  var d = document;
  var ENDPOINT = window.QM_CONTACT_ENDPOINT || '/api/contact';

  function post(payload) {
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        return { status: r.status, ok: r.ok && data.ok !== false, data: data };
      });
    });
  }

  function mailtoFallback(payload) {
    var body = (payload.message || '') + '\n\nSent from ' + location.pathname;
    return 'mailto:hello@quietmason.com?subject=' + encodeURIComponent('[site] ' + (payload.topic || 'question')) +
           '&body=' + encodeURIComponent(body);
  }

  function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((v || '').trim()); }

  /* ---------------------------------------------------------------- contact form */
  var form = d.getElementById('qm-contact');
  if (form) {
    var status = d.getElementById('cf-status');
    var submit = d.getElementById('cf-submit');
    function setStatus(kind, msg) {
      if (!status) return;
      status.className = 'form-status' + (kind ? ' ' + kind : '');
      status.textContent = msg;
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = form.email.value.trim();
      var message = form.message.value.trim();
      var topic = form.topic ? form.topic.value : 'other';
      var trap = form.website ? form.website.value : '';

      form.email.classList.toggle('form-error', !validEmail(email));
      form.message.classList.toggle('form-error', message.length < 10);
      if (!validEmail(email) || message.length < 10) {
        setStatus('err', 'Please add a working email and a sentence or two about the task.');
        return;
      }
      if (submit) submit.disabled = true;
      setStatus('busy', 'Sending…');
      post({ email: email, topic: topic, message: message, website: trap, source: location.pathname })
        .then(function (res) {
          if (res.ok && res.data.delivered) {
            form.reset();
            setStatus('ok', 'Got it. You will hear from a person within one business day.');
          } else if (res.ok) {
            setStatus('ok', 'Received and stored. Delivery to the inbox is not wired up on this preview, so if you are trialling the site, also ' +
              '<a href="' + mailtoFallback({ message: message, topic: topic }) + '">email it directly</a>.');
          } else {
            setStatus('err', 'That did not send (' + res.status + '). ' +
              '<a href="' + mailtoFallback({ message: message, topic: topic }) + '">Open it in your mail app instead</a>, same inbox.');
          }
        })
        .catch(function () {
          setStatus('err', 'Network problem. ' +
            '<a href="' + mailtoFallback({ message: message, topic: topic }) + '">Send it by email instead</a>.');
        })
        .then(function () { if (submit) submit.disabled = false; });
    });
  }

})();
