/* 보고 단계 · 보고서 취합 (순수 로직, node 테스트 대상) — 2026-09-30 답변 반영
   「디자인팀 전원 사용을 목표로 팀원 → 파트리더 → 팀장 → 담당 임원 순으로 보고합니다.」

   흐름: 팀원은 지금처럼 메일로 보고서를 만들고 「보고서 파일(.json)」을 내려받아 파트리더에게 보냅니다(메일 첨부 · 공유 폴더).
         파트리더는 팀원들의 파일을 모아 한 장으로 취합합니다(원하면 자기 메일 보고서도 함께). 그 취합본을 다시 파일로 내려받아
         팀장에게, 팀장은 파트별 취합본을 모아 담당 임원에게 — 같은 파일 모양이라 몇 단계든 이어집니다. 서버 · DB 없음.

   보고서 파일(p27-report-file-v1)에 들어가는 것: 보고자 · 단계 · 보고 단위 · 기간 · 승인 여부, 항목(실적 · 계획 · 이슈 문장 · 상태 ·
   프로젝트 · 확인 표시 · 근거 메일 ID), 근거 메일 목록(날짜 · 보낸이 · 제목 · 첨부 이름), 주간보고 양식 표.
   메일 본문과 첨부 글은 넣지 않습니다(Word 로 내려받는 보고서와 같은 범위).

   취합 규칙
   - 기간(주간 · 월간 · 시작일 · 끝일)이 같은 파일만 합칩니다. 기간은 가장 많은 파일의 기간(같으면 먼저 넣은 파일).
   - 같은 보고자 · 같은 보고 단위의 파일이 두 개면 나중에 만든 것만 씁니다.
   - 항목 문장 앞에 「[보고자]」를 붙이고, 근거 메일 ID 는 「보고자·M0003」으로 바꿔 서로 겹치지 않게 합니다.
     이미 취합한 파일(파트 취합본)을 다시 취합할 때는 원래 보고자 이름을 그대로 둡니다(「[파트리더] [팀원]」처럼 겹치지 않게).
   - 확인 필요 · 상충 · AI 추론 · 근거 없음 · 첨부 근거 표시는 원래 값 그대로 가져옵니다(취합하면서 지우지 않음).
   - 양식 표는 프로젝트마다 한 줄로 모으고, 칸 안의 각 줄 앞에 보고자를 붙입니다.

   2026-09-30 두 번째 답변 반영
   - 「메일로 송/수신」 → 받은 메일의 첨부에서 보고서 파일을 찾습니다(findMailedPackages). 수집기가 첨부로 온 .json 중
     형식 표시(schema: p27-report-file-v1)가 있는 것만 「보고서 파일」로 표시하고 그 글을 넘겨 줍니다. 형식 표시가 없는 .json 은 무시합니다.
     보낼 때는 메일 제목을 채운 mailto: 링크를 만듭니다(mailDraft — mailto 로는 첨부를 넣을 수 없어 파일은 직접 첨부).
   - 「담당 임원에게는 다른 양식」 → 실제 양식을 받기 전까지 쓰는 한 장짜리 임시 요약(execSummary · execSummaryHtml).
     파트(보고 단위)마다 핵심 실적 · 주요 이슈 · 다음 계획 3건씩과 건수. 「임시 양식」임을 제목 아래에 늘 적습니다. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./report-logic.js'));
  else root.RollupLogic = factory(root.RPLogic);
})(typeof self !== 'undefined' ? self : this, function (L) {
  'use strict';

  var PACKAGE_SCHEMA = 'p27-report-file-v1';
  /* 보고 단계 — 아래로 갈수록 윗사람. 각 단계는 한 칸 아래 단계의 보고서를 취합합니다 */
  var LEVELS = ['팀원', '파트리더', '팀장', '임원'];
  var LEVEL_NOTE = {
    '팀원': '내 메일로 보고서를 만들어 파트리더에게 보고서 파일을 보냅니다.',
    '파트리더': '팀원들의 보고서 파일을 모아 파트 보고서로 취합하고, 팀장에게 보냅니다.',
    '팀장': '파트리더들의 파트 보고서를 모아 팀 보고서로 취합하고, 담당 임원에게 보냅니다.',
    '임원': '팀장들의 팀 보고서를 모아 봅니다.'
  };
  var SECTIONS = {
    weekly: [
      { id: 'summary', name: '기간·요약' },
      { id: 'sources', name: '보고자별 취합 현황' },
      { id: 'board', name: '주간 업무보고 — 양식 표' },
      { id: 'performance', name: '01. Weekly Performance — 금주 주요 실적' },
      { id: 'plan', name: '02. Next Week Plan — 차주 주요 계획' },
      { id: 'issue', name: '03. Key Issues & Risks — 주요 이슈 및 리스크' }
    ],
    monthly: [
      { id: 'summary', name: 'Executive Summary — 월간 핵심 요약' },
      { id: 'sources', name: '보고자별 취합 현황' },
      { id: 'performance', name: 'Monthly Performance — 프로젝트별 실적' },
      { id: 'plan', name: 'Next Month Plan — 차월 추진계획' },
      { id: 'issue', name: 'Key Issues — 지속·신규 이슈' },
      { id: 'decision', name: 'Decision Required — 의사결정·지원 요청' }
    ]
  };

  function str(v) { return v == null ? '' : String(v); }
  function trim(v) { return str(v).trim(); }
  function uniq(list) { var seen = {}, out = []; list.forEach(function (x) { if (!seen[x]) { seen[x] = 1; out.push(x); } }); return out; }
  function isDay(s) { return /^\d{4}-\d{2}-\d{2}$/.test(str(s)); }
  function levelIndex(lv) { return LEVELS.indexOf(lv); }
  function nextLevel(lv) { var i = levelIndex(lv); return i >= 0 && i < LEVELS.length - 1 ? LEVELS[i + 1] : ''; }
  function lowerLevel(lv) { var i = levelIndex(lv); return i > 0 ? LEVELS[i - 1] : ''; }
  function needsCheck(x) { return x.status === '확인 필요' || !!x.conflict || x.explicit === false || !(x.evidence || []).length; }
  function flat(groups) { return [].concat.apply([], (groups || []).map(function (g) { return g.items.map(function (x) { return Object.assign({ project: g.project }, x); }); })); }
  function byProject(list) {
    var map = {}, order = [];
    list.forEach(function (x) { var p = x.project || L.OTHER_PROJECT; if (!map[p]) { map[p] = []; order.push(p); } map[p].push(x); });
    order.sort(function (a, b) { return (a === L.OTHER_PROJECT) - (b === L.OTHER_PROJECT); });   // 기타는 맨 뒤(자바스크립트 정렬은 같은 값끼리 순서를 지킴)
    return order.map(function (p) { return { project: p, items: map[p] }; });
  }
  function periodKey(p) { return p.type + '|' + p.start + '|' + p.end; }
  function periodText(p) { return (p.type === 'monthly' ? '월간 ' : '주간 ') + p.start + ' ~ ' + p.end; }

  /* ── 보고서 → 보고서 파일 ─────────────── */
  /* rep: RPLogic.buildReport 결과(내 메일 보고서) 또는 mergePackages 의 rep(취합본). meta: { level, author, unit, generatedAt } */
  function makePackage(rep, meta) {
    meta = meta || {};
    var items = flat(rep.performance).concat(flat(rep.plan), flat(rep.issue)).map(function (x) {
      return {
        category: x.category, project: x.project || L.OTHER_PROJECT, text: x.rawText != null ? x.rawText : str(x.text), status: str(x.status), date: str(x.date),
        decision: !!x.decision, explicit: x.explicit !== false, origin: str(x.origin), source: str(x.source), conflict: str(x.conflict),
        evidence: (x.evidence || []).slice(), reporter: str(x.reporter)
      };
    });
    var board = null;
    if (rep.type !== 'monthly') { var bd = L.boardOf(rep); board = JSON.parse(JSON.stringify({ head: bd.head, rows: bd.rows })); }
    return {
      schema: PACKAGE_SCHEMA, tool: 'data09-27 업무보고 Agent',
      level: levelIndex(meta.level) >= 0 ? meta.level : '팀원', author: trim(meta.author), unit: trim(meta.unit),
      type: rep.type === 'monthly' ? 'monthly' : 'weekly',
      period: rep.period ? { type: rep.period.type || rep.type, start: rep.period.start, end: rep.period.end, label: rep.period.label, next: rep.period.next } : null,
      approved: rep.approved || null, generatedAt: str(meta.generatedAt || rep.generated), boardStyle: rep.boardStyle || 'brief',
      rollup: !!rep.rollup, sources: rep.rollup ? JSON.parse(JSON.stringify(rep.sources || [])) : [],
      summary: (rep.summary || []).slice(), counts: Object.assign({}, rep.counts),
      items: items,
      evidence: (rep.evidence || []).map(function (e) { return { id: e.id, day: str(e.day), time: str(e.time), from: str(e.from), subject: str(e.subject), attachments: (e.attachments || []).slice() }; }),
      board: board
    };
  }
  function packageFileName(pkg) {
    return (pkg.type === 'monthly' ? '월간' : '주간') + '업무보고_' + (pkg.period ? pkg.period.start.replace(/-/g, '') : '') + '_' +
      (pkg.rollup ? pkg.level + '취합_' : '') + (pkg.author || '이름없음').replace(/[\\/:*?"<>|\s]+/g, '_') + (pkg.approved ? '' : '_초안') + '.json';
  }

  /* ── 보고서 파일 읽기 · 점검 ───────────── */
  function parsePackage(input) {
    var p = input;
    if (typeof input === 'string') {
      try { p = JSON.parse(input.replace(/^﻿/, '')); } catch (e) { throw new Error('JSON 파일이 아닙니다.'); }
    }
    if (!p || typeof p !== 'object') throw new Error('업무보고 파일이 아닙니다.');
    if (p.schema !== PACKAGE_SCHEMA) {
      if (p.settings && Array.isArray(p.mails)) throw new Error('「07 이력 · 백업」의 백업 파일입니다. 「06 보고서」의 「보고서 파일 내려받기」로 만든 파일을 골라 주세요.');
      throw new Error('업무보고 파일이 아닙니다(' + (p.schema || '형식 표시 없음') + ').');
    }
    var type = p.type === 'monthly' ? 'monthly' : p.type === 'weekly' ? 'weekly' : '';
    if (!type) throw new Error('주간 · 월간 표시가 없습니다.');
    if (!p.period || !isDay(p.period.start) || !isDay(p.period.end)) throw new Error('보고 기간이 없습니다.');
    if (!trim(p.author)) throw new Error('보고자 이름이 없습니다. 보낸 사람에게 「01 보고 설정」에서 작성자를 적고 다시 내려받아 달라고 해 주세요.');
    if (!Array.isArray(p.items)) throw new Error('보고 항목이 없습니다.');
    var period = { type: type, start: p.period.start, end: p.period.end, label: str(p.period.label) || p.period.start + ' ~ ' + p.period.end, next: p.period.next };
    if (!period.next || !isDay(period.next.start)) {
      var ws = new Date(p.period.start + 'T00:00:00Z').getUTCDay();               // 주간은 시작일의 요일이 곧 한 주의 시작
      var re = L.periodFor(type, p.period.start, ws === 0 ? 0 : 1);
      period.next = re ? re.next : { start: '', end: '', label: '' };
    }
    var dropped = 0;
    var items = p.items.filter(function (x) { var ok = x && L.CATEGORIES.indexOf(x.category) >= 0 && trim(x.text); if (!ok) dropped++; return ok; }).map(function (x) {
      return {
        category: x.category, project: trim(x.project) || L.OTHER_PROJECT, text: trim(x.text), status: str(x.status), date: isDay(x.date) ? x.date : '',
        decision: !!x.decision, explicit: x.explicit !== false, origin: str(x.origin) || 'rule', source: str(x.source), conflict: str(x.conflict),
        evidence: Array.isArray(x.evidence) ? x.evidence.map(str).filter(Boolean) : [], reporter: trim(x.reporter)
      };
    });
    var board = p.board && Array.isArray(p.board.rows) && Array.isArray(p.board.head) ? p.board : null;
    return {
      schema: PACKAGE_SCHEMA, level: levelIndex(p.level) >= 0 ? p.level : '팀원', author: trim(p.author), unit: trim(p.unit), type: type, period: period,
      approved: typeof p.approved === 'string' && p.approved ? p.approved : null, generatedAt: str(p.generatedAt), boardStyle: p.boardStyle === 'original' ? 'original' : 'brief',
      rollup: !!p.rollup, sources: Array.isArray(p.sources) ? p.sources : [], summary: Array.isArray(p.summary) ? p.summary.map(str) : [],
      items: items, evidence: Array.isArray(p.evidence) ? p.evidence.filter(function (e) { return e && e.id; }) : [], board: board, dropped: dropped
    };
  }
  /* 취합 파일에 들어 있는 원래 보고자 이름들 */
  function reportersOf(pkg) {
    if (!pkg.rollup) return [pkg.author];
    var fromSources = [].concat.apply([], (pkg.sources || []).map(function (s) { return s.reporters || []; }));
    return uniq(fromSources.concat(pkg.items.map(function (x) { return x.reporter; })).filter(Boolean));
  }

  /* ── 양식 표 합치기 ─────────────────── */
  function mergeBoards(used, period) {
    var rows = [], byName = {}, head = null;
    used.forEach(function (s) {
      if (!s.board) return;
      if (!head) head = s.board.head.slice();
      var tag = s.rollup ? '' : '[' + s.author + '] ';
      var ev = function (e) { return s.rollup ? e : s.author + '·' + e; };
      s.board.rows.forEach(function (r) {
        var name = r.project || L.OTHER_PROJECT, row = byName[name];
        if (!row) {
          row = byName[name] = { group: '', project: name, evidence: [], perf: { progress: [], release: '', issues: [], images: [] }, plan: { tasks: [], schedule: '', issues: [] }, _rel: [], _sch: [] };
          rows.push(row);
        }
        if (!row.group && r.group) row.group = r.group;
        var pf = r.perf || {}, pl = r.plan || {};
        row.perf.progress = row.perf.progress.concat((pf.progress || []).map(function (x) { return tag + x; }));
        row.perf.issues = row.perf.issues.concat((pf.issues || []).map(function (x) { return tag + x; }));
        row.perf.images = row.perf.images.concat((pf.images || []).map(function (x) { return tag + x; }));
        row.plan.tasks = row.plan.tasks.concat((pl.tasks || []).map(function (x) { return tag + x; }));
        row.plan.issues = row.plan.issues.concat((pl.issues || []).map(function (x) { return tag + x; }));
        if (pf.release) row._rel.push(tag + pf.release);
        if (pl.schedule) row._sch.push(tag + pl.schedule);
        row.evidence = row.evidence.concat((r.evidence || []).map(ev));
      });
    });
    rows.forEach(function (r) { r.perf.release = r._rel.join(' · '); r.plan.schedule = r._sch.join(' · '); r.evidence = uniq(r.evidence); delete r._rel; delete r._sch; });
    rows.sort(function (a, b) { return (a.project === L.OTHER_PROJECT) - (b.project === L.OTHER_PROJECT); });
    if (!head) {
      var wr = L.workdayRange(period), nr = period.next && period.next.start ? L.workdayRange(period.next) : null;
      head = ['Business Group', '프로젝트명', '금주 실적' + (wr ? ' (' + wr.label + ')' : ''), '차주 계획' + (nr ? ' (' + nr.label + ')' : '')];
    }
    return { style: 'merged', head: head, rows: rows };
  }

  /* ── 취합 ─────────────────────────── */
  /* pkgs: parsePackage 결과 목록(각각 _name = 파일 이름이 있으면 안내에 씀)
     opts: { level, author, unit, now, approved, own: 내 메일 보고서의 파일(선택), boardStyle }
     → { rep: 보고서(RPLogic 의 reportBodyHtml · docxParts 에 그대로 넣을 수 있는 모양), used, skipped: [{ name, reason }], warnings } */
  function mergePackages(pkgs, opts) {
    opts = opts || {};
    var level = levelIndex(opts.level) >= 0 ? opts.level : '파트리더';
    var all = (opts.own ? [Object.assign({}, opts.own, { own: true, _name: '내 메일 보고서' })] : []).concat((pkgs || []).map(function (p) { return Object.assign({ own: false }, p); }));
    var skipped = [], warnings = [];
    if (!all.length) return { rep: null, used: [], skipped: [], warnings: ['취합할 보고서 파일이 없습니다.'] };
    // 기간: 가장 많은 파일의 기간(같으면 먼저 넣은 파일). 내 메일 보고서는 세지 않음 — 기간을 정하는 것은 받은 보고서
    var votes = {}, order = [];
    all.filter(function (p) { return !p.own; }).forEach(function (p) { var k = periodKey(p.period); if (!votes[k]) { votes[k] = 0; order.push(k); } votes[k]++; });
    if (!order.length) order.push(periodKey(all[0].period));
    var best = order.slice().sort(function (a, b) { return (votes[b] || 0) - (votes[a] || 0) || order.indexOf(a) - order.indexOf(b); })[0];
    var period = null;
    all.forEach(function (p) { if (!period && periodKey(p.period) === best) period = p.period; });

    var used = [], seen = {};
    all.forEach(function (p) {
      var name = p._name || p.author;
      if (periodKey(p.period) !== best) { skipped.push({ name: name, reason: '기간이 다릅니다(' + periodText(p.period) + ' — 취합 기간은 ' + periodText(period) + ')' }); return; }
      if (!p.own && levelIndex(p.level) >= levelIndex(level)) warnings.push(name + ' — 보낸 사람의 보고 단계(' + p.level + ')가 내 단계(' + level + ')보다 낮지 않습니다. 맞는 파일인지 확인해 주세요.');
      var k = (p.own ? '*' : '') + p.author + '|' + p.unit;
      if (seen[k] != null) {
        var prev = used[seen[k]];
        warnings.push(p.author + (p.unit ? '(' + p.unit + ')' : '') + ' 의 보고서가 두 개라 나중에 만든 것(' + (str(p.generatedAt) >= str(prev.generatedAt) ? p.generatedAt : prev.generatedAt) + ')만 씁니다.');
        if (str(p.generatedAt) >= str(prev.generatedAt)) used[seen[k]] = p;
        return;
      }
      seen[k] = used.length; used.push(p);
    });

    var items = [], evidence = [], sources = [], n = 0;
    used.forEach(function (s) {
      var ev = function (e) { return s.rollup ? e : s.author + '·' + e; };
      var mine = s.items.map(function (x) {
        var who = s.rollup ? (x.reporter || s.author) : s.author;
        return Object.assign({}, x, {
          id: 'R' + ('00' + (++n)).slice(-3), reporter: who, rawText: x.text, text: '[' + who + '] ' + x.text,
          evidence: x.evidence.map(ev), from: s.author, part: s.unit || s.author, taskName: ''
        });
      });
      items = items.concat(mine);
      s.evidence.forEach(function (e) { evidence.push({ id: ev(e.id), day: str(e.day), time: str(e.time), from: str(e.from), subject: str(e.subject), attachments: (e.attachments || []).slice(), file: '' }); });
      var cnt = function (c) { return mine.filter(function (x) { return x.category === c; }).length; };
      sources.push({
        author: s.author, unit: s.unit, level: s.level, own: !!s.own, rollup: !!s.rollup, approved: s.approved, generatedAt: s.generatedAt,
        reporters: reportersOf(s), counts: { performance: cnt('실적'), plan: cnt('계획'), issue: cnt('이슈'), check: mine.filter(needsCheck).length }
      });
    });
    var ids = {}; evidence = evidence.filter(function (e) { if (ids[e.id]) return false; ids[e.id] = 1; return true; }).sort(function (a, b) { return (a.day + a.time).localeCompare(b.day + b.time) || a.id.localeCompare(b.id); });

    var perf = items.filter(function (x) { return x.category === '실적'; }), plan = items.filter(function (x) { return x.category === '계획'; }), issue = items.filter(function (x) { return x.category === '이슈'; });
    var check = items.filter(needsCheck);
    var reporters = uniq([].concat.apply([], sources.map(function (s) { return s.reporters; })));
    var drafts = sources.filter(function (s) { return !s.approved; });
    var summary = [];
    summary.push(period.label + ' — 보고서 ' + used.length + '개(보고자 ' + reporters.length + '명)를 취합했습니다: 실적 ' + perf.length + '건 · 계획 ' + plan.length + '건 · 이슈 ' + issue.length + '건.');
    var done = perf.filter(function (x) { return x.status === '완료'; }).length;
    if (perf.length) summary.push('실적 ' + perf.length + '건 중 완료가 확인된 것은 ' + done + '건입니다.');
    var delayed = issue.filter(function (x) { return x.status === '지연'; }).length, dec = issue.filter(function (x) { return x.decision; }).length;
    if (issue.length) summary.push('이슈 ' + issue.length + '건' + (delayed ? '(지연 ' + delayed + '건)' : '') + (dec ? ' 가운데 의사결정이 필요한 사항이 ' + dec + '건 있습니다.' : '이 있습니다.'));
    if (check.length) summary.push('확인이 필요한 항목이 ' + check.length + '건 있습니다(보고자가 붙인 표시를 그대로 가져왔습니다). 보고 전에 해당 보고자에게 확인해 주세요.');
    if (drafts.length) summary.push('아직 승인하지 않은 초안 보고서가 ' + drafts.length + '개 있습니다: ' + drafts.map(function (s) { return s.author; }).join(', ') + '.');

    var unit = trim(opts.unit);
    var rep = {
      type: period.type, title: (unit ? unit + ' ' : '') + level + ' 취합', author: trim(opts.author), period: period,
      approved: opts.approved || null, generated: str(opts.now), rollup: true, level: level,
      sections: SECTIONS[period.type] || SECTIONS.weekly, sources: sources, summary: summary,
      performance: byProject(perf), plan: byProject(plan), issue: byProject(issue),
      decision: issue.filter(function (x) { return x.decision; }), status: [], carry: [], projects: [], boardStyle: opts.boardStyle || 'brief',
      counts: { performance: perf.length, plan: plan.length, issue: issue.length, check: check.length, mails: evidence.length, files: used.length, reporters: reporters.length },
      evidence: evidence
    };
    rep._board = mergeBoards(used, period);
    return { rep: rep, used: used, skipped: skipped, warnings: warnings };
  }

  /* ── 엑셀(취합본) ─────────────────────── */
  function rollupSheets(rep) {
    var sum = [['항목', '값'], ['보고서', L.reportTitle(rep)], ['유형', rep.type === 'monthly' ? '월간' : '주간'], ['기간', rep.period.start + ' ~ ' + rep.period.end],
      ['보고 단계', rep.level + ' 취합'], ['작성', rep.author], ['상태', rep.approved ? '승인 ' + rep.approved : '초안'], ['취합한 보고서', rep.counts.files], ['보고자', rep.counts.reporters],
      ['실적', rep.counts.performance], ['계획', rep.counts.plan], ['이슈', rep.counts.issue], ['확인 필요', rep.counts.check]]
      .concat(rep.summary.map(function (s, i) { return ['요약 ' + (i + 1), s]; }));
    var out = [{ name: '요약', aoa: sum }];
    out.push({ name: '보고자별', aoa: [['보고자', '단계', '보고 단위', '실적', '계획', '이슈', '확인 필요', '상태', '들어 있는 보고자']].concat(rep.sources.map(function (s) {
      return [s.author + (s.own ? ' (나)' : ''), s.level, s.unit, s.counts.performance, s.counts.plan, s.counts.issue, s.counts.check, s.approved ? '승인 ' + s.approved : '초안', s.reporters.join(', ')];
    })) });
    if (rep.type !== 'monthly') {
      var bd = L.boardOf(rep);
      out.push({ name: '주간보고표', aoa: [bd.head.concat(['근거 메일'])].concat(bd.rows.map(function (r) { return [r.group, r.project, L.boardCellLines(r, 'perf').join('\n'), L.boardCellLines(r, 'plan').join('\n'), r.evidence.join(', ')]; })) });
    }
    var rows = [['보고자', '분류', '프로젝트', '내용', '상태', '날짜', '의사결정', '확인 표시', '근거 메일']];
    ['performance', 'plan', 'issue'].forEach(function (k) {
      flat(rep[k]).forEach(function (x) { rows.push([x.reporter, x.category, x.project, x.rawText, x.status, x.date, x.decision ? '필요' : '', L.flagText(x).join(', '), x.evidence.join(', ')]); });
    });
    out.push({ name: '업무항목', aoa: rows });
    return out;
  }

  /* ── 메일로 주고받기 (2026-09-30 답변 「메일로 송/수신」) ── */
  /* 글에 보고서 파일 형식 표시가 있는가 — 수집기(PowerShell)의 같은 검사와 같은 규칙 */
  var MARKER_RE = /"schema"\s*:\s*"p27-report-file-v1"/;
  function looksLikePackageText(text) { return MARKER_RE.test(str(text).slice(0, 4096)); }
  function packageKey(p) { return [p.author, p.unit, p.type, p.period && p.period.start, p.generatedAt].join('|'); }
  /* 모은 메일의 첨부 중 보고서 파일 찾기
     mails: 수집 결과의 메일(첨부 { name, kind, file }). texts: { 첨부 경로(file): 파일 글 } — 자동 열기는 수집기가 넘긴 글, 폴더 열기는 파일을 읽은 글
     → { found: [{ key, pkg, name, file, mailId, from, fromEmail, day, time, subject, direction, mine }], bad: [{ name, reason }] }
        found 는 최근 메일부터. 같은 파일(보고자 · 단위 · 기간 · 만든 때가 같음)이 여러 메일에 있으면 한 번만. */
  function findMailedPackages(mails, texts) {
    texts = texts || {};
    var found = [], bad = [], seen = {};
    (mails || []).forEach(function (m) {
      (m.attachments || []).forEach(function (a) {
        var isJson = /\.json$/i.test(str(a.name)) || a.kind === 'report';
        if (!isJson || !a.file) return;
        var text = texts[a.file];
        if (text == null) { if (a.kind === 'report') bad.push({ name: a.name, reason: '수집 폴더에서 파일을 찾지 못했습니다 — 「02」의 「수집 폴더 열기」로 폴더째 골라 주세요' }); return; }
        if (!looksLikePackageText(text)) return;                      // 다른 .json(설정 · 데이터 파일)은 조용히 넘김
        var pkg;
        try { pkg = parsePackage(text); } catch (e) { bad.push({ name: a.name, reason: e.message }); return; }
        pkg._name = str(a.name);
        var k = packageKey(pkg);
        if (seen[k]) return;
        seen[k] = 1;
        found.push({ key: k, pkg: pkg, name: str(a.name), file: str(a.file), mailId: str(m.id || m.cid), from: trim(m.from && (m.from.name || m.from.email)), fromEmail: trim(m.from && m.from.email),
          day: str(m.day), time: str(m.time), subject: str(m.subject), direction: m.direction === 'sent' ? 'sent' : 'received', mine: m.direction === 'sent' });
      });
    });
    found.sort(function (a, b) { return (b.day + b.time).localeCompare(a.day + a.time); });
    return { found: found, bad: bad };
  }
  /* 윗단계에게 보낼 메일 — 제목 · 본문을 채운 mailto: 주소. 받는 사람과 첨부는 사용자가 넣습니다(mailto 로는 첨부를 넣을 수 없음) */
  function mailDraft(pkg, fileName) {
    var p = pkg.period || { start: '', end: '' };
    var subject = '[' + (pkg.type === 'monthly' ? '월간' : '주간') + '업무보고] ' + p.start + ' ~ ' + p.end + ' ' + (pkg.author || '') + (pkg.unit ? '(' + pkg.unit + ')' : '') +
      (pkg.rollup ? ' ' + pkg.level + ' 취합' : '') + (pkg.approved ? '' : ' — 초안');
    var body = [(pkg.type === 'monthly' ? '월간' : '주간') + ' 업무보고 파일을 첨부합니다(' + p.start + ' ~ ' + p.end + ').', '첨부: ' + (fileName || packageFileName(pkg)), '',
      '받은 파일은 업무보고 도구의 「08 보고서 취합」에서 불러오면 됩니다. 메일을 주간보고.bat 로 모으면 첨부에서 자동으로 찾아 줍니다.'].join('\r\n');
    return { subject: subject, body: body, href: 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body) };
  }

  /* ── 임원 보고용 요약 (임시 양식) ──────────── */
  var EXEC_NOTE = '임시 양식 — 실제 임원 보고 양식을 받으면 맞춥니다';
  var EXEC_MAX = 3;
  function mmdd(d) { return isDay(d) ? d.slice(5).replace('-', '/') : ''; }
  /* rep: mergePackages 의 rep(취합본) 또는 내 메일 보고서. opts.unit(보고 단위) */
  function execSummary(rep, opts) {
    opts = opts || {};
    var all = flat(rep.performance).concat(flat(rep.plan), flat(rep.issue));
    var partOf = function (x) { return x.part || (rep.rollup ? x.from : '') || trim(opts.unit) || rep.author || '전체'; };
    var order = [], by = {};
    (rep.rollup ? (rep.sources || []).map(function (s) { return s.unit || s.author; }) : []).concat(all.map(partOf)).forEach(function (n) { if (!by[n]) { by[n] = []; order.push(n); } });
    all.forEach(function (x) { by[partOf(x)].push(x); });
    var line = function (x) { return (x.project && x.project !== L.OTHER_PROJECT ? x.project + ' — ' : '') + (x.rawText != null ? x.rawText : str(x.text)); };
    var rank = function (list, score) { return list.map(function (x, i) { return { x: x, i: i, s: score(x) }; }).sort(function (a, b) { return a.s - b.s || a.i - b.i; }).map(function (o) { return o.x; }); };
    var parts = order.map(function (name) {
      var xs = by[name], perf = xs.filter(function (x) { return x.category === '실적'; }), plan = xs.filter(function (x) { return x.category === '계획'; }), iss = xs.filter(function (x) { return x.category === '이슈'; });
      var srcRep = (rep.sources || []).filter(function (s) { return (s.unit || s.author) === name; });
      var reporters = uniq([].concat.apply([], srcRep.map(function (s) { return s.reporters || [s.author]; })).concat(xs.map(function (x) { return x.reporter; })).filter(Boolean));
      var counts = { performance: perf.length, done: perf.filter(function (x) { return x.status === '완료'; }).length, plan: plan.length, issue: iss.length,
        delayed: iss.filter(function (x) { return x.status === '지연'; }).length, decision: iss.filter(function (x) { return x.decision; }).length, check: xs.filter(needsCheck).length };
      var hi = rank(perf, function (x) { return x.status === '완료' ? 0 : 1; }).map(function (x) { return line(x) + (x.status && x.status !== '완료' ? ' (' + x.status + ')' : ''); });
      var is = rank(iss, function (x) { return x.decision ? 0 : x.status === '지연' ? 1 : 2; }).map(function (x) { return (x.decision ? '[의사결정] ' : x.status === '지연' ? '[지연] ' : '') + line(x); });
      var pl = rank(plan, function (x) { return isDay(x.date) ? Number(x.date.replace(/-/g, '')) : 99999999; }).map(function (x) { return line(x) + (isDay(x.date) ? ' (' + mmdd(x.date) + ')' : ''); });
      return { name: name, reporters: reporters.length, counts: counts,
        highlights: hi.slice(0, EXEC_MAX), issues: is.slice(0, EXEC_MAX), plans: pl.slice(0, EXEC_MAX),
        more: { highlights: Math.max(0, hi.length - EXEC_MAX), issues: Math.max(0, is.length - EXEC_MAX), plans: Math.max(0, pl.length - EXEC_MAX) } };
    }).filter(function (p) { return by[p.name].length || (rep.sources || []).length; });
    var sum = function (k) { return parts.reduce(function (n, p) { return n + p.counts[k]; }, 0); };
    var unit = trim(opts.unit);
    return {
      title: '임원 보고용 요약', note: EXEC_NOTE, heading: (unit ? unit + ' ' : '') + (rep.type === 'monthly' ? '월간' : '주간') + ' 업무 요약',
      period: rep.period ? rep.period.start + ' ~ ' + rep.period.end : '', nextLabel: rep.type === 'monthly' ? '다음 달 계획' : '다음 주 계획',
      author: str(rep.author), approved: rep.approved || null, generated: str(rep.generated),
      totals: { parts: parts.length, reporters: rep.counts && rep.counts.reporters != null ? rep.counts.reporters : uniq(all.map(function (x) { return x.reporter; }).filter(Boolean)).length || 1,
        performance: sum('performance'), done: sum('done'), plan: sum('plan'), issue: sum('issue'), delayed: sum('delayed'), decision: sum('decision'), check: sum('check') },
      parts: parts
    };
  }
  function execSummaryHtml(m) {
    var e = L.esc, t = m.totals;
    var li = function (list, more) { return list.length ? '<ul>' + list.map(function (x) { return '<li>' + e(x) + '</li>'; }).join('') + (more ? '<li class="more">외 ' + more + '건 — 취합 보고서 참고</li>' : '') + '</ul>' : '<p class="none">없음</p>'; };
    var h = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>' + e(m.title + ' ' + m.period) + '</title><style>' +
      'body{font-family:"Malgun Gothic","맑은 고딕",sans-serif;font-size:10.5pt;color:#111;margin:18mm 16mm;word-break:keep-all;overflow-wrap:break-word}' +
      'h1{font-size:16pt;margin:0 0 4px}.temp{display:inline-block;border:1px solid #b45309;color:#b45309;padding:2px 8px;font-size:9pt;margin:4px 0 10px}' +
      '.meta{color:#444;margin:0 0 12px}table{border-collapse:collapse;width:100%;margin:0 0 14px}th,td{border:1px solid #999;padding:5px 7px;text-align:left;vertical-align:top}' +
      'th{background:#eef2f7}td.n{text-align:right}h2{font-size:12pt;margin:14px 0 6px;border-bottom:2px solid #1f3a5f;padding-bottom:2px}' +
      '.cols{display:table;width:100%;table-layout:fixed}.col{display:table-cell;padding-right:10px}.col h3{font-size:10.5pt;margin:4px 0}ul{margin:0;padding-left:18px}li{margin:2px 0}' +
      '.none{color:#777;margin:0}.more{color:#555;list-style:none;margin-left:-18px}</style></head><body>';
    h += '<h1>' + e(m.heading) + '</h1><div class="temp">' + e(m.note) + '</div>';
    h += '<p class="meta">기간 ' + e(m.period) + (m.author ? ' · 작성 ' + e(m.author) : '') + ' · ' + (m.approved ? '승인 ' + e(m.approved) : '초안') + '</p>';
    h += '<table><thead><tr><th>파트(보고 단위)</th><th>보고자</th><th>실적(완료)</th><th>' + e(m.nextLabel) + '</th><th>이슈(지연 · 의사결정)</th><th>확인 필요</th></tr></thead><tbody>';
    m.parts.forEach(function (p) {
      var c = p.counts;
      h += '<tr><td>' + e(p.name) + '</td><td class="n">' + p.reporters + '</td><td class="n">' + c.performance + ' (' + c.done + ')</td><td class="n">' + c.plan + '</td><td class="n">' + c.issue + ' (' + c.delayed + ' · ' + c.decision + ')</td><td class="n">' + c.check + '</td></tr>';
    });
    h += '<tr><th>합계 ' + t.parts + '개 파트</th><th class="n">' + t.reporters + '</th><th class="n">' + t.performance + ' (' + t.done + ')</th><th class="n">' + t.plan + '</th><th class="n">' + t.issue + ' (' + t.delayed + ' · ' + t.decision + ')</th><th class="n">' + t.check + '</th></tr></tbody></table>';
    m.parts.forEach(function (p) {
      h += '<h2>' + e(p.name) + '</h2><div class="cols"><div class="col"><h3>핵심 실적</h3>' + li(p.highlights, p.more.highlights) + '</div><div class="col"><h3>주요 이슈</h3>' + li(p.issues, p.more.issues) +
        '</div><div class="col"><h3>' + e(m.nextLabel) + '</h3>' + li(p.plans, p.more.plans) + '</div></div>';
    });
    return h + '</body></html>';
  }

  return {
    EXEC_NOTE: EXEC_NOTE, looksLikePackageText: looksLikePackageText, findMailedPackages: findMailedPackages, mailDraft: mailDraft,
    execSummary: execSummary, execSummaryHtml: execSummaryHtml,
    PACKAGE_SCHEMA: PACKAGE_SCHEMA, LEVELS: LEVELS, LEVEL_NOTE: LEVEL_NOTE, SECTIONS: SECTIONS,
    nextLevel: nextLevel, lowerLevel: lowerLevel, needsCheck: needsCheck,
    makePackage: makePackage, packageFileName: packageFileName, parsePackage: parsePackage, reportersOf: reportersOf,
    mergeBoards: mergeBoards, mergePackages: mergePackages, rollupSheets: rollupSheets
  };
});
