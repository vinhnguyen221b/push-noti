/* FCM Notification Sender — vanilla JS, no inline handlers (CSP: script-src 'self'). */
(function () {
  'use strict';

  var SEND_PATH = '/api/v1/notifications/send';
  var ids = [
    'serverUrl',
    'apiKey',
    'remember',
    'title',
    'body',
    'token',
    'tokens',
    'topic',
    'data',
    'send',
    'status',
    'result',
    'seg',
  ];
  var el = {};
  ids.forEach(function (id) {
    el[id] = document.getElementById(id);
  });

  var currentTarget = 'token';

  // Restore a previously-remembered key / server URL.
  try {
    var savedKey = localStorage.getItem('fcm.apiKey');
    var savedUrl = localStorage.getItem('fcm.serverUrl');
    if (savedKey) {
      el.apiKey.value = savedKey;
      el.remember.checked = true;
    }
    if (savedUrl) {
      el.serverUrl.value = savedUrl;
    }
  } catch (e) {
    /* localStorage may be unavailable (private mode) — ignore. */
  }

  // Segmented target control: toggle which target input is visible.
  var segButtons = el.seg.querySelectorAll('button');
  Array.prototype.forEach.call(segButtons, function (btn) {
    btn.addEventListener('click', function () {
      currentTarget = btn.getAttribute('data-target');
      Array.prototype.forEach.call(segButtons, function (b) {
        b.classList.toggle('active', b === btn);
      });
      document.getElementById('field-token').classList.toggle('hidden', currentTarget !== 'token');
      document
        .getElementById('field-tokens')
        .classList.toggle('hidden', currentTarget !== 'tokens');
      document.getElementById('field-topic').classList.toggle('hidden', currentTarget !== 'topic');
    });
  });

  function setStatus(text, kind) {
    el.status.textContent = text;
    el.status.className = 'status' + (kind ? ' ' + kind : '');
  }

  function buildTarget() {
    if (currentTarget === 'token') {
      return { token: el.token.value.trim() };
    }
    if (currentTarget === 'tokens') {
      var list = el.tokens.value
        .split(/[\n,]/)
        .map(function (t) {
          return t.trim();
        })
        .filter(Boolean);
      return { tokens: list };
    }
    return { topic: el.topic.value.trim() };
  }

  function buildPayload() {
    var payload = { title: el.title.value, body: el.body.value, target: buildTarget() };
    var dataRaw = el.data.value.trim();
    if (dataRaw) {
      payload.data = JSON.parse(dataRaw); // throws on invalid JSON -> caught by caller
    }
    return payload;
  }

  el.send.addEventListener('click', function () {
    setStatus('Sending…');
    el.result.textContent = '—';

    // Persist or clear the key/url per the "remember" checkbox.
    try {
      if (el.remember.checked) {
        localStorage.setItem('fcm.apiKey', el.apiKey.value);
        localStorage.setItem('fcm.serverUrl', el.serverUrl.value.trim());
      } else {
        localStorage.removeItem('fcm.apiKey');
        localStorage.removeItem('fcm.serverUrl');
      }
    } catch (e) {
      /* ignore storage errors */
    }

    var payload;
    try {
      payload = buildPayload();
    } catch (e) {
      setStatus('Invalid Data JSON', 'err');
      el.result.textContent = String((e && e.message) || e);
      return;
    }

    var base = el.serverUrl.value.trim() || window.location.origin;
    var url = base.replace(/\/+$/, '') + SEND_PATH;

    el.send.disabled = true;
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': el.apiKey.value },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        return res
          .json()
          .catch(function () {
            return {};
          })
          .then(function (json) {
            return { status: res.status, ok: res.ok, json: json };
          });
      })
      .then(function (out) {
        setStatus('HTTP ' + out.status, out.ok ? 'ok' : 'err');
        el.result.textContent = JSON.stringify(out.json, null, 2);
      })
      .catch(function (err) {
        setStatus('Network error', 'err');
        el.result.textContent = String((err && err.message) || err);
      })
      .then(function () {
        el.send.disabled = false;
      });
  });
})();
