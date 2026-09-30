/* 업무보고 자동생성 Agent · 화면 (data09-10 과제 B 의 report-app.js 를 이어 씀)
   메뉴: 01 보고 설정 · 02 메일 자동 수집 · 보고서(첫 화면 — 주간·월간 고르기 → 수집 폴더 → 보고서 만들기)
   03 업무 그룹 · 04 실적·계획·이슈 · 05 이전 계획 대비 · 06 보고서 · 07 이력·백업 · 08 보고서 취합
   평소에는 주간보고.bat(월간보고.bat) → 02 → 06 만 씁니다. 03~05 는 고칠 것이 있을 때만 엽니다.
   08 은 파트리더 · 팀장 · 임원이 아래 단계의 보고서 파일을 모아 한 장으로 만들 때 씁니다(2026-09-30 답변). */
(function () {
  'use strict';
  var L = window.RPLogic, C = window.CollectLogic, RD = window.P27Readers, R = window.RollupLogic;
  var KEY = 'data09-27.report';
  var memory = null, storeOk = true;
  function load() {
    try { var raw = window.localStorage.getItem(KEY); if (raw) return L.restoreState(JSON.parse(raw)); }
    catch (e) { storeOk = false; }
    return memory ? L.restoreState(JSON.parse(memory)) : L.emptyState();
  }
  var st = load();
  var main = document.getElementById('main');
  // 보고서 본문 모양은 Word·HTML 내보내기와 같은 CSS 를 쓴다(모양이 갈라지지 않게)
  var rpCss = document.createElement('style'); rpCss.textContent = L.REPORT_CSS; document.head.appendChild(rpCss);

  /* ── 작은 도구 ── */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  function save() {
    var raw = JSON.stringify(st);
    memory = raw;
    try { window.localStorage.setItem(KEY, raw); storeOk = true; }
    catch (e) {
      storeOk = false;
      toast('브라우저에 저장하지 못했습니다(저장 공간 부족 또는 차단). 이번 창에만 남아 있으니 「07 이력·백업」에서 JSON 백업을 받아 두세요.', true);
    }
    renderChrome();
  }
  var toastTimer;
  function toast(msg, isError) {
    var el = document.getElementById('toast');
    el.textContent = msg; el.className = 'toast' + (isError ? ' error' : ''); el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, isError ? 6000 : 3000);
  }
  function dialog(title, content, buttons) {
    var dlg = document.getElementById('dialog');
    document.getElementById('dialogTitle').textContent = title;
    var c = document.getElementById('dialogContent'); c.innerHTML = ''; append(c, content);
    var a = document.getElementById('dialogActions'); a.innerHTML = '';
    (buttons || [{ label: '닫기' }]).forEach(function (b) {
      a.appendChild(h('button', {
        class: 'btn' + (b.primary ? ' btn-primary' : '') + (b.danger ? ' btn-danger' : ''), value: 'close',
        onclick: b.onClick ? function (e) { e.preventDefault(); dlg.close(); b.onClick(); } : null
      }, b.label));
    });
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }
  function confirmBox(title, msg, okLabel, onOk, danger) {
    dialog(title, h('p', null, msg), [{ label: '취소' }, { label: okLabel, primary: !danger, danger: danger, onClick: onOk }]);
  }
  function download(name, blob) {
    var a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function nowStamp() { var d = new Date(); return today() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function fileTag() { return st._sample ? '_예시데이터' : ''; }
  function pageHead(stage, title, lead, tools) {
    return h('div', { class: 'page-head' },
      h('div', { class: 'titles' }, h('div', { class: 'stage' }, stage), h('h1', null, title), lead ? h('p', { class: 'lead' }, lead) : null),
      tools || null);
  }
  function field(label, control, hint) {
    return h('label', { class: 'field' }, h('span', null, label), control, hint ? h('small', { class: 'hint' }, hint) : null);
  }
  function selectEl(options, value, onchange) {
    var s = h('select', { onchange: onchange });
    options.forEach(function (o) {
      var v = typeof o === 'object' ? o.value : o, t = typeof o === 'object' ? o.label : o;
      var opt = h('option', { value: v }, t);
      if (String(v) === String(value)) opt.selected = true;
      s.appendChild(opt);
    });
    return s;
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(function () { toast('복사했습니다.'); }, fallback);
    fallback();
    function fallback() {
      var ta = h('textarea', { style: 'position:fixed;left:-9999px' }); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('복사했습니다.'); } catch (e) { toast('복사하지 못했습니다. 글상자에서 직접 선택해 복사해 주세요.', true); }
      ta.remove();
    }
  }

  /* ── 파생 값: 기간 · 업무 그룹 ── */
  function period() { return L.periodFor(st.settings.type, st.settings.refDay || today(), st.settings.weekStart); }
  function tasksNow() {
    var tasks = L.groupTasks(st.mails, st.projects), ov = st.taskProject || {};
    tasks.forEach(function (t) { if (ov[t.key]) t.project = ov[t.key]; });
    return tasks;
  }
  /* 항목의 업무 연결은 매번 근거 메일로 다시 잡는다(메일이 늘면 업무 번호가 바뀌므로) */
  function itemsNow(tasks) {
    return st.items.map(function (x) {
      var t = x.evidence.length ? L.taskOfMail(tasks, x.evidence[0]) : null;
      var y = Object.assign({}, x);
      y.taskId = t ? t.id : ''; if (t && !x.taskName) y.taskName = t.name;
      return y;
    });
  }
  function mailById(id) { return st.mails.filter(function (m) { return m.id === id; })[0] || null; }
  function periodMails() { var p = period(); return st.mails.filter(function (m) { return L.inPeriod(m.day, p); }); }
  function carryNow(tasks) {
    var p = period(), items = L.markConflicts(itemsNow(tasks).filter(function (x) { return !x.excluded && x.evidence.some(function (e) { var m = mailById(e); return m && L.inPeriod(m.day, p); }); }));
    return L.carryOver(L.parsePlanLines(st.prevPlansText), items).map(function (c) {
      var k = (c.plan.project || '') + '|' + c.plan.text;
      if (st.carryFinal[k]) c.final = st.carryFinal[k];
      c.key = k;
      return c;
    });
  }
  function reportNow() {
    var tasks = tasksNow();
    return L.buildReport({
      type: st.settings.type, period: period(), mails: st.mails, items: C.applyReleaseDates(L.markConflicts(itemsNow(tasks)), st.mails, L.extractDates), tasks: tasks,
      carry: carryNow(tasks), author: st.settings.author, title: st.settings.title, approved: st.approved || null,
      now: nowStamp(), summaryOverride: st.summaryOverride, projects: st.projects, boardStyle: st.settings.boardStyle || 'brief'
    });
  }

  /* ── 머리·메뉴 ───────────────────────── */
  var NAV = [
    ['#/setup', '01', '보고 설정', '보고자 · 프로젝트 · AI 연결'],
    ['#/make', '02', '메일 자동 수집 · 보고서', '주간·월간 → 보고서 만들기'],
    ['#/tasks', '03', '업무 그룹', '제목·프로젝트로 묶기'],
    ['#/classify', '04', '실적·계획·이슈', '규칙 분류 + AI 반자동'],
    ['#/carry', '05', '이전 계획 대비', '완료·진행·지연·이월'],
    ['#/report', '06', '보고서 초안', '검토·승인 · Word·Excel'],
    ['#/history', '07', '이력·백업', '승인 이력 · JSON'],
    ['#/rollup', '08', '보고서 취합', '파트리더 · 팀장 · 임원']
  ];
  function renderChrome(route) {
    route = route || location.hash || '#/make';
    var nav = document.getElementById('nav'); nav.innerHTML = '';
    var p = period(), inP = periodMails().length;
    var check = st.items.filter(function (x) { return !x.excluded && !x.reviewed && (x.status === '확인 필요' || x.explicit === false || !x.evidence.length); }).length;
    NAV.forEach(function (n) {
      var cur = route === n[0] || route.indexOf(n[0] + '/') === 0 || (n[0] === '#/make' && route.indexOf('#/mail/') === 0);
      nav.appendChild(h('a', { href: n[0], 'aria-current': cur ? 'page' : null },
        h('span', { class: 'no' }, n[1]), h('span', { class: 't' }, n[2]), h('span', { class: 's' }, n[3]),
        n[0] === '#/make' && st.mails.length ? h('span', { class: 's' }, '메일 ' + st.mails.length + '통 · 기간 안 ' + inP + '통') : null,
        n[0] === '#/classify' && check ? h('span', { class: 's badge-warn' }, '확인 필요 ' + check + '건') : null,
        n[0] === '#/report' && st.approved ? h('span', { class: 's' }, '승인 ' + st.approved) : null,
        n[0] === '#/rollup' && st.rollup.sources.length ? h('span', { class: 's' }, '받은 보고서 ' + st.rollup.sources.length + '개') : null));
    });
    var chip = document.getElementById('scopeChip'); chip.innerHTML = '';
    append(chip, [h('span', null, st.settings.type === 'monthly' ? '월간보고' : '주간보고'), h('span', { class: 'dim' }, p ? p.start + ' ~ ' + p.end : '기간 미지정'), h('span', { class: 'dim' }, st.settings.level || '팀원')]);
    document.getElementById('storeNote').textContent = '메일 ' + st.mails.length + '통 · 항목 ' + st.items.length + '건' + (storeOk ? '' : ' · 메모리에만 보관 중');
    document.getElementById('schemaVer').textContent = L.SCHEMA_VERSION;
    var ban = document.getElementById('sampleBanner');
    ban.hidden = !st._sample; ban.innerHTML = '';
    if (st._sample) append(ban, [h('strong', null, '예시 데이터'), ' — 메일 · 첨부 · 인물 · 업무는 모두 가상(example.com)입니다. ', h('a', { href: '#/history' }, '예시 데이터 지우기')]);
  }

  /* ── 01 보고 설정 ─────────────────────── */
  function viewSetup() {
    var s = st.settings;
    var ws = selectEl([{ value: 1, label: '월요일' }, { value: 0, label: '일요일' }], s.weekStart, function (e) { s.weekStart = +e.target.value; save(); render(); });
    var au = h('input', { type: 'text', value: s.author, placeholder: '예: 보고자 이름', onchange: function (e) { s.author = e.target.value.trim(); save(); } });
    var ti = h('input', { type: 'text', value: s.title, placeholder: '예: 디자인팀', onchange: function (e) { s.title = e.target.value.trim(); save(); } });

    var rows = h('div', { class: 'pj-rows' });
    function drawProjects() {
      rows.innerHTML = '';
      st.projects.forEach(function (pj, i) {
        rows.appendChild(h('div', { class: 'pj-row' },
          field('Business Group', h('input', { type: 'text', value: pj.group || '', placeholder: '예: 건설기계', onchange: function (e) { pj.group = e.target.value.trim(); st.approved = null; save(); } })),
          field('프로젝트명', h('input', { type: 'text', value: pj.name, onchange: function (e) { pj.name = e.target.value.trim(); st.projects = L.cleanProjects(st.projects); save(); } })),
          field('키워드(쉼표로 구분)', h('input', { type: 'text', value: pj.keywords.join(', '), onchange: function (e) { pj.keywords = e.target.value.split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean); save(); } })),
          h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: function () { st.projects.splice(i, 1); save(); drawProjects(); } }, '삭제')));
      });
      if (!st.projects.length) rows.appendChild(h('p', { class: 'note' }, '등록한 프로젝트가 없습니다. 없어도 메일 제목의 [대괄호] 표시로 묶지만, 키워드를 넣으면 더 정확합니다.'));
    }
    drawProjects();
    var lvNote = h('p', { class: 'note' }, R.LEVEL_NOTE[s.level || '팀원']);
    var levels = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': '보고 단계' }, R.LEVELS.map(function (lv) {
      return h('label', { class: 'opt' }, h('input', { type: 'radio', name: 'level', value: lv, checked: (s.level || '팀원') === lv, onchange: function () { s.level = lv; save(); lvNote.textContent = R.LEVEL_NOTE[lv]; } }),
        h('span', null, h('span', { class: 't' }, lv), h('span', { class: 's' }, R.nextLevel(lv) ? R.nextLevel(lv) + '에게 보고' : '보고를 받음')));
    }));
    return h('div', null,
      pageHead('01 · Report Setting', '보고 설정', '한 번만 정해 두면 됩니다. 주간·월간과 기간은 「02 메일 자동 수집」에서 고릅니다.'),
      h('section', { class: 'card' }, h('h2', null, '보고서 정보'),
        h('div', { class: 'form-grid' }, field('작성자', au, '보고서 파일을 주고받을 때 이 이름으로 누가 보고했는지 표시합니다.'), field('보고 단위(팀·과제명)', ti, '예: 디자인팀 A파트'), field('한 주의 시작', ws, '수집설정.txt 의 주시작과 같게 맞춰 주세요.'))),
      h('section', { class: 'card' }, h('h2', null, '보고 단계(내 역할)'),
        h('p', { class: 'note' }, '팀원 → 파트리더 → 팀장 → 담당 임원 순서로 올립니다. 팀원은 메일로 보고서를 만들고, 파트리더 · 팀장 · 임원은 아래 단계에서 받은 보고서 파일을 「08 보고서 취합」에서 한 장으로 모읍니다.'),
        levels, lvNote),
      h('section', { class: 'card' }, h('h2', null, '프로젝트와 키워드'),
        h('p', { class: 'note' }, '메일 제목 · 첨부 파일명 · 본문 · 첨부 파일 글에 키워드가 있으면 그 프로젝트로 묶습니다. 제목의 [프로젝트명]과 같으면 가장 먼저 씁니다. Business Group 은 주간보고 양식 표의 첫 열(예: 건설기계·산업차량)에 들어갑니다.'),
        rows,
        h('button', { class: 'btn', type: 'button', onclick: function () { st.projects.push({ name: '새 프로젝트', keywords: [], group: '' }); save(); drawProjects(); } }, '프로젝트 추가')),
      h('section', { class: 'card' }, h('h2', null, '주간보고 양식 표 문체'),
        h('p', { class: 'note' }, '주간보고의 양식 표(Business Group · 프로젝트명 · 금주 실적 · 차주 계획)에 넣을 문장 모양입니다. 원래 문장은 아래 상세 절(01~03)에 그대로 남습니다.'),
        h('div', { class: 'seg', role: 'radiogroup', 'aria-label': '양식 표 문체' }, [['brief', '개조식(양식 샘플처럼)', '「~ 검토 완료」「~ 확인 필요」'], ['original', '메일 문장 그대로', '「~ 검토했습니다」']].map(function (o) {
          return h('label', { class: 'opt' }, h('input', { type: 'radio', name: 'bstyle', value: o[0], checked: (s.boardStyle || 'brief') === o[0], onchange: function () { s.boardStyle = o[0]; st.approved = null; save(); } }),
            h('span', null, h('span', { class: 't' }, o[1]), h('span', { class: 's' }, o[2])));
        }))),
      window.AIPanel ? AIPanel.settingsCard({ toast: toast, onChange: render }) : null,
      h('div', { class: 'btn-row' }, h('a', { class: 'btn btn-primary', href: '#/make' }, '다음: 메일 자동 수집 · 보고서')));
  }

  /* ── 02 메일 자동 수집 · 보고서 (한 화면) ─────────────
     ① 주간 · 월간 고르기 ② 수집 폴더 열기(주간보고.bat · 월간보고.bat 가 만든 폴더) ③ 보고서 만들기
     .bat 로 모으면 이 화면이 그 결과를 들고 자동으로 열립니다(#/make?collect=…). */
  var busy = '';
  function setBusy(msg) { busy = msg; render(); }
  /* 첨부 글 채우기 — getBytes(rel) → Promise<Uint8Array|null>. PDF · 일러스트만 브라우저에서 읽습니다 */
  function readPending(mails, getBytes) {
    var jobs = C.pendingBrowserReads(mails), done = 0, p = Promise.resolve();
    jobs.forEach(function (j) {
      p = p.then(function () {
        busy = 'PDF · 일러스트 첨부 읽는 중 ' + (++done) + ' / ' + jobs.length + ' — ' + j.att.name; renderBusy();
        return getBytes(j.att.file).then(function (bytes) {
          if (!bytes) { j.att.extract = 'no-file'; j.att.note = '수집 폴더에서 이 파일을 찾지 못했습니다 — 「수집 폴더 열기」로 폴더째 골라 주세요'; return; }
          return RD.fillAttachment(j.att, bytes);
        }, function (e) { j.att.extract = 'error'; j.att.note = e.message; });
      });
    });
    return p.then(function () { return jobs.length; });
  }
  function renderBusy() { var el = document.getElementById('busyLine'); if (el) el.textContent = busy; }
  /* 모은 메일의 첨부 .json 글 모으기 — getText(rel) → Promise<string|null> (2026-09-30 「메일로 송/수신」)
     자동 열기는 수집기가 넘긴 reports.js 의 글, 폴더 열기는 그 파일을 읽은 글 */
  function readReportTexts(mails, getText) {
    var texts = {}, p = Promise.resolve();
    if (!getText) return p.then(function () { return texts; });
    mails.forEach(function (m) {
      (m.attachments || []).forEach(function (a) {
        if (!a.file || !(a.kind === 'report' || /\.json$/i.test(a.name))) return;
        p = p.then(function () { return getText(a.file); }).then(function (t) { if (t != null) texts[a.file] = t; }, function () { /* 못 읽으면 건너뜀 */ });
      });
    });
    return p.then(function () { return texts; });
  }
  /* manifest(수집 결과) 넣기. source: 'auto' | 'folder' | 'sample'. getReportText: 첨부 .json 글 읽기(선택) */
  function importCollection(manifest, getBytes, source, extra, getReportText) {
    var m, mails, summary;
    try { m = C.parseManifest(manifest); mails = C.mailsFromManifest(m, L.mainText, L.normalizeSubject); summary = C.collectSummary(m); }
    catch (e) { busy = ''; toast('수집 결과를 읽지 못했습니다: ' + e.message, true); render(); return Promise.resolve(false); }
    setBusy('수집 결과를 넣는 중…');
    var reportTexts = {};
    return readReportTexts(mails, getReportText).then(function (t) { reportTexts = t; return readPending(mails, getBytes); }).then(function (nPdf) {
      var keep = st.mails.filter(function (x) { return x.source !== 'collect' && !(source === 'sample'); });
      var ps = C.settingsFromManifest(m);
      var s = source === 'sample' ? L.emptyState() : st;
      if (source === 'sample') {
        s.settings = Object.assign(s.settings, extra.settings);
        s.projects = L.cleanProjects(extra.projects);
        s.history = JSON.parse(JSON.stringify(extra.history));
        s._sample = true;
      } else if (st._sample) {           // 예시를 보다가 실제 수집 결과를 넣으면 예시는 지운다
        s = L.emptyState(); s.settings = Object.assign(s.settings, { author: st.settings.author === '보고자(가상)' ? '' : st.settings.author });
        keep = [];
      }
      s.settings.type = ps.type; s.settings.refDay = ps.refDay; s.settings.weekStart = ps.weekStart;
      var r = L.addMails(keep, C.slimForState(mails));
      s.mails = r.mails;
      s.items = s.items.filter(function (x) { return x.origin === 'manual'; });   // 규칙 · AI 항목은 「보고서 만들기」 때 새로 뽑는다
      s.carryFinal = {}; s.summaryOverride = ''; s.approved = null;
      summary.source = source; summary.pdfRead = nPdf;
      summary.pdfOk = mails.reduce(function (n, x) { return n + x.attachments.filter(function (a) { return (a.kind === 'pdf' || a.kind === 'illustrator') && a.extract === 'ok'; }).length; }, 0);
      s.collect = summary;
      // 받은 메일의 첨부에서 업무보고 파일 찾기 → 「08 보고서 취합」에서 불러오기
      var fm = R.findMailedPackages(s.mails.filter(function (x) { return x.source === 'collect'; }), reportTexts);
      s.rollup.found = fm.found; summary.reportsFound = fm.found.length; summary.reportsBad = fm.bad;
      st = s; busy = '';
      save();
      toast('메일 ' + r.added.length + '통 · 첨부 ' + summary.attachments.total + '개를 넣었습니다' + (r.duplicates.length ? '(같은 메일 ' + r.duplicates.length + '통은 건너뜀)' : '') + '. 「보고서 만들기」를 눌러 주세요.' +
        (fm.found.length ? ' 받은 메일에서 업무보고 파일 ' + fm.found.length + '개도 찾았습니다(08 보고서 취합).' : ''));
      render();
      return true;
    });
  }
  /* 「수집 폴더 열기」 — 폴더째(또는 manifest.json 과 파일들) */
  function openFolderFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    var paths = files.map(function (f) { return f.webkitRelativePath || f.name; });
    var idx = C.relPathIndex(paths), byPath = {};
    files.forEach(function (f, i) { byPath[paths[i]] = f; });
    var manPath = idx['manifest.json'] || idx['manifest.js'];
    if (!manPath) { toast('고른 곳에 manifest.json 이 없습니다. 주간보고.bat · 월간보고.bat 가 만든 폴더(문서\\업무보고_수집\\…)를 골라 주세요.', true); return; }
    RD.fileText(byPath[manPath]).then(function (text) {
      var getBytes = function (rel) { var p = idx[rel]; return p ? RD.fileBytes(byPath[p]) : Promise.resolve(null); };
      var getText = function (rel) { var p = idx[rel]; return p ? RD.fileText(byPath[p]) : Promise.resolve(null); };
      return importCollection(text, getBytes, 'folder', null, getText);
    }).catch(function (e) { toast('폴더를 읽지 못했습니다: ' + e.message, true); });
  }
  /* 자동 열기(#/make?collect=file:///…/manifest.js) — .bat 가 만든 「보고서_열기.html」이 이 주소로 엽니다 */
  function autoOpen() {
    var q = C.collectParam(location.hash, location.protocol);
    if (!q.url && !q.error) return false;
    history.replaceState(null, '', location.pathname + location.search + '#/make');
    if (q.error) { toast(q.error, true); return false; }
    window.P27_COLLECT = null; window.P27_PDF = null; window.P27_REPORTS = null;
    setBusy('수집 결과를 여는 중…');
    RD.addScript(q.url).then(function () {
      return RD.addScript(q.url.replace(/manifest\.js$/i, 'pdfdata.js')).catch(function () { /* PDF 가 없거나 못 읽으면 건너뜀 */ });
    }).then(function () {
      return RD.addScript(q.url.replace(/manifest\.js$/i, 'reports.js')).catch(function () { /* 예전 수집기 결과에는 없음 */ });
    }).then(function () {
      if (!window.P27_COLLECT) throw new Error('manifest.js 에 수집 결과가 없습니다');
      var pdf = window.P27_PDF || {};
      var reps = window.P27_REPORTS || {};
      return importCollection(window.P27_COLLECT, function (rel) { return Promise.resolve(pdf[rel] ? RD.base64ToBytes(pdf[rel]) : null); }, 'auto', null,
        function (rel) { return Promise.resolve(reps[rel] != null ? reps[rel] : null); });
    }).catch(function (e) {
      busy = ''; render();
      toast('수집 결과를 자동으로 열지 못했습니다(' + e.message + '). 「수집 폴더 열기」로 그 폴더를 골라 주세요.', true);
    });
    return true;
  }
  /* 「보고서 만들기」 — 규칙 분류(메일 본문 + 첨부 글) → 이전 계획 대비(승인 이력에서) → 06 보고서 */
  function makeReport() {
    var p = period();
    if (!st.mails.length) { toast('메일이 없습니다. 먼저 수집 폴더를 열거나 예시로 해 보세요.', true); return; }
    if (!periodMails().length) { toast('보고 기간(' + p.start + ' ~ ' + p.end + ') 안의 메일이 없습니다. 주간 · 월간을 확인하거나 그 기간으로 다시 모아 주세요.', true); return; }
    runRules(true);
    var fromHist = L.plansFromHistory(st.history, p);
    if (fromHist && !st.prevPlansText.trim()) st.prevPlansText = fromHist.text;
    save();
    var n = st.items.filter(function (x) { return !x.excluded; }).length, fa = st.items.filter(function (x) { return x.source === 'attachment'; }).length;
    toast('업무 항목 ' + n + '건(첨부에서 ' + fa + '건)으로 보고서 초안을 만들었습니다. 「확인 필요」 표시를 살펴 주세요.');
    location.hash = '#/report';
  }
  function extractTag(a) {
    var cls = a.extract === 'ok' ? ' ok' : a.extract === 'error' || a.extract === 'no-file' ? ' warn' : ' muted';
    return h('span', { class: 'tag' + cls, title: a.note || '' }, C.EXTRACT_LABEL[a.extract] || a.extract);
  }
  function viewMake() {
    var s = st.settings, p = period(), cs = st.collect;
    var types = h('div', { class: 'seg big', role: 'radiogroup', 'aria-label': '보고 주기' }, L.REPORT_TYPES.map(function (t) {
      return h('label', { class: 'opt' }, h('input', { type: 'radio', name: 'rtype', value: t.id, checked: s.type === t.id, onchange: function () {
        s.type = t.id;
        if (cs && cs.period) s.refDay = cs.period.start;           // 수집한 기간에 맞춰 둔다
        st.approved = null; save(); render();
      } }), h('span', null, h('span', { class: 't' }, t.id === 'weekly' ? '주간 보고' : '월간 보고'), h('span', { class: 's' }, t.id === 'weekly' ? '금주 실적 · 차주 계획 · 이슈 (양식 표)' : '요약 · 실적 · 상태 · 차월 계획 · 이슈')));
    }));
    var ref = h('input', { type: 'date', value: s.refDay || today(), 'aria-label': '기준일', onchange: function (e) { s.refDay = e.target.value; st.approved = null; save(); render(); } });
    var cover = cs && cs.period ? C.periodCovered(cs.period, p) : null;

    var dirIn = h('input', { type: 'file', class: 'sr', webkitdirectory: true, multiple: true, onchange: function (e) { openFolderFiles(e.target.files); e.target.value = ''; } });
    var filesIn = h('input', { type: 'file', class: 'sr', multiple: true, accept: '.json,.js,.pdf,.ai,.docx,.pptx,.xlsx', onchange: function (e) { openFolderFiles(e.target.files); e.target.value = ''; } });

    var summary = null;
    if (cs) {
      var ax = cs.attachments || { total: 0, byExtract: {} }, bx = ax.byExtract || {};
      summary = h('div', null,
        h('div', { class: 'tiles' },
          h('div', { class: 'tile' }, h('div', { class: 'k' }, '모은 메일'), h('div', { class: 'v' }, cs.mails), h('div', { class: 'note' }, 'Online ' + cs.online + ' · Local(.pst) ' + cs.pst + ' · 보낸 메일 ' + cs.sent)),
          h('div', { class: 'tile' }, h('div', { class: 'k' }, '첨부'), h('div', { class: 'v' }, ax.total), h('div', { class: 'note' }, '글 뽑음 ' + ((bx.ok || 0) + (cs.pdfOk || 0)) + ' · 이름만 ' + (bx.meta || 0) + (bx.unsupported ? ' · 못 읽는 형식 ' + bx.unsupported : ''))),
          h('div', { class: 'tile' }, h('div', { class: 'k' }, '수집 기간'), h('div', { class: 'v small' }, cs.period.start.slice(5) + ' ~ ' + cs.period.end.slice(5)), h('div', { class: 'note' }, (cs.period.type === 'monthly' ? '월간' : '주간') + ' · ' + (cs.source === 'sample' ? '예시' : cs.source === 'auto' ? '자동 열기' : '폴더') + ' · ' + cs.generatedAt))),
        h('ul', { class: 'note' },
          cs.stores.map(function (x) { return h('li', null, (x.kind === 'pst' ? 'Local(.pst) · ' : 'Online 사서함 · ') + x.name + (x.scope ? ' (' + C.SCOPE_LABEL[x.scope] + ')' : '') + ' — 메일 ' + x.mails + '통' + (x.added ? ' (잠깐 열었다 닫음)' : '')); }),
          cs.skippedFolders.length ? h('li', null, '읽지 않은 폴더: ' + cs.skippedFolders.map(function (f) { return f.replace(/^\\\\[^\\]+\\/, ''); }).join(', ')) : null,
          cs.duplicates ? h('li', null, 'Online 과 .pst 에 함께 있던 같은 메일 ' + cs.duplicates + '통은 한 번만 담았습니다.') : null,
          cs.warnings.map(function (w) { return h('li', { class: 'warn-text' }, w); })),
        st.rollup.found.length ? h('p', { class: 'alert info' }, '받은 메일에서 업무보고 파일(.json) ' + st.rollup.found.length + '개를 찾았습니다. ', h('a', { href: '#/rollup' }, '「08 보고서 취합」에서 불러오기')) : null,
        cover && !cover.ok ? h('p', { class: 'alert warn' }, '고른 보고 기간(' + p.start + ' ~ ' + p.end + ')이 수집한 기간보다 넓습니다(' + cover.missing.join(', ') + ' 의 메일이 없음). ' + (s.type === 'monthly' ? '월간보고.bat' : '주간보고.bat') + ' 로 다시 모아 주세요.') : null);
    }

    var mailTable = st.mails.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('thead', null, h('tr', null, ['ID', '날짜', '보낸이', '제목', '위치', '첨부', '기간'].map(function (x) { return h('th', null, x); }))),
      h('tbody', null, st.mails.map(function (m) {
        var inside = L.inPeriod(m.day, p);
        return h('tr', null,
          h('td', null, h('a', { href: '#/mail/' + m.id }, m.id)),
          h('td', { class: 'nowrap' }, m.day + (m.time ? ' ' + m.time : '')),
          h('td', null, (m.direction === 'sent' ? '보냄 → ' + ((m.to[0] && (m.to[0].name || m.to[0].email)) || '') : (m.from.name || m.from.email))),
          h('td', null, m.subject || '(제목 없음)', m.warnings.length ? h('div', { class: 'tag warn' }, m.warnings[0]) : null),
          h('td', null, m.source === 'collect' ? h('span', { class: 'note' }, (m.storeKind === 'pst' ? '.pst · ' : 'Online · ') + m.folder) : h('span', { class: 'note' }, m.file || '직접 넣음')),
          h('td', null, (m.attachments || []).map(function (a) { return h('div', { class: 'att' }, a.name, ' ', a.extract ? extractTag(a) : null); })),
          h('td', null, h('span', { class: 'tag' + (inside ? ' ok' : ' muted') }, inside ? '기간 안' : '기간 밖')));
      })))) : h('p', { class: 'empty' }, '아직 메일이 없습니다.');

    return h('div', null,
      pageHead('02 · Auto Collect', '메일 자동 수집 · 보고서 만들기', '주간 · 월간을 고르고, 모은 메일 폴더를 열고, 「보고서 만들기」를 누르면 됩니다. 메일과 첨부는 이 PC 안에서만 읽습니다.'),
      busy ? h('p', { class: 'alert info', id: 'busyLine', 'aria-live': 'polite' }, busy) : null,
      h('section', { class: 'card step' }, h('h2', null, h('span', { class: 'step-no' }, '1'), '주간 · 월간 고르기'), types,
        h('div', { class: 'inline-row' }, h('span', { class: 'note' }, '보고 기간 '), h('strong', null, p ? (p.type === 'weekly' ? p.label : p.label + ' (' + p.start + ' ~ ' + p.end + ')') : '-'), h('span', { class: 'note' }, ' · 기준일 '), ref)),
      h('section', { class: 'card step' }, h('h2', null, h('span', { class: 'step-no' }, '2'), '모은 메일 열기'),
        h('p', { class: 'note' }, '압축을 푼 폴더의 ', h('strong', null, '주간보고.bat'), ' (또는 ', h('strong', null, '월간보고.bat'), ')를 더블클릭하면 이 PC 의 클래식 Outlook 에서 기간 안 메일(Online 사서함 + 열려 있는 .pst)과 첨부(워드 · PPT · 엑셀 · PDF · 그림 · 일러스트)를 모아 ',
          '이 화면을 자동으로 엽니다. 자동으로 열리지 않았거나 온라인 주소에서 쓸 때는 모은 폴더(문서\\업무보고_수집\\…)를 골라 주세요. ', h('a', { href: 'guide.html' }, '처음 쓰는 법')),
        h('div', { class: 'btn-row' },
          h('label', { class: 'btn btn-primary' }, '수집 폴더 열기', dirIn),
          h('label', { class: 'btn' }, '파일로 고르기(manifest.json · PDF)', filesIn),
          h('button', { class: 'btn', type: 'button', onclick: loadSample }, '예시 수집 결과로 해 보기')),
        summary),
      h('section', { class: 'card step' }, h('h2', null, h('span', { class: 'step-no' }, '3'), '보고서 만들기'),
        h('p', { class: 'note' }, '메일 본문과 첨부 글에서 실적 · 계획 · 이슈를 뽑아 업무별로 묶고, 주간보고 양식 표(Business Group · 프로젝트 · 금주 실적 · 차주 계획)로 만듭니다. 지난 보고서를 이 도구에서 승인해 두었다면 그 계획과도 비교합니다.'),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-primary btn-lg', type: 'button', disabled: !st.mails.length || !!busy, onclick: makeReport }, '보고서 만들기'),
          st.items.length ? h('a', { class: 'btn', href: '#/report' }, '만든 보고서 보기') : null),
        h('p', { class: 'note' }, 'AI 로 다듬기는 선택입니다 — 「04 실적 · 계획 · 이슈」의 프롬프트를 복사해 회사가 허용한 AI 에 붙여 넣거나, 사내 LLM 주소를 「01 보고 설정」에 넣어 자동으로 보냅니다.')),
      h('details', { class: 'card' }, h('summary', null, h('strong', null, '모은 메일 ' + st.mails.length + '통 보기')), mailTable),
      manualInputSection());
  }

  /* ── 대안: 직접 넣기(.eml · 붙여 넣기) — 수집기를 못 쓸 때 ── */
  function isOle(bytes) { return bytes.length > 8 && bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0; }
  function readFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    var parsed = [], skipped = [];
    var jobs = files.map(function (f) {
      return new Promise(function (res) {
        var r = new FileReader();
        r.onload = function () {
          var bytes = new Uint8Array(r.result), name = f.name, low = name.toLowerCase();
          try {
            if (/\.msg$/.test(low) || isOle(bytes)) skipped.push({ name: name, why: 'Outlook .msg 형식은 브라우저에서 읽을 수 없습니다' });
            else if (/\.txt$/.test(low)) parsed.push(L.mailFromPaste(L.decodeBytes(bytes, 'utf-8'), { file: name }));
            else parsed.push(L.parseEml(bytes, { file: name, keepBytes: true }));
          } catch (e) { skipped.push({ name: name, why: '읽는 중 오류: ' + e.message }); }
          res();
        };
        r.onerror = function () { skipped.push({ name: f.name, why: '파일을 열 수 없습니다' }); res(); };
        r.readAsArrayBuffer(f);
      });
    });
    Promise.all(jobs).then(function () {
      // .eml 안에 첨부 원본이 들어 있으면 그 글도 뽑는다(워드 · PPT · 엑셀 · PDF)
      var p = Promise.resolve();
      parsed.forEach(function (m) {
        (m.attachments || []).forEach(function (a) {
          a.kind = C.kindOf(a.name);
          if (!a._bytes) { a.extract = 'meta'; return; }
          var b = a._bytes; delete a._bytes;
          p = p.then(function () { return RD.fillAttachment(a, b); });
        });
      });
      return p;
    }).then(function () {
      var r = L.addMails(st.mails, C.slimForState(parsed));
      st.mails = r.mails; st.approved = null; save(); render();
      var msg = '메일 ' + r.added.length + '통을 넣었습니다.' + (r.duplicates.length ? ' 이미 있는 메일 ' + r.duplicates.length + '통은 건너뛰었습니다.' : '');
      if (skipped.length) dialog('읽지 못한 파일 ' + skipped.length + '개', [h('p', null, msg), h('ul', null, skipped.map(function (s) { return h('li', null, s.name + ' — ' + s.why); }))]);
      else toast(msg);
    });
  }
  function manualInputSection() {
    var fileIn = h('input', { type: 'file', multiple: true, class: 'sr', accept: '.eml,.msg,.txt,message/rfc822', onchange: function (e) { readFiles(e.target.files); e.target.value = ''; } });
    var drop = h('div', { class: 'drop', tabindex: '0',
      ondragover: function (e) { e.preventDefault(); drop.classList.add('over'); },
      ondragleave: function () { drop.classList.remove('over'); },
      ondrop: function (e) { e.preventDefault(); drop.classList.remove('over'); readFiles(e.dataTransfer.files); }
    }, h('strong', null, '.eml 파일을 여기에 끌어 놓거나'), h('label', { class: 'btn' }, '메일 파일 불러오기(여러 개)', fileIn),
      h('small', { class: 'hint' }, '.eml(첨부가 들어 있으면 첨부 글도 뽑음) · Outlook 에서 텍스트로 저장한 .txt'));
    var pasteTa = h('textarea', { rows: 6, placeholder: '메일 내용을 붙여 넣어 주세요. Outlook 에서 복사하면 「보낸 사람: / 보낸 날짜: / 제목:」 머리글도 함께 읽습니다.' });
    var pSubj = h('input', { type: 'text', placeholder: '머리글이 없으면 적어 주세요' });
    var pDay = h('input', { type: 'date' });
    var pFrom = h('input', { type: 'text', placeholder: '예: 홍길동 <a@b.com>' });
    function addPaste() {
      if (!pasteTa.value.trim()) { toast('붙여 넣은 내용이 없습니다.', true); return; }
      var m = L.mailFromPaste(pasteTa.value, { subject: pSubj.value.trim(), day: pDay.value, from: pFrom.value.trim() });
      if (!m.day) { toast('날짜를 읽지 못했습니다. 날짜 칸을 채워 주세요.', true); return; }
      var r = L.addMails(st.mails, [m]); st.mails = r.mails; st.approved = null; save();
      toast(r.added.length ? '메일 1통을 넣었습니다(' + r.added[0].id + ').' : '같은 메일이 이미 있습니다.');
      render();
    }
    return h('details', { class: 'card' }, h('summary', null, h('strong', null, '대안 — 직접 넣기(.eml · 붙여 넣기)'), h('span', { class: 'note' }, ' 수집기(.bat)를 쓸 수 없는 PC 에서')),
      h('p', { class: 'note' }, '새 Outlook · 웹 Outlook 은 메일을 열고 「…」 → 「다운로드」로 .eml 을 받을 수 있습니다. 여기 넣은 메일은 모은 메일과 함께 보고서에 씁니다.'),
      drop,
      h('div', { class: 'form-grid' }, field('제목', pSubj), field('보낸 날짜', pDay), field('보낸이', pFrom)),
      field('메일 내용', pasteTa), h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', onclick: addPaste }, '붙여 넣은 메일 넣기')));
  }
  function viewMail(id) {
    var m = mailById(id);
    if (!m) return h('div', null, pageHead('메일', '메일을 찾지 못했습니다', null), h('a', { class: 'btn', href: '#/make' }, '메일 목록으로'));
    var full = h('pre', { class: 'mail-body', hidden: true }, m.text);
    var t = L.taskOfMail(tasksNow(), m.id);
    var used = st.items.filter(function (x) { return x.evidence.indexOf(m.id) >= 0 && !x.excluded; });
    return h('div', null,
      pageHead('근거 메일 · ' + m.id, m.subject || '(제목 없음)', null, h('div', { class: 'btn-row no-print' },
        h('button', { class: 'btn', type: 'button', onclick: function () { history.back(); } }, '뒤로'), h('a', { class: 'btn', href: '#/make' }, '메일 목록'))),
      h('section', { class: 'card' },
        h('dl', { class: 'kvs' },
          h('dt', null, '보낸이'), h('dd', null, (m.from.name ? m.from.name + ' ' : '') + (m.from.email ? '<' + m.from.email + '>' : '')),
          h('dt', null, '받는이'), h('dd', null, m.to.map(function (a) { return a.name || a.email; }).join(', ') || '-'),
          m.cc.length ? [h('dt', null, '참조'), h('dd', null, m.cc.map(function (a) { return a.name || a.email; }).join(', '))] : null,
          h('dt', null, '날짜'), h('dd', null, m.day + (m.time ? ' ' + m.time : '')),
          h('dt', null, '정규화 제목'), h('dd', null, m.subjectNorm),
          h('dt', null, '업무'), h('dd', null, t ? t.project + ' · ' + t.name + ' (' + t.id + ')' : '-'),
          h('dt', null, '위치'), h('dd', null, m.source === 'collect' ? (m.storeKind === 'pst' ? 'Local(.pst) · ' : 'Online 사서함 · ') + m.store + ' › ' + m.folder + (m.direction === 'sent' ? ' (보낸 메일)' : '') : (m.file || '직접 넣음'))),
        m.warnings.length ? h('div', { class: 'alert warn' }, m.warnings.join(' ')) : null),
      (m.attachments || []).length ? h('section', { class: 'card' }, h('h2', null, '첨부 ' + m.attachments.length + '개'),
        m.attachments.map(function (a) {
          return h('details', { class: 'att-detail' }, h('summary', null, a.name + ' (' + (C.KIND_LABEL[a.kind] || a.kind || '파일') + ' · ' + Math.max(1, Math.round((a.size || 0) / 1024)) + 'KB) ', a.extract ? extractTag(a) : null),
            a.note ? h('p', { class: 'note' }, a.note) : null,
            a.text ? h('pre', { class: 'mail-body' }, a.text + (a.text.length >= C.STATE_TEXT_CAP ? '\n…(앞 ' + C.STATE_TEXT_CAP + '자만 보관)' : '')) : h('p', { class: 'note' }, '뽑은 글이 없습니다.'));
        })) : null,
      h('section', { class: 'card' }, h('h2', null, '이번 메일에서 새로 쓴 내용'), h('pre', { class: 'mail-body' }, m.main || '(없음)'),
        m.text !== m.main ? h('button', { class: 'btn btn-sm', type: 'button', onclick: function (e) { full.hidden = !full.hidden; e.target.textContent = full.hidden ? '인용문 포함 전체 보기' : '전체 닫기'; } }, '인용문 포함 전체 보기') : null, full),
      h('section', { class: 'card' }, h('h2', null, '이 메일을 근거로 한 항목 ' + used.length + '건'),
        used.length ? h('ul', null, used.map(function (x) { return h('li', null, '[' + x.category + '·' + x.status + '] ' + x.text); })) : h('p', { class: 'note' }, '없습니다.')));
  }

  /* ── 03 업무 그룹 ─────────────────────── */
  function viewTasks() {
    var tasks = tasksNow(), p = period(), items = L.markConflicts(itemsNow(tasks));
    if (!st.mails.length) return h('div', null, pageHead('03 · Task Analyzer', '업무 그룹', null), h('p', { class: 'empty' }, '메일을 먼저 넣어 주세요.'), h('a', { class: 'btn btn-primary', href: '#/make' }, '메일 자동 수집으로'));
    var names = L.cleanProjects(st.projects).map(function (x) { return x.name; });
    tasks.forEach(function (t) { if (names.indexOf(t.project) < 0) names.push(t.project); });
    if (names.indexOf(L.OTHER_PROJECT) < 0) names.push(L.OTHER_PROJECT);
    var groups = {};
    tasks.forEach(function (t) { (groups[t.project] = groups[t.project] || []).push(t); });
    return h('div', null,
      pageHead('03 · Task Analyzer', '업무 그룹', '회신·전달로 이어진 메일과 제목이 같은 메일(RE:·FW: 등을 뗀 제목)을 한 업무로 묶고, 프로젝트 키워드로 나눴습니다. 잘못 묶인 프로젝트는 바꿔 주세요.'),
      Object.keys(groups).map(function (pj) {
        return h('section', { class: 'card' }, h('h2', null, pj + ' · 업무 ' + groups[pj].length + '건'),
          h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
            h('thead', null, h('tr', null, ['업무', '메일', '기간', '현재 상태', '첨부', '프로젝트'].map(function (x) { return h('th', null, x); }))),
            h('tbody', null, groups[pj].map(function (t) {
              var ts = L.taskStatus(t, items, st.mails);
              var inside = t.mailIds.filter(function (id) { var m = mailById(id); return m && L.inPeriod(m.day, p); }).length;
              return h('tr', null,
                h('td', null, h('strong', null, t.name), h('div', { class: 'note' }, t.id + (inside < t.mailIds.length ? ' · 기간 밖 메일 ' + (t.mailIds.length - inside) + '통 포함' : ''))),
                h('td', null, t.mailIds.map(function (id) { return h('a', { class: 'evlink', href: '#/mail/' + id }, id); })),
                h('td', { class: 'nowrap' }, t.first === t.last ? t.first : t.first + ' ~ ' + t.last),
                h('td', null, h('span', { class: 'tag' + (ts.status === '완료' ? ' ok' : ts.status === '지연' || ts.status === '확인 필요' ? ' warn' : '') }, ts.status),
                  ts.history.length > 1 ? h('div', { class: 'note' }, ts.history.map(function (x) { return x.day.slice(5) + ' ' + x.status; }).join(' → ')) : null),
                h('td', null, t.attachments.map(function (a) { return h('div', { class: 'att' }, a); })),
                h('td', null, selectEl(names, t.project, function (e) { st.taskProject = st.taskProject || {}; st.taskProject[t.key] = e.target.value; st.items.forEach(function (x) { if (x.evidence.some(function (id) { return t.mailIds.indexOf(id) >= 0; })) x.project = e.target.value; }); save(); render(); })));
            }))))) ;
      }),
      h('p', { class: 'note' }, '현재 상태 = 가장 최근 근거의 상태. 상태가 바뀐 이력은 화살표로 남깁니다. 메일끼리 내용이 상충하면 「확인 필요」로 둡니다(기획서 3.3).'),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn btn-primary', href: '#/classify' }, '다음: 실적·계획·이슈 분류')));
  }

  /* ── 04 실적·계획·이슈 ────────────────── */
  var catFilter = '전체', aiPreview = null;
  function runRules(silent) {
    var tasks = tasksNow();
    var body = L.ruleItems(st.mails, tasks);
    // data09-27: 첨부 파일 글에서도 업무 문장을 뽑는다(같은 메일 본문과 비슷한 문장은 뺌) — 「첨부 근거」 표시
    var rule = body.concat(C.attachmentItems(st.mails, tasks, body, L));
    // 사용자가 이미 고친 규칙 항목은 문장·근거가 같으면 고친 값을 지킨다
    var old = {}; st.items.filter(function (x) { return x.origin === 'rule'; }).forEach(function (x) { old[x.evidence.join(',') + '|' + x.text] = x; });
    rule = rule.map(function (x) { var o = old[x.evidence.join(',') + '|' + x.text]; return o && (o.reviewed || o.edited || o.excluded) ? Object.assign(x, { category: o.category, status: o.status, project: o.project, date: o.date, reviewed: o.reviewed, edited: o.edited, excluded: o.excluded, note: o.note }) : x; });
    st.items = st.items.filter(function (x) { return x.origin !== 'rule'; }).concat(rule);
    st.approved = null; save();
    if (!silent) toast('규칙으로 ' + rule.length + '건(첨부에서 ' + (rule.length - body.length) + '건)을 뽑았습니다. 표에서 확인·수정해 주세요.');
  }
  function newItemId(prefix) {
    var max = 0; st.items.forEach(function (x) { var m = new RegExp('^' + prefix + '(\\d+)$').exec(x.id); if (m) max = Math.max(max, +m[1]); });
    return prefix + String(max + 1).padStart(3, '0');
  }
  function viewClassify() {
    var tasks = tasksNow(), p = period();
    var items = L.markConflicts(itemsNow(tasks));
    var shown = items.filter(function (x) {
      if (catFilter === '확인 필요') return !x.excluded && (x.status === '확인 필요' || x.conflict || !x.explicit || !x.evidence.length);
      return catFilter === '전체' || x.category === catFilter;
    });
    function upd(id, patch) { st.items.forEach(function (x) { if (x.id === id) { Object.assign(x, patch); x.edited = true; } }); st.approved = null; save(); }
    var tabs = h('div', { class: 'seg', role: 'tablist' }, ['전체', '실적', '계획', '이슈', '확인 필요'].map(function (c) {
      var n = c === '전체' ? items.length : c === '확인 필요' ? items.filter(function (x) { return !x.excluded && (x.status === '확인 필요' || x.conflict || !x.explicit || !x.evidence.length); }).length : items.filter(function (x) { return x.category === c; }).length;
      return h('button', { class: 'btn btn-sm' + (catFilter === c ? ' btn-primary' : ''), type: 'button', role: 'tab', 'aria-selected': catFilter === c ? 'true' : 'false', onclick: function () { catFilter = c; render(); } }, c + ' ' + n);
    }));
    var table = shown.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'list items' },
      h('thead', null, h('tr', null, ['분류', '상태', '프로젝트', '내용', '날짜', '근거', '표시', '확인', '제외'].map(function (x) { return h('th', null, x); }))),
      h('tbody', null, shown.map(function (x) {
        var inside = x.evidence.some(function (e) { var m = mailById(e); return m && L.inPeriod(m.day, p); });
        return h('tr', { class: (x.excluded ? 'excluded' : '') + (!x.explicit ? ' inferred' : '') },
          h('td', null, selectEl(L.CATEGORIES, x.category, function (e) { upd(x.id, { category: e.target.value }); render(); })),
          h('td', null, selectEl(L.STATUSES, x.status, function (e) { upd(x.id, { status: e.target.value }); render(); })),
          h('td', null, h('input', { type: 'text', value: x.project, 'aria-label': '프로젝트', onchange: function (e) { upd(x.id, { project: e.target.value.trim() || L.OTHER_PROJECT }); } })),
          h('td', { class: 'wide' }, h('textarea', { rows: 2, 'aria-label': '내용', onchange: function (e) { upd(x.id, { text: e.target.value.trim() }); } }, x.text),
            x.conflict ? h('div', { class: 'tag warn' }, x.conflict) : null, x.note ? h('div', { class: 'note' }, x.note) : null),
          h('td', null, h('input', { type: 'date', value: x.date || '', 'aria-label': '날짜', onchange: function (e) { upd(x.id, { date: e.target.value }); } })),
          h('td', null, x.evidence.map(function (e) { return h('a', { class: 'evlink', href: '#/mail/' + e }, e); }), inside ? null : h('div', { class: 'tag muted' }, '기간 밖')),
          h('td', null, h('div', { class: 'tags' }, h('span', { class: 'tag muted' }, L.ORIGINS[x.origin] || x.origin), L.flagText(x).map(function (f) { return h('span', { class: 'tag warn' }, f); }))),
          h('td', null, h('input', { type: 'checkbox', checked: !!x.reviewed, 'aria-label': '확인함', onchange: function (e) { upd(x.id, { reviewed: e.target.checked }); } })),
          h('td', null, h('input', { type: 'checkbox', checked: !!x.excluded, 'aria-label': '보고서에서 제외', onchange: function (e) { upd(x.id, { excluded: e.target.checked }); render(); } })));
      })))) : h('p', { class: 'empty' }, st.items.length ? '이 분류에 해당하는 항목이 없습니다.' : '아직 항목이 없습니다. 「규칙으로 분류」를 누르거나 AI 반자동을 써 주세요.');

    // 직접 입력
    var mCat = selectEl(L.CATEGORIES, '실적'), mSt = selectEl(L.STATUSES, '완료'), mPj = h('input', { type: 'text', placeholder: '프로젝트' }), mTx = h('input', { type: 'text', placeholder: '보고서에 쓸 한 문장' }), mEv = h('input', { type: 'text', placeholder: '예: E003, E005 (없으면 비움)' });
    function addManual() {
      if (!mTx.value.trim()) { toast('내용을 적어 주세요.', true); return; }
      var ev = mEv.value.split(/[,\s]+/).map(function (x) { return x.trim().toUpperCase(); }).filter(function (x) { return mailById(x); });
      st.items.push({ id: newItemId('M'), origin: 'manual', category: mCat.value, status: mSt.value, text: mTx.value.trim(), project: mPj.value.trim() || L.OTHER_PROJECT, taskName: '', date: '', dates: [], evidence: ev, keywords: [], decision: false, explicit: true, reviewed: true, conflict: '', note: ev.length ? '' : '근거 메일 없이 직접 입력' });
      st.approved = null; save(); render();
    }

    // AI 반자동
    var mask = h('input', { type: 'checkbox', checked: true });
    var onlyIn = h('input', { type: 'checkbox', checked: true });
    var promptTa = h('textarea', { rows: 8, readonly: true, class: 'mono' });
    function makePrompt() {
      var ms = onlyIn.checked ? periodMails() : st.mails;
      promptTa.value = L.aiPrompt(ms, p, st.projects, { mask: mask.checked });
      return promptTa.value;
    }
    makePrompt();
    mask.addEventListener('change', makePrompt); onlyIn.addEventListener('change', makePrompt);
    var answerTa = h('textarea', { rows: 6, class: 'mono', placeholder: 'AI 의 답(JSON)을 그대로 붙여 넣어 주세요. ```json … ``` 으로 감싸져 있어도 됩니다.' });
    var previewBox = h('div');
    function readAnswer() {
      try {
        aiPreview = L.parseAiItems(answerTa.value, st.mails, tasks);
        previewBox.innerHTML = '';
        append(previewBox, [h('p', { class: 'alert info' }, 'AI 항목 ' + aiPreview.items.length + '건을 읽었습니다' + (aiPreview.errors.length ? ' · 걸러 낸 것 ' + aiPreview.errors.length + '건' : '') + '.'),
          aiPreview.errors.length ? h('ul', { class: 'note' }, aiPreview.errors.map(function (e) { return h('li', null, e); })) : null,
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn btn-primary', type: 'button', onclick: function () { applyAi(true); } }, '기존 AI 항목을 이것으로 바꾸기'),
            h('button', { class: 'btn', type: 'button', onclick: function () { applyAi(false); } }, '기존 항목에 더하기'))]);
      } catch (e) { previewBox.innerHTML = ''; previewBox.appendChild(h('p', { class: 'alert warn' }, '읽지 못했습니다: ' + e.message)); }
    }
    function applyAi(replace) {
      if (!aiPreview) return;
      if (replace) st.items = st.items.filter(function (x) { return x.origin !== 'ai'; });
      aiPreview.items.forEach(function (x) { x.id = newItemId('A'); st.items.push(x); });
      aiPreview = null; st.approved = null; save(); toast('AI 항목을 넣었습니다. 「AI 추출(검토 필요)」 표시를 확인해 주세요.'); render();
    }

    return h('div', null,
      pageHead('04 · AI Analysis', '실적 · 계획 · 이슈 분류', '1차는 규칙(낱말)으로 뽑고, 필요하면 AI 반자동으로 보강합니다. 모든 항목에 근거 메일을 붙이고, 완료가 분명하지 않은 것은 「확인 필요」로 둡니다.',
        h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: function () { runRules(); render(); } }, st.items.some(function (x) { return x.origin === 'rule'; }) ? '규칙으로 다시 분류' : '규칙으로 분류'))),
      h('section', { class: 'card' }, h('h2', null, '업무 항목'), tabs, table,
        h('p', { class: 'note' }, '기울임 행 = AI 가 문맥으로 추론한 내용. 「확인」에 표시하면 확인 필요 알림에서 빠집니다. 「제외」는 보고서에만 빠지고 기록은 남습니다.')),
      h('section', { class: 'card' }, h('h2', null, '직접 입력'),
        h('div', { class: 'form-grid' }, field('분류', mCat), field('상태', mSt), field('프로젝트', mPj), field('근거 메일 ID', mEv)),
        field('내용', mTx), h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', onclick: addManual }, '항목 추가'))),
      h('section', { class: 'card' }, h('h2', null, 'AI 반자동 추출'),
        h('div', { class: 'alert warn' }, '외부 AI(ChatGPT 등)에 메일 내용과 첨부 글을 붙여 넣기 전에 회사 보안정책에서 허용한 서비스인지 확인해 주세요. 사내 온프레미스 LLM 이 OpenAI 호환 API 를 열어 두었다면 「01 보고 설정 → AI 연결 설정」에 주소·모델을 넣고 「설정한 AI 서버로 보내기」를 쓰면 메일이 사내망 밖으로 나가지 않습니다.'),
        h('div', { class: 'btn-row' }, h('label', { class: 'opt' }, mask, h('span', null, h('span', { class: 't' }, '메일주소·전화번호 가리기'))), h('label', { class: 'opt' }, onlyIn, h('span', null, h('span', { class: 't' }, '보고 기간 안 메일만')))),
        h('ol', { class: 'steps' },
          h('li', null, '아래 프롬프트를 복사해 AI 에 붙여 넣어 주세요. ', h('button', { class: 'btn btn-sm', type: 'button', onclick: function () { copyText(makePrompt()); } }, '프롬프트 복사'), ' ',
            window.AIPanel ? AIPanel.sendButton('설정한 AI 서버로 보내기', makePrompt, function (t) { answerTa.value = t; readAnswer(); toast('AI 서버의 답을 읽었습니다. 아래 미리보기를 확인해 주세요.'); }, { toast: toast, settingsHref: '#/setup' }) : null),
          h('li', null, 'AI 가 준 JSON 답을 아래 칸에 붙여 넣고 「AI 답 읽기」를 눌러 주세요.'),
          h('li', null, '없는 메일 ID·허용 밖 값은 자동으로 걸러 「확인 필요」로 낮춥니다. 표에서 검토해 주세요.')),
        field('프롬프트', promptTa), field('AI 답', answerTa),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: readAnswer }, 'AI 답 읽기')), previewBox),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn btn-primary', href: '#/carry' }, '다음: 이전 계획 대비')));
  }

  /* ── 05 이전 계획 대비 ────────────────── */
  function viewCarry() {
    var p = period(), tasks = tasksNow();
    var fromHist = L.plansFromHistory(st.history, p);
    var ta = h('textarea', { rows: 6, placeholder: '이전 보고서의 계획을 한 줄에 하나씩 붙여 넣어 주세요. 「[프로젝트] 내용」 형식이면 프로젝트도 읽습니다.', onchange: function (e) { st.prevPlansText = e.target.value; st.approved = null; save(); render(); } }, st.prevPlansText);
    var carry = carryNow(tasks);
    var table = carry.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('thead', null, h('tr', null, ['이전 계획', '제안', '확정', '이유 · 연결 항목', '유사도'].map(function (x) { return h('th', null, x); }))),
      h('tbody', null, carry.map(function (c) {
        return h('tr', null,
          h('td', null, (c.plan.project ? '[' + c.plan.project + '] ' : '') + c.plan.text),
          h('td', null, h('span', { class: 'tag' + (c.suggest === '완료' ? ' ok' : c.suggest === '진행' ? '' : ' warn') }, c.suggest)),
          h('td', null, selectEl([{ value: '', label: '제안 따름' }, '완료', '진행', '지연', '이월'], c.final || '', function (e) {
            if (e.target.value) st.carryFinal[c.key] = e.target.value; else delete st.carryFinal[c.key];
            st.approved = null; save(); render();
          })),
          h('td', null, c.reason, c.match ? h('div', { class: 'note' }, '→ ' + c.match.text + ' ', c.match.evidence.map(function (e) { return h('a', { class: 'evlink', href: '#/mail/' + e }, e); })) : null),
          h('td', { class: 'num' }, c.sim.toFixed(2)));
      })))) : h('p', { class: 'empty' }, '비교할 이전 계획이 없습니다.');
    return h('div', null,
      pageHead('05 · Continuity', '이전 보고서 계획 대비', '지난 보고서의 계획이 이번 기간에 완료·진행·지연됐는지, 아니면 이월인지 제안합니다. 제안은 확정이 아니니 「확정」 칸에서 골라 주세요.'),
      h('section', { class: 'card' }, h('h2', null, '이전 보고서 계획'),
        fromHist ? h('p', { class: 'alert info' }, '승인 이력에 ' + fromHist.entry.period.start + ' ~ ' + fromHist.entry.period.end + ' 보고서가 있습니다(계획 ' + fromHist.entry.plans.length + '건). ',
          h('button', { class: 'btn btn-sm', type: 'button', onclick: function () { st.prevPlansText = fromHist.text; st.carryFinal = {}; st.approved = null; save(); render(); } }, '이력에서 가져오기')) :
          h('p', { class: 'note' }, '이 도구에서 승인한 이전 보고서가 없습니다. 지난 보고서의 계획을 붙여 넣어 주세요.'),
        field('계획 목록', ta)),
      h('section', { class: 'card' }, h('h2', null, '비교 결과'), table,
        h('p', { class: 'note' }, '판정 기준: 비슷한 항목(글자 2-gram 유사도 0.3 이상)이 이슈면 지연, 완료 실적이면 완료, 완료가 확인되지 않은 실적이면 진행, 다시 계획으로 나오거나 찾지 못하면 이월.')),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn btn-primary', href: '#/report' }, '다음: 보고서 초안')));
  }

  /* ── 06 보고서 초안 ───────────────────── */
  function exportDocx(rep, name) {
    if (!window.XLSX || !XLSX.CFB) { toast('.docx 를 만들 라이브러리를 찾지 못했습니다. Word(.doc)로 내려받아 주세요.', true); return; }
    var parts = L.docxParts(rep), cfb = XLSX.CFB.utils.cfb_new(), enc = new TextEncoder();
    Object.keys(parts).forEach(function (p) { XLSX.CFB.utils.cfb_add(cfb, '/' + p, enc.encode(parts[p])); });
    var out = XLSX.CFB.write(cfb, { fileType: 'zip', type: 'array' });
    download(name || fname(rep, 'docx'), new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
  }
  /* 보고서 파일(.json) — 윗단계(파트리더 · 팀장 · 임원)에게 보내는 파일. 메일 본문 · 첨부 글은 넣지 않습니다 */
  function exportPackage(rep) {
    if (!st.settings.author) { toast('「01 보고 설정」에서 작성자 이름을 먼저 적어 주세요. 받는 사람이 누구의 보고인지 알 수 있게 파일에 넣습니다.', true); return; }
    var pkg = R.makePackage(rep, { level: st.settings.level, author: st.settings.author, unit: st.settings.title, generatedAt: nowStamp() });
    var name = R.packageFileName(pkg).replace(/\.json$/, fileTag() + '.json');
    download(name, new Blob([JSON.stringify(pkg, null, 1)], { type: 'application/json' }));
    sendGuide(pkg, name, R.nextLevel(st.settings.level));
  }
  /* 내려받은 뒤 — 메일에 첨부해 윗단계로 보내는 짧은 안내(2026-09-30 「메일로 송/수신」). 이 도구는 메일을 보내지 않습니다 */
  function sendGuide(pkg, name, up) {
    var d = R.mailDraft(pkg, name);
    dialog('보고서 파일을 메일로 보내기', [
      h('p', null, '내려받은 파일: ', h('strong', null, name), h('br'), h('small', { class: 'note' }, '브라우저의 「다운로드」 폴더에 있습니다.')),
      h('ol', null,
        h('li', null, 'Outlook 에서 새 메일을 열거나, 보고 요청 메일에 「회신」을 누릅니다. 받는 사람에 ' + (up || '받는 사람') + '을(를) 넣습니다.'),
        h('li', null, '「파일 첨부」 → 다운로드 폴더의 위 파일을 고릅니다(파일을 메일 창으로 끌어다 놓아도 됩니다).'),
        h('li', null, '보내기. 받는 사람이 주간보고.bat(월간보고.bat)로 메일을 모으면 「08 보고서 취합」에 이 파일이 자동으로 나타납니다.')),
      h('p', { class: 'note' }, '아래 버튼은 제목 · 본문만 채운 새 메일을 엽니다. 메일 링크(mailto)로는 파일을 첨부할 수 없어서 2번은 직접 해 주세요. 기본 메일 프로그램이 Outlook 이 아니면 다른 프로그램이 열릴 수 있습니다.'),
      h('div', { class: 'btn-row' },
        h('a', { class: 'btn btn-primary', href: d.href }, '제목을 채운 새 메일 열기'),
        h('button', { class: 'btn', type: 'button', onclick: function () { copyText(d.subject); } }, '메일 제목 복사')),
      h('p', { class: 'note' }, '제목: ' + d.subject)]);
  }
  function fname(rep, ext) { return (rep.type === 'monthly' ? '월간업무보고_' : '주간업무보고_') + (rep.period ? rep.period.start.replace(/-/g, '') : '') + (rep.approved ? '' : '_초안') + fileTag() + '.' + ext; }
  function exportXlsx(rep) {
    var tasks = tasksNow();
    var sheets = L.reportSheets(rep, L.markConflicts(itemsNow(tasks)), st.mails, tasks), wb = XLSX.utils.book_new();
    sheets.forEach(function (s) { XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.aoa), s.name); });
    XLSX.writeFile(wb, fname(rep, 'xlsx'));
  }
  function viewReport() {
    var rep = reportNow();
    var sumTa = h('textarea', { rows: 4, placeholder: '비워 두면 계산한 요약을 씁니다. 한 줄에 한 문장.', onchange: function (e) { st.summaryOverride = e.target.value; st.approved = null; save(); render(); } }, st.summaryOverride);
    var paper = h('div', { class: 'card paper', html: L.reportBodyHtml(rep, { linkBase: '#/mail/', anchorPrefix: 'ev-' }) });
    var unchecked = st.items.filter(function (x) { return !x.excluded && !x.reviewed && (x.status === '확인 필요' || x.explicit === false || !x.evidence.length); }).length;
    return h('div', null,
      pageHead('06 · Report Preview · Approval', '보고서 초안', '근거 메일 ID(파란 글씨)를 누르면 원문 메일을 봅니다. 고칠 내용은 「04 실적·계획·이슈」에서 고치면 여기에 바로 반영됩니다.',
        h('div', { class: 'btn-row no-print' },
          h('button', { class: 'btn', type: 'button', onclick: function () { window.print(); } }, '인쇄 · PDF'),
          h('button', { class: 'btn', type: 'button', onclick: function () { exportDocx(rep); } }, 'Word(.docx)'),
          h('button', { class: 'btn', type: 'button', onclick: function () { download(fname(rep, 'doc'), new Blob(['﻿' + L.reportWordHtml(rep)], { type: 'application/msword' })); } }, 'Word(.doc)'),
          h('button', { class: 'btn', type: 'button', onclick: function () { exportXlsx(rep); } }, 'Excel(.xlsx)'),
          h('button', { class: 'btn', type: 'button', onclick: function () { download(fname(rep, 'html'), new Blob([L.reportHtml(rep)], { type: 'text/html' })); } }, 'HTML'),
          R.nextLevel(st.settings.level) ? h('button', { class: 'btn btn-primary', type: 'button', onclick: function () { exportPackage(rep); } }, '보고서 파일(.json) — ' + R.nextLevel(st.settings.level) + '에게') : null)),
      h('section', { class: 'card no-print' }, h('h2', null, '검토 · 승인'),
        h('div', { class: 'tiles' },
          h('div', { class: 'tile' }, h('div', { class: 'k' }, '실적'), h('div', { class: 'v' }, rep.counts.performance)),
          h('div', { class: 'tile' }, h('div', { class: 'k' }, '계획'), h('div', { class: 'v' }, rep.counts.plan)),
          h('div', { class: 'tile' }, h('div', { class: 'k' }, '이슈'), h('div', { class: 'v' }, rep.counts.issue)),
          h('div', { class: 'tile' }, h('div', { class: 'k' }, '확인 필요 표시'), h('div', { class: 'v' }, rep.counts.check))),
        unchecked ? h('p', { class: 'alert warn' }, '아직 확인하지 않은 항목(확인 필요·AI 추론·근거 없음)이 ' + unchecked + '건 있습니다. ', h('a', { href: '#/classify', onclick: function () { catFilter = '확인 필요'; } }, '확인하러 가기')) : null,
        field('요약 문장 직접 쓰기(선택)', sumTa),
        h('div', { class: 'btn-row' },
          st.approved ? [h('span', { class: 'tag ok' }, '승인됨 ' + st.approved), h('button', { class: 'btn', type: 'button', onclick: function () { st.approved = null; save(); render(); } }, '승인 취소')] :
            h('button', { class: 'btn btn-primary', type: 'button', onclick: function () {
              if (!rep.period) { toast('보고 기간을 먼저 정해 주세요.', true); return; }
              confirmBox('보고서 승인', '이 보고서를 승인하고 이력에 남길까요? 승인한 보고서의 계획은 다음 보고 때 「이전 계획 대비」에 씁니다.' + (unchecked ? ' (확인하지 않은 항목 ' + unchecked + '건이 있습니다)' : ''), '승인', function () {
                st.approved = nowStamp();
                var r2 = reportNow(), e = L.historyEntry(r2, st.approved);
                st.history = st.history.filter(function (x) { return !(x.type === e.type && x.period.start === e.period.start); }).concat([e]);
                save(); toast('승인했습니다. 이제 내려받은 파일에는 「초안」 표시가 빠집니다.'); render();
              });
            } }, '승인하고 이력에 남기기')),
        h('p', { class: 'note' }, '이 도구는 메일을 보내지 않습니다. 승인한 파일을 직접 저장하거나 전달해 주세요(기획서 7.2 — 발송은 승인 이후).'),
        R.nextLevel(st.settings.level) ? h('p', { class: 'note' }, '「보고서 파일(.json)」은 ' + R.nextLevel(st.settings.level) + '가 「08 보고서 취합」에서 여러 사람 것을 한 장으로 모을 때 쓰는 파일입니다. 보고서 항목 · 근거 메일의 날짜 · 제목만 들어 있고 메일 본문 · 첨부 글은 들어 있지 않습니다. 승인한 뒤 내려받으면 「초안」 표시가 빠집니다.') : null),
      paper);
  }

  /* ── 07 이력·백업 ─────────────────────── */
  function viewHistory() {
    var restoreIn = h('input', { type: 'file', accept: '.json,application/json', onchange: function (e) {
      var f = e.target.files[0]; if (!f) return;
      f.text().then(function (t) {
        try { var p = JSON.parse(t); if (!p || !p.settings) throw new Error('업무보고 백업 파일이 아닙니다'); st = L.restoreState(p); save(); toast('복원했습니다.'); render(); }
        catch (err) { toast('복원하지 못했습니다: ' + err.message, true); }
      });
      e.target.value = '';
    } });
    return h('div', null,
      pageHead('07 · Analysis History', '이력 · 백업', '승인한 보고서의 이력과 백업입니다. 데이터는 이 브라우저(localStorage)에만 있습니다.'),
      h('section', { class: 'card' }, h('h2', null, '승인 이력 ' + st.history.length + '건'),
        st.history.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
          h('thead', null, h('tr', null, ['유형', '기간', '승인', '실적', '계획', '이슈', ''].map(function (x) { return h('th', null, x); }))),
          h('tbody', null, st.history.slice().sort(function (a, b) { return b.period.start.localeCompare(a.period.start); }).map(function (x) {
            return h('tr', null, h('td', null, x.type === 'monthly' ? '월간' : '주간'), h('td', null, x.period.start + ' ~ ' + x.period.end), h('td', null, x.approved),
              h('td', { class: 'num' }, x.counts.performance), h('td', { class: 'num' }, x.counts.plan), h('td', { class: 'num' }, x.counts.issue),
              h('td', null, h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: function () { confirmBox('이력 삭제', x.period.start + ' 보고 이력을 지울까요?', '삭제', function () { st.history = st.history.filter(function (y) { return y !== x; }); save(); render(); }, true); } }, '삭제')));
          })))) : h('p', { class: 'note' }, '아직 승인한 보고서가 없습니다.')),
      h('section', { class: 'card' }, h('h2', null, '백업 · 복원'),
        h('p', { class: 'note' }, 'JSON 백업에는 메일 본문도 들어 있습니다. 공유 폴더에 둘 때는 사내 정책을 확인해 주세요.'),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', type: 'button', onclick: function () { download('업무보고_백업_' + today().replace(/-/g, '') + fileTag() + '.json', new Blob([JSON.stringify(st, null, 1)], { type: 'application/json' })); } }, 'JSON 백업 내려받기'),
          h('label', { class: 'btn' }, 'JSON 복원', restoreIn)),
        h('hr'),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', type: 'button', onclick: loadSample }, '예시로 해 보기'),
          h('button', { class: 'btn btn-danger', type: 'button', onclick: function () { confirmBox('모두 지우기', '메일·항목·이력·설정을 모두 지울까요? 되돌릴 수 없습니다.', '모두 지우기', function () { st = L.emptyState(); save(); render(); }, true); } }, '모두 지우기'))));
  }

  /* ── 08 보고서 취합 (2026-09-30 답변 — 팀원 → 파트리더 → 팀장 → 담당 임원) ──
     아래 단계에서 받은 보고서 파일(.json)을 모아 한 장으로. 파일은 브라우저 안에서만 읽습니다(서버 없음). */
  function ownPackage() {
    if (!st.items.length || !st.settings.author) return null;
    return R.parsePackage(JSON.stringify(R.makePackage(reportNow(), { level: st.settings.level, author: st.settings.author, unit: st.settings.title })));
  }
  function rollupNow() {
    var ru = st.rollup, own = ru.includeOwn ? ownPackage() : null;
    if (!ru.sources.length && !own) return null;
    return R.mergePackages(ru.sources, { level: st.settings.level, author: st.settings.author, unit: st.settings.title, now: nowStamp(), approved: ru.approved, own: own, boardStyle: st.settings.boardStyle });
  }
  function sameSource(a, b) { return a.author === b.author && a.unit === b.unit && a.period.start === b.period.start && a.generatedAt === b.generatedAt; }
  function addPackage(p) { st.rollup.sources = st.rollup.sources.filter(function (x) { return !sameSource(x, p); }); st.rollup.sources.push(p); }
  /* 받은 메일에서 찾은 보고서 파일 — 고른 것 불러오기 */
  var foundPick = {};
  function foundDefault(f) { return !f.mine && !st.rollup.sources.some(function (x) { return sameSource(x, f.pkg); }); }
  function loadFound() {
    var list = st.rollup.found.filter(function (f) { return foundPick[f.key] != null ? foundPick[f.key] : foundDefault(f); });
    if (!list.length) { toast('불러올 파일을 골라 주세요.', true); return; }
    list.forEach(function (f) { addPackage(Object.assign(JSON.parse(JSON.stringify(f.pkg)), { _name: f.name + ' (메일 ' + f.day.slice(5) + ' ' + f.time + ' · ' + f.from + ')' })); });
    foundPick = {}; st.rollup.approved = null; save(); render();
    toast('받은 메일의 보고서 파일 ' + list.length + '개를 넣었습니다.');
  }
  function foundSection() {
    var fl = st.rollup.found;
    if (!fl.length) return st.collect ? h('p', { class: 'note' }, '최근에 모은 메일(' + (st.collect.period ? st.collect.period.start + ' ~ ' + st.collect.period.end : '') + ')에는 업무보고 파일(.json)이 첨부된 메일이 없습니다. 보고서 파일을 메일로 받았다면 그 기간으로 다시 모으거나, 아래에서 파일을 직접 골라 주세요.') : null;
    var picked = fl.filter(function (f) { return foundPick[f.key] != null ? foundPick[f.key] : foundDefault(f); }).length;
    return h('div', { class: 'found' },
      h('h3', null, '받은 메일에서 찾은 보고서 파일 ' + fl.length + '개'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
        h('thead', null, h('tr', null, ['', '보낸이 · 받은 때', '보고자 · 단위', '기간', '상태', '첨부 파일'].map(function (x) { return h('th', null, x); }))),
        h('tbody', null, fl.map(function (f) {
          var inAlready = st.rollup.sources.some(function (x) { return sameSource(x, f.pkg); });
          var cb = h('input', { type: 'checkbox', 'aria-label': f.name + ' 고르기', checked: foundPick[f.key] != null ? foundPick[f.key] : foundDefault(f), onchange: function (e) { foundPick[f.key] = e.target.checked; render(); } });
          return h('tr', null, h('td', null, cb),
            h('td', null, (f.mine ? '내가 보냄 → ' : '') + f.from, h('div', { class: 'note' }, f.day + ' ' + f.time)),
            h('td', null, f.pkg.author + (f.pkg.unit ? ' · ' + f.pkg.unit : '') + (f.pkg.rollup ? ' (취합본)' : '')),
            h('td', { class: 'nowrap' }, (f.pkg.type === 'monthly' ? '월간 ' : '주간 ') + f.pkg.period.start + ' ~ ' + f.pkg.period.end),
            h('td', null, h('span', { class: 'tag' + (f.pkg.approved ? ' ok' : ' warn') }, f.pkg.approved ? '승인' : '초안'), inAlready ? h('span', { class: 'tag muted' }, '이미 넣음') : null),
            h('td', null, h('span', { class: 'note' }, f.name)));
        })))),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary', type: 'button', disabled: !picked, onclick: loadFound }, '받은 메일에서 찾은 보고서 파일 ' + picked + '개 불러오기')),
      h('p', { class: 'note' }, '주간보고.bat(월간보고.bat)로 모은 메일의 첨부 중 이 도구가 만든 보고서 파일만 골랐습니다(다른 .json 은 뺌). 내가 보낸 메일의 파일은 처음에 고르지 않습니다.'));
  }
  function addRollupFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []), bad = [], added = 0;
    Promise.all(files.map(function (f) {
      return RD.fileText(f).then(function (t) {
        try {
          var p = R.parsePackage(t); p._name = f.name;
          addPackage(p); added++;
        } catch (e) { bad.push(f.name + ' — ' + e.message); }
      });
    })).then(function () {
      st.rollup.approved = null; save(); render();
      if (bad.length) dialog('읽지 못한 파일 ' + bad.length + '개', [h('p', null, '보고서 파일 ' + added + '개를 넣었습니다.'), h('ul', null, bad.map(function (b) { return h('li', null, b); }))]);
      else toast('보고서 파일 ' + added + '개를 넣었습니다.');
    });
  }
  function viewRollup() {
    var ru = st.rollup, lv = st.settings.level || '팀원', low = R.lowerLevel(lv) || '아래 단계';
    var fileIn = h('input', { type: 'file', class: 'sr', multiple: true, accept: '.json,application/json', onchange: function (e) { addRollupFiles(e.target.files); e.target.value = ''; } });
    var drop = h('div', { class: 'drop', tabindex: '0',
      ondragover: function (e) { e.preventDefault(); drop.classList.add('over'); },
      ondragleave: function () { drop.classList.remove('over'); },
      ondrop: function (e) { e.preventDefault(); drop.classList.remove('over'); addRollupFiles(e.dataTransfer.files); }
    }, h('strong', null, low + '의 보고서 파일(.json)을 여기에 끌어 놓거나'), h('label', { class: 'btn btn-primary' }, '보고서 파일 고르기(여러 개)', fileIn),
      h('small', { class: 'hint' }, '메일로 받은 첨부나 공유 폴더의 파일을 한 번에 여러 개 고를 수 있습니다.'));
    var r = rollupNow(), rep = r && r.rep;
    var list = ru.sources.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('thead', null, h('tr', null, ['보고자', '단계 · 보고 단위', '기간', '항목', '상태', '파일', ''].map(function (x) { return h('th', null, x); }))),
      h('tbody', null, ru.sources.map(function (x, i) {
        return h('tr', null, h('td', null, x.author), h('td', null, x.level + (x.unit ? ' · ' + x.unit : '') + (x.rollup ? ' (취합본)' : '')),
          h('td', { class: 'nowrap' }, (x.type === 'monthly' ? '월간 ' : '주간 ') + x.period.start + ' ~ ' + x.period.end), h('td', { class: 'num' }, x.items.length),
          h('td', null, h('span', { class: 'tag' + (x.approved ? ' ok' : ' warn') }, x.approved ? '승인' : '초안')), h('td', null, h('span', { class: 'note' }, x._name || '')),
          h('td', null, h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: function () { ru.sources.splice(i, 1); ru.approved = null; save(); render(); } }, '빼기')));
      })))) : h('p', { class: 'empty' }, '아직 받은 보고서 파일이 없습니다.');
    var own = h('label', { class: 'opt' }, h('input', { type: 'checkbox', checked: !!ru.includeOwn, disabled: !st.items.length || !st.settings.author, onchange: function (e) { ru.includeOwn = e.target.checked; ru.approved = null; save(); render(); } }),
      h('span', null, h('span', { class: 't' }, '내 메일 보고서도 함께 넣기'), h('span', { class: 's' }, st.items.length ? (st.settings.author ? '「02」에서 만든 내 보고서가 「' + st.settings.author + ' (나)」로 들어갑니다' : '「01 보고 설정」에서 작성자를 먼저 적어 주세요') : '「02」에서 「보고서 만들기」를 한 뒤 쓸 수 있습니다')));
    var paper = null;
    if (rep) {
      paper = h('div', { class: 'card paper', html: L.reportBodyHtml(rep, { linkBase: '#', anchorPrefix: 'ru-ev-' }) });
      // 근거 ID 는 같은 쪽 아래 표로 — 주소(#…)가 바뀌면 화면이 넘어가므로 눌렀을 때 스크롤만 합니다
      paper.addEventListener('click', function (e) {
        var a = e.target.closest ? e.target.closest('a.ev') : null; if (!a) return;
        e.preventDefault(); var el = document.getElementById('ru-ev-' + a.textContent); if (el) el.scrollIntoView({ block: 'center' });
      });
    }
    var name = function (ext) { return (rep.type === 'monthly' ? '월간업무보고_' : '주간업무보고_') + rep.period.start.replace(/-/g, '') + '_' + lv + '취합' + (rep.approved ? '' : '_초안') + '.' + ext; };
    var up = R.nextLevel(lv);
    return h('div', null,
      pageHead('08 · Roll-up', '보고서 취합', low + '에게서 받은 보고서 파일을 모아 같은 주간보고 양식으로 한 장을 만듭니다. 파일은 이 브라우저 안에서만 읽습니다.',
        rep ? h('div', { class: 'btn-row no-print' },
          h('button', { class: 'btn', type: 'button', onclick: function () { window.print(); } }, '인쇄 · PDF'),
          h('button', { class: 'btn', type: 'button', onclick: function () { exportDocx(rep, name('docx')); } }, 'Word(.docx)'),
          h('button', { class: 'btn', type: 'button', onclick: function () { download(name('doc'), new Blob(['\ufeff' + L.reportWordHtml(rep)], { type: 'application/msword' })); } }, 'Word(.doc)'),
          h('button', { class: 'btn', type: 'button', onclick: function () { var wb = XLSX.utils.book_new(); R.rollupSheets(rep).forEach(function (sh) { XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sh.aoa), sh.name); }); XLSX.writeFile(wb, name('xlsx')); } }, 'Excel(.xlsx)'),
          h('button', { class: 'btn', type: 'button', onclick: function () { download(name('html'), new Blob([L.reportHtml(rep)], { type: 'text/html' })); } }, 'HTML'),
          up ? h('button', { class: 'btn btn-primary', type: 'button', onclick: function () {
            if (!st.settings.author) { toast('「01 보고 설정」에서 작성자 이름을 먼저 적어 주세요.', true); return; }
            var pkg = R.makePackage(rep, { level: lv, author: st.settings.author, unit: st.settings.title, generatedAt: nowStamp() });
            download(R.packageFileName(pkg), new Blob([JSON.stringify(pkg, null, 1)], { type: 'application/json' }));
            sendGuide(pkg, R.packageFileName(pkg), up);
          } }, '취합 보고서 파일(.json) — ' + up + '에게') : null) : null),
      lv === '팀원' ? h('p', { class: 'alert info' }, '지금 보고 단계가 「팀원」입니다. 팀원은 「06 보고서」에서 보고서 파일을 내려받아 파트리더에게 보내면 됩니다. 파트리더 · 팀장 · 임원이면 ',
        h('a', { href: '#/setup' }, '「01 보고 설정」'), '에서 보고 단계를 바꿔 주세요.') : null,
      h('section', { class: 'card step' }, h('h2', null, h('span', { class: 'step-no' }, '1'), '받은 보고서 파일 넣기'), foundSection(), drop, list, h('div', { class: 'btn-row' }, own,
        ru.sources.length ? h('button', { class: 'btn btn-danger', type: 'button', onclick: function () { confirmBox('모두 빼기', '넣은 보고서 파일 ' + ru.sources.length + '개를 모두 뺄까요? 받은 원본 파일은 그대로 있습니다.', '모두 빼기', function () { st.rollup = L.emptyRollup(); save(); render(); }, true); } }, '모두 빼기') : null)),
      r && r.skipped.length ? h('div', { class: 'alert warn' }, h('strong', null, '취합에서 뺀 파일'), h('ul', null, r.skipped.map(function (x) { return h('li', null, x.name + ' — ' + x.reason); }))) : null,
      r && r.warnings.length ? h('div', { class: 'alert info' }, h('ul', null, r.warnings.map(function (w) { return h('li', null, w); }))) : null,
      rep ? h('section', { class: 'card step no-print' }, h('h2', null, h('span', { class: 'step-no' }, '2'), '확인 · 승인'),
        h('div', { class: 'tiles' },
          h('div', { class: 'tile' }, h('div', { class: 'k' }, '보고자'), h('div', { class: 'v' }, rep.counts.reporters), h('div', { class: 'note' }, '보고서 ' + rep.counts.files + '개')),
          h('div', { class: 'tile' }, h('div', { class: 'k' }, '실적 · 계획'), h('div', { class: 'v small' }, rep.counts.performance + ' · ' + rep.counts.plan)),
          h('div', { class: 'tile' }, h('div', { class: 'k' }, '이슈'), h('div', { class: 'v' }, rep.counts.issue), h('div', { class: 'note' }, '의사결정 필요 ' + rep.decision.length)),
          h('div', { class: 'tile' }, h('div', { class: 'k' }, '확인 필요 표시'), h('div', { class: 'v' }, rep.counts.check), h('div', { class: 'note' }, '보고자가 붙인 그대로'))),
        h('p', { class: 'note' }, '고칠 내용이 있으면 그 보고자에게 알려 다시 받는 것이 가장 정확합니다(취합 화면에서는 문장을 고치지 않습니다).'),
        h('div', { class: 'btn-row' }, ru.approved ? [h('span', { class: 'tag ok' }, '승인됨 ' + ru.approved), h('button', { class: 'btn', type: 'button', onclick: function () { ru.approved = null; save(); render(); } }, '승인 취소')] :
          h('button', { class: 'btn btn-primary', type: 'button', onclick: function () { ru.approved = nowStamp(); save(); toast('승인했습니다. 이제 내려받은 파일에는 「초안」 표시가 빠집니다.'); render(); } }, '취합 보고서 승인'))) : null,
      rep ? execCard(rep) : null,
      paper);
  }
  /* 임원 보고용 요약 — 임시 양식(2026-09-30 「담당 임원에게는 다른 양식으로」 — 실제 양식을 받기 전까지) */
  function execCard(rep) {
    var m = R.execSummary(rep, { unit: st.settings.title }), html = R.execSummaryHtml(m);
    var base = (rep.type === 'monthly' ? '월간' : '주간') + '_임원보고요약_' + rep.period.start.replace(/-/g, '') + '_임시양식' + (rep.approved ? '' : '_초안');
    return h('section', { class: 'card step no-print' }, h('h2', null, h('span', { class: 'step-no' }, '3'), '임원 보고용(요약)'),
      h('p', { class: 'alert warn' }, h('strong', null, R.EXEC_NOTE), ' — 담당 임원에게는 다른 양식으로 보고한다고 들었습니다. 그 양식(빈 양식 또는 내용을 지운 샘플)을 받기 전까지 쓰는 한 장짜리 요약입니다.'),
      h('p', { class: 'note' }, '파트(보고 단위)마다 건수와 핵심 실적 · 주요 이슈 · ' + m.nextLabel + '을 3건씩 뽑았습니다. 핵심 실적은 완료 먼저, 이슈는 의사결정 필요 → 지연 순입니다. 더 있으면 「외 N건」으로 적습니다.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: function () { download(base + '.doc', new Blob(['\ufeff' + html], { type: 'application/msword' })); } }, '임원 보고용(요약) — Word(.doc)'),
        h('button', { class: 'btn', type: 'button', onclick: function () { download(base + '.html', new Blob([html], { type: 'text/html' })); } }, 'HTML')),
      h('details', null, h('summary', null, '미리보기'), h('iframe', { class: 'exec-preview', title: '임원 보고용 요약 미리보기', srcdoc: html })));
  }

  /* ── 예시 ─────────────────────────────── */
  function loadSample() {
    var S = window.P27_SAMPLE;
    if (!S) { toast('예시 파일(js/sample-collect.js)을 불러오지 못했습니다.', true); return; }
    function doLoad() {
      importCollection(S.manifest, function (rel) { return Promise.resolve(S.pdf[rel] ? RD.base64ToBytes(S.pdf[rel]) : null); }, 'sample',
        { settings: S.settings, projects: S.projects, history: S.history }).then(function (ok) {
        if (ok) toast('예시 수집 결과(메일 ' + st.mails.length + '통 · 가상)를 넣었습니다. 「보고서 만들기」를 눌러 보세요.');
      });
    }
    if (st.mails.length && !st._sample) confirmBox('예시로 해 보기', '지금 있는 메일 · 항목을 지우고 예시로 바꿀까요? 필요하면 먼저 「07 이력 · 백업」에서 JSON 백업을 받아 두세요.', '예시로 바꾸기', doLoad, true);
    else doLoad();
  }

  /* ── 라우팅 ───────────────────────────── */
  function render() {
    var route = location.hash || '#/make';
    renderChrome(route);
    main.innerHTML = '';
    var v;
    if (route.indexOf('#/mail/') === 0) v = viewMail(decodeURIComponent(route.slice(7)));
    else if (route === '#/setup') v = viewSetup();
    else if (route === '#/tasks') v = viewTasks();
    else if (route === '#/classify') v = viewClassify();
    else if (route === '#/carry') v = viewCarry();
    else if (route === '#/report') v = viewReport();
    else if (route === '#/history') v = viewHistory();
    else if (route === '#/rollup') v = viewRollup();
    else v = viewMake();
    main.appendChild(v);
  }
  window.addEventListener('hashchange', function () {
    if (autoOpen()) return;
    render(); main.focus({ preventScroll: true }); window.scrollTo(0, 0);
  });
  if (!st.settings.refDay) st.settings.refDay = today();
  if (!autoOpen()) render();
})();
