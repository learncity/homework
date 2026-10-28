/* Learn City Homework — staff portal.
   Same structure as the Results and Appraisal portals: one /exec endpoint, an
   action prefix, staff email + code verified server-side, tabs gated by what
   the account is allowed to do.

   SETUP: paste the deployed /exec URL into ENDPOINT below — the same URL Spark
   Points, Results and Appraisal already use. */
'use strict';

function fatal(message) {
  var bar = document.getElementById('fatal');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'fatal';
    (document.body || document.documentElement).appendChild(bar);
  }
  bar.textContent = 'Homework staff portal problem — report this line to Head of IT:\n' + message;
}
window.addEventListener('error', function (e) {
  fatal((e.message || 'Unknown error') + '  [' + (e.filename || '?').split('/').pop() + ' line ' + (e.lineno || '?') + ']');
});

/* The same /exec URL Spark Points, Results and Appraisal all use. Re-deploying
   with Manage deployments > Edit > New version keeps it; "New deployment" would
   mint a new one and every portal would need updating. */
const ENDPOINT = 'https://script.google.com/macros/s/AKfycbxahzgarriiZeHw-RCWr8PivATnm1ajQa3cUcadNyyj0eNYdUFT4zbt8_yqxQSxSBqW/exec';
const ACTION_PREFIX = 'homework.';
const STORE_EMAIL = 'LC_HOMEWORK_EMAIL';
const STORE_CODE = 'LC_HOMEWORK_CODE';

const $ = function (id) { return document.getElementById(id); };

let state = { email: '', code: '', staff: null, topics: [], assignments: [], tab: 'assignments',
  category: '', subject: '', subjects: [], examBoards: [], examSubjects: [], report: null };

/* One subject at a time, everywhere topics are listed. A bank with one subject
   behaves exactly as before, because the filter then matches everything. */
function subjectTopics() {
  if (!state.subject) return state.topics;
  return state.topics.filter(function (t) { return (t.subject || state.subject) === state.subject; });
}

function call(action, extra) {
  /* "Is this a URL", not "is this script.google.com", so the portal can also be
     pointed at a local stub for testing. */
  if (!/^https?:\/\//.test(ENDPOINT)) {
    return Promise.resolve({ success: false, error: 'This page is not connected: ENDPOINT in app.js is not a URL.' });
  }
  const payload = Object.assign({ action: ACTION_PREFIX + action, email: state.email, code: state.code }, extra || {});
  return fetch(ENDPOINT, {
    method: 'POST', mode: 'cors',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({ data: JSON.stringify(payload) })
  }).then(function (r) { return r.json(); });
}

/* ---------- helpers ---------- */

function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function msg(id, cls, text) {
  const el = $(id);
  if (!el) return;
  el.className = 'msg' + (cls ? ' ' + cls : '');
  el.textContent = text || '';
}
function options(list, selected, blank) {
  return (blank !== undefined ? '<option value="">' + esc(blank) + '</option>' : '') +
    list.map(function (o) {
      const v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o;
      return '<option value="' + esc(v) + '"' + (String(v) === String(selected) ? ' selected' : '') + '>' + esc(l) + '</option>';
    }).join('');
}
function pctClass(p) {
  if (p === null || p === undefined) return 'none';
  if (p < 50) return 'weak';
  if (p < 75) return 'mid';
  return 'strong';
}
function pct(p) {
  return p === null || p === undefined ? '<span class="pct none">–</span>'
    : '<span class="pct ' + pctClass(p) + '">' + p + '%</span>';
}
/* For a "got wrong" column the scale runs the other way: a high number is the
   bad one. Without this, 0% wrong came out red. */
function pctWrong(p) {
  if (p === null || p === undefined) return '<span class="pct none">–</span>';
  const cls = p >= 50 ? 'weak' : p >= 25 ? 'mid' : 'strong';
  return '<span class="pct ' + cls + '">' + p + '%</span>';
}
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function prettyDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  if (!m) return String(ymd || '');
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
}
function todayPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* Topics come back one row per learning outcome. Teachers think in topics, so
   they are grouped the same way the pupil's practice menu groups them, and a
   checked topic means every outcome inside it. */
function groupTopics(topics) {
  const byDomain = {};
  topics.forEach(function (t) {
    const d = t.domain || 'Other';
    if (!byDomain[d]) byDomain[d] = {};
    const key = t.topic || t.outcomeId;
    if (!byDomain[d][key]) {
      byDomain[d][key] = { topic: key, domain: d, outcomeIds: [], live: 0, reviewed: 0, liveTheory: 0, years: [] };
    }
    const slot = byDomain[d][key];
    slot.outcomeIds.push(t.outcomeId);
    /* A topic can span two classes, and one outcome can too — a junior-secondary
       foundation tagged "JSS 3, SSS 1" is taught in JSS 3 and revised in SSS 1,
       so it should be offered under both. Keep every level, not the first seen. */
    String(t.yearLevel || '').split(',').forEach(function (y) {
      var v = y.trim();
      if (v && slot.years.indexOf(v) < 0) slot.years.push(v);
    });
    slot.live += t.liveMcq || 0;
    slot.reviewed += t.reviewedMcq || 0;
    slot.liveTheory += t.liveTheory || 0;
  });
  return Object.keys(byDomain).sort().map(function (d) {
    return {
      domain: d,
      topics: Object.keys(byDomain[d]).sort().map(function (k) {
        byDomain[d][k].years.sort();
        return byDomain[d][k];
      })
    };
  });
}

/* Shown only once the bank holds two subjects; with one it would be a dropdown
   that can only say what it already says. */
function renderSubjectBars() {
  ['pickSubject', 'bankSubject'].forEach(function (id) {
    const sel = $(id), bar = $(id + 'Bar');
    if (!sel || !bar) return;
    if (state.subjects.length < 2) { bar.classList.add('hidden'); return; }
    if (sel.options.length !== state.subjects.length) {
      sel.innerHTML = state.subjects.map(function (s) {
        return '<option value="' + esc(s) + '">' + esc(s) + '</option>';
      }).join('');
    }
    sel.value = state.subject;
    bar.classList.remove('hidden');
  });
}

/* Changing subject changes which topics exist, so the year filter has to be
   rebuilt from scratch rather than kept from the previous subject. */
function changeSubject(value) {
  state.subject = value;
  ['pickYear', 'bankYear'].forEach(function (id) {
    const sel = $(id);
    if (sel) { sel.innerHTML = '<option value="">any</option>'; }
  });
  renderSubjectBars();
  fillYearFilter('pickYear');
  fillYearFilter('bankYear');
  renderNewTopicPicker();
  if (state.staff && state.staff.canManageUsers) { renderBankPicker(); renderBankExplain(); }
}

/* The year filter hides topics taught in other classes. It never unticks
   anything, so a topic chosen before the filter was set still counts. */
function yearFilter(selectId) {
  const want = $(selectId) ? $(selectId).value : '';
  return function (t) { return !want || t.years.indexOf(want) >= 0; };
}

function fillYearFilter(selectId) {
  const years = [];
  subjectTopics().forEach(function (t) {
    String(t.yearLevel || '').split(',').forEach(function (y) {
      const v = y.trim();
      if (v && years.indexOf(v) < 0) years.push(v);
    });
  });
  years.sort();
  const sel = $(selectId);
  if (!sel || sel.options.length > 1) return;
  years.forEach(function (y) {
    const o = document.createElement('option');
    o.value = y; o.textContent = y;
    sel.appendChild(o);
  });
}

function renderPicker(elId, countId, filterFn, labelFn) {
  const groups = groupTopics(subjectTopics());
  let html = '';
  groups.forEach(function (g) {
    const rows = g.topics.filter(filterFn);
    if (!rows.length) return;
    html += '<div class="dom"><div class="domName">' + esc(g.domain) + '</div>' +
      rows.map(function (t) {
        const info = labelFn(t);
        const yr = t.years.length ? '<span class="yr">' + esc(t.years.join(', ')) + '</span>' : '';
        return '<label class="' + (info.dim ? 'dim' : '') + '">' +
          '<input type="checkbox" value="' + esc(t.outcomeIds.join(',')) + '"' + (info.disabled ? ' disabled' : '') + '>' +
          '<span class="tName">' + esc(t.topic) + '</span>' + yr +
          (info.preview ? '<button type="button" class="linkBtn preview" data-outcomes="' + esc(t.outcomeIds.join(',')) +
            '" data-name="' + esc(t.topic) + '">Preview</button>' : '') +
          '<span class="avail">' + info.note + '</span></label>';
      }).join('') + '</div>';
  });
  $(elId).innerHTML = html || '<p class="muted" style="margin:6px 0">' +
    (elId === 'topicPicker'
      ? 'No questions have been released yet. Ask the Head of IT to release some topics in the Question Bank tab.'
      : 'Nothing to show.') + '</p>';
  updateCount(elId, countId);
}

function chosenOutcomes(elId) {
  const out = [];
  $(elId).querySelectorAll('input:checked').forEach(function (b) {
    b.value.split(',').forEach(function (o) { if (o) out.push(o); });
  });
  return out;
}
function chosenTopicCount(elId) { return $(elId).querySelectorAll('input:checked').length; }

function updateCount(elId, countId) {
  const n = chosenTopicCount(elId);
  $(countId).textContent = n ? n + (n === 1 ? ' topic chosen' : ' topics chosen') : 'none chosen';
}

/* ---------- sign in ---------- */

function trySignIn(email, code) {
  state.email = String(email).trim().toLowerCase();
  state.code = String(code).trim();
  $('signInBtn').disabled = true;
  $('signInError').textContent = 'Checking...';
  call('teacherBootstrap').then(function (r) {
    $('signInBtn').disabled = false;
    if (!r || !r.success) { $('signInError').textContent = (r && r.error) || 'Sign in failed.'; return; }
    $('signInError').textContent = '';
    $('staffCode').value = '';
    try {
      const keep = $('rememberMeToggle').checked ? localStorage : sessionStorage;
      const drop = keep === localStorage ? sessionStorage : localStorage;
      keep.setItem(STORE_EMAIL, state.email); keep.setItem(STORE_CODE, state.code);
      drop.removeItem(STORE_EMAIL); drop.removeItem(STORE_CODE);
    } catch (e) {}
    applyBootstrap(r);
    $('signInScreen').classList.add('hidden');
    $('mainScreen').classList.remove('hidden');
    $('refreshBtn').classList.remove('hidden');
    $('signOutBtn').classList.remove('hidden');
  }).catch(function () {
    $('signInBtn').disabled = false;
    $('signInError').textContent = 'Could not reach the server. Check your connection and try again.';
  });
}

function signOut() {
  try { [localStorage, sessionStorage].forEach(function (s) { s.removeItem(STORE_EMAIL); s.removeItem(STORE_CODE); }); } catch (e) {}
  location.reload();
}

function applyBootstrap(r) {
  state.staff = r.staff;
  state.topics = r.topics || [];
  state.assignments = r.assignments || [];
  state.category = r.achievementCategory || '';
  state.subjects = r.subjects || [];
  if (!state.subject || state.subjects.indexOf(state.subject) < 0) {
    state.subject = state.subjects[0] || r.defaultSubject || '';
  }
  renderSubjectBars();

  $('who').textContent = r.staff.name + ' · ' + r.staff.role +
    ' · ' + (r.staff.classes.length ? r.staff.classes.join(', ') : 'no classes assigned');
  /* Releasing questions and issuing codes are deliberate admin actions — a
     second pair of eyes on the bank before anything reaches a pupil — so a
     class teacher is not shown those tabs at all, rather than shown them and
     then refused. */
  $('studentsTabBtn').classList.toggle('hidden', !r.staff.canManageUsers);
  $('bankTabBtn').classList.toggle('hidden', !r.staff.canManageUsers);
  if (!r.staff.canManageUsers && (state.tab === 'bank' || state.tab === 'students')) showTab('assignments');

  /* Rebuilding the dropdowns must not throw away what the teacher had chosen —
     they often set two or three pieces of homework for the same class in a row,
     and the list is refreshed after every save. */
  const classes = r.staff.classes;
  ['newClass', 'pracClass', 'codeClass'].forEach(function (id) {
    const had = $(id).value;
    const keep = classes.indexOf(had) !== -1 ? had : (classes.length === 1 ? classes[0] : '');
    $(id).innerHTML = options(classes, keep, classes.length === 1 ? undefined : 'Choose a class...');
  });
  if (!$('newDue').value) $('newDue').value = todayPlus(7);

  $('pointsNote').textContent = state.category
    ? 'How much it is worth is set once in the ACHIEVEMENT LIBRARY, under "' + state.category + '".'
    : '';

  state.examBoards = r.examBoards || [];
  state.examSubjects = r.examSubjects || [];
  fillExamPickers();
  renderAssignments();
  renderNewTopicPicker();
  fillYearFilter('pickYear');
  fillYearFilter('bankYear');
  if (r.staff.canManageUsers) { renderBankPicker(); renderBankExplain(); }
}

function reload(after) {
  return call('teacherBootstrap').then(function (r) {
    if (!r || !r.success) { msg('listMsg', 'error', (r && r.error) || 'Could not reload.'); return; }
    applyBootstrap(r);
    if (after) after();
  });
}

/* ---------- preview a topic's questions ----------
   Read-only, and only what pupils could actually be given (Live). Staff see the
   key; pupils never do until after they have answered. */

let preview = { outcomes: [], name: '', shown: 0, total: 0 };

function openPreview(outcomes, name) {
  preview = { outcomes: outcomes, name: name, shown: 0, total: 0 };
  $('previewTitle').textContent = 'Preview: ' + name;
  $('previewBody').innerHTML = '';
  $('previewNote').textContent = 'Loading...';
  $('previewMore').classList.add('hidden');
  $('previewBox').classList.remove('hidden');
  $('previewBox').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  loadPreview();
}

function loadPreview() {
  call('previewTopic', { outcomeIds: preview.outcomes, offset: preview.shown, limit: 10 }).then(function (r) {
    if (!r || !r.success) { $('previewNote').textContent = (r && r.error) || 'Could not load the preview.'; return; }
    preview.total = r.total;
    $('previewBody').insertAdjacentHTML('beforeend', r.questions.map(function (q, i) {
      return renderPreviewQuestion(q, preview.shown + i + 1);
    }).join(''));
    if (r.theory && r.theory.length) {
      $('previewBody').insertAdjacentHTML('beforeend',
        '<h3>Written tasks (' + r.theoryTotal + ' live' + (r.theoryTotal > r.theory.length ? ', first ' + r.theory.length + ' shown' : '') + ')</h3>' +
        r.theory.map(function (t) {
          return '<div class="pq"><div class="pqHead"><span class="chip">' + esc(t.marks || '') + ' marks</span> <span class="muted">' + esc(t.id) + '</span></div>' +
            '<div class="pqPrompt">' + fmtText(t.prompt) + figImg(t.figure) + '</div>' +
            (t.modelAnswer ? '<div class="pqKey"><b>Model answer.</b> ' + fmtText(t.modelAnswer) + '</div>' : '') + '</div>';
        }).join(''));
    }
    preview.shown += r.questions.length;
    $('previewNote').textContent = r.total
      ? 'Showing ' + preview.shown + ' of ' + r.total + ' live questions. A homework gives each pupil a random selection from these. The correct answer is marked for you; pupils never see it before they answer.'
      : 'This topic has no live questions yet.';
    $('previewMore').classList.toggle('hidden', preview.shown >= preview.total);
  }).catch(function () { $('previewNote').textContent = 'Could not reach the school server.'; });
}

/* Question text may carry **bold** and line breaks; escape first, then format. */
function fmtText(v) { return esc(v).replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>'); }

function figImg(id) {
  return /^[A-Za-z0-9_-]{1,80}$/.test(id || '')
    ? '<img class="fig" src="../figures/' + id + '.svg" alt="Diagram for this question">' : '';
}

function renderPreviewQuestion(q, n) {
  const opts = ['A', 'B', 'C', 'D'].map(function (L) {
    return '<div class="pqOpt' + (q.correct === L ? ' right' : '') + '"><span class="ltr">' + L + '</span><span>' +
      fmtText(q.options[L]) + '</span>' + (q.correct === L ? '<span class="tick">Correct</span>' : '') + '</div>';
  }).join('');
  return '<div class="pq"><div class="pqHead"><b>' + n + '.</b> <span class="chip">' + esc(q.difficulty || 'Mixed') +
    '</span> <span class="muted">' + esc(q.id) + '</span></div><div class="pqPrompt">' + fmtText(q.prompt) +
    figImg(q.figure) + '</div>' + opts + '</div>';
}

/* ---------- assignments ---------- */

function renderNewTopicPicker() {
  const scored = $('newMode').value === 'Scored';
  const onlyReady = $('pickOnlyReady').checked;
  const inYear = yearFilter('pickYear');
  renderPicker('topicPicker', 'pickCount',
    function (t) {
      if (!inYear(t)) return false;
      const n = scored ? t.live : t.liveTheory;
      return onlyReady ? n > 0 : true;
    },
    function (t) {
      const n = scored ? t.live : t.liveTheory;
      return {
        dim: n === 0, disabled: n === 0, preview: n > 0,
        note: n > 0 ? n + ' ready' : (t.reviewed > 0 ? t.reviewed + ' waiting to be released' : 'none yet')
      };
    });
}

function renderAssignments() {
  const body = $('assignmentRows');
  if (!state.assignments.length) {
    body.innerHTML = '<tr><td colspan="9" class="muted">Nothing set yet.</td></tr>';
    return;
  }
  const names = {};
  state.topics.forEach(function (t) { names[t.outcomeId] = t.topic; });
  body.innerHTML = state.assignments.map(function (a) {
    const topics = [];
    a.outcomeIds.forEach(function (o) {
      const n = names[o] || o;
      if (topics.indexOf(n) === -1) topics.push(n);
    });
    const next = a.status === 'Draft' ? 'Published' : a.status === 'Published' ? 'Closed' : '';
    const label = a.status === 'Draft' ? 'Publish' : a.status === 'Published' ? 'Close' : '';
    return '<tr><td>' + esc(a.assignmentId) + '</td><td>' + esc(a.className) + '</td>' +
      '<td>' + (a.mode === 'Self-Check' ? 'Self-check' : a.mode === 'Exam' ? 'Exam' : 'Scored') + '</td>' +
      '<td>' + (a.mode === 'Exam'
        ? esc((a.board || '') + ' ' + (a.subject || '') + ' \u2014 whole syllabus')
        : esc(topics.join(', '))) + '</td><td>' + a.count + '</td>' +
      '<td>' + esc(prettyDate(a.due)) + '</td>' +
      '<td><span class="chip ' + esc(a.status) + '">' + esc(a.status) + '</span></td>' +
      '<td>' + esc(a.teacher) + '</td>' +
      '<td>' + (next ? '<button class="small" data-act="status" data-id="' + esc(a.assignmentId) +
        '" data-next="' + next + '">' + label + '</button>' : '') + '</td></tr>';
  }).join('');
}

function createAssignment(publish) {
  const className = $('newClass').value;
  const outcomeIds = chosenOutcomes('topicPicker');
  const count = Number($('newCount').value);
  const due = $('newDue').value;
  const mode = $('newMode').value;
  const isExam = mode === 'Exam';

  if (!className) { msg('createMsg', 'error', 'Choose a class.'); return; }
  if (!due) { msg('createMsg', 'error', 'Set a due date.'); return; }
  if (!isExam && !outcomeIds.length) { msg('createMsg', 'error', 'Tick at least one topic.'); return; }
  if (!isExam && !(count > 0)) { msg('createMsg', 'error', 'Set how many questions.'); return; }

  const body = isExam
    ? { className: className, mode: 'Exam', due: due, publish: publish,
        board: $('examBoard').value, subject: $('examSubject').value,
        awardPoints: $('newPoints').checked }
    : { className: className, outcomeIds: outcomeIds, mode: mode, count: count, due: due,
        publish: publish, awardPoints: mode === 'Scored' && $('newPoints').checked };

  const btn = publish ? $('createPublishBtn') : $('createDraftBtn');
  btn.disabled = true;
  msg('createMsg', '', publish ? 'Creating and publishing...' : 'Saving...');
  call('createAssignment', body).then(function (r) {
    btn.disabled = false;
    if (!r || !r.success) { msg('createMsg', 'error', (r && r.error) || 'Could not create it.'); return; }
    msg('createMsg', 'ok', r.assignmentId + ' ' +
      (publish ? 'is published — pupils in ' + className + ' will see it now.' : 'saved as a draft. Publish it when you are ready.') +
      notifyNote(r));
    $('topicPicker').querySelectorAll('input:checked').forEach(function (b) { b.checked = false; });
    updateCount('topicPicker', 'pickCount');
    reload();
  }).catch(function () {
    btn.disabled = false;
    msg('createMsg', 'error', 'Could not reach the server. Nothing was created.');
  });
}

/* ---------- exam papers ----------
   An exam is set by board and subject. The blueprint below shows the shape of
   the paper the class will sit, so a Head of Department can check the weighting
   before anyone sits it. */

function fillExamPickers() {
  const fill = function (id, values) {
    const sel = $(id);
    if (!sel || sel.options.length === values.length) return;
    sel.innerHTML = values.map(function (v) {
      return '<option value="' + esc(v) + '">' + esc(v) + '</option>';
    }).join('');
  };
  fill('examBoard', state.examBoards);
  const subs = state.examSubjects.length ? state.examSubjects
    : (state.subjects.length ? state.subjects : ['Mathematics']);
  fill('examSubject', subs);
  /* Start on the subject the teacher is already working in, not whichever comes
     first alphabetically. */
  const want = subs.indexOf(state.subject) >= 0 ? state.subject : subs[0];
  if (want) $('examSubject').value = want;
}

function examMode() { return $('newMode').value === 'Exam'; }

function toggleExamSetup() {
  const on = examMode();
  msg('createMsg', '', '');
  $('examSetup').classList.toggle('hidden', !on);
  $('topicSetup').classList.toggle('hidden', on);
  $('newCount').closest('div').classList.toggle('hidden', on);
  $('newPointsWrap').classList.toggle('hidden', $('newMode').value === 'Self-Check');
  if (on) loadExamBlueprint();
}

function loadExamBlueprint() {
  const board = $('examBoard').value, subject = $('examSubject').value;
  if (!board || !subject) return;
  msg('examMsg', '', 'Working out the paper...');
  $('examBlueprint').innerHTML = '';
  call('examPreview', { board: board, subject: subject }).then(function (r) {
    if (!r || !r.success) { msg('examMsg', 'error', (r && r.error) || 'Could not load the paper.'); return; }
    msg('examMsg', r.objective.ready ? '' : 'warn',
      r.objective.ready ? '' : 'Not enough has been released for a full paper yet. Release more topics in the Question Bank first.');
    $('examBlueprint').innerHTML = blueprintHtml(r);
  }).catch(function () { msg('examMsg', 'error', 'Could not reach the server.'); });
}

function blueprintHtml(r) {
  const o = r.objective, t = r.theory;
  let html = '<div class="stats">' +
    '<div class="stat"><b>' + o.questions + '</b><span>' + esc(o.label) + ' questions</span></div>' +
    '<div class="stat"><b>' + o.minutes + '</b><span>minutes</span></div>' +
    '<div class="stat"><b>' + o.marks + '</b><span>marks</span></div>' +
    (t ? '<div class="stat"><b>' + t.questions + '</b><span>' + esc(t.label) + ' questions</span></div>' +
         '<div class="stat"><b>' + t.minutes + '</b><span>theory minutes</span></div>' +
         '<div class="stat"><b>' + t.marks + '</b><span>theory marks</span></div>' : '') +
    '</div>';
  html += '<p class="muted">The objective paper is marked by the portal. The theory paper is shown on the clock, written on paper and handed to you; type the mark into the class report afterwards and the portal shows a combined grade.</p>';
  /* Said before the exam is set, not only on the report, so nobody reads the
     combined grade as the whole Physics result. */
  if (o.notInPortal) html += '<p class="muted"><b>Not in the portal:</b> ' + esc(o.notInPortal) +
    '. The combined grade leaves it out.</p>';
  html += '<h3>How ' + esc(o.label) + ' is made up</h3>' +
    '<p class="muted">Weighted by the number of learning outcomes each part of the syllabus has. Every pupil gets a different draw to this same shape.</p>' +
    '<div class="tableWrap"><table><thead><tr><th>Part of the syllabus</th><th>Topics</th>' +
    '<th>Questions</th><th>Released</th></tr></thead><tbody>' +
    o.rows.map(function (x) {
      return '<tr><td>' + esc(x.domain) + '</td><td>' + x.topics + '</td><td><b>' + x.questions +
        '</b></td><td>' + x.live + '</td></tr>';
    }).join('') +
    '<tr><td><b>Total</b></td><td><b>' + o.outcomesReady + '</b></td><td><b>' + o.questions +
    '</b></td><td><b>' + o.available + '</b></td></tr>' +
    '</tbody></table></div>';
  if (t && t.note) html += '<p class="muted"><b>' + esc(t.label) + ':</b> ' + esc(t.note) + '</p>';
  return html;
}

/* The mark a teacher has worked out on paper. One number per pupil, out of the
   theory paper's own total. */
function saveTheoryScore(btn, studentId) {
  const box = document.querySelector('[data-theory="' + studentId + '"]');
  if (!box) return;
  const raw = String(box.value).trim();
  btn.disabled = true;
  msg('repMsg', '', 'Saving the mark...');
  call('enterTheoryScore', { assignmentId: $('repAssignment').value, studentId: studentId, score: raw })
    .then(function (r) {
      btn.disabled = false;
      if (!r || !r.success) { msg('repMsg', 'error', (r && r.error) || 'Could not save the mark.'); return; }
      loadClassReport(raw === '' ? 'Mark cleared.' : 'Mark saved.');
    }).catch(function () {
      btn.disabled = false;
      msg('repMsg', 'error', 'Could not reach the server. The mark was not saved.');
    });
}

function setStatus(btn, id, next) {
  if (next === 'Closed' && !window.confirm('Close ' + id + '? Pupils will not be able to start or finish it.')) return;
  btn.disabled = true;
  msg('listMsg', '', 'Updating ' + id + '...');
  call('setAssignmentStatus', { assignmentId: id, status: next }).then(function (r) {
    if (!r || !r.success) { btn.disabled = false; msg('listMsg', 'error', (r && r.error) || 'Could not update it.'); return; }
    msg('listMsg', 'ok', id + ' is now ' + next + '.' + notifyNote(r));
    reload();
  }).catch(function () { btn.disabled = false; msg('listMsg', 'error', 'Could not reach the server.'); });
}

/* ---------- reports ---------- */

function fillReportPicker() {
  const list = state.assignments.map(function (a) {
    return [a.assignmentId, a.assignmentId + ' — ' + a.className + ', due ' + prettyDate(a.due) +
      ' (' + a.status + ')'];
  });
  $('repAssignment').innerHTML = options(list, '', list.length ? 'Choose a homework...' : 'Nothing set yet');
}

/* `after` is shown once the fresh report is on screen. Without it, reloading
   after an award wiped the very message that confirmed the award happened. */
function loadClassReport(after) {
  const id = $('repAssignment').value;
  if (!id) { msg('repMsg', 'error', 'Choose a homework first.'); return Promise.resolve(); }
  msg('repMsg', '', 'Loading...');
  $('repBody').innerHTML = '';
  return call('classReport', { assignmentId: id }).then(function (r) {
    if (!r || !r.success) { msg('repMsg', 'error', (r && r.error) || 'Could not load the report.'); return; }
    msg('repMsg', after ? 'ok' : '', after || '');
    const s = r.summary;
    let html = '<div class="stats">' +
      '<div class="stat"><b>' + s.completionPct + '%</b><span>Handed in</span></div>' +
      '<div class="stat"><b>' + s.completed + '/' + s.total + '</b><span>Pupils</span></div>' +
      '<div class="stat"><b>' + (s.averagePct === null ? '–' : s.averagePct + '%') + '</b><span>Average</span></div>' +
      '<div class="stat"><b>' + s.onTime + '</b><span>On time</span></div>' +
      '<div class="stat"><b>' + s.pointsAwarded + '</b><span>Spark Points</span></div>' +
      '</div>';

    if (r.weakestOutcomes && r.weakestOutcomes.length) {
      html += '<h3>What the class found hardest</h3><div class="tableWrap"><table>' +
        '<thead><tr><th>Topic</th><th>Asked</th><th>Got wrong</th></tr></thead><tbody>' +
        r.weakestOutcomes.map(function (x) {
          return '<tr><td>' + esc(x.topic) + '</td><td>' + x.asked + '</td><td>' +
            pctWrong(x.wrongPct) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }

    const isExam = r.mode === 'Exam';
    const theoryMarks = isExam && r.papers && r.papers.theory ? r.papers.theory.marks : 0;
    html += '<h3>Pupil by pupil</h3>' +
      '<p class="muted">The point for handing in on time is given automatically. The extra ' +
      'two are yours to give, after reading the work, when it is of an appreciable standard.' +
      (isExam ? ' Type each pupil\'s theory mark out of ' + theoryMarks +
        ' once you have marked their paper, and the combined grade appears beside it.' : '') +
      (isExam && r.papers && r.papers.notInPortal ? ' ' + esc(r.papers.notInPortal.charAt(0).toUpperCase() +
        r.papers.notInPortal.slice(1)) + ' is not in the portal, so the combined grade leaves it out.' : '') + '</p>' +
      '<div class="tableWrap"><table>' +
      '<thead><tr><th>Pupil</th><th>State</th><th>' + (isExam ? 'Objective' : 'Score') + '</th>' +
      (isExam ? '<th>Theory mark</th><th>Combined</th>' : '') +
      '<th>On time</th><th>Auto</th>' +
      '<th>Quality</th>' + (isExam ? '' : '<th>Retries</th>') + '<th>Handed in</th></tr></thead><tbody>' +
      r.students.map(function (x) {
        const state_ = x.state === 'done' ? 'Done' : x.state === 'in_progress' ? 'Started' : 'Not started';
        const flag = /too_fast/.test(x.flags) ? ' <span class="chip Closed">rushed</span>' : '';
        let merit;
        if (x.meritAwarded) {
          merit = '+' + x.meritAwarded + '<br><span class="muted">' + esc(x.meritBy) + '</span>';
        } else if (x.state === 'done') {
          merit = '<button class="small" data-act="merit" data-id="' + esc(x.studentId) +
            '" data-name="' + esc(x.name) + '">Give +2</button>';
        } else {
          merit = '<span class="muted">–</span>';
        }
        let examCells = '';
        if (isExam) {
          const val = (x.theoryScore === null || x.theoryScore === undefined) ? '' : x.theoryScore;
          examCells = '<td class="theoryCell"><input type="number" min="0" max="' + theoryMarks +
            '" data-theory="' + esc(x.studentId) + '" value="' + esc(val) + '" placeholder="/' + theoryMarks + '">' +
            '<button class="small" data-act="theory" data-id="' + esc(x.studentId) + '">Save</button>' +
            (x.theoryMarkedBy ? '<span class="muted">' + esc(x.theoryMarkedBy) + '</span>' : '') + '</td>' +
            '<td>' + (x.combined
              ? '<b>' + esc(x.combined.grade) + '</b> ' + x.combined.percent + '%<br>' +
                '<span class="muted">' + x.combined.objectiveMark + ' + ' + x.combined.theoryMark +
                ' of ' + x.combined.totalMarks + '</span>'
              : '<span class="muted">needs the theory mark</span>') + '</td>';
        }
        return '<tr data-row="' + esc(x.studentId) + '"><td>' + esc(x.name) +
          '<br><span class="muted">' + esc(x.studentId) + '</span></td>' +
          '<td>' + state_ + flag + '</td>' +
          '<td>' + (x.score === null ? '–' : x.score + '/' + x.total + ' ' + pct(x.percent)) + '</td>' +
          examCells +
          '<td>' + (x.onTime === null ? '–' : x.onTime ? 'Yes' : 'No') + '</td>' +
          '<td>' + (x.pointsAwarded || (x.pointsNote ? '<span class="muted">' + esc(x.pointsNote.replace(/_/g, ' ')) + '</span>' : '0')) + '</td>' +
          '<td>' + merit + '</td>' +
          (isExam ? '' : '<td>' + x.retries + '</td>') + '<td>' + esc(x.submittedAt) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    $('repBody').innerHTML = html;
  }).catch(function () { msg('repMsg', 'error', 'Could not reach the server.'); });
}

function giveMerit(btn, studentId, name) {
  const id = $('repAssignment').value;
  if (!window.confirm('Give ' + name + ' the extra 2 Spark Points for work done to an appreciable standard?\n\n' +
    'It goes on the Spark Points log under your name, and can only be given once.')) return;
  btn.disabled = true;
  btn.textContent = 'Giving...';
  call('awardMerit', { assignmentId: id, studentId: studentId }).then(function (r) {
    if (!r || !r.success) {
      btn.disabled = false;
      btn.textContent = 'Give +2';
      msg('repMsg', 'error', (r && r.error) || 'Could not give the award.');
      return;
    }
    loadClassReport(name + ' has been given ' + r.points + ' Spark Points.');
  }).catch(function () {
    btn.disabled = false;
    btn.textContent = 'Give +2';
    msg('repMsg', 'error', 'Could not reach the server. Nothing was given.');
  });
}

function loadPracticeReport() {
  const className = $('pracClass').value;
  if (!className) { msg('pracMsg', 'error', 'Choose a class first.'); return; }
  msg('pracMsg', '', 'Loading...');
  $('pracBody').innerHTML = '';
  call('classPracticeReport', { className: className }).then(function (r) {
    if (!r || !r.success) { msg('pracMsg', 'error', (r && r.error) || 'Could not load the activity.'); return; }
    msg('pracMsg', '', '');
    const s = r.summary;
    let html = '<div class="stats">' +
      '<div class="stat"><b>' + s.active + '/' + s.total + '</b><span>Revising</span></div>' +
      '<div class="stat"><b>' + s.questionsAnswered + '</b><span>Questions</span></div>' +
      '<div class="stat"><b>' + s.practiceSessions + '</b><span>Practice</span></div>' +
      '<div class="stat"><b>' + s.mockPapers + '</b><span>Mock tests</span></div>' +
      '</div>';
    if (r.hardestTopics && r.hardestTopics.length) {
      html += '<h3>Topics the class struggles with in revision</h3><div class="tableWrap"><table>' +
        '<thead><tr><th>Topic</th><th>Asked</th><th>Got wrong</th></tr></thead><tbody>' +
        r.hardestTopics.map(function (x) {
          return '<tr><td>' + esc(x.topic) + '</td><td>' + x.asked + '</td><td>' + pctWrong(x.wrongPct) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    html += '<h3>Pupil by pupil</h3><div class="tableWrap"><table>' +
      '<thead><tr><th>Pupil</th><th>Practice</th><th>Mock tests</th><th>Questions</th><th>Correct</th><th>Last active</th></tr></thead><tbody>' +
      r.students.map(function (x) {
        return '<tr><td>' + esc(x.name) + '</td><td>' + x.practiceSessions + '</td><td>' + x.mockPapers +
          '</td><td>' + x.questionsAnswered + '</td><td>' + pct(x.correctPct) + '</td><td>' +
          esc(x.lastActive || '–') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    $('pracBody').innerHTML = html;
  }).catch(function () { msg('pracMsg', 'error', 'Could not reach the server.'); });
}

/* The assignment is saved whether or not the emails went out, so the two are
   reported separately — a mail problem must not read as a failure to publish. */
function notifyNote(r) {
  if (r.notifyError) return ' Pupils were not emailed: ' + r.notifyError;
  const n = r.notified;
  if (!n) return '';
  if (n.note === 'already sent') return ' Pupils had already been emailed about it.';
  let out = ' ' + n.sent + ' pupil' + (n.sent === 1 ? '' : 's') + ' emailed';
  if (n.noEmail && n.noEmail.length) out += ', ' + n.noEmail.length + ' have no email address';
  if (n.failures && n.failures.length) out += ', ' + n.failures.length + ' failed';
  return out + '.';
}

/* ---------- question bank ---------- */

function renderBankExplain() {
  let live = 0, reviewed = 0;
  subjectTopics().forEach(function (t) { live += t.liveMcq || 0; reviewed += t.reviewedMcq || 0; });
  $('bankExplain').innerHTML = '<b>Nothing reaches a pupil until it is released.</b> ' +
    'Questions start as <i>Reviewed</i> or <i>Draft</i>. Releasing a topic turns its <i>Reviewed</i> ' +
    'questions into <i>Live</i>; <i>Draft</i> ones are never released automatically, because those are ' +
    'the items the source bank flagged as a weaker match to the Nigerian syllabus. ' +
    'Check a topic yourself before releasing it. ' +
    '<br><b>' + live + '</b> question' + (live === 1 ? '' : 's') + ' released so far, <b>' + reviewed +
    '</b> waiting.';
}

function renderBankPicker() {
  const onlyPending = $('bankOnlyPending').checked;
  const inYear = yearFilter('bankYear');
  renderPicker('bankPicker', 'bankCount',
    function (t) { return inYear(t) && (onlyPending ? t.reviewed > 0 : true); },
    function (t) {
      return {
        dim: t.reviewed === 0, disabled: t.reviewed === 0,
        note: t.reviewed > 0 ? t.reviewed + ' waiting · ' + t.live + ' live' : t.live + ' live, none waiting'
      };
    });
}

function promote() {
  const outcomeIds = chosenOutcomes('bankPicker');
  if (!outcomeIds.length) { msg('promoteMsg', 'error', 'Tick the topics you have checked and want to release.'); return; }
  const n = chosenTopicCount('bankPicker');
  if (!window.confirm('Release ' + n + (n === 1 ? ' topic' : ' topics') +
    ' to pupils? Only questions a second teacher has already marked as Reviewed will go live.')) return;
  $('promoteBtn').disabled = true;
  msg('promoteMsg', '', 'Releasing...');
  call('promoteToLive', { outcomeIds: outcomeIds }).then(function (r) {
    $('promoteBtn').disabled = false;
    if (!r || !r.success) { msg('promoteMsg', 'error', (r && r.error) || 'Could not release them.'); return; }
    msg('promoteMsg', 'ok', r.promoted + ' question' + (r.promoted === 1 ? ' is' : 's are') + ' now live for pupils.');
    reload();
  }).catch(function () { $('promoteBtn').disabled = false; msg('promoteMsg', 'error', 'Could not reach the server.'); });
}

/* Now that the second-marker pass is done across the bank, releasing the lot in
   one go is a reasonable thing to want. Draft items are still left alone. */
function promoteAll() {
  const ids = [];
  state.topics.forEach(function (t) {
    if ((t.reviewedMcq || 0) > 0) ids.push(t.outcomeId);
  });
  if (!ids.length) { msg('promoteMsg', 'ok', 'Everything checked has already been released.'); return; }
  if (!window.confirm('Release every checked question in the bank to pupils?\n\n' +
    'Draft questions are not included — those are the ones flagged as a weaker match to the ' +
    'Nigerian syllabus, and stay for you to decide on topic by topic.')) return;
  $('promoteAllBtn').disabled = true;
  msg('promoteMsg', '', 'Releasing the whole bank — this can take a moment...');
  call('promoteToLive', { outcomeIds: ids }).then(function (r) {
    $('promoteAllBtn').disabled = false;
    if (!r || !r.success) { msg('promoteMsg', 'error', (r && r.error) || 'Could not release them.'); return; }
    msg('promoteMsg', 'ok', r.promoted + ' question' + (r.promoted === 1 ? ' is' : 's are') + ' now live for pupils.');
    reload();
  }).catch(function () { $('promoteAllBtn').disabled = false; msg('promoteMsg', 'error', 'Could not reach the server.'); });
}

function runCheck() {
  msg('checkMsg', '', 'Checking...');
  $('checkBody').innerHTML = '';
  call('checkAssignments').then(function (r) {
    if (!r || !r.success) { msg('checkMsg', 'error', (r && r.error) || 'Could not run the check.'); return; }
    if (!r.issues.length) { msg('checkMsg', 'ok', 'Nothing wrong.'); return; }
    msg('checkMsg', 'warn', r.issues.length + ' thing' + (r.issues.length === 1 ? '' : 's') + ' to look at:');
    $('checkBody').innerHTML = '<ul class="issues">' +
      r.issues.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>';
  }).catch(function () { msg('checkMsg', 'error', 'Could not reach the server.'); });
}

/* ---------- student codes ---------- */

function issueCodes(reset) {
  const className = $('codeClass').value;
  if (!className) { msg('codeMsg', 'error', 'Choose a class first.'); return; }
  if (reset && !window.confirm('Reset every code in ' + className +
    '? Codes pupils already have will stop working, and links in old emails will stop working too.')) return;

  const btn = reset ? $('resetCodesBtn') : $('issueBtn');
  btn.disabled = true;
  msg('codeMsg', '', 'Working — emails can take a moment...');
  $('codeBody').innerHTML = '';
  call('issueStudentCodes', { className: className, notify: $('codeNotify').checked, reset: !!reset })
    .then(function (r) {
      btn.disabled = false;
      if (!r || !r.success) { msg('codeMsg', 'error', (r && r.error) || 'Could not issue codes.'); return; }
      const noEmail = r.noEmail || [], shared = r.sharedEmail || [];
      const stuck = r.failed + noEmail.length + shared.length;
      msg('codeMsg', stuck ? 'warn' : 'ok',
        r.issued + ' code' + (r.issued === 1 ? '' : 's') + ' issued, ' + r.emailed + ' emailed, ' +
        r.skippedExisting + ' already had one' +
        (noEmail.length ? ', ' + noEmail.length + ' have no email address' : '') +
        (shared.length ? ', ' + shared.length + ' share an address with another pupil' : '') +
        (r.failed ? ', ' + r.failed + ' could not be emailed' : '') + '.');

      /* Pupils sign in with their email, so no address means no way in at all
         — a different problem from an email that bounced. Listed apart. */
      let html = '';
      if (noEmail.length) {
        html += '<p class="muted"><b>No email address, so they cannot sign in.</b> ' +
          'Add one to STUDENTS and run this again.</p><ul class="issues">' +
          noEmail.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>';
      }
      if (shared.length) {
        html += '<p class="muted"><b>Address used by more than one pupil.</b> ' +
          'Sign-in cannot tell them apart, so each needs their own address.</p><ul class="issues">' +
          shared.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>';
      }
      if (r.failures && r.failures.length) {
        html += '<p class="muted"><b>Code issued but the email did not send.</b> ' +
          'Give those pupils their code by hand, or try again.</p><ul class="issues">' +
          r.failures.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>';
      }
      $('codeBody').innerHTML = html;
    }).catch(function () { btn.disabled = false; msg('codeMsg', 'error', 'Could not reach the server.'); });
}

/* ---------- tabs and wiring ---------- */

function showTab(name) {
  state.tab = name;
  ['assignments', 'reports', 'bank', 'students'].forEach(function (t) {
    $('tab-' + t).classList.toggle('hidden', t !== name);
  });
  document.querySelectorAll('.tabs button').forEach(function (b) {
    b.classList.toggle('on', b.getAttribute('data-tab') === name);
  });
  if (name === 'reports') fillReportPicker();
  window.scrollTo(0, 0);
}

function wire() {
  $('signInForm').addEventListener('submit', function (e) {
    e.preventDefault();
    trySignIn($('staffEmail').value, $('staffCode').value);
  });
  $('signOutBtn').addEventListener('click', signOut);
  $('refreshBtn').addEventListener('click', function () {
    msg('listMsg', '', 'Refreshing...');
    reload(function () { msg('listMsg', 'ok', 'Up to date.'); });
  });

  document.querySelector('.tabs').addEventListener('click', function (e) {
    const t = e.target.getAttribute && e.target.getAttribute('data-tab');
    if (t) showTab(t);
  });

  $('newMode').addEventListener('change', function () {
    $('newPointsWrap').classList.toggle('hidden', $('newMode').value === 'Self-Check');
    toggleExamSetup();
    renderNewTopicPicker();
  });
  $('pickOnlyReady').addEventListener('change', renderNewTopicPicker);
  $('topicPicker').addEventListener('click', function (e) {
    const b = e.target.closest ? e.target.closest('.preview') : null;
    if (b) { e.preventDefault(); openPreview(b.getAttribute('data-outcomes').split(','), b.getAttribute('data-name')); }
  });
  $('previewClose').addEventListener('click', function () { $('previewBox').classList.add('hidden'); });
  $('previewMore').addEventListener('click', loadPreview);
  $('pickClear').addEventListener('click', function () {
    $('topicPicker').querySelectorAll('input:checked').forEach(function (b) { b.checked = false; });
    updateCount('topicPicker', 'pickCount');
  });
  $('topicPicker').addEventListener('change', function () { updateCount('topicPicker', 'pickCount'); });

  $('createPublishBtn').addEventListener('click', function () { createAssignment(true); });
  $('createDraftBtn').addEventListener('click', function () { createAssignment(false); });

  $('assignmentRows').addEventListener('click', function (e) {
    const b = e.target.closest ? e.target.closest('[data-act="status"]') : null;
    if (b) setStatus(b, b.getAttribute('data-id'), b.getAttribute('data-next'));
  });

  $('repLoadBtn').addEventListener('click', function () { loadClassReport(); });
  $('repBody').addEventListener('click', function (e) {
    const t = e.target.closest ? e.target.closest('[data-act="theory"]') : null;
    if (t) { saveTheoryScore(t, t.getAttribute('data-id')); return; }
    const b = e.target.closest ? e.target.closest('[data-act="merit"]') : null;
    if (b) giveMerit(b, b.getAttribute('data-id'), b.getAttribute('data-name'));
  });
  /* Enter saves the mark, which is how anyone types a column of marks. */
  $('repBody').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    const box = e.target.closest ? e.target.closest('[data-theory]') : null;
    if (!box) return;
    e.preventDefault();
    const btn = box.parentNode.querySelector('[data-act="theory"]');
    if (btn) saveTheoryScore(btn, box.getAttribute('data-theory'));
  });
  $('pracLoadBtn').addEventListener('click', loadPracticeReport);

  $('bankOnlyPending').addEventListener('change', renderBankPicker);
  $('bankYear').addEventListener('change', renderBankPicker);
  $('pickSubject').addEventListener('change', function () { changeSubject(this.value); });
  $('bankSubject').addEventListener('change', function () { changeSubject(this.value); });
  $('pickYear').addEventListener('change', renderNewTopicPicker);
  $('examBoard').addEventListener('change', loadExamBlueprint);
  $('examSubject').addEventListener('change', loadExamBlueprint);
  $('bankClear').addEventListener('click', function () {
    $('bankPicker').querySelectorAll('input:checked').forEach(function (b) { b.checked = false; });
    updateCount('bankPicker', 'bankCount');
  });
  $('bankPicker').addEventListener('change', function () { updateCount('bankPicker', 'bankCount'); });
  $('promoteBtn').addEventListener('click', promote);
  $('promoteAllBtn').addEventListener('click', promoteAll);
  $('checkBtn').addEventListener('click', runCheck);

  $('issueBtn').addEventListener('click', function () { issueCodes(false); });
  $('resetCodesBtn').addEventListener('click', function () { issueCodes(true); });

  /* A link from the access email: ?email=...&code=... — sign in and strip it,
     exactly as the Results and Spark Points portals do. */
  const params = new URLSearchParams(location.search);
  if (params.get('email') && params.get('code')) {
    $('staffEmail').value = params.get('email');
    $('staffCode').value = params.get('code');
    history.replaceState({}, document.title, location.pathname);
    trySignIn(params.get('email'), params.get('code'));
    return;
  }

  let se, sc;
  try {
    se = localStorage.getItem(STORE_EMAIL) || sessionStorage.getItem(STORE_EMAIL);
    sc = localStorage.getItem(STORE_CODE) || sessionStorage.getItem(STORE_CODE);
  } catch (e) {}
  if (se && sc) {
    $('staffEmail').value = se;
    $('staffCode').value = sc;
    try { if (localStorage.getItem(STORE_EMAIL)) $('rememberMeToggle').checked = true; } catch (e) {}
    trySignIn(se, sc);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
else wire();
