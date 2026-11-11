/* Learn City Help — one shared help centre for every app.
   Add to any page AFTER that page's own app.js:

     <script src="help.js" data-app="results"></script>

   Options (attributes on the script tag):
     data-app          which app's questions to show; comma-separate for
                       several (e.g. "sparkpoints,fees"), or ALL. Required.
     data-exclude      with ALL: apps to leave out (e.g. "recruitment").
     data-endpoint     Apps Script /exec URL. Optional: the page's own
                       ENDPOINT constant from app.js is used if left out.
     data-email-field  id of the sign-in email box (default staffEmail)
     data-code-field   id of the sign-in code box  (default staffCode)
     data-bottom       distance of the ? button from the bottom, in px
                       (default 16; raise it where a bottom bar would clash)
     data-mount        id of an element to show the help centre inside the
                       page itself (e.g. a Help page), instead of a pop-out
     data-button       "off" to hide the floating ? button

   Content comes from the HELP tab in the Spark Points sheet. Signed-in
   staff see questions for their role; everyone else sees the general ones.
   Written in plain ES5 with XMLHttpRequest so it also runs on pupils' older
   phones. */
(function () {
  'use strict';

  var me = document.currentScript || (function () {
    var s = document.querySelectorAll('script[src*="help.js"]');
    return s[s.length - 1];
  })();
  function attr(name, fallback) { var v = me && me.getAttribute(name); return v === null || v === undefined || v === '' ? fallback : v; }

  var cfg = {
    app: attr('data-app', ''),
    exclude: attr('data-exclude', ''),
    endpoint: attr('data-endpoint', ''),
    emailField: attr('data-email-field', 'staffEmail'),
    codeField: attr('data-code-field', 'staffCode'),
    bottom: parseInt(attr('data-bottom', '16'), 10) || 16,
    mount: attr('data-mount', ''),
    button: attr('data-button', 'on') !== 'off'
  };
  var allMode = /(^|,)\s*all\s*(,|$)/i.test(cfg.app);
  var NAVY = '#004AAD';
  var APP_LABELS = {
    all: 'General', sparkpoints: 'Spark Points', fees: 'Fees', results: 'Results', appraisal: 'Appraisal',
    homework: 'Homework (pupils)', homeworkstaff: 'Homework', staffhub: 'Staff Hub', recruitment: 'Recruitment test', admin: 'Admin Portal'
  };
  var manualUser = null;
  var data = { key: '', entries: null, signedIn: false };
  var views = [];

  function endpoint() {
    if (cfg.endpoint) return cfg.endpoint;
    try { if (typeof ENDPOINT !== 'undefined' && ENDPOINT) return ENDPOINT; } catch (e) { /* not defined */ }
    return '';
  }

  /* Who is signed in: an explicit LCHelp.setUser call, else the app's own
     state, else the sign-in boxes (apps fill these when restoring a session). */
  function currentUser() {
    if (manualUser) return manualUser;
    try {
      /* global state */
      if (typeof state !== 'undefined' && state && state.email && state.code) return { email: state.email, code: state.code };
    } catch (e) { /* no app state */ }
    var e = document.getElementById(cfg.emailField);
    var c = document.getElementById(cfg.codeField);
    var email = e && e.value ? e.value.replace(/^\s+|\s+$/g, '') : '';
    var code = c && c.value ? c.value.replace(/^\s+|\s+$/g, '') : '';
    return email && code ? { email: email, code: code } : null;
  }

  function currentScreen() {
    var active = document.querySelector('.tabBtn.activeTab, .tab.on, .tabs .on, .nav__link[aria-current], [aria-selected="true"]');
    var label = active ? active.textContent.replace(/\s+/g, ' ').replace(/^\s|\s$/g, '') : '';
    return (label ? label + ' — ' : '') + (document.title || '');
  }

  function call(payload, done) {
    var url = endpoint();
    if (!url) { done(new Error('Help is not connected yet.')); return; }
    var xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded;charset=UTF-8');
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var res = null;
      try { res = JSON.parse(xhr.responseText); } catch (e) { /* not JSON */ }
      if (!res) { done(new Error('Could not reach the server. Check your connection and try again.')); return; }
      if (!res.success) { done(new Error(res.error || 'Something went wrong.')); return; }
      done(null, res);
    };
    xhr.send('data=' + encodeURIComponent(JSON.stringify(payload)));
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  // Plain text -> paragraphs, line breaks and clickable links.
  function formatAnswer(text) {
    return String(text || '').split(/\n\s*\n/).map(function (para) {
      var html = esc(para).replace(/\n/g, '<br>')
        .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
      return '<p>' + html + '</p>';
    }).join('');
  }

  function hasClass(el, c) { return (' ' + el.className + ' ').indexOf(' ' + c + ' ') !== -1; }
  function setHidden(el, hidden) {
    if (hidden && !hasClass(el, 'lch-hidden')) el.className += ' lch-hidden';
    if (!hidden) el.className = el.className.replace(/\s*\blch-hidden\b/g, '');
  }

  /* ---------- styles ---------- */
  var css =
    '.lch-btn{position:fixed;right:16px;bottom:' + cfg.bottom + 'px;z-index:9998;width:48px;height:48px;border-radius:50%;border:0;' +
      'background:' + NAVY + ';color:#fff;font-family:inherit;font-weight:700;font-size:22px;line-height:48px;' +
      'box-shadow:0 4px 14px rgba(0,0,0,.18);cursor:pointer;padding:0}' +
    '.lch-btn:focus{outline:3px solid #F8A74B;outline-offset:2px}' +
    '.lch-overlay{position:fixed;top:0;right:0;bottom:0;left:0;z-index:9998;background:rgba(15,23,42,.35)}' +
    '.lch-panel{position:fixed;top:0;right:0;bottom:0;z-index:9999;width:100%;max-width:420px;background:#fff;color:#1f2937;' +
      'display:flex;flex-direction:column;box-shadow:-6px 0 24px rgba(0,0,0,.15);font-family:inherit;text-align:left}' +
    '.lch-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #e5e9f0}' +
    '.lch-head h2{margin:0;font-size:18px;color:' + NAVY + '}' +
    '.lch-x{background:none;border:0;font-size:26px;line-height:1;cursor:pointer;color:#5b6577;padding:4px 8px;width:auto;min-height:0}' +
    '.lch-body{flex:1;overflow-y:auto;padding:12px 16px 20px;-webkit-overflow-scrolling:touch}' +
    '.lch-inline{color:inherit;text-align:left}' +
    '.lch-search{display:block;width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #cfd6e3;border-radius:6px;font:inherit;margin:0 0 12px}' +
    '.lch-cat{margin:16px 0 6px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#5b6577}' +
    '.lch-q{border:1px solid #e5e9f0;border-radius:6px;margin-bottom:6px;background:#fff}' +
    '.lch-q summary{cursor:pointer;padding:10px 12px;font-weight:600;list-style:none;color:#1f2937}' +
    '.lch-q summary::-webkit-details-marker{display:none}' +
    '.lch-q summary:before{content:"+";display:inline-block;width:16px;color:' + NAVY + '}' +
    '.lch-q[open] summary:before{content:"−"}' +
    '.lch-a{padding:0 12px 6px 28px;font-size:14px;line-height:1.55;color:#1f2937}' +
    '.lch-a p{margin:0 0 8px}.lch-a a{color:' + NAVY + '}' +
    '.lch-muted{color:#5b6577;font-size:14px}' +
    '.lch-report{margin-top:22px;padding-top:14px;border-top:1px solid #e5e9f0}' +
    '.lch-report h3{margin:0 0 8px;font-size:15px;color:#1f2937}' +
    '.lch-report input,.lch-report textarea{display:block;width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid #cfd6e3;' +
      'border-radius:6px;font:inherit;margin:0 0 8px;background:#fff;color:#1f2937}' +
    '.lch-send{background:' + NAVY + ';color:#fff;border:0;border-radius:6px;padding:10px 16px;font:inherit;font-weight:600;cursor:pointer;width:auto}' +
    '.lch-send[disabled]{opacity:.6;cursor:default}' +
    '.lch-err{color:#b00020;font-size:14px;margin:6px 0 0}.lch-ok{color:#166534;font-size:14px;margin:6px 0 0}' +
    '.lch-hidden{display:none!important}' +
    '@media print{.lch-btn,.lch-panel,.lch-overlay{display:none!important}}';

  var BODY =
    '<input type="search" class="lch-search" placeholder="Search help…" aria-label="Search help">' +
    '<div class="lch-list"><p class="lch-muted">Loading…</p></div>' +
    '<div class="lch-report">' +
      '<h3>Still stuck? Report an issue</h3>' +
      '<div class="lch-anon">' +
        '<input type="text" class="lch-name" placeholder="Your name" autocomplete="name">' +
        '<input type="text" class="lch-contact" placeholder="Email or phone number" autocomplete="email">' +
      '</div>' +
      '<textarea class="lch-msg" rows="4" placeholder="What were you trying to do, and what happened?"></textarea>' +
      '<button type="button" class="lch-send">Send to Head of IT</button>' +
      '<p class="lch-err" aria-live="polite"></p><p class="lch-ok" aria-live="polite"></p>' +
    '</div>';

  /* One help centre view (pop-out panel or in-page). */
  function View(root) {
    var q = function (sel) { return root.querySelector(sel); };
    var search = q('.lch-search'), list = q('.lch-list'), anon = q('.lch-anon');

    function syncAnon() {
      var hide = data.signedIn && !!currentUser();
      setHidden(anon, hide);
      var contact = q('.lch-contact'), u = currentUser();
      if (!hide && u && !contact.value) contact.value = u.email; // e.g. a pupil's school email
    }

    function render() {
      syncAnon();
      if (!data.entries) return;
      var term = search.value.replace(/^\s+|\s+$/g, '').toLowerCase();
      var items = data.entries.filter(function (e) {
        return !term || (e.question + ' ' + e.answer + ' ' + e.category).toLowerCase().indexOf(term) !== -1;
      });
      if (!items.length) {
        list.innerHTML = '<p class="lch-muted">' + (term ? 'Nothing matches “' + esc(term) +
          '”. Try other words, or report an issue below.' : 'No help topics yet.') + '</p>';
        return;
      }
      var groups = [], byCat = {};
      items.forEach(function (e) {
        var label = allMode ? (APP_LABELS[e.app] || e.app) + ' · ' + e.category : e.category;
        if (!byCat[label]) { byCat[label] = []; groups.push(label); }
        byCat[label].push(e);
      });
      list.innerHTML = groups.map(function (cat) {
        return '<div class="lch-cat">' + esc(cat) + '</div>' + byCat[cat].map(function (e) {
          return '<details class="lch-q"' + (term ? ' open' : '') + '><summary>' + esc(e.question) + '</summary>' +
            '<div class="lch-a">' + formatAnswer(e.answer) + '</div></details>';
        }).join('');
      }).join('');
    }

    function showError(message) { list.innerHTML = '<p class="lch-err">' + esc(message) + '</p>'; }
    function showLoading() { list.innerHTML = '<p class="lch-muted">Loading…</p>'; }

    function send() {
      var err = q('.lch-err'), ok = q('.lch-ok'), btn = q('.lch-send');
      err.textContent = ''; ok.textContent = '';
      var user = currentUser();
      var payload = { action: 'help.report', app: cfg.app, screen: currentScreen(), message: q('.lch-msg').value.replace(/^\s+|\s+$/g, '') };
      if (user) { payload.email = user.email; payload.code = user.code; }
      payload.name = q('.lch-name').value.replace(/^\s+|\s+$/g, '');
      payload.contact = q('.lch-contact').value.replace(/^\s+|\s+$/g, '');
      if (payload.message.length < 10) { err.textContent = 'Please describe the problem in a sentence or two.'; return; }
      btn.disabled = true; btn.textContent = 'Sending…';
      call(payload, function (e) {
        btn.disabled = false; btn.textContent = 'Send to Head of IT';
        if (e) { err.textContent = e.message; return; }
        q('.lch-msg').value = '';
        ok.textContent = 'Sent. The Head of IT will get back to you.';
      });
    }

    search.oninput = render;
    q('.lch-send').onclick = send;

    return {
      render: render, showError: showError, showLoading: showLoading, search: search,
      clearNotes: function () { q('.lch-err').textContent = ''; q('.lch-ok').textContent = ''; }
    };
  }

  function load() {
    var user = currentUser();
    var key = cfg.app + '|' + (user ? user.email : '');
    if (data.key === key && data.entries) { views.forEach(function (v) { v.render(); }); return; }
    views.forEach(function (v) { v.showLoading(); });
    var payload = { action: 'help.list', app: cfg.app, exclude: cfg.exclude };
    if (user) { payload.email = user.email; payload.code = user.code; }
    call(payload, function (e, res) {
      if (e) { views.forEach(function (v) { v.showError(e.message); }); return; }
      data = { key: key, entries: res.entries || [], signedIn: !!res.signedIn };
      views.forEach(function (v) { v.render(); });
    });
  }

  function build() {
    var style = document.createElement('style');
    style.appendChild(document.createTextNode(css));
    document.getElementsByTagName('head')[0].appendChild(style);

    // In-page help centre (e.g. the Staff Hub's Help page).
    var mount = cfg.mount && document.getElementById(cfg.mount);
    if (mount) {
      mount.className += ' lch-inline';
      mount.innerHTML = BODY;
      views.push(View(mount));
      var loadIfShown = function () { if (mount.offsetParent !== null) load(); };
      window.addEventListener('hashchange', function () { setTimeout(loadIfShown, 50); });
      document.addEventListener('click', function () { setTimeout(loadIfShown, 80); });
      setTimeout(loadIfShown, 300);
    }

    if (!cfg.button) return;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lch-btn';
    btn.setAttribute('aria-label', 'Help');
    btn.title = 'Help';
    btn.textContent = '?';

    var overlay = document.createElement('div');
    overlay.className = 'lch-overlay lch-hidden';

    var panel = document.createElement('div');
    panel.className = 'lch-panel lch-hidden';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Help');
    panel.innerHTML =
      '<div class="lch-head"><h2>Help</h2><button type="button" class="lch-x" aria-label="Close help">&times;</button></div>' +
      '<div class="lch-body">' + BODY + '</div>';

    document.body.appendChild(btn);
    document.body.appendChild(overlay);
    document.body.appendChild(panel);
    var view = View(panel);
    views.push(view);

    function open() {
      setHidden(overlay, false); setHidden(panel, false);
      view.clearNotes();
      load();
      setTimeout(function () { try { view.search.focus(); } catch (e) {} }, 50);
    }
    function close() {
      setHidden(overlay, true); setHidden(panel, true);
      try { btn.focus(); } catch (e) {}
    }

    btn.onclick = open;
    overlay.onclick = close;
    panel.querySelector('.lch-x').onclick = close;
    document.addEventListener('keydown', function (ev) {
      if ((ev.key === 'Escape' || ev.keyCode === 27) && !hasClass(panel, 'lch-hidden')) close();
    });
  }

  /* For apps that keep sign-in details elsewhere: call after sign-in
     LCHelp.setUser(email, code), and LCHelp.setUser(null) on sign-out. */
  window.LCHelp = {
    setUser: function (email, code) {
      manualUser = email && code ? { email: email, code: code } : null;
      data = { key: '', entries: null, signedIn: false };
    },
    refresh: function () { data = { key: '', entries: null, signedIn: false }; load(); }
  };

  if (!cfg.app) { if (window.console) console.warn('help.js: add data-app="..." to the script tag.'); return; }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
