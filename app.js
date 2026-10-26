/* Learn City homework portal — student front end.

   SETUP: paste the deployed Apps Script /exec URL into ENDPOINT below. It is
   the same URL the Spark Points staff portal uses.

   Written in plain ES5 with XMLHttpRequest rather than fetch and arrow
   functions, because the phones this runs on are not all recent. Requests are
   form-encoded into a `data` field, exactly as app.js in the staff portal does
   — that shape is what lets Apps Script answer without a CORS preflight.

   The answer key never reaches this file until the student submits. Draft
   answers are kept in sessionStorage so a refresh mid-homework does not lose
   work; the marked result is deliberately never stored. */

/* A script error would otherwise leave a pupil staring at a frozen page with no
   idea why. Same visible bar the staff portals use. */
function fatal(message) {
  var bar = document.getElementById('lcFatal');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'lcFatal';
    bar.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;background:#9b1c1c;' +
      'color:#fff;padding:12px 16px;font:14px/1.5 Arial,Helvetica,sans-serif;white-space:pre-wrap';
    (document.body || document.documentElement).appendChild(bar);
  }
  bar.textContent = 'Something went wrong on this page. Show this line to your teacher:\n' + message;
}
window.addEventListener('error', function (e) {
  fatal((e.message || 'Unknown error') + '  [' + (e.filename || '?').split('/').pop() +
    ' line ' + (e.lineno || '?') + ']');
});

(function () {
  'use strict';

  /* The same /exec URL Spark Points, Results and Appraisal all use — homework
     is a fourth add-on file in that one Apps Script project. It survives a
     re-deploy as long as that is done with Manage deployments > Edit > New
     version; only "New deployment" would mint a new URL. */
  var ENDPOINT = 'https://script.google.com/macros/s/AKfycbxahzgarriiZeHw-RCWr8PivATnm1ajQa3cUcadNyyj0eNYdUFT4zbt8_yqxQSxSBqW/exec';

  var AUTH = { studentEmail: '', studentCode: '' };
  /* Practice, the mock and progress are all one subject at a time. Empty until
     the first reply says which subjects exist; the server decides the default so
     the two screens cannot disagree. */
  var SUBJECT = '';
  var ME = { name: '', className: '' };
  var Q = { attempt: null, questions: [], answers: {}, i: 0 };
  var SELF = { attempt: null, questions: [], i: 0 };
  var LAST = null;
  var TAB = 'List';
  var TIMER = null;

  var POINTS_NOTE = {
    late: 'This was handed in after the due date, so it does not earn Spark Points. It is still recorded.',
    too_fast: 'This was finished too quickly to count for Spark Points. Take your time and your next one will count.',
    retry_no_points: 'Retries do not earn extra Spark Points — they are for practice.',
    points_not_enabled: '',
    already_awarded: '',
    below_min_score: 'A higher score is needed for Spark Points on this one.',
    category_not_in_library: '',
    library_value_zero: '',
    spark_log_failed: '',
    practice_no_points: '',
    mock_no_points: ''
  };

  /* ---------- small helpers ---------- */

  function $(id) { return document.getElementById(id); }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Question text may carry **bold** (English items point at a word that way).
     Escape first, then turn the markers into <b>, so nothing else can inject markup. */
  function fmt(v) {
    return esc(v).replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>');
  }

  function say(id, cls, text) {
    var el = $(id);
    el.className = 'msg' + (cls ? ' ' + cls : '');
    el.textContent = text || '';
  }

  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* "2026-10-30" reads as a date, not a serial number. Parsed as local noon so
     a timezone cannot nudge it onto the wrong day. */
  function prettyDate(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
    if (!m) return String(ymd || '');
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
    var today = new Date();
    today.setHours(12, 0, 0, 0);
    var days = Math.round((d - today) / 86400000);
    if (days === 0) return 'today';
    if (days === 1) return 'tomorrow';
    if (days === -1) return 'yesterday';
    return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
  }

  /* Read by hand rather than with URLSearchParams, which older Android
     WebViews do not have. */
  function queryParam(name) {
    var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
  }

  /* Storage can be absent or throw in a private window, and it is never
     required for the page to work. */
  function store(kind, op, key, value) {
    try {
      var s = kind === 'local' ? window.localStorage : window.sessionStorage;
      if (!s) return null;
      if (op === 'get') return s.getItem(key);
      if (op === 'set') { s.setItem(key, value); return null; }
      s.removeItem(key);
      return null;
    } catch (e) { return null; }
  }

  var SCREENS = ['SignIn', 'List', 'Practice', 'Progress', 'Quiz', 'Results', 'Self'];

  function show(name) {
    SCREENS.forEach(function (s) {
      $('screen' + s).classList.toggle('hidden', s !== name);
    });
    $('quizNav').classList.toggle('hidden', name !== 'Quiz');
    $('signOut').classList.toggle('hidden', name === 'SignIn');
    /* The tabs stay visible only on the three top-level screens; mid-quiz they
       would let a student wander off and lose their place. */
    var top = ['List', 'Practice', 'Progress'].indexOf(name) >= 0;
    $('tabs').classList.toggle('hidden', !top);
    if (top) {
      TAB = name;
      Array.prototype.forEach.call(document.querySelectorAll('.tabs .tab'), function (b) {
        b.classList.toggle('on', b.getAttribute('data-tab') === name);
      });
    }
    window.scrollTo(0, 0);
  }

  function pctClass(p) {
    if (p === null || p === undefined) return 'none';
    if (p < 50) return 'weak';
    if (p < 75) return 'mid';
    return 'strong';
  }

  function mmss(sec) {
    sec = Math.max(0, Math.round(sec));
    var m = Math.floor(sec / 60), r = sec % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  function api(action, extra, cb) {
    var payload = { action: action, studentEmail: AUTH.studentEmail, studentCode: AUTH.studentCode };
    if (extra) {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) payload[k] = extra[k];
      }
    }
    /* Catches an unconfigured or blanked ENDPOINT. Deliberately "is this a URL"
       rather than "is this script.google.com", so the portal can also be pointed
       at a local stub for testing. */
    if (!/^https?:\/\//.test(ENDPOINT)) {
      cb({ success: false, error: 'This page is not connected: ENDPOINT in app.js is not a URL.' });
      return;
    }
    var xhr = new XMLHttpRequest();
    xhr.open('POST', ENDPOINT, true);
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status < 200 || xhr.status >= 400) {
        cb({ success: false, error: 'Could not reach the school server. Check your connection and try again.' });
        return;
      }
      var r;
      try { r = JSON.parse(xhr.responseText); }
      catch (e) { r = { success: false, error: 'The server sent something unexpected. Please tell your teacher.' }; }
      cb(r || { success: false, error: 'The server sent an empty reply.' });
    };
    xhr.onerror = function () {
      cb({ success: false, error: 'Could not reach the school server. Check your connection and try again.' });
    };
    xhr.send('data=' + encodeURIComponent(JSON.stringify(payload)));
  }

  /* ---------- sign in ---------- */

  function signIn() {
    var id = $('semail').value.trim();
    var code = $('scode').value.trim();
    if (!id || !code) { say('signInMsg', 'error', 'Enter your school email and access code.'); return; }
    AUTH.studentEmail = id;
    AUTH.studentCode = code;
    $('signInBtn').disabled = true;
    say('signInMsg', '', 'Checking...');
    api('homework.listAssignments', null, function (r) {
      $('signInBtn').disabled = false;
      if (!r.success) {
        AUTH.studentCode = '';
        say('signInMsg', 'error', r.error);
        return;
      }
      say('signInMsg', '', '');
      $('scode').value = '';
      keepAuth($('remember').checked);
      onSignedIn(r);
    });
  }

  /* Remembered on this device means localStorage; otherwise sessionStorage, so
     a refresh mid-homework does not throw the student out but closing the
     browser does. Same split the staff portals use. */
  function keepAuth(remember) {
    var keep = remember ? 'local' : 'session';
    var drop = remember ? 'session' : 'local';
    store(keep, 'set', 'lc_hw_id', AUTH.studentEmail);
    store(keep, 'set', 'lc_hw_code', AUTH.studentCode);
    store(drop, 'remove', 'lc_hw_id');
    store(drop, 'remove', 'lc_hw_code');
  }

  function clearAuth() {
    ['local', 'session'].forEach(function (k) {
      store(k, 'remove', 'lc_hw_id');
      store(k, 'remove', 'lc_hw_code');
    });
  }

  function onSignedIn(r) {
    ME.name = r.student.name;
    ME.className = r.student.className;
    $('who').textContent = ME.name + ' · ' + ME.className;
    renderList(r.assignments);
    show('List');
  }

  function signOut() {
    stopTimer();
    AUTH = { studentEmail: '', studentCode: '' };
    SUBJECT = '';
    clearAuth();
    $('who').textContent = 'Learn City Academy';
    $('semail').value = '';
    $('scode').value = '';
    show('SignIn');
  }

  /* Shared by the email link and a remembered session. A link sign-in is kept
     only for this browser session: the email is the way back in, and these are
     often shared phones. */
  function autoSignIn(id, code, remembered) {
    AUTH.studentEmail = id;
    AUTH.studentCode = code;
    say('signInMsg', '', 'Signing you in...');
    api('homework.listAssignments', null, function (r) {
      if (r.success) {
        say('signInMsg', '', '');
        keepAuth(remembered && $('remember').checked);
        onSignedIn(r);
        return;
      }
      AUTH.studentCode = '';
      clearAuth();
      $('semail').value = id;
      say('signInMsg', 'error', r.error || 'Please sign in again.');
    });
  }

  /* ---------- assignment list ---------- */

  function refreshList(message) {
    say('listMsg', '', 'Loading...');
    api('homework.listAssignments', null, function (r) {
      if (!r.success) { say('listMsg', 'error', r.error); return; }
      say('listMsg', message ? 'ok' : '', message || '');
      renderList(r.assignments);
      show('List');
    });
  }

  function renderList(list) {
    var box = $('listRows');
    if (!list.length) {
      box.innerHTML = '<div class="card"><p>Nothing has been set for ' + esc(ME.className) +
        ' yet. Check again after your next lesson.</p></div>';
      return;
    }
    var order = { todo: 0, in_progress: 1, done: 2 };
    list.sort(function (a, b) {
      return (order[a.state] - order[b.state]) || String(a.due).localeCompare(String(b.due));
    });
    box.innerHTML = list.map(function (a) {
      var tag, label;
      if (a.state === 'done') {
        tag = 'done';
        label = a.mode === 'Self-Check' ? 'Finished'
          : 'Scored ' + a.score + '/' + a.total;
      } else if (a.overdue) { tag = 'late'; label = 'Overdue'; }
      else if (a.state === 'in_progress') { tag = 'open'; label = 'Started'; }
      else { tag = ''; label = 'To do'; }

      var topics = a.topics.length ? a.topics.join(', ') : a.subject;
      var bits = [];
      bits.push(a.mode === 'Self-Check' ? 'Self-check, not marked' : a.questionCount + ' questions');
      bits.push('Due ' + esc(prettyDate(a.due)));
      if (a.retryAvailable) bits.push('retry available');

      return '<button class="card hw" type="button" data-id="' + esc(a.assignmentId) +
        '" data-mode="' + esc(a.mode) + '" data-state="' + esc(a.state) +
        '" data-retry="' + (a.retryAvailable ? '1' : '') + '">' +
        '<span class="top"><span class="ttl">' + esc(topics) + '</span>' +
        '<span class="tag ' + tag + '">' + esc(label) + '</span></span>' +
        '<span class="meta">' + bits.join(' · ') + '</span></button>';
    }).join('');
  }

  function openAssignment(btn) {
    var id = btn.getAttribute('data-id');
    var mode = btn.getAttribute('data-mode');
    var state = btn.getAttribute('data-state');
    var canRetry = btn.getAttribute('data-retry') === '1';

    if (state === 'done' && !canRetry) {
      say('listMsg', '', mode === 'Self-Check'
        ? 'You have already worked through that self-check.'
        : 'That one is finished. Your teacher can see your score.');
      return;
    }
    say('listMsg', '', 'Opening...');
    if (mode === 'Self-Check') {
      api('homework.startSelfCheck', { assignmentId: id }, function (r) {
        if (!r.success) { say('listMsg', 'error', r.error); return; }
        startSelf(r);
      });
      return;
    }
    if (state === 'done' && canRetry) { say('listMsg', '', 'Open it to retry the ones you missed.'); }
    api('homework.startAttempt', { assignmentId: id }, function (r) {
      if (!r.success) { say('listMsg', 'error', r.error); return; }
      startQuiz(r);
    });
  }

  /* ---------- practice ---------- */

  function openPractice() {
    say('practiceMsg', '', 'Loading topics...');
    api('homework.practiceTopics', { subject: SUBJECT || undefined }, function (r) {
      if (!r.success) { say('practiceMsg', 'error', r.error); show('Practice'); return; }
      say('practiceMsg', '', '');
      renderSubjects(r);
      $('weakBtn').disabled = !r.weakReady;
      $('mockBtn').disabled = !r.mockReady;
      $('mockNote').textContent = r.mockReady
        ? 'A full paper across ' + r.mockTopics + ' topics, timed like the real thing.'
        : 'A mock test needs questions ready across at least 5 topics. Only ' + r.mockTopics +
          ' ' + (r.mockTopics === 1 ? 'is' : 'are') + ' ready so far.';
      $('weakNote').textContent = r.weakReady
        ? 'Pulls from the topics you get wrong most.'
        : 'Answer a few more questions and this will find the topics you need to work on.';
      renderDomains(r.domains);
      show('Practice');
    });
  }

  function renderDomains(domains) {
    var box = $('domainRows');
    if (!domains.length) {
      box.innerHTML = '<div class="card"><p>No topics are open for practice yet. Your teacher releases them a few at a time.</p></div>';
      return;
    }
    box.innerHTML = domains.map(function (d, i) {
      return '<div class="dom"><button class="head" type="button" data-domain="' + i + '">' +
        '<span class="nm">' + esc(d.domain) + '</span>' +
        '<span class="ct">' + d.topics.length + (d.topics.length === 1 ? ' topic' : ' topics') + '</span></button>' +
        '<div class="topics hidden" id="dom' + i + '">' +
        d.topics.map(function (t) {
          var pct = t.correctPct === null
            ? '<span class="pct none">not tried</span>'
            : '<span class="pct ' + pctClass(t.correctPct) + '">' + t.correctPct + '%</span>';
          return '<button type="button" data-outcomes="' + esc(t.outcomeIds.join(',')) + '">' +
            '<span>' + esc(t.topic) + '</span>' + pct + '</button>';
        }).join('') + '</div></div>';
    }).join('');
  }

  /* One subject in the bank is the normal case, and a dropdown with a single
     option is just clutter — so the bar only appears once there are two. */
  function renderSubjects(r) {
    if (r.subject) SUBJECT = r.subject;
    var list = r.subjects || [];
    var bar = $('subjectBar'), sel = $('subject');
    if (list.length < 2) { bar.classList.add('hidden'); return; }
    if (sel.options.length !== list.length) {
      sel.innerHTML = list.map(function (s) {
        return '<option value="' + esc(s) + '">' + esc(s) + '</option>';
      }).join('');
    }
    sel.value = SUBJECT;
    bar.classList.remove('hidden');
  }

  function startPractice(extra, action) {
    say('practiceMsg', '', 'Setting up...');
    extra = extra || {};
    if (SUBJECT) extra.subject = SUBJECT;
    api(action, extra, function (r) {
      if (!r.success) { say('practiceMsg', 'error', r.error); return; }
      say('practiceMsg', '', '');
      startQuiz(r);
      var notes = [];
      if (r.weakTopics && r.weakTopics.length) notes.push('Your weakest topics: ' + r.weakTopics.join(', ') + '.');
      if (r.repeatsAllowed) notes.push('You have seen some of these before \u2014 there were not enough new ones left.');
      if (notes.length) say('quizMsg', '', notes.join(' '));
    });
  }

  /* ---------- progress ---------- */

  function openProgress() {
    say('progressMsg', '', 'Loading...');
    api('homework.myProgress', { subject: SUBJECT || undefined }, function (r) {
      if (!r.success) { say('progressMsg', 'error', r.error); show('Progress'); return; }
      say('progressMsg', '', '');
      if (r.subject) SUBJECT = r.subject;
      renderProgress(r);
      show('Progress');
    });
  }

  function renderProgress(r) {
    var t = r.totals;
    if (!t.questionsAnswered) {
      $('progressBody').innerHTML = '<div class="card"><h2>Your progress</h2>' +
        '<p>Nothing to show yet. Once you have answered some questions, this page shows which topics you are strong on and which need work.</p></div>';
      return;
    }
    var html = '<div class="card"><h2>Your progress</h2><div class="stats">' +
      '<div class="stat"><b>' + t.questionsAnswered + '</b><span>Questions</span></div>' +
      '<div class="stat"><b>' + (t.correctPct === null ? '\u2013' : t.correctPct + '%') + '</b><span>Correct</span></div>' +
      '<div class="stat"><b>' + t.homeworkDone + '</b><span>Homework</span></div>' +
      '<div class="stat"><b>' + t.practiceSessions + '</b><span>Practice</span></div>' +
      '</div></div>';

    if (r.byDomain.length) {
      html += '<div class="card"><h2>By part of the syllabus</h2>' +
        r.byDomain.map(function (d) {
          return '<div class="barrow"><div class="lbl"><span>' + esc(d.domain) +
            '</span><span>' + d.correctPct + '% of ' + d.asked + '</span></div>' +
            '<div class="meter"><span class="' + pctClass(d.correctPct) +
            '" style="width:' + d.correctPct + '%"></span></div></div>';
        }).join('') + '</div>';
    }

    if (r.weakest.length) {
      html += '<div class="card"><h2>Worth going back to</h2>' +
        r.weakest.map(function (x) {
          return '<div class="barrow"><div class="lbl"><span>' + esc(x.topic) +
            '</span><span>' + x.correctPct + '% of ' + x.asked + '</span></div>' +
            '<div class="meter"><span class="' + pctClass(x.correctPct) +
            '" style="width:' + x.correctPct + '%"></span></div></div>';
        }).join('') +
        '<button class="primary block" id="weakFromProgress" type="button" style="margin-top:6px">Practise these now</button></div>';
    }
    if (r.strongest.length) {
      html += '<div class="card"><h2>Going well</h2>' +
        r.strongest.map(function (x) {
          return '<div class="hist"><span>' + esc(x.topic) + '</span><span class="r pct ' +
            pctClass(x.correctPct) + '">' + x.correctPct + '%</span></div>';
        }).join('') + '</div>';
    }
    if (r.recent.length) {
      var label = { Scored: 'Homework', Practice: 'Practice', Mock: 'Mock test', 'Self-Check': 'Self-check' };
      html += '<div class="card"><h2>Recently</h2>' +
        r.recent.map(function (x) {
          var sc = x.score === null ? '' : x.score + '/' + x.total;
          var over = /over_time/.test(x.flags) ? ' (over time)' : '';
          return '<div class="hist"><span>' + esc(label[x.mode] || x.mode) + '</span>' +
            '<span class="r">' + esc(prettyDate(x.when)) + ' ' + sc + over + '</span></div>';
        }).join('') + '</div>';
    }
    $('progressBody').innerHTML = html;
    var btn = $('weakFromProgress');
    if (btn) btn.addEventListener('click', function () { startPractice({}, 'homework.startWeakPractice'); });
    $('subject').addEventListener('change', function () {
      SUBJECT = $('subject').value;
      openPractice();
    });
  }

  /* ---------- quiz ---------- */

  function draftKey(attemptId) { return 'lc_hw_draft_' + attemptId; }

  function startQuiz(r) {
    Q.attempt = r;
    Q.questions = r.questions;
    Q.answers = {};
    Q.i = 0;
    Q.mode = r.mode || 'Scored';
    var saved = store('session', 'get', draftKey(r.attemptId));
    if (saved) {
      try { Q.answers = JSON.parse(saved) || {}; } catch (e) { Q.answers = {}; }
    }
    say('quizMsg', '', r.late
      ? 'This is past its due date. You can still finish it, but it will not earn Spark Points.'
      : (r.round > 1 ? 'Retry — these are new questions on the topics you missed.' : ''));
    stopTimer();
    if (typeof r.secondsLeft === 'number') startTimer(r.secondsLeft);
    renderQuestion();
    show('Quiz');
  }

  /* The countdown is a convenience, not the rule. The server records when the
     paper actually started and flags one handed in over time, so closing the
     tab buys a student nothing. */
  function startTimer(seconds) {
    var endsAt = Date.now() + seconds * 1000;
    var el = $('qTimer');
    el.classList.remove('hidden');
    var tick = function () {
      var left = Math.round((endsAt - Date.now()) / 1000);
      el.textContent = mmss(left);
      el.classList.toggle('low', left <= 300);
      if (left <= 0) {
        stopTimer();
        say('quizMsg', 'error', 'Time is up. Handing in what you have.');
        submitQuiz(true);
      }
    };
    tick();
    TIMER = window.setInterval(tick, 1000);
  }

  function stopTimer() {
    if (TIMER) { window.clearInterval(TIMER); TIMER = null; }
    var el = $('qTimer');
    el.classList.add('hidden');
    el.classList.remove('low');
  }

  function renderQuestion() {
    var q = Q.questions[Q.i];
    var n = Q.questions.length;
    $('qProgress').textContent = 'Question ' + (Q.i + 1) + ' of ' + n;
    $('qTrack').style.width = Math.round(100 * (Q.i + 1) / n) + '%';
    $('qPrompt').innerHTML = (q.topic ? '<span class="topic">' + esc(q.topic) + '</span>' : '') + fmt(q.prompt);

    var picked = Q.answers[q.id] || '';
    $('qOptions').innerHTML = ['A', 'B', 'C', 'D'].filter(function (L) {
      return q.options[L] !== '' && q.options[L] != null;
    }).map(function (L) {
      return '<button class="card opt' + (picked === L ? ' picked' : '') +
        '" type="button" data-letter="' + L + '">' +
        '<span class="ltr">' + L + '</span><span>' + esc(q.options[L]) + '</span></button>';
    }).join('');

    var answered = 0;
    Q.questions.forEach(function (x) { if (Q.answers[x.id]) answered++; });
    $('answeredCount').textContent = answered + '/' + n;
    $('prevBtn').disabled = Q.i === 0;
    $('nextBtn').textContent = (Q.i === n - 1) ? 'Finish' : 'Next';
  }

  function pick(letter) {
    Q.answers[Q.questions[Q.i].id] = letter;
    store('session', 'set', draftKey(Q.attempt.attemptId), JSON.stringify(Q.answers));
    renderQuestion();
    if (Q.i < Q.questions.length - 1) {
      window.setTimeout(function () { Q.i++; renderQuestion(); }, 180);
    }
  }

  function submitQuiz(force) {
    var n = Q.questions.length, answered = 0;
    Q.questions.forEach(function (x) { if (Q.answers[x.id]) answered++; });
    var missing = n - answered;
    if (!force) {
      if (missing > 0 && !window.confirm('You have left ' + missing + ' question' +
        (missing === 1 ? '' : 's') + ' unanswered. They will be marked wrong. Hand it in anyway?')) return;
      if (missing === 0 && !window.confirm('Hand in your answers? You cannot change them afterwards.')) return;
    }
    stopTimer();

    $('nextBtn').disabled = true;
    say('quizMsg', '', 'Marking...');
    api('homework.submitAttempt', { attemptId: Q.attempt.attemptId, answers: Q.answers }, function (r) {
      $('nextBtn').disabled = false;
      if (!r.success) { say('quizMsg', 'error', r.error); return; }
      store('session', 'remove', draftKey(Q.attempt.attemptId));
      say('quizMsg', '', '');
      renderResults(r);
    });
  }

  /* ---------- results ---------- */

  function renderResults(r) {
    LAST = r;
    $('rScore').textContent = r.score + '/' + r.total;
    $('rOf').textContent = r.percent + '% · ' + (r.round > 1 ? 'retry ' + (r.round - 1) : 'first attempt');

    var html = '';
    if (r.overTime) {
      html += '<div class="banner warn">This was handed in after the time ran out, so treat the score with that in mind.</div>';
    }
    if (r.pointsAwarded > 0) {
      html = '<div class="banner good">Well done — ' + r.pointsAwarded +
        ' Spark Point' + (r.pointsAwarded === 1 ? '' : 's') + ' added for handing this in on time.</div>';
    } else if (POINTS_NOTE[r.pointsNote]) {
      html = '<div class="banner warn">' + esc(POINTS_NOTE[r.pointsNote]) + '</div>';
    }
    $('rBanner').innerHTML = html;

    $('retryBtn').classList.toggle('hidden', !r.retryAvailable);
    if (r.retryAvailable) {
      $('retryBtn').textContent = 'Try the ' + r.retryQuestions + ' I missed';
    }
    $('backBtn').textContent = (r.mode === 'Scored' || !r.mode) ? 'Back to my homework' : 'Back to practice';

    /* A mock is read by section of the syllabus, not question by question. */
    var hasDomains = !!(r.byDomain && r.byDomain.length);
    $('rDomainCard').classList.toggle('hidden', !hasDomains);
    if (hasDomains) {
      $('rDomain').innerHTML = r.byDomain.map(function (d) {
        return '<div class="barrow"><div class="lbl"><span>' + esc(d.domain) +
          '</span><span>' + d.correct + '/' + d.asked + '</span></div>' +
          '<div class="meter"><span class="' + pctClass(d.pct) + '" style="width:' + d.pct + '%"></span></div></div>';
      }).join('');
    }

    var byId = {};
    Q.questions.forEach(function (q) { byId[q.id] = q; });
    var wrong = r.results.filter(function (x) { return !x.isCorrect; });
    var list = wrong.length ? wrong : r.results;
    $('rReviewHead').textContent = wrong.length ? 'Where you went wrong' : 'Worked answers';

    $('rReview').innerHTML = (wrong.length
      ? ''
      : '<p class="muted">Everything correct. The worked answers are below if you want to check your method.</p>') +
      list.map(function (x) {
        var q = byId[x.id] || { prompt: '', options: {}, topic: '' };
        var num = 0;
        r.results.forEach(function (y, i) { if (y.id === x.id) num = i + 1; });
        var opts = ['A', 'B', 'C', 'D'].filter(function (L) {
          return q.options[L] !== '' && q.options[L] != null;
        }).map(function (L) {
          var cls = (L === x.correct) ? ' right' : (L === x.given ? ' wrong' : '');
          return '<div class="card opt' + cls + '"><span class="ltr">' + L + '</span><span>' +
            esc(q.options[L]) + '</span></div>';
        }).join('');

        var ex = '';
        if (!x.isCorrect) {
          ex += x.given
            ? '<p><b>You chose ' + esc(x.given) + '.</b> ' + esc(stripLetter(x.rationaleGiven)) + '</p>'
            : '<p><b>You left this one blank.</b></p>';
        }
        ex += '<p><b>The answer is ' + esc(x.correct) + '.</b> ' + esc(stripLetter(x.rationaleCorrect)) + '</p>';
        if (x.workedSolution) ex += '<p><b>How to get there:</b> ' + esc(x.workedSolution) + '</p>';
        if (x.commonError) ex += '<p><b>Watch out for:</b> ' + esc(x.commonError) + '</p>';

        return '<div class="review"><div class="q"><span class="n">Question ' + num + '</span><br>' +
          fmt(q.prompt) + '</div>' + opts + '<div class="explain">' + ex + '</div></div>';
      }).join('');

    show('Results');
  }

  /* The bank stores each rationale prefixed with its own letter ("C: Correct.
     ..."). The letter is already shown beside the option, so drop it here. */
  function stripLetter(text) {
    return String(text == null ? '' : text).replace(/^\s*[A-D]\s*:\s*/, '');
  }

  function doRetry() {
    $('retryBtn').disabled = true;
    api('homework.startRetry', { attemptId: LAST.attemptId }, function (r) {
      $('retryBtn').disabled = false;
      if (!r.success) { say('listMsg', 'error', r.error); show('List'); return; }
      startQuiz(r);
      if (r.fewerThanMissed) {
        say('quizMsg', '', 'There were fewer new questions left than you missed, so this retry is shorter.');
      }
    });
  }

  /* ---------- self check ---------- */

  function startSelf(r) {
    SELF.attempt = r;
    SELF.questions = r.questions;
    SELF.i = 0;
    say('selfMsg', '', '');
    renderSelf();
    show('Self');
  }

  function renderSelf() {
    var q = SELF.questions[SELF.i], n = SELF.questions.length;
    $('sProgress').textContent = 'Question ' + (SELF.i + 1) + ' of ' + n;
    $('sTrack').style.width = Math.round(100 * (SELF.i + 1) / n) + '%';
    $('sPrompt').innerHTML = (q.topic ? '<span class="topic">' + esc(q.topic) + '</span>' : '') + fmt(q.prompt);
    $('sAnswer').classList.add('hidden');
    $('sAnswer').innerHTML = '';
    $('sRate').classList.add('hidden');
    $('revealBtn').classList.remove('hidden');
    $('revealBtn').disabled = false;
  }

  function reveal() {
    var q = SELF.questions[SELF.i];
    $('revealBtn').disabled = true;
    api('homework.revealSelfCheck', {
      attemptId: SELF.attempt.attemptId, questionId: q.id, rating: ''
    }, function (r) {
      if (!r.success) { say('selfMsg', 'error', r.error); $('revealBtn').disabled = false; return; }
      var html = '<div class="explain"><p><b>Model answer</b></p><p>' + esc(r.modelAnswer) + '</p>';
      if (r.workedSolution) html += '<p><b>Working</b></p><p>' + esc(r.workedSolution) + '</p>';
      if (r.markScheme) html += '<p><b>How marks are given</b></p><p>' + esc(r.markScheme) + '</p>';
      if (r.commonError) html += '<p><b>Watch out for:</b> ' + esc(r.commonError) + '</p>';
      html += '</div>';
      $('sAnswer').innerHTML = html;
      $('sAnswer').classList.remove('hidden');
      $('revealBtn').classList.add('hidden');
      $('sRate').classList.remove('hidden');
    });
  }

  function rate(value) {
    var q = SELF.questions[SELF.i];
    api('homework.revealSelfCheck', {
      attemptId: SELF.attempt.attemptId, questionId: q.id, rating: value
    }, function (r) {
      if (!r.success) { say('selfMsg', 'error', r.error); return; }
      if (SELF.i < SELF.questions.length - 1) { SELF.i++; renderSelf(); return; }
      refreshList('Self-check finished. Nothing to hand in — it is not marked.');
    });
  }

  /* ---------- wiring ---------- */

  document.addEventListener('DOMContentLoaded', function () {
    $('signInBtn').addEventListener('click', signIn);
    $('scode').addEventListener('keydown', function (e) { if (e.key === 'Enter') signIn(); });
    $('semail').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('scode').focus(); });
    $('signOut').addEventListener('click', signOut);

    $('listRows').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.hw') : null;
      if (btn) openAssignment(btn);
    });

    $('qOptions').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.opt') : null;
      if (btn) pick(btn.getAttribute('data-letter'));
    });
    $('prevBtn').addEventListener('click', function () {
      if (Q.i > 0) { Q.i--; renderQuestion(); }
    });
    $('nextBtn').addEventListener('click', function () {
      if (Q.i < Q.questions.length - 1) { Q.i++; renderQuestion(); } else submitQuiz();
    });

    $('retryBtn').addEventListener('click', doRetry);
    $('backBtn').addEventListener('click', function () {
      if (LAST && LAST.mode && LAST.mode !== 'Scored') openPractice(); else refreshList();
    });

    $('tabs').addEventListener('click', function (e) {
      var t = e.target.getAttribute && e.target.getAttribute('data-tab');
      if (!t || t === TAB) return;
      if (t === 'List') refreshList();
      else if (t === 'Practice') openPractice();
      else openProgress();
    });

    $('weakBtn').addEventListener('click', function () {
      startPractice({}, 'homework.startWeakPractice');
    });
    $('mockBtn').addEventListener('click', function () {
      if (!window.confirm('A mock test is timed and should be done in one sitting. Start now?')) return;
      startPractice({}, 'homework.startMock');
    });
    $('domainRows').addEventListener('click', function (e) {
      var head = e.target.closest ? e.target.closest('.head') : null;
      if (head) {
        $('dom' + head.getAttribute('data-domain')).classList.toggle('hidden');
        return;
      }
      var topic = e.target.closest ? e.target.closest('[data-outcomes]') : null;
      if (topic) {
        startPractice({ outcomeIds: topic.getAttribute('data-outcomes').split(',') }, 'homework.startPractice');
      }
    });
    $('revealBtn').addEventListener('click', reveal);
    $('selfExit').addEventListener('click', function () { refreshList(); });
    $('sRate').addEventListener('click', function (e) {
      var v = e.target.getAttribute && e.target.getAttribute('data-rate');
      if (v) rate(v);
    });

    /* A link from the access email looks like ?email=...&code=... — sign in with
       it, then strip it from the address bar so the code is not left visible in
       history or in a bookmark. Same shape as the staff portals. */
    var linkId = queryParam('email'), linkCode = queryParam('code');
    if (linkId && linkCode) {
      if (window.history && history.replaceState) {
        history.replaceState({}, document.title, location.pathname);
      }
      autoSignIn(linkId, linkCode, false);
      return;
    }

    var savedId = store('local', 'get', 'lc_hw_id') || store('session', 'get', 'lc_hw_id');
    var savedCode = store('local', 'get', 'lc_hw_code') || store('session', 'get', 'lc_hw_code');
    if (savedId && savedCode) {
      $('remember').checked = !!store('local', 'get', 'lc_hw_id');
      autoSignIn(savedId, savedCode, true);
    }
  });
})();
