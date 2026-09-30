/* 자동 수집 결과(manifest) → 보고서 로직이 쓰는 메일 · 첨부 글 → 분류 보강 (순수 로직, node 테스트 대상)

   흐름: 내 PC 의 수집기(collector/Collect-OutlookMail.ps1, Outlook COM · 읽기 전용)가
         기간 안의 메일(Online 사서함 + 열려 있는 .pst)과 첨부를 한 폴더에 저장하고 manifest.json 을 남긴다
         → 이 파일이 manifest 를 메일 객체로 바꾼다(report-logic.js 의 parseEml 결과와 같은 모양)
         → 첨부 글로 ① 첨부 근거 항목 ② 결과물 배포일 ③ 프로젝트 판정(report-logic 쪽)을 보강한다.

   워드·PPT·엑셀 글 뽑기(docxXmlToText · pptxSlidesToText · xlsxToText)는 수집기 collector/CollectorCore.ps1 과
   「같은 규칙」으로 쓴 쌍둥이다. 수집기는 Windows 에서만 돌아서 macOS 개발 PC 에서는 이 JS 쌍둥이로
   같은 예시 파일을 검사한다(test/collect-logic.test.mjs). 규칙을 바꾸면 두 파일을 함께 고쳐 주세요. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CollectLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MANIFEST_SCHEMA = 'p27-collect-v1';
  var TEXT_CAP = 20000;          // 수집기가 manifest 에 넣는 첨부 글 최대 글자 수
  var STATE_TEXT_CAP = 4000;     // 브라우저 저장소(localStorage)에 남기는 첨부 글 최대 글자 수
  var XLSX_MAX_ROWS = 200;       // 시트마다 읽는 최대 줄 수

  function str(v) { return v == null ? '' : String(v); }
  function trim(v) { return str(v).trim(); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* ── 파일 종류 ─────────────────────────── */
  var KINDS = [
    ['word', /^(docx|docm|dotx)$/], ['ppt', /^(pptx|pptm|ppsx)$/], ['excel', /^(xlsx|xlsm)$/],
    ['pdf', /^pdf$/], ['illustrator', /^ai$/], ['image', /^(png|jpe?g|gif|bmp|tiff?|webp|heic)$/],
    ['text', /^(txt|csv|md|log)$/], ['old-office', /^(doc|ppt|xls)$/], ['hwp', /^(hwp|hwpx)$/],
    ['mail', /^(eml|msg)$/], ['archive', /^(zip|7z|rar|alz|egg)$/]
  ];
  var KIND_LABEL = {
    word: 'Word', ppt: 'PowerPoint', excel: 'Excel', pdf: 'PDF', illustrator: 'Illustrator', image: '그림',
    text: '글 파일', 'old-office': '옛 Office(97-2003)', hwp: '한글(HWP)', mail: '첨부 메일', archive: '압축 파일', other: '기타'
  };
  var EXTRACT_LABEL = {
    ok: '글 뽑음', empty: '글 없음', browser: '브라우저에서 읽을 차례', meta: '이름·크기만', unsupported: '못 읽는 형식',
    'too-large': '너무 커서 건너뜀', error: '읽다가 오류', skipped: '저장 안 함', 'no-file': '파일 없음(폴더를 골라 주세요)'
  };
  function extOf(name) { var m = /\.([^.\\/]+)$/.exec(str(name)); return m ? m[1].toLowerCase() : ''; }
  function kindOf(name) {
    var e = extOf(name);
    for (var i = 0; i < KINDS.length; i++) if (KINDS[i][1].test(e)) return KINDS[i][0];
    return 'other';
  }
  /* 결과물(보고서에 「배포」로 적을 만한 파일)인가 — 그림·일러스트·문서·발표자료·PDF */
  function isDeliverable(kind) { return ['word', 'ppt', 'excel', 'pdf', 'illustrator', 'image'].indexOf(kind) >= 0; }

  /* ── XML 글자 풀기 ─────────────────────── */
  function decodeXml(s) {
    return str(s).replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, function (all, k) {
      if (k === 'lt') return '<'; if (k === 'gt') return '>'; if (k === 'amp') return '&'; if (k === 'quot') return '"'; if (k === 'apos') return "'";
      var n = k.charAt(1) === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      try { return String.fromCodePoint(n); } catch (e) { return ''; }
    });
  }
  function tidy(lines) {
    return lines.map(function (l) { return l.replace(/[ \t]+$/g, ''); }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /* Word(document.xml) → 글. 문단 한 개 = 한 줄, 표는 한 행 = 한 줄(칸은 「 | 」) — CollectorCore.ps1 의 Get-DocxTextFromXml 과 같은 규칙 */
  function docxPara(p) {
    var out = '', re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br[^>]*\/>|<w:cr\/>/g, m;
    while ((m = re.exec(p))) {
      if (m[1] != null) out += decodeXml(m[1]);
      else if (m[0] === '<w:tab/>') out += '\t';
      else out += '\n';
    }
    return out;
  }
  function docxXmlToText(xml) {
    var body = (/<w:body[^>]*>([\s\S]*)<\/w:body>/.exec(str(xml)) || [])[1] || str(xml);
    var out = [], re = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g, m;
    while ((m = re.exec(body))) {
      var blk = m[0];
      if (blk.indexOf('<w:tbl>') === 0) {
        (blk.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || []).forEach(function (tr) {
          var cells = (tr.match(/<w:tc[ >][\s\S]*?<\/w:tc>/g) || []).map(function (tc) {
            return trim((tc.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).map(docxPara).join(' '));
          });
          out.push(cells.join(' | '));
        });
      } else out.push(docxPara(blk));
    }
    return tidy(out);
  }
  /* PowerPoint 슬라이드 → 글. slides = [{ n: 1, xml }] — 번호 순. 「[슬라이드 N]」 머리 다음 문단마다 한 줄 */
  function pptxSlidesToText(slides) {
    return tidy((slides || []).slice().sort(function (a, b) { return a.n - b.n; }).map(function (s) {
      var lines = [], re = /<a:p[ >][\s\S]*?<\/a:p>/g, m;
      while ((m = re.exec(str(s.xml)))) {
        var t = '', r2 = /<a:t>([^<]*)<\/a:t>|<a:br[^>]*\/>/g, k;
        while ((k = r2.exec(m[0]))) t += k[1] != null ? decodeXml(k[1]) : '\n';
        if (trim(t)) lines.push(trim(t));
      }
      return '[슬라이드 ' + s.n + ']\n' + lines.join('\n');
    }));
  }
  /* 엑셀 → 글. parts = { workbook, rels, shared, sheets: { 'xl/worksheets/sheet1.xml': xml } }
     시트마다 「[시트 이름]」 머리, 한 행 = 한 줄(빈 칸 빼고 「 | 」). 날짜 서식 칸은 엑셀 일련번호(예: 46289)로 나온다 — 2단계 */
  function xlsxShared(xml) {
    return (str(xml).match(/<si>[\s\S]*?<\/si>/g) || []).map(function (si) {
      var s = si.replace(/<rPh[\s\S]*?<\/rPh>/g, ''), out = '', re = /<t(?:\s[^>]*)?>([^<]*)<\/t>/g, m;
      while ((m = re.exec(s))) out += decodeXml(m[1]);
      return out;
    });
  }
  function attr(tag, name) { var m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag); return m ? decodeXml(m[1]) : ''; }
  function xlsxSheetList(workbookXml, relsXml) {
    var rels = {};
    (str(relsXml).match(/<Relationship\b[^>]*\/?>/g) || []).forEach(function (r) { rels[attr(r, 'Id')] = attr(r, 'Target'); });
    return (str(workbookXml).match(/<sheet\b[^>]*\/?>/g) || []).map(function (s) {
      var t = rels[attr(s, 'r:id')] || '';
      var p = t.charAt(0) === '/' ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
      return { name: attr(s, 'name'), path: p };
    });
  }
  function xlsxSheetToLines(xml, shared, maxRows) {
    var lines = [], re = /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g, m;
    while ((m = re.exec(str(xml))) && lines.length < (maxRows || XLSX_MAX_ROWS)) {
      if (m[1] == null) continue;   // 빈 줄(<row …/>)
      var vals = [], cre = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, c;
      while ((c = cre.exec(m[1]))) {
        var t = attr(' ' + c[1], 't'), inner = c[2] || '', v = (/<v>([^<]*)<\/v>/.exec(inner) || [])[1], val = '';
        if (t === 's') val = shared[parseInt(v, 10)] || '';
        else if (t === 'inlineStr') { var ir = /<t(?:\s[^>]*)?>([^<]*)<\/t>/g, q; while ((q = ir.exec(inner))) val += decodeXml(q[1]); }
        else if (t === 'b') val = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : '';
        else val = v == null ? '' : decodeXml(v);
        if (trim(val)) vals.push(trim(val));
      }
      if (vals.length) lines.push(vals.join(' | '));
    }
    return lines;
  }
  function xlsxToText(parts) {
    var shared = xlsxShared(parts.shared);
    return tidy(xlsxSheetList(parts.workbook, parts.rels).map(function (s) {
      var xml = parts.sheets && parts.sheets[s.path];
      return xml == null ? '' : '[시트 ' + s.name + ']\n' + xlsxSheetToLines(xml, shared).join('\n');
    }).filter(Boolean));
  }
  /* zip 객체(JSZip · 브라우저·node 공용) → 글. 종류가 아니면 null */
  function ooxmlTextFromZip(zip, kind) {
    function read(p) { var f = zip.file(p); return f ? f.async('string') : Promise.resolve(null); }
    if (kind === 'word') return read('word/document.xml').then(function (x) { return x == null ? '' : docxXmlToText(x); });
    if (kind === 'ppt') {
      var names = Object.keys(zip.files).filter(function (n) { return /^ppt\/slides\/slide\d+\.xml$/.test(n); });
      return Promise.all(names.map(function (n) { return read(n).then(function (x) { return { n: +/(\d+)\.xml$/.exec(n)[1], xml: x }; }); })).then(pptxSlidesToText);
    }
    if (kind === 'excel') {
      return Promise.all([read('xl/workbook.xml'), read('xl/_rels/workbook.xml.rels'), read('xl/sharedStrings.xml')]).then(function (r) {
        var list = xlsxSheetList(r[0], r[1]), sheets = {};
        return Promise.all(list.map(function (s) { return read(s.path).then(function (x) { sheets[s.path] = x; }); })).then(function () {
          return xlsxToText({ workbook: r[0], rels: r[1], shared: r[2], sheets: sheets });
        });
      });
    }
    return Promise.resolve(null);
  }

  /* pdf.js getTextContent 항목 → 줄 (data09-26 과 같은 방식). pages = [[{str, x, y, w, h}]] */
  function pdfPagesToText(pages) {
    return (pages || []).map(function (items, pi) {
      var rows = [];
      items.filter(function (it) { return it && trim(it.str); }).forEach(function (it) {
        var tol = Math.max(2, (it.h || 10) * 0.5);
        var row = rows.filter(function (r) { return Math.abs(r.y - it.y) <= tol; })[0];
        if (!row) { row = { y: it.y, items: [] }; rows.push(row); }
        row.items.push(it);
      });
      rows.sort(function (a, b) { return b.y - a.y; });
      var lines = rows.map(function (r) {
        r.items.sort(function (a, b) { return a.x - b.x; });
        var s = '', prevEnd = null;
        r.items.forEach(function (it) {
          if (prevEnd != null && it.x - prevEnd > (it.h || 10) * 0.2 && !/\s$/.test(s) && !/^\s/.test(it.str)) s += ' ';
          s += it.str; prevEnd = it.x + (it.w || 0);
        });
        return trim(s);
      });
      return '[쪽 ' + (pi + 1) + ']\n' + lines.join('\n');
    }).join('\n').trim();
  }

  /* ── 수집 설정 파일(collector/수집설정.txt) — 「이름=값」 줄, # 은 설명 ── */
  var SETTING_DEFAULTS = { 'PST폴더': '', '제외폴더': '', '저장위치': '', '첨부최대MB': '30', '작은그림KB': '15', '최대메일수': '5000', '주시작': '월', '첨부저장': '예', 'PDF포함MB': '60' };
  function parseSettingsText(text) {
    var out = {}, unknown = [];
    Object.keys(SETTING_DEFAULTS).forEach(function (k) { out[k] = SETTING_DEFAULTS[k]; });
    str(text).replace(/^﻿/, '').split(/\r?\n/).forEach(function (ln) {
      var l = trim(ln); if (!l || l.charAt(0) === '#') return;
      var i = l.indexOf('='); if (i < 1) return;
      var k = trim(l.slice(0, i)), v = trim(l.slice(i + 1));
      if (Object.prototype.hasOwnProperty.call(SETTING_DEFAULTS, k)) out[k] = v; else unknown.push(k);
    });
    out._unknown = unknown;
    return out;
  }
  /* 늘 빼는 폴더(지운 편지함 · 정크) + 설정의 제외폴더 */
  var ALWAYS_SKIP = ['지운 편지함', 'Deleted Items', '정크 메일', '정크 전자 메일', 'Junk Email', 'Junk E-mail'];
  function skipFolderNames(settings) {
    return ALWAYS_SKIP.concat(str(settings && settings['제외폴더']).split(/[,，]/).map(trim).filter(Boolean));
  }

  /* ── manifest ─────────────────────────── */
  /* manifest.json 글, 또는 manifest.js(「window.P27_COLLECT = {…};」) 글, 또는 이미 객체 */
  function parseManifest(input) {
    var m = input;
    if (typeof input === 'string') {
      var t = input.replace(/^﻿/, '').trim();
      var js = /^window\.P27_COLLECT\s*=\s*([\s\S]*?);?\s*$/.exec(t);
      m = JSON.parse(js ? js[1] : t);
    }
    if (!m || typeof m !== 'object') throw new Error('수집 결과(manifest)가 아닙니다.');
    if (m.schema !== MANIFEST_SCHEMA) throw new Error('수집 결과 형식이 다릅니다(' + (m.schema || '형식 표시 없음') + '). 이 도구의 수집기(주간보고.bat · 월간보고.bat)로 다시 모아 주세요.');
    if (!m.period || !/^\d{4}-\d{2}-\d{2}$/.test(str(m.period.start)) || !/^\d{4}-\d{2}-\d{2}$/.test(str(m.period.end))) throw new Error('수집 결과에 기간(period.start · end)이 없습니다.');
    if (!Array.isArray(m.mails)) throw new Error('수집 결과에 메일 목록(mails)이 없습니다.');
    return m;
  }
  function addr(a) { return { name: trim(a && a.name), email: trim(a && a.email).toLowerCase() }; }
  /* manifest 첨부 → 브라우저 첨부 객체 */
  function attachmentOf(a) {
    var name = trim(a.name) || '이름 없는 첨부', kind = a.kind || kindOf(name);
    return {
      name: name, type: kind, kind: kind, ext: extOf(name), size: +a.size || 0,
      file: trim(a.file), extract: a.extract || (a.text ? 'ok' : 'meta'),
      text: str(a.text).slice(0, TEXT_CAP), note: trim(a.note)
    };
  }
  /* manifest → 메일 객체 목록 (report-logic.parseEml 결과와 같은 칸 + store · folder · direction) */
  function mailsFromManifest(manifest, mainText, normalizeSubject) {
    var m = parseManifest(manifest), out = [];
    m.mails.forEach(function (x, i) {
      var body = str(x.body), subject = str(x.subject), warnings = [];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(str(x.day))) warnings.push('날짜를 읽지 못했습니다.');
      out.push({
        id: '', cid: trim(x.id) || 'M' + (i + 1), file: (trim(x.store) ? x.store + ' › ' : '') + trim(x.folder), source: 'collect',
        store: trim(x.store), storeKind: x.storeKind === 'pst' ? 'pst' : 'online', folder: trim(x.folder), direction: x.direction === 'sent' ? 'sent' : 'received',
        messageId: trim(x.messageId).replace(/^<|>$/g, ''), inReplyTo: trim(x.inReplyTo).replace(/^<|>$/g, ''),
        references: (Array.isArray(x.references) ? x.references : []).map(function (r) { return trim(r).replace(/^<|>$/g, ''); }).filter(Boolean),
        from: addr(x.from), to: (x.to || []).map(addr), cc: (x.cc || []).map(addr),
        date: trim(x.sentAt), day: trim(x.day), time: trim(x.time),
        subject: subject, subjectNorm: normalizeSubject ? normalizeSubject(subject) : subject,
        text: body.trim(), main: mainText ? mainText(body) : body.trim(), hasHtml: false,
        attachments: (x.attachments || []).map(attachmentOf), warnings: warnings
      });
    });
    return out;
  }
  /* 화면에 보여 줄 수집 요약 */
  function collectSummary(manifest) {
    var m = parseManifest(manifest), att = { total: 0, byExtract: {}, byKind: {} };
    var byStore = {};
    m.mails.forEach(function (x) {
      var k = (x.storeKind === 'pst' ? 'pst' : 'online');
      byStore[k] = (byStore[k] || 0) + 1;
      (x.attachments || []).forEach(function (a) {
        var kind = a.kind || kindOf(a.name), ex = a.extract || (a.text ? 'ok' : 'meta');
        att.total++; att.byExtract[ex] = (att.byExtract[ex] || 0) + 1; att.byKind[kind] = (att.byKind[kind] || 0) + 1;
      });
    });
    return {
      period: m.period, generatedAt: str(m.generatedAt), computer: str(m.computer),
      stores: (m.stores || []).map(function (s) { return { name: str(s.name), kind: s.kind === 'pst' ? 'pst' : 'online', path: str(s.path), mails: +s.mails || 0, added: !!s.added }; }),
      mails: m.mails.length, sent: m.mails.filter(function (x) { return x.direction === 'sent'; }).length,
      online: byStore.online || 0, pst: byStore.pst || 0, attachments: att,
      skippedFolders: (m.skippedFolders || []).map(str), duplicates: +m.duplicates || 0, warnings: (m.warnings || []).map(str)
    };
  }
  /* 브라우저 저장소에 넣기 전에 첨부 글을 줄인다(localStorage 한도) */
  function slimForState(mails) {
    return mails.map(function (m) {
      var c = Object.assign({}, m);
      c.attachments = (m.attachments || []).map(function (a) { var b = Object.assign({}, a); b.text = str(a.text).slice(0, STATE_TEXT_CAP); return b; });
      return c;
    });
  }
  /* 브라우저에서 읽어야 하는 첨부(PDF · PDF 호환 일러스트) 목록 */
  function pendingBrowserReads(mails) {
    var out = [];
    (mails || []).forEach(function (m) { (m.attachments || []).forEach(function (a) { if (a.extract === 'browser' && a.file) out.push({ mail: m, att: a }); }); });
    return out;
  }
  /* PDF 파일인가(일러스트 .ai 는 대개 PDF 호환으로 저장된다 — 머리 %PDF) */
  function looksPdf(bytes) { return !!bytes && bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; }

  /* ── 첨부 글 → 분류 보강 ───────────────── */
  /* 첨부 글에서 업무 문장을 뽑아 항목으로(출처 표시 source: 'attachment'). 같은 메일 본문 항목과 비슷하면 뺀다.
     L = RPLogic(report-logic.js), opts.perFile = 파일마다 최대 항목 수 */
  function attachmentItems(mails, tasks, bodyItems, L, opts) {
    opts = opts || {};
    var per = opts.perFile || 6, out = [], n = 0;
    mails.forEach(function (m) {
      var task = L.taskOfMail(tasks, m.id);
      var mine = (bodyItems || []).filter(function (x) { return x.evidence.indexOf(m.id) >= 0; });
      (m.attachments || []).forEach(function (a) {
        if (!trim(a.text) || a.kind === 'mail') return;
        var took = 0;
        L.sentences(a.text.replace(/\[(슬라이드|시트|쪽) [^\]]+\]/g, '\n')).forEach(function (s) {
          if (took >= per) return;
          var c = L.classifySentence(s);
          if (!c) return;
          if (mine.concat(out).some(function (x) { return x.evidence[0] === m.id && L.similarity(x.text, s) >= 0.6; })) return;
          took++;
          s = s.replace(/ \| /g, ' · ');           // 표 · 시트 한 줄의 칸 구분을 문장 모양으로
          var dates = L.extractDates(s, m.day);
          out.push({
            id: 'F' + String(++n).padStart(3, '0'), origin: 'rule', source: 'attachment', attachment: a.name,
            category: c.category, status: c.status, text: s,
            project: task ? task.project : L.OTHER_PROJECT, taskId: task ? task.id : '', taskName: task ? task.name : '',
            date: c.category === '계획' ? (dates[0] || '') : m.day, dates: dates, evidence: [m.id],
            keywords: c.keywords, decision: !!c.decision, explicit: true, reviewed: false, note: '첨부 「' + a.name + '」에서'
          });
        });
      });
    });
    return out;
  }
  /* 메일 한 통의 결과물 배포일: ① 첨부 글의 「배포일 · 발행일 · 배포 일자 : 날짜」 ② 내가 보낸 메일 + 결과물 첨부 + 배포·송부·전달·공유·제출 낱말 → 메일 날짜 */
  var RELEASE_LABEL = /(배포일|배포 일자|배포일자|발행일|릴리스|Release date)\s*[:：]?\s*([0-9]{4}[-./][0-9]{1,2}[-./][0-9]{1,2}|[0-9]{1,2}\s*월\s*[0-9]{1,2}\s*일|[0-9]{1,2}\/[0-9]{1,2})/i;
  var RELEASE_WORD = /(배포|송부|전달|공유드립|제출|업로드|발송)/;
  function releaseDateOf(m, extractDates) {
    var atts = (m.attachments || []).filter(function (a) { return isDeliverable(a.kind || kindOf(a.name)); });
    for (var i = 0; i < atts.length; i++) {
      var r = RELEASE_LABEL.exec(str(atts[i].text));
      if (r) { var d = extractDates(r[2], m.day)[0]; if (d) return { day: d, by: '첨부 「' + atts[i].name + '」의 ' + r[1] }; }
    }
    if (atts.length && m.direction === 'sent' && RELEASE_WORD.test((m.subject || '') + ' ' + (m.main || m.text || ''))) {
      return { day: m.day, by: '결과물을 첨부해 보낸 메일(' + atts.map(function (a) { return a.name; }).join(', ') + ')' };
    }
    return null;
  }
  /* 실적 항목에 배포일을 붙인다(근거 메일 중 배포일이 있는 가장 늦은 것) */
  function applyReleaseDates(items, mails, extractDates) {
    var byId = {}; (mails || []).forEach(function (m) { byId[m.id] = m; });
    return items.map(function (x) {
      if (x.category !== '실적') return x;
      var best = null;
      x.evidence.forEach(function (e) { var r = byId[e] ? releaseDateOf(byId[e], extractDates) : null; if (r && (!best || r.day > best.day)) best = r; });
      if (!best) return x;
      var y = Object.assign({}, x); y.releaseDate = best.day; y.releaseBy = best.by;
      return y;
    });
  }
  /* 수집 기간 → 보고 설정. 한 주의 시작은 수집기가 쓴 값 */
  function settingsFromManifest(manifest) {
    var m = parseManifest(manifest);
    return { type: m.period.type === 'monthly' ? 'monthly' : 'weekly', refDay: m.period.start, weekStart: m.period.weekStart === 0 ? 0 : 1 };
  }
  /* 보고 기간이 수집 기간 안에 드는가 — 아니면 「다시 모아 주세요」 */
  function periodCovered(collectPeriod, reportPeriod) {
    if (!collectPeriod || !reportPeriod) return { ok: false, missing: [] };
    var miss = [];
    if (reportPeriod.start < collectPeriod.start) miss.push(reportPeriod.start + ' ~ ' + collectPeriod.start + ' 앞');
    if (reportPeriod.end > collectPeriod.end) miss.push(collectPeriod.end + ' 뒤 ~ ' + reportPeriod.end);
    return { ok: !miss.length, missing: miss };
  }
  /* 수집 폴더의 상대 경로 맞추기: 「업무보고_수집_…/att/M0001/a.pdf」 → 「att/M0001/a.pdf」 */
  function relPathIndex(paths) {
    var idx = {};
    paths.forEach(function (p) {
      var norm = str(p).replace(/\\/g, '/'), parts = norm.split('/');
      idx[norm] = p;
      for (var i = 1; i < parts.length; i++) { var k = parts.slice(i).join('/'); if (!(k in idx)) idx[k] = p; }
    });
    return idx;
  }
  /* 자동 열기 주소(#/make?collect=…) 점검 — file:// 로 연 도구에서, file:// 의 manifest.js 만 받는다.
     (온라인 주소에서 남의 스크립트를 불러오는 통로가 되지 않도록) */
  function collectParam(hash, pageProtocol) {
    var m = /[?&]collect=([^&]+)/.exec(str(hash));
    if (!m) return { url: '', error: '' };
    var url; try { url = decodeURIComponent(m[1]); } catch (e) { return { url: '', error: '주소를 읽지 못했습니다.' }; }
    if (pageProtocol !== 'file:') return { url: '', error: '자동 열기는 내 PC 에서 연 도구(index.html)에서만 됩니다. 「수집 폴더 열기」로 골라 주세요.' };
    if (!/^file:\/\//i.test(url) || !/\/manifest\.js$/i.test(url)) return { url: '', error: '수집 결과 주소가 아닙니다(file://…/manifest.js 만 엽니다).' };
    return { url: url, error: '' };
  }

  return {
    MANIFEST_SCHEMA: MANIFEST_SCHEMA, TEXT_CAP: TEXT_CAP, STATE_TEXT_CAP: STATE_TEXT_CAP, KIND_LABEL: KIND_LABEL, EXTRACT_LABEL: EXTRACT_LABEL,
    extOf: extOf, kindOf: kindOf, isDeliverable: isDeliverable, decodeXml: decodeXml,
    docxXmlToText: docxXmlToText, pptxSlidesToText: pptxSlidesToText, xlsxShared: xlsxShared, xlsxSheetList: xlsxSheetList,
    xlsxSheetToLines: xlsxSheetToLines, xlsxToText: xlsxToText, ooxmlTextFromZip: ooxmlTextFromZip, pdfPagesToText: pdfPagesToText,
    SETTING_DEFAULTS: SETTING_DEFAULTS, parseSettingsText: parseSettingsText, ALWAYS_SKIP: ALWAYS_SKIP, skipFolderNames: skipFolderNames,
    parseManifest: parseManifest, mailsFromManifest: mailsFromManifest, collectSummary: collectSummary, slimForState: slimForState,
    pendingBrowserReads: pendingBrowserReads, looksPdf: looksPdf,
    attachmentItems: attachmentItems, releaseDateOf: releaseDateOf, applyReleaseDates: applyReleaseDates,
    settingsFromManifest: settingsFromManifest, periodCovered: periodCovered, relPathIndex: relPathIndex, collectParam: collectParam,
    pad: pad
  };
});
