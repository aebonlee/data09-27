/* 업무보고 자동생성 Agent · 순수 로직 (화면·저장소와 무관, node 테스트 대상)
   data09-10 과제 B 의 js/report-logic.js 를 가져와 이어 쓴다. data09-27 에서 바꾼 곳(「data09-27:」 주석):
   ① 프로젝트 판정에 첨부 파일 글(attachments[].text)도 쓴다 ② AI 프롬프트에 첨부 글 발췌를 넣는다
   ③ 양식 표의 결과물 배포일은 항목의 releaseDate(첨부로 찾은 배포일)를 먼저 쓴다 ④ 결과물 이미지에 일러스트(.ai)도 넣는다
   ⑤ 첨부에서 뽑은 항목은 「첨부 근거」로 표시한다 ⑥ parseEml(…, { keepBytes: true }) 이면 첨부 바이트를 남긴다(직접 넣은 .eml 의 첨부 글 뽑기)
   ⑦ 저장 형태에 마지막 자동 수집 요약(collect)을 둔다
   ⑧ (2026-09-30 답변) 보고 단계(settings.level: 팀원 · 파트리더 · 팀장 · 임원)와 취합 상태(rollup)를 저장한다.
      보고서에 rep.sections 가 있으면 그 절 순서를 쓰고, 「보고자별 취합 현황」(sources) 절을 그린다 — 취합 로직은 js/rollup-logic.js
   원래 설명(과제 B):
   흐름(제출 기획서 5.1): 보고 기간 설정 → 메일 수집(.eml 파싱) → 업무 단위 그룹핑 → 실적·계획·이슈 분류
   → 이전 보고서 계획과 비교 → 근거가 붙은 보고서 초안 → 사용자 검토·승인 → Word·Excel·인쇄
   설계 원칙(1.3·7.2): 업무 단위 통합 / 주요 내용에 근거 메일 연결 / 확인 못 한 완료·성과·일정은 확정하지 않음 /
   AI 추론은 명시 사실과 구분 / 발송보다 검토·승인 우선 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RPLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SCHEMA_VERSION = 'p27-v0.1';  // data09-27: 자동 수집(manifest) 판. 이전: rp-v0.2-stage1(data09-10)
  var CATEGORIES = ['실적', '계획', '이슈'];
  var CATEGORY_EN = { '실적': 'Performance', '계획': 'Plan', '이슈': 'Issue' };
  /* 기획서 3.2 진행 상태 */
  var STATUSES = ['예정', '진행 중', '완료', '지연', '보류', '확인 필요'];
  var ORIGINS = { rule: '규칙 분류', ai: 'AI 추출(검토 필요)', manual: '직접 입력' };
  var REPORT_TYPES = [
    { id: 'weekly', name: '주간보고(Weekly)', next: '차주' },
    { id: 'monthly', name: '월간보고(Monthly)', next: '차월' }
  ];
  /* 기획서 4.1 · 4.2 보고서 섹션 */
  var SECTIONS = {
    weekly: [
      { id: 'summary', name: '기간·요약' },
      { id: 'board', name: '주간 업무보고 — 양식 표' },
      { id: 'performance', name: '01. Weekly Performance — 금주 주요 실적' },
      { id: 'plan', name: '02. Next Week Plan — 차주 주요 계획' },
      { id: 'issue', name: '03. Key Issues & Risks — 주요 이슈 및 리스크' },
      { id: 'carry', name: '참고 — 이전 보고서 계획 대비' }
    ],
    monthly: [
      { id: 'summary', name: 'Executive Summary — 월간 핵심 요약' },
      { id: 'performance', name: 'Monthly Performance — 프로젝트별 실적' },
      { id: 'status', name: 'Project Status — 프로젝트별 진행 상태' },
      { id: 'plan', name: 'Next Month Plan — 차월 추진계획' },
      { id: 'issue', name: 'Key Issues — 지속·신규 이슈' },
      { id: 'decision', name: 'Decision Required — 의사결정·지원 요청' },
      { id: 'carry', name: '참고 — 이전 보고서 계획 대비' }
    ]
  };
  var OTHER_PROJECT = '기타';

  /* ── 작은 도구 ───────────────────────── */
  function str(v) { return v == null ? '' : String(v); }
  function trim(v) { return str(v).trim(); }
  function pad(n, w) { var s = String(n); while (s.length < (w || 2)) s = '0' + s; return s; }
  function esc(v) {
    return str(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function xmlEsc(v) {
    // XML 1.0 에 넣을 수 없는 제어문자는 뺀다(탭·줄바꿈 제외)
    return esc(str(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''));
  }
  function uniq(list) { var seen = {}, out = []; list.forEach(function (x) { if (!seen[x]) { seen[x] = 1; out.push(x); } }); return out; }

  /* ── 바이트·문자셋 ───────────────────── */
  var CHARSET_ALIAS = {
    'ks_c_5601-1987': 'euc-kr', 'ks_c_5601': 'euc-kr', 'ksc5601': 'euc-kr', 'cp949': 'euc-kr', 'x-windows-949': 'euc-kr',
    'windows-949': 'euc-kr', 'euckr': 'euc-kr', 'utf8': 'utf-8', 'us-ascii': 'utf-8', 'ascii': 'utf-8', 'latin1': 'iso-8859-1'
  };
  function normCharset(cs) {
    cs = trim(cs).toLowerCase().replace(/^"|"$/g, '');
    if (!cs) return 'utf-8';
    return CHARSET_ALIAS[cs] || cs;
  }
  /* 바이너리 문자열(한 글자 = 한 바이트) ↔ 바이트 배열 */
  function binToBytes(bin) {
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xFF;
    return out;
  }
  function bytesToBin(bytes) {
    var s = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, Array.prototype.slice.call(bytes, i, i + CH));
    return s;
  }
  function decodeBytes(bytes, charset) {
    var cs = normCharset(charset);
    if (typeof TextDecoder !== 'undefined') {
      try { return new TextDecoder(cs).decode(bytes); }
      catch (e) { try { return new TextDecoder('utf-8').decode(bytes); } catch (e2) { /* 아래로 */ } }
    }
    return bytesToBin(bytes);
  }
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function base64ToBytes(s) {
    s = str(s).replace(/[^A-Za-z0-9+/]/g, '');
    var out = [], buf = 0, bits = 0;
    for (var i = 0; i < s.length; i++) {
      buf = (buf << 6) | B64.indexOf(s.charAt(i)); bits += 6;
      if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 0xFF); }
    }
    return new Uint8Array(out);
  }
  function bytesToBase64(bytes) {
    var out = '', i;
    for (i = 0; i + 2 < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
    }
    if (i < bytes.length) {
      var a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0;
      var m = (a << 16) | (b << 8);
      out += B64[(m >> 18) & 63] + B64[(m >> 12) & 63] + (i + 1 < bytes.length ? B64[(m >> 6) & 63] : '=') + '=';
    }
    return out;
  }
  /* quoted-printable → 바이트. header=true 면 RFC 2047 Q 인코딩(_ = 공백) */
  function qpToBytes(s, header) {
    s = str(s);
    if (!header) s = s.replace(/=\r?\n/g, ''); // 부드러운 줄바꿈
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))) { out.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; }
      else if (header && c === '_') out.push(0x20);
      else out.push(s.charCodeAt(i) & 0xFF);
    }
    return new Uint8Array(out);
  }

  /* RFC 2047 인코딩 제목·이름: =?charset?B|Q?...?= — 붙어 있는 인코딩 단어 사이의 공백은 버린다 */
  function decodeWords(v) {
    v = str(v);
    var re = /=\?([^?*]+)(?:\*[^?]*)?\?([BbQq])\?([^?]*)\?=/g;
    // 인코딩 단어 사이의 공백만 지운다
    v = v.replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?[^?]+\?[BbQq]\?[^?]*\?=)/g, '$1');
    // 같은 문자셋의 연속 단어는 바이트를 이어 붙여 한 번에 푼다(멀티바이트 글자가 단어 경계에서 잘리는 경우)
    var out = '', last = 0, m, pend = null;
    function flush() { if (pend) { out += decodeBytes(new Uint8Array(pend.bytes), pend.cs); pend = null; } }
    while ((m = re.exec(v))) {
      var gap = v.slice(last, m.index);
      if (gap) { flush(); out += gap; }
      var bytes = m[2].toUpperCase() === 'B' ? base64ToBytes(m[3]) : qpToBytes(m[3], true);
      var cs = normCharset(m[1]);
      if (pend && pend.cs === cs) pend.bytes = pend.bytes.concat(Array.prototype.slice.call(bytes));
      else { flush(); pend = { cs: cs, bytes: Array.prototype.slice.call(bytes) }; }
      last = re.lastIndex;
    }
    flush();
    return out + v.slice(last);
  }
  /* 헤더 값 풀기: 인코딩 없이 8비트 UTF-8 로 온 값도 살린다 */
  function decodeHeaderValue(bin) {
    var v = str(bin);
    if (/[\u0080-ÿ]/.test(v) && !/[Ā-￿]/.test(v)) v = decodeBytes(binToBytes(v), 'utf-8');
    return decodeWords(v).replace(/\s+/g, ' ').trim();
  }

  /* ── 헤더 ───────────────────────────── */
  function splitHeadBody(bin) {
    var m = /\r?\n\r?\n/.exec(bin);
    if (!m) return { head: bin, body: '' };
    return { head: bin.slice(0, m.index), body: bin.slice(m.index + m[0].length) };
  }
  function parseHeaders(head) {
    var lines = str(head).replace(/\r\n/g, '\n').replace(/\n[ \t]+/g, ' ').split('\n'); // 접힌 줄 펴기
    var map = {};
    lines.forEach(function (ln) {
      var i = ln.indexOf(':');
      if (i <= 0) return;
      var k = ln.slice(0, i).trim().toLowerCase(), v = ln.slice(i + 1).trim();
      if (map[k] == null) map[k] = v; // 첫 번째 값
    });
    return map;
  }
  /* Content-Type · Content-Disposition 값과 매개변수(따옴표, RFC 2231 name*=, name*0*= 이어붙이기) */
  function parseParams(value) {
    value = str(value);
    var parts = [], cur = '', q = false;
    for (var i = 0; i < value.length; i++) {
      var c = value.charAt(i);
      if (c === '"') q = !q;
      if (c === ';' && !q) { parts.push(cur); cur = ''; } else cur += c;
    }
    parts.push(cur);
    var res = { value: trim(parts.shift()).toLowerCase(), params: {} }, ext = {};
    parts.forEach(function (p) {
      var i = p.indexOf('=');
      if (i < 0) return;
      var k = trim(p.slice(0, i)).toLowerCase(), v = trim(p.slice(i + 1));
      if (/^".*"$/.test(v)) v = v.slice(1, -1).replace(/\\(.)/g, '$1');
      var m = /^([^*]+)\*(\d+)?(\*)?$/.exec(k);
      if (m) { (ext[m[1]] = ext[m[1]] || []).push({ n: +(m[2] || 0), enc: !!m[3] || m[2] == null, v: v }); }
      else res.params[k] = v;
    });
    Object.keys(ext).forEach(function (k) {
      var segs = ext[k].sort(function (a, b) { return a.n - b.n; }), cs = 'utf-8', bytes = [];
      segs.forEach(function (s, idx) {
        var v = s.v;
        if (idx === 0 && s.enc) { var mm = /^([^']*)'[^']*'(.*)$/.exec(v); if (mm) { cs = mm[1] || cs; v = mm[2]; } }
        if (s.enc) v.replace(/%([0-9A-Fa-f]{2})|([^%])/g, function (_, hx, ch) { bytes.push(hx ? parseInt(hx, 16) : ch.charCodeAt(0) & 0xFF); return ''; });
        else for (var j = 0; j < v.length; j++) bytes.push(v.charCodeAt(j) & 0xFF);
      });
      res.params[k] = decodeBytes(new Uint8Array(bytes), cs);
    });
    return res;
  }
  /* 주소 목록: "이름" <a@b>, =?UTF-8?B?...?= <c@d>, e@f */
  function parseAddressList(v) {
    v = str(v);
    var parts = [], cur = '', q = false, ang = false;
    for (var i = 0; i < v.length; i++) {
      var c = v.charAt(i);
      if (c === '"') q = !q;
      else if (c === '<') ang = true; else if (c === '>') ang = false;
      if (c === ',' && !q && !ang) { parts.push(cur); cur = ''; } else cur += c;
    }
    parts.push(cur);
    var out = [];
    parts.forEach(function (p) {
      p = trim(p); if (!p) return;
      // 주소 없이 이름만 「A; B」(Outlook 의 받는 사람 표시 — tools/outlook 내보내기)면 이름만 여러 명으로
      if (p.indexOf('@') < 0 && p.indexOf('<') < 0) {
        decodeHeaderValue(p).split(/\s*;\s*/).map(trim).filter(Boolean).forEach(function (nm) { out.push({ name: nm, email: '' }); });
        return;
      }
      out.push(one(p));
    });
    return out;
    function one(p) {
      var m = /^(.*)<([^>]+)>\s*$/.exec(p);
      var name = m ? trim(m[1]).replace(/^"|"$/g, '') : '', email = trim(m ? m[2] : p);
      name = decodeHeaderValue(name);
      return { name: name, email: email };
    }
  }
  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  /* RFC 5322 날짜 → { iso(UTC), day(보낸 쪽 시간대의 날짜), time } */
  function parseMailDate(v) {
    var m = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{4}|GMT|UT|UTC|Z|[A-Z]{3})?/.exec(str(v));
    if (!m) {
      var t = Date.parse(str(v));
      if (isNaN(t)) return null;
      var d = new Date(t);
      return { iso: d.toISOString(), day: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) };
    }
    var y = +m[3]; if (y < 100) y += y < 50 ? 2000 : 1900;
    var mon = MONTHS[m[2].toLowerCase()]; if (!mon) return null;
    var off = 0, z = m[7] || '+0000';
    if (/^[+-]\d{4}$/.test(z)) off = (z.charAt(0) === '-' ? -1 : 1) * (+z.slice(1, 3) * 60 + +z.slice(3, 5));
    var utc = Date.UTC(y, mon - 1, +m[1], +m[4], +m[5], +(m[6] || 0)) - off * 60000;
    return { iso: new Date(utc).toISOString(), day: y + '-' + pad(mon) + '-' + pad(+m[1]), time: pad(+m[4]) + ':' + m[5] };
  }

  /* ── 본문 ───────────────────────────── */
  function decodeTransfer(bin, enc) {
    enc = trim(enc).toLowerCase();
    if (enc === 'base64') return base64ToBytes(bin);
    if (enc === 'quoted-printable') return qpToBytes(bin, false);
    return binToBytes(bin);
  }
  var ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", middot: '·', hellip: '…', ndash: '–', mdash: '—' };
  function htmlToText(html) {
    return str(html)
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6]|table|blockquote)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, '')
      .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (all, e) {
        if (e.charAt(0) === '#') { var n = e.charAt(1).toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return isNaN(n) ? all : String.fromCharCode(n); }
        return ENTITIES[e.toLowerCase()] != null ? ENTITIES[e.toLowerCase()] : all;
      })
      .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  /* MIME 한 덩어리를 재귀로 풀어 text·html·첨부를 모은다 */
  function walkPart(bin, acc, depth) {
    var hb = splitHeadBody(bin), hd = parseHeaders(hb.head);
    var ct = parseParams(hd['content-type'] || 'text/plain; charset=us-ascii');
    var cd = parseParams(hd['content-disposition'] || '');
    var enc = hd['content-transfer-encoding'] || '';
    var fname = cd.params.filename || ct.params.name || '';
    if (fname) fname = decodeHeaderValue(fname);
    if (/^multipart\//.test(ct.value) && ct.params.boundary && depth < 8) {
      var b = '--' + ct.params.boundary, pieces = hb.body.split(b);
      pieces.slice(1).forEach(function (p) {
        if (/^--/.test(p)) return; // 끝 경계
        walkPart(p.replace(/^\r?\n/, '').replace(/\r?\n$/, ''), acc, depth + 1);
      });
      return;
    }
    var isAttach = cd.value === 'attachment' || (!!fname && !/^text\/(plain|html)$/.test(ct.value)) || (!!fname && cd.value !== 'inline');
    if (ct.value === 'message/rfc822') isAttach = true;
    if (isAttach) {
      var bytes = decodeTransfer(hb.body, enc);
      // 내용 없이 이름만 담은 첨부(tools/outlook/Export-OutlookMail.ps1)는 Content-Disposition 의 size 매개변수(RFC 2183)로 크기를 적는다
      var declared = Number(cd.params.size);
      var att = { name: fname || (ct.value === 'message/rfc822' ? '첨부 메일.eml' : '이름 없는 첨부'), type: ct.value, size: bytes.length || (declared > 0 ? declared : 0) };
      if (acc.keepBytes && bytes.length) att._bytes = bytes;   // data09-27: 직접 넣은 .eml 의 첨부 글도 뽑도록(화면이 글을 뽑은 뒤 지운다)
      acc.attachments.push(att);
      return;
    }
    if (ct.value === 'text/plain' || ct.value === 'text/html') {
      var text = decodeBytes(decodeTransfer(hb.body, enc), ct.params.charset);
      if (ct.value === 'text/plain') acc.text.push(text); else acc.html.push(text);
    }
  }
  /* 회신·전달 메일의 인용 부분을 떼어 「이번 메일에서 새로 쓴 내용」만 남긴다 */
  var QUOTE_MARKERS = [
    /^-{2,}\s*(Original Message|원본 메시지|Forwarded message|전달된 메시지)\s*-{2,}/i,
    /^(From|보낸 사람|보낸사람)\s*:\s*.+/,
    /^On .+wrote:$/, /^20\d\d.*작성:$/
  ];
  function mainText(text) {
    var lines = str(text).replace(/\r\n/g, '\n').split('\n'), out = [];
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (QUOTE_MARKERS.some(function (re) { return re.test(ln.trim()); })) break;
      if (/^\s*>/.test(ln)) continue;
      out.push(ln);
    }
    return out.join('\n').trim();
  }

  /* 제목 정규화: RE:/FW:/Fwd:/회신:/전달:/답장: 과 [외부] 같은 표시를 반복해서 걷어 낸다 */
  var NOISE_TAGS = ['외부', '외부메일', 'external', 'ext', '긴급', 'urgent', '공유', '참고', '중요', 'fyi', '보안'];
  var PREFIX_RE = /^\s*((re|fw|fwd|aw|wg|회신|전달|답장|답변)\s*(\[\d+\]|\(\d+\))?\s*[:：]\s*)/i;
  function subjectParts(subject) {
    var s = str(subject), tags = [], guard = 0, changed = true;
    while (changed && guard++ < 20) {
      changed = false;
      var m = PREFIX_RE.exec(s);
      if (m) { s = s.slice(m[0].length); changed = true; continue; }
      var t = /^\s*[\[【]([^\]】]{1,40})[\]】]\s*/.exec(s);
      if (t) {
        var tag = trim(t[1]);
        if (NOISE_TAGS.indexOf(tag.toLowerCase()) < 0) tags.push(tag);
        s = s.slice(t[0].length); changed = true;
      }
    }
    return { tags: tags, rest: trim(s).replace(/\s+/g, ' ') };
  }
  function normalizeSubject(subject) {
    var p = subjectParts(subject);
    return (p.tags.length ? '[' + p.tags.join('][') + '] ' : '') + p.rest;
  }

  /* .eml 한 통 → 메일 객체. input 은 Uint8Array(파일) 또는 문자열(붙여넣기 / 바이너리 문자열) */
  function parseEml(input, opts) {
    opts = opts || {};
    var bin;
    if (input && typeof input === 'object' && typeof input.length === 'number') bin = bytesToBin(input);
    else {
      bin = str(input);
      // 붙여 넣은 글처럼 이미 풀린 유니코드면 UTF-8 바이트 문자열로 바꿔 같은 길로 푼다
      if (/[Ā-￿]/.test(bin)) bin = bytesToBin(new TextEncoderLite().encode(bin));
    }
    var hb = splitHeadBody(bin), hd = parseHeaders(hb.head);
    var acc = { text: [], html: [], attachments: [], keepBytes: !!opts.keepBytes }, warnings = [];
    if (!hd.from && !hd.subject && !hd.date) warnings.push('메일 머리글(From·Subject·Date)을 찾지 못했습니다. .eml 파일이 맞는지 확인해 주세요.');
    walkPart(bin, acc, 0);
    var text = acc.text.length ? acc.text.join('\n') : acc.html.map(htmlToText).join('\n');
    if (!acc.text.length && !acc.html.length) warnings.push('본문(text/plain·text/html)이 없습니다.');
    var date = parseMailDate(hd.date || '');
    if (!date) warnings.push('보낸 날짜를 읽지 못했습니다.');
    var subject = decodeHeaderValue(hd.subject || '');
    var from = parseAddressList(hd.from || '')[0] || { name: '', email: '' };
    return {
      id: opts.id || '', file: opts.file || '',
      messageId: trim(hd['message-id']).replace(/^<|>$/g, ''),
      inReplyTo: trim(hd['in-reply-to']).replace(/^<|>$/g, ''),
      references: (hd.references || '').match(/<[^>]+>/g) ? hd.references.match(/<[^>]+>/g).map(function (x) { return x.slice(1, -1); }) : [],
      from: from, to: parseAddressList(hd.to || ''), cc: parseAddressList(hd.cc || ''),
      date: date ? date.iso : '', day: date ? date.day : '', time: date ? date.time : '',
      subject: subject, subjectNorm: normalizeSubject(subject),
      text: text.trim(), main: mainText(text), hasHtml: acc.html.length > 0,
      attachments: acc.attachments, warnings: warnings
    };
  }
  /* 문자열 → UTF-8 바이트 (TextEncoder 가 없는 환경 대비) */
  function TextEncoderLite() {}
  TextEncoderLite.prototype.encode = function (s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xD800 && c < 0xDC00 && i + 1 < s.length) { c = 0x10000 + ((c - 0xD800) << 10) + (s.charCodeAt(++i) - 0xDC00); }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | c >> 6, 0x80 | c & 63);
      else if (c < 0x10000) out.push(0xE0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63);
      else out.push(0xF0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63);
    }
    return new Uint8Array(out);
  };
  /* 붙여 넣은 글(.msg 를 열어 복사한 내용 등) → 메일 객체. 머리글이 없으면 사용자가 준 값으로 채운다 */
  function mailFromPaste(text, meta) {
    meta = meta || {};
    var t = str(text).replace(/\r\n/g, '\n');
    var hasHeader = /^(From|Subject|Date|보낸 사람|제목)\s*:/im.test(t.split('\n\n')[0] || '');
    if (hasHeader && /^(From|Subject|Date)\s*:/im.test(t)) {
      var m = parseEml(t, meta);
      m.source = 'paste';
      return m;
    }
    // Outlook 에서 복사하면 「보낸 사람: / 보낸 날짜: / 받는 사람: / 제목:」 머리글이 붙는다
    var lines = t.split('\n'), hd = {}, i = 0;
    for (; i < lines.length && i < 12; i++) {
      var mm = /^(보낸 사람|보낸사람|받는 사람|받는사람|참조|보낸 날짜|날짜|제목)\s*:\s*(.*)$/.exec(lines[i].trim());
      if (!mm) { if (lines[i].trim() === '' && Object.keys(hd).length) { i++; break; } if (Object.keys(hd).length) break; continue; }
      hd[mm[1].replace(/\s/g, '')] = mm[2];
    }
    var body = Object.keys(hd).length ? lines.slice(i).join('\n') : t;
    var subject = meta.subject || hd['제목'] || '';
    var day = meta.day || koreanDateToDay(hd['보낸날짜'] || hd['날짜'] || '') || '';
    var from = parseAddressList(meta.from || hd['보낸사람'] || '')[0] || { name: '', email: '' };
    return {
      id: meta.id || '', file: meta.file || '(붙여넣기)', source: 'paste',
      messageId: '', inReplyTo: '', references: [],
      from: from, to: parseAddressList(hd['받는사람'] || ''), cc: parseAddressList(hd['참조'] || ''),
      date: day ? day + 'T00:00:00.000Z' : '', day: day, time: '',
      subject: subject, subjectNorm: normalizeSubject(subject),
      text: body.trim(), main: mainText(body), hasHtml: false, attachments: [],
      warnings: day ? [] : ['날짜를 읽지 못했습니다. 날짜 칸을 채워 주세요.']
    };
  }
  /* 「2026년 9월 21일 월요일 오전 9:12」, 「2026-09-21」, 「2026.9.21」 → 2026-09-21 */
  function koreanDateToDay(v) {
    var m = /(20\d\d)\s*[년.\-/]\s*(\d{1,2})\s*[월.\-/]\s*(\d{1,2})/.exec(str(v));
    return m ? m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]) : '';
  }
  function nextMailId(mails) {
    var max = 0;
    (mails || []).forEach(function (m) { var n = /^E(\d+)$/.exec(m.id || ''); if (n) max = Math.max(max, +n[1]); });
    return 'E' + pad(max + 1, 3);
  }
  /* 같은 메일을 두 번 넣지 않는다: Message-ID, 없으면 보낸이·시각·제목 */
  function mailKey(m) { return m.messageId ? 'mid:' + m.messageId.toLowerCase() : 'k:' + [m.from && m.from.email, m.date, m.subject].join('|').toLowerCase(); }
  function addMails(existing, incoming) {
    var list = (existing || []).slice(), keys = {}, added = [], dup = [];
    list.forEach(function (m) { keys[mailKey(m)] = 1; });
    // 날짜 순으로 번호를 매겨야 E001 이 가장 오래된 메일이 된다
    incoming.slice().sort(function (a, b) { return str(a.date).localeCompare(str(b.date)); }).forEach(function (m) {
      var k = mailKey(m);
      if (keys[k]) { dup.push(m); return; }
      keys[k] = 1;
      var copy = Object.assign({}, m); copy.id = nextMailId(list);
      list.push(copy); added.push(copy);
    });
    list.sort(function (a, b) { return str(a.date).localeCompare(str(b.date)) || a.id.localeCompare(b.id); });
    return { mails: list, added: added, duplicates: dup };
  }

  /* ── 보고 기간 ───────────────────────── */
  function parseDay(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(s)); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; }
  function fmtDay(t) { var d = new Date(t); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function addDays(day, n) { return fmtDay(parseDay(day) + n * 86400000); }
  var DOW = ['일', '월', '화', '수', '목', '금', '토'];
  function dow(day) { return DOW[new Date(parseDay(day)).getUTCDay()]; }
  /* 기준일이 속한 주(시작 요일 weekStart, 0=일 1=월)·달 */
  function periodFor(type, refDay, weekStart) {
    if (isNaN(parseDay(refDay))) return null;
    if (type === 'monthly') {
      var d = new Date(parseDay(refDay)), y = d.getUTCFullYear(), mo = d.getUTCMonth();
      var start = fmtDay(Date.UTC(y, mo, 1)), end = fmtDay(Date.UTC(y, mo + 1, 0));
      var ns = fmtDay(Date.UTC(y, mo + 1, 1)), ne = fmtDay(Date.UTC(y, mo + 2, 0));
      return { type: 'monthly', start: start, end: end, label: y + '년 ' + (mo + 1) + '월', next: { start: ns, end: ne, label: new Date(parseDay(ns)).getUTCFullYear() + '년 ' + (new Date(parseDay(ns)).getUTCMonth() + 1) + '월' } };
    }
    var ws = weekStart == null ? 1 : +weekStart;
    var back = (new Date(parseDay(refDay)).getUTCDay() - ws + 7) % 7;
    var s = addDays(refDay, -back), e = addDays(s, 6);
    return { type: 'weekly', start: s, end: e, label: s + '(' + dow(s) + ') ~ ' + e + '(' + dow(e) + ')',
      next: { start: addDays(s, 7), end: addDays(e, 7), label: addDays(s, 7) + ' ~ ' + addDays(e, 7) } };
  }
  function previousPeriod(p, weekStart) {
    if (!p) return null;
    return periodFor(p.type, addDays(p.start, -1), weekStart);
  }
  function inPeriod(day, p) { return !!(p && day && day >= p.start && day <= p.end); }

  /* ── 프로젝트·업무 그룹핑 ─────────────── */
  /* projects: [{ name, keywords: ['캡', '인테리어'] }] — 이름 자체도 키워드로 쓴다 */
  function cleanProjects(list) {
    return (list || []).map(function (p) {
      var name = trim(p.name);
      var kws = (Array.isArray(p.keywords) ? p.keywords : str(p.keywords).split(/[,，\n]/)).map(trim).filter(Boolean);
      return name ? { name: name, keywords: uniq(kws), group: trim(p.group) } : null;
    }).filter(Boolean);
  }
  function squash(s) { return str(s).toLowerCase().replace(/[\s\[\]【】()_\-·.,:]/g, ''); }
  function projectOf(mail, projects) {
    var sp = subjectParts(mail.subject);
    var hay = squash(sp.tags.join(' ') + ' ' + sp.rest + ' ' + (mail.attachments || []).map(function (a) { return a.name; }).join(' '));
    // data09-27: 첨부 파일 글(워드·PPT·엑셀·PDF 에서 뽑은 글)도 본문처럼 약하게(1점) 본다
    var body = squash((mail.main || mail.text) + ' ' + (mail.attachments || []).map(function (a) { return str(a.text).slice(0, 4000); }).join(' '));
    var best = null, bestScore = 0;
    (projects || []).forEach(function (p) {
      var score = 0;
      [p.name].concat(p.keywords).forEach(function (k, idx) {
        var kk = squash(k); if (!kk) return;
        if (sp.tags.some(function (t) { return squash(t) === kk; })) score += 10; // 제목 [태그] 와 같으면 확실
        else if (hay.indexOf(kk) >= 0) score += idx === 0 ? 4 : 3;
        else if (body.indexOf(kk) >= 0) score += 1;
      });
      if (score > bestScore) { bestScore = score; best = p.name; }
    });
    if (best && bestScore >= 3) return { project: best, by: 'keyword' };
    if (sp.tags.length) return { project: sp.tags[0], by: 'tag' };
    return { project: OTHER_PROJECT, by: 'none' };
  }
  /* 같은 업무 = 회신·전달로 이어진 메일(Message-ID/References) + 정규화한 제목이 같은 메일 */
  function groupTasks(mails, projects) {
    projects = cleanProjects(projects);
    var parent = {};
    function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    function unite(a, b) { a = find(a); b = find(b); if (a !== b) parent[b] = a; }
    var byMid = {}, bySubj = {};
    mails.forEach(function (m) { parent[m.id] = m.id; if (m.messageId) byMid[m.messageId.toLowerCase()] = m.id; });
    mails.forEach(function (m) {
      [m.inReplyTo].concat(m.references || []).forEach(function (r) { var o = r && byMid[r.toLowerCase()]; if (o) unite(o, m.id); });
      var key = squash(subjectParts(m.subject).rest);
      if (key) { if (bySubj[key]) unite(bySubj[key], m.id); else bySubj[key] = m.id; }
    });
    var groups = {};
    mails.forEach(function (m) { var r = find(m.id); (groups[r] = groups[r] || []).push(m); });
    var tasks = Object.keys(groups).map(function (r) {
      var ms = groups[r].slice().sort(function (a, b) { return str(a.date).localeCompare(str(b.date)); });
      var votes = {};
      ms.forEach(function (m) { var p = projectOf(m, projects); votes[p.project] = (votes[p.project] || 0) + (p.by === 'none' ? 0.5 : 1); });
      var project = Object.keys(votes).sort(function (a, b) { return votes[b] - votes[a] || (a === OTHER_PROJECT) - (b === OTHER_PROJECT); })[0];
      return {
        key: 'T:' + squash(subjectParts(ms[0].subject).rest || ms[0].id),
        name: subjectParts(ms[0].subject).rest || '(제목 없음)',
        project: project, mailIds: ms.map(function (m) { return m.id; }),
        first: ms[0].day, last: ms[ms.length - 1].day,
        attachments: uniq([].concat.apply([], ms.map(function (m) { return (m.attachments || []).map(function (a) { return a.name; }); })))
      };
    });
    tasks.sort(function (a, b) { return (a.project === OTHER_PROJECT) - (b.project === OTHER_PROJECT) || a.project.localeCompare(b.project) || str(a.first).localeCompare(str(b.first)); });
    tasks.forEach(function (t, i) { t.id = 'T' + pad(i + 1, 2); });
    return tasks;
  }
  function taskOfMail(tasks, mailId) { return tasks.filter(function (t) { return t.mailIds.indexOf(mailId) >= 0; })[0] || null; }

  /* ── 실적·계획·이슈 규칙 분류 (1차) ───── */
  var RULES = {
    issue: ['지연', '늦어', '차질', '문제', '이슈', '리스크', '위험', '불량', '미확정', '미정', '회신 없', '회신이 없', '회신 지연', '충돌', '보류', '누락', '부족', '오류', '결함', '재작업', '어려움', '결정 필요', '의사결정', '확인이 필요', '확인 필요', '승인 필요', '우려'],
    done: ['완료했', '완료하였', '완료되었', '완료됨', '완료 했', '마쳤', '마무리했', '끝냈', '제출했', '제출하였', '제출 완료', '선정했', '선정하였', '확정했', '확정되었', '반영했', '반영하였', '배포했', '송부했', '전달했', '입고 완료', '검토 완료', '작성 완료', '테스트 완료', '완료'],
    doing: ['진행했', '진행하였', '진행 중', '진행중', '착수했', '착수하였', '수행했', '수행하였', '실시했', '검토했', '검토하였', '작성 중', '작업 중', '협의했', '논의했', '공유했', '공유드립니다', '회의를 가졌', '회의 결과'],
    plan: ['예정', '계획', '차주', '다음 주', '다음주', '차월', '다음 달', '다음달', '할 계획', '하겠습니다', '진행할', '착수할', '추진', '까지 회신', '까지 제출', '까지 완료', '목표'],
    decision: ['결정 필요', '의사결정', '승인 필요', '승인 요청', '결재', '판단 부탁', '지원 요청', '검토 요청', '결정해', '여부 결정', '결정이 필요']
  };
  function hits(text, list) { var n = 0, found = []; list.forEach(function (k) { if (text.indexOf(k) >= 0) { n++; found.push(k); } }); return { n: n, found: found }; }
  /* 문장 하나 → { category, status, keywords } 또는 null(업무 문장 아님) */
  function classifySentence(s) {
    var t = str(s);
    var is = hits(t, RULES.issue), dn = hits(t, RULES.done), dg = hits(t, RULES.doing), pl = hits(t, RULES.plan), dc = hits(t, RULES.decision);
    // 「완료 예정」은 계획이다 — '완료' 한 낱말만 걸린 경우는 예정 쪽이 이긴다
    var doneStrong = dn.found.filter(function (k) { return k !== '완료'; }).length > 0;
    if (is.n || dc.n) {
      var st = /보류/.test(t) ? '보류' : /(지연|늦어|차질|회신 없|회신이 없)/.test(t) ? '지연' : '확인 필요';
      return { category: '이슈', status: st, keywords: is.found.concat(dc.found), decision: dc.n > 0 };
    }
    if (pl.n && !doneStrong) return { category: '계획', status: '예정', keywords: pl.found };
    if (dn.n) return { category: '실적', status: '완료', keywords: dn.found };
    // 「착수했다·작업 중」은 진행 중. 「진행했다·검토했다」는 끝났는지 메일만으로는 모르니 확인 필요(7.2)
    if (dg.n) return { category: '실적', status: /(중|착수)/.test(dg.found.join('')) ? '진행 중' : '확인 필요', keywords: dg.found };
    return null;
  }
  /* 문장 나누기: 줄바꿈·마침표·「다.」 뒤 */
  function sentences(text) {
    // 뒤돌아보기 정규식((?<=…))은 옛 사파리에서 문법 오류라 줄바꿈 표시를 넣어 나눈다
    return str(text).replace(/\r\n/g, '\n').replace(/([.!?。])[ \t]+/g, '$1\n').replace(/다\.(?=\S)/g, '다.\n').split(/\n+/)
      .map(function (s) { return s.replace(/^\s*(?:[-*•·]\s*|\d{1,2}[.)]\s+)/, '').trim(); })
      .filter(function (s) { return s.length >= 6 && !/^(안녕하세요|감사합니다|수고하세요|수고 많으십니다|좋은 하루|잘 부탁)/.test(s) && !/(드림|올림)$/.test(s); });
  }
  /* 날짜 표현 → YYYY-MM-DD (연도는 기준일에서) */
  function extractDates(text, baseDay) {
    var y = +(str(baseDay).slice(0, 4)) || new Date().getFullYear(), out = [];
    var re = /(20\d\d)[-.\/](\d{1,2})[-.\/](\d{1,2})|(\d{1,2})\s*월\s*(\d{1,2})\s*일|(?:^|[^\d./])(\d{1,2})\/(\d{1,2})(?![\d/])/g, m;
    while ((m = re.exec(str(text)))) {
      var yy = m[1] ? +m[1] : y, mo = +(m[2] || m[4] || m[6]), dd = +(m[3] || m[5] || m[7]);
      if (mo >= 1 && mo <= 12 && dd >= 1 && dd <= 31) out.push(yy + '-' + pad(mo) + '-' + pad(dd));
    }
    return uniq(out);
  }
  /* 메일 → 업무 항목(규칙). 근거 메일 ID 를 반드시 붙인다 */
  function ruleItems(mails, tasks) {
    var items = [], n = 0;
    mails.forEach(function (m) {
      var task = taskOfMail(tasks, m.id);
      sentences(m.main || m.text).forEach(function (s) {
        var c = classifySentence(s);
        if (!c) return;
        var dates = extractDates(s, m.day);
        items.push({
          id: 'R' + pad(++n, 3), origin: 'rule', category: c.category, status: c.status, text: s,
          project: task ? task.project : OTHER_PROJECT, taskId: task ? task.id : '', taskName: task ? task.name : '',
          date: c.category === '계획' ? (dates[0] || '') : m.day, dates: dates, evidence: [m.id],
          keywords: c.keywords, decision: !!c.decision, explicit: true, reviewed: false, note: ''
        });
      });
    });
    return markConflicts(items);
  }
  /* 문장 유사도(글자 2-gram Dice) — 한국어는 조사가 붙어 낱말 비교가 잘 안 맞는다 */
  var STOP = /(습니다|했습니다|합니다|입니다|예정|완료|진행|했음|하였|되었|드립니다|관련|건|및|의|을|를|이|가|은|는|에|로|으로|과|와|\s|[.,:;!?()\[\]【】"'「」~\-])/g;
  function bigrams(s) { s = str(s).toLowerCase().replace(STOP, ''); var out = {}; for (var i = 0; i < s.length - 1; i++) out[s.substr(i, 2)] = (out[s.substr(i, 2)] || 0) + 1; return out; }
  /* 겹치는 2-gram 가짓수 — 짧은 계획(「개정안 작성」)이 「작성」 두 글자만으로 엉뚱한 항목에 붙지 않게 쓴다 */
  function sharedBigrams(a, b) { var A = bigrams(a), B = bigrams(b); return Object.keys(A).filter(function (k) { return B[k]; }).length; }
  function similarity(a, b) {
    var A = bigrams(a), B = bigrams(b), inter = 0, na = 0, nb = 0;
    Object.keys(A).forEach(function (k) { na += A[k]; if (B[k]) inter += Math.min(A[k], B[k]); });
    Object.keys(B).forEach(function (k) { nb += B[k]; });
    return na + nb ? 2 * inter / (na + nb) : 0;
  }
  /* 상충: 같은 업무 안에서 한쪽은 「완료」, 다른 쪽은 「지연·확인 필요」이고 내용이 비슷하면 확정하지 않는다(3.3) */
  function markConflicts(items) {
    items.forEach(function (x) { x.conflict = x.conflict || ''; });
    for (var i = 0; i < items.length; i++) for (var j = 0; j < items.length; j++) {
      var a = items[i], b = items[j];
      if (i === j || !a.taskId || a.taskId !== b.taskId) continue;
      if (a.status === '완료' && b.category === '이슈' && similarity(a.text, b.text) >= 0.3) {
        a.conflict = '같은 업무에 「' + b.evidence.join(',') + '」의 상충 내용이 있습니다 — 확인 필요';
        b.conflict = '같은 업무에 「' + a.evidence.join(',') + '」의 완료 내용이 있습니다 — 확인 필요';
      }
    }
    return items;
  }
  /* 업무 상태: 가장 최근 근거의 상태를 쓰고, 바뀐 이력을 남긴다(3.3) */
  function taskStatus(task, items, mails) {
    var dayOf = {}; (mails || []).forEach(function (m) { dayOf[m.id] = m.day; });
    var own = items.filter(function (x) { return x.taskId === task.id; }).map(function (x) { return { x: x, day: dayOf[x.evidence[0]] || x.date || '' }; })
      .sort(function (a, b) { return a.day.localeCompare(b.day); });
    var hist = [];
    own.forEach(function (o) {
      var st = o.x.category === '계획' ? '예정' : o.x.status;
      if (!hist.length || hist[hist.length - 1].status !== st) hist.push({ day: o.day, status: st, evidence: o.x.evidence.slice() });
    });
    var cur = hist.length ? hist[hist.length - 1].status : '확인 필요';
    if (own.some(function (o) { return o.x.conflict; })) cur = '확인 필요';
    return { status: cur, history: hist };
  }

  /* ── AI 반자동: 프롬프트 · 답 읽기 ─────── */
  function maskPII(s) {
    return str(s).replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[메일주소]')
      .replace(/(?:\+?82[-\s]?)?0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}/g, '[전화번호]');
  }
  function aiPrompt(mails, period, projects, opts) {
    opts = opts || {};
    var max = opts.maxChars || 1200, mask = opts.mask !== false;
    var pj = cleanProjects(projects).map(function (p) { return p.name + (p.keywords.length ? '(' + p.keywords.join(', ') + ')' : ''); }).join(' / ') || '(지정 없음)';
    var body = mails.map(function (m) {
      var t = (m.main || m.text).slice(0, max);
      var fromName = m.from && (m.from.name || m.from.email) || '';
      var head = '### ' + m.id + ' | ' + m.day + ' | 보낸이: ' + fromName + ' | 제목: ' + m.subject +
        ((m.attachments || []).length ? ' | 첨부: ' + m.attachments.map(function (a) { return a.name; }).join(', ') : '');
      // data09-27: 첨부에서 뽑은 글이 있으면 파일마다 앞부분을 붙인다(opts.attChars, 기본 400자)
      var att = (m.attachments || []).filter(function (a) { return trim(a.text); }).map(function (a) {
        return '[첨부 ' + a.name + '] ' + trim(a.text).replace(/\s+/g, ' ').slice(0, opts.attChars || 400);
      }).join('\n');
      return (mask ? maskPII(head) : head) + '\n' + (mask ? maskPII(t) : t) + (att ? '\n' + (mask ? maskPII(att) : att) : '');
    }).join('\n\n');
    return [
      '너는 업무보고 초안을 돕는 분석가야. 아래 메일에서 업무 정보를 뽑아 JSON 배열로만 답해줘.',
      '',
      '보고 기간: ' + (period ? period.start + ' ~ ' + period.end + ' (' + (period.type === 'monthly' ? '월간' : '주간') + ')' : '(미지정)'),
      '프로젝트 목록: ' + pj,
      '',
      '규칙',
      '1. 메일 한 통씩 요약하지 말고, 같은 업무는 한 항목으로 묶어줘. 근거 메일이 여러 통이면 evidence 에 모두 적어줘.',
      '2. category 는 「실적」(보고 기간에 실제 수행·완료한 것), 「계획」(다음 기간에 할 것), 「이슈」(일정·품질·의사결정에 영향을 주는 것) 중 하나야.',
      '3. status 는 예정 / 진행 중 / 완료 / 지연 / 보류 / 확인 필요 중 하나야. 완료 여부가 메일에 분명하지 않으면 「확인 필요」로 적어줘.',
      '4. 메일에 없는 수치·성과·날짜는 만들지 마. 모르면 빈 문자열로 둬.',
      '5. 메일에 명시된 내용은 explicit: true, 문맥으로 추론한 내용은 explicit: false 로 구분해줘.',
      '6. evidence 에는 아래 메일 ID(E001 형식)만 적어줘. 근거가 없는 항목은 만들지 마. [첨부 …] 줄은 그 메일에 붙은 파일의 글이니 근거는 그 메일 ID 야.',
      '7. 메일끼리 내용이 상충하면 conflict 에 양쪽 메일 ID 와 차이를 적어줘.',
      '8. 의사결정·지원이 필요한 이슈는 decision: true 로 표시해줘.',
      '',
      '답 형식(JSON 배열만, 설명 없이):',
      '[{"project":"프로젝트명","task":"업무명","category":"실적","status":"완료","text":"보고서에 쓸 한 문장","date":"YYYY-MM-DD 또는 빈 문자열","evidence":["E001"],"explicit":true,"decision":false,"conflict":""}]',
      '',
      '메일 ' + mails.length + '통' + (mask ? ' (메일주소·전화번호는 가렸어)' : ''),
      '',
      body
    ].join('\n');
  }
  function extractJsonArray(text) {
    // data09-27(2026-09-30 사내 LLM qwen3.8): Qwen3 의 생각하는 과정 <think>…</think> 를 먼저 뗀다 — 그 안의 [ ] 를 배열로 잘못 잡지 않게.
    // 반자동으로 붙여 넣은 답에도 들어 있을 수 있어 여기서도 뗀다(자동 보내기는 ai-endpoint.stripThinking 이 먼저 뗌)
    var t = str(text).replace(/<think>[\s\S]*?<\/think>/gi, ''), close = t.toLowerCase().lastIndexOf('</think>');
    if (close >= 0) t = t.slice(close + 8);
    var f = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
    if (f) t = f[1];
    var s = t.indexOf('['), e = t.lastIndexOf(']');
    if (s < 0 || e <= s) throw new Error('JSON 배열([ … ])을 찾지 못했습니다. AI 의 답을 그대로 붙여 넣어 주세요.');
    return JSON.parse(t.slice(s, e + 1));
  }
  /* AI 답 → 업무 항목. 없는 메일 ID·허용 밖 값은 받지 않고 「확인 필요」로 낮춘다 */
  function parseAiItems(text, mails, tasks) {
    var arr = extractJsonArray(text), ids = {}, errors = [], items = [];
    (mails || []).forEach(function (m) { ids[m.id] = m; });
    if (!Array.isArray(arr)) throw new Error('배열이 아닙니다.');
    arr.forEach(function (o, i) {
      if (!o || typeof o !== 'object') { errors.push((i + 1) + '번째: 객체가 아님'); return; }
      var txt = trim(o.text || o.summary);
      if (!txt) { errors.push((i + 1) + '번째: text 가 비어 있어 뺐습니다'); return; }
      var ev = (Array.isArray(o.evidence) ? o.evidence : str(o.evidence).split(/[,\s]+/)).map(trim).filter(Boolean);
      var bad = ev.filter(function (e) { return !ids[e]; });
      ev = ev.filter(function (e) { return ids[e]; });
      if (bad.length) errors.push((i + 1) + '번째: 없는 메일 ID ' + bad.join(', ') + ' 를 뺐습니다');
      var cat = CATEGORIES.indexOf(trim(o.category)) >= 0 ? trim(o.category) : '';
      var note = [];
      if (!cat) { note.push('분류 값이 없어 이슈(확인 필요)로 둠'); cat = '이슈'; }
      var st = STATUSES.indexOf(trim(o.status)) >= 0 ? trim(o.status) : '확인 필요';
      if (!ev.length) { note.push('근거 메일 없음'); st = '확인 필요'; }
      var date = /^\d{4}-\d{2}-\d{2}$/.test(trim(o.date)) ? trim(o.date) : '';
      var task = ev.length && tasks ? taskOfMail(tasks, ev[0]) : null;
      items.push({
        id: 'A' + pad(i + 1, 3), origin: 'ai', category: cat, status: st, text: txt,
        project: trim(o.project) || (task ? task.project : OTHER_PROJECT), taskId: task ? task.id : '', taskName: trim(o.task) || (task ? task.name : ''),
        date: date, dates: date ? [date] : [], evidence: ev, keywords: [], decision: !!o.decision,
        explicit: o.explicit !== false, reviewed: false, conflict: trim(o.conflict), note: note.join(' · ')
      });
    });
    return { items: items, errors: errors };
  }

  /* ── 이전 보고서 계획 대비 (3.3) ───────── */
  /* 붙여 넣은 이전 계획 한 줄 = 계획 하나. 「[프로젝트] 내용」 형식이면 프로젝트를 읽는다 */
  function parsePlanLines(text) {
    return str(text).split(/\r?\n/).map(function (ln) { return ln.replace(/^\s*(?:[-*•·]\s*|\d{1,2}[.)]\s+)/, '').trim(); }).filter(Boolean).map(function (ln, i) {
      var m = /^[\[【]([^\]】]+)[\]】]\s*(.*)$/.exec(ln);
      return { id: 'P' + pad(i + 1, 2), project: m ? trim(m[1]) : '', text: m ? trim(m[2]) : ln };
    });
  }
  /* 이전 계획마다 이번 항목 중 가장 비슷한 것을 찾아 완료·진행·지연·이월을 「제안」한다 */
  function carryOver(prevPlans, items, opts) {
    var th = (opts && opts.threshold) || 0.3, minShared = (opts && opts.minShared) || 3;
    return (prevPlans || []).map(function (p) {
      var best = null, bestSim = 0;
      items.forEach(function (x) {
        if (sharedBigrams(p.text, x.text + ' ' + (x.taskName || '')) < minShared) return;
        var sim = similarity(p.text, x.text) + similarity(p.text, x.taskName || '') * 0.5;
        // 프로젝트가 같으면 더하고, 둘 다 적혀 있는데 다르면 뺀다
        if (p.project && x.project && x.project !== OTHER_PROJECT) sim += squash(p.project) === squash(x.project) ? 0.1 : -0.15;
        if (sim > bestSim) { bestSim = sim; best = x; }
      });
      var r = { plan: p, match: null, sim: Math.round(Math.min(1, bestSim) * 100) / 100, suggest: '이월', reason: '이번 기간 메일에서 관련 내용을 찾지 못했습니다 — 이월 또는 누락 여부를 확인해 주세요' };
      if (best && bestSim >= th) {
        r.match = best;
        if (best.category === '이슈') { r.suggest = '지연'; r.reason = '관련 이슈가 있습니다(' + best.status + ')'; }
        else if (best.category === '실적' && best.status === '완료' && !best.conflict) { r.suggest = '완료'; r.reason = '완료 근거가 있습니다'; }
        else if (best.category === '실적') { r.suggest = '진행'; r.reason = '수행 중이거나 완료가 확인되지 않았습니다'; }
        else { r.suggest = '이월'; r.reason = '다시 계획으로 언급되었습니다(아직 수행 전)'; }
      }
      return r;
    });
  }

  /* ── 보고서 ─────────────────────────── */
  function inReport(x, period) {
    // 근거 메일이 보고 기간 안에 있어야 한다. 계획도 「이번 기간 메일에서 언급된」 다음 기간 계획만 싣는다
    // (계획 날짜는 다음 기간이라 날짜로 거르면 빠진다 — 그래서 근거 메일 날짜로 거른다)
    return !period || x._inPeriod !== false;
  }
  function byProject(list) {
    var map = {}, order = [];
    list.forEach(function (x) { var p = x.project || OTHER_PROJECT; if (!map[p]) { map[p] = []; order.push(p); } map[p].push(x); });
    order.sort(function (a, b) { return (a === OTHER_PROJECT) - (b === OTHER_PROJECT); });
    return order.map(function (p) { return { project: p, items: map[p] }; });
  }
  /* state: { type, period, mails, items, tasks, carry, author, title, approved } */
  /* ── 주간보고 양식 표 (2026-09-29 오후 늦게 — 수강생 제출 「주간업무보고 양식 샘플」의 구조) ──
     열: Business Group | 프로젝트명 | 금주 실적 (기간) | 차주 계획 (기간)
     금주 실적 칸: 진행 내용 · 결과물 배포일 · 이슈 사항 · 디자인 결과물 이미지
     차주 계획 칸: 실행 예정 업무 · 일정 · 이슈 사항
     문체: 명사로 끝나는 개조식(「~ 확정」「~ 검토 완료」「~ 확인 필요」). 양식 원본은 리포에 넣지 않았습니다(구조 설명: docs/source). */
  var BOARD_LABELS = {
    perf: ['진행 내용', '결과물 배포일', '이슈 사항', '디자인 결과물 이미지'],
    plan: ['실행 예정 업무', '일정', '이슈 사항']
  };
  var IMAGE_RE = /\.(png|jpe?g|gif|bmp|webp|svg|tiff?|heic|ai|psd|eps)$/i;   // data09-27: 일러스트(.ai)·포토샵도 결과물 이미지
  /* 메일 문장 → 개조식. 원래 항목 문장은 그대로 두고 표에만 씁니다 */
  function boardStyle(text) {
    var t = trim(text).replace(/\s+/g, ' ').replace(/[.。!]+$/, '').trim();
    var tail = '', pm = /^(.*?[가-힣])\s*(\([^()]*\))$/.exec(t);          // 「…예정입니다(10/2까지)」 → 끝 괄호는 떼었다 붙임
    if (pm) { t = pm[1]; tail = ' ' + pm[2]; }
    t = t.replace(/^[가-힣]{1,6}님\s*,\s*/, '');                          // 「팀장님, 」 부르는 말
    var rules = [
      [/(부탁드립니다|부탁합니다|해\s?주시기 바랍니다|해\s?주세요)$/, ' 요청'],
      [/(할|하게 될) 예정입니다$/, ' 예정'], [/예정입니다$/, ' 예정'],
      [/하겠습니다$/, ' 예정'], [/드리겠습니다$/, ' 예정'],
      [/마쳤습니다$/, ' 완료'],
      [/(하|되)고 있습니다$/, ' 중'],
      [/(했|하였|되었|됐)습니다$/, ''],
      [/필요합니다$/, ' 필요'], [/중입니다$/, ' 중'], [/입니다$/, ''],
      [/있습니다$/, ' 있음'], [/없습니다$/, ' 없음'],
      [/(았|었|였)습니다$/, '음'],
      [/(드립니다|합니다|됩니다)$/, ''], [/습니다$/, '음']
    ];
    for (var i = 0; i < rules.length; i++) { if (rules[i][0].test(t)) { t = t.replace(rules[i][0], rules[i][1]); break; } }
    t = t.replace(/([가-힣A-Za-z0-9)\]]{2,})(을|를)(?=\s)/g, '$1')      // 「시안을 검토」 → 「시안 검토」
      .replace(/([가-힣A-Za-z0-9)\]]{2,})(을|를)$/, '$1')
      .replace(/\s+/g, ' ').trim()
      .replace(/([가-힣]{2,})(이|가) (필요|없음|있음)$/, '$1 $3');        // 「확인이 필요」 → 「확인 필요」
    return t + tail;
  }
  function dotDay(day) { return str(day).replace(/-/g, '.'); }
  /* 주간 기간의 첫·마지막 평일 (양식 샘플이 월~금으로 적음) */
  function workdayRange(p) {
    if (!p) return null;
    var s = p.start, e = p.end, g = 0;
    while (s < e && (dow(s) === '토' || dow(s) === '일') && g++ < 7) s = addDays(s, 1);
    g = 0;
    while (e > s && (dow(e) === '토' || dow(e) === '일') && g++ < 7) e = addDays(e, -1);
    return { start: s, end: e, label: dotDay(s) + ' ~ ' + dotDay(e) };
  }
  function dateSpan(days) {
    var ds = uniq(days.filter(Boolean)).sort();
    if (!ds.length) return '';
    return ds.length === 1 ? ds[0] : ds[0] + ' ~ ' + ds[ds.length - 1];
  }
  /* rep: buildReport 결과, projects: 설정의 프로젝트(Business Group), mails, opts.style: 'brief'(개조식)|'original' */
  function weeklyBoard(rep, projects, mails, opts) {
    opts = opts || {};
    var brief = opts.style !== 'original';
    var fmt = function (x) { return brief ? boardStyle(x.text) : x.text; };
    var mailById = {}; (mails || []).forEach(function (m) { mailById[m.id] = m; });
    var pj = cleanProjects(projects), groupOf = {}, order = {};
    pj.forEach(function (p, i) { groupOf[p.name] = p.group; order[p.name] = i; });
    var names = uniq([].concat(rep.performance, rep.plan, rep.issue).map(function (g) { return g.project; }));
    (rep.carry || []).forEach(function (c) { var f = c.final || c.suggest; if ((f === '이월' || f === '지연') && c.plan.project && names.indexOf(c.plan.project) < 0) names.push(c.plan.project); });
    function itemsOf(list, name) { var g = list.filter(function (x) { return x.project === name; })[0]; return g ? g.items : []; }
    var rows = names.map(function (name) {
      var perf = itemsOf(rep.performance, name), plan = itemsOf(rep.plan, name), issue = itemsOf(rep.issue, name);
      var ev = uniq([].concat.apply([], perf.concat(plan, issue).map(function (x) { return x.evidence; }))).sort();
      var imgs = uniq([].concat.apply([], perf.map(function (x) { return [].concat.apply([], x.evidence.map(function (e) {
        return ((mailById[e] && mailById[e].attachments) || []).map(function (a) { return a.name; }).filter(function (n) { return IMAGE_RE.test(n); });
      })); })));
      var carried = (rep.carry || []).filter(function (c) { var f = c.final || c.suggest; return (f === '이월' || f === '지연') && c.plan.project === name; });
      return {
        group: groupOf[name] || '', project: name, evidence: ev,
        perf: {
          progress: perf.map(function (x) { return fmt(x) + (x.status && x.status !== '완료' ? ' (' + x.status + ')' : ''); }),
          // data09-27: 첨부로 찾은 배포일(releaseDate)이 있으면 그것을 먼저 쓴다(완료가 아니어도 배포는 배포)
          release: dateSpan(perf.filter(function (x) { return x.status === '완료' || x.releaseDate; }).map(function (x) { return x.releaseDate || x.date; })),
          issues: issue.map(function (x) { return fmt(x) + (x.decision ? ' (의사결정 필요)' : ''); }),
          images: imgs
        },
        plan: {
          tasks: plan.map(function (x) { return fmt(x) + (x.status === '확인 필요' ? ' (확인 필요)' : ''); }),
          schedule: dateSpan(plan.map(function (x) { return x.date; })),
          issues: carried.map(function (c) { return (c.final || c.suggest) + ': ' + (brief ? boardStyle(c.plan.text) : c.plan.text); })
            .concat(issue.filter(function (x) { return x.decision; }).map(function (x) { return '의사결정 필요: ' + fmt(x); }))
        }
      };
    });
    rows.sort(function (a, b) {
      var oa = order[a.project] == null ? 999 : order[a.project], ob = order[b.project] == null ? 999 : order[b.project];
      return (a.project === OTHER_PROJECT) - (b.project === OTHER_PROJECT) || oa - ob || a.project.localeCompare(b.project);
    });
    var wr = workdayRange(rep.period), nr = rep.period && rep.period.next ? workdayRange({ start: rep.period.next.start, end: rep.period.next.end }) : null;
    return {
      style: brief ? 'brief' : 'original',
      head: ['Business Group', '프로젝트명', '금주 실적' + (wr ? ' (' + wr.label + ')' : ''), '차주 계획' + (nr ? ' (' + nr.label + ')' : '')],
      rows: rows
    };
  }
  /* 양식 칸 한 개의 줄들 — 「- 진행 내용: …」 식. 여러 건이면 이어서 적고, 없으면 「-」 */
  function boardCellLines(row, side) {
    var L = BOARD_LABELS[side], c = row[side], out = [];
    function list(label, arr) {
      if (!arr.length) { out.push('- ' + label + ': -'); return; }
      if (arr.length === 1) { out.push('- ' + label + ': ' + arr[0]); return; }
      out.push('- ' + label + ':'); arr.forEach(function (x) { out.push('  · ' + x); });
    }
    if (side === 'perf') {
      list(L[0], c.progress);
      out.push('- ' + L[1] + ': ' + (c.release || '-'));
      list(L[2], c.issues);
      out.push('- ' + L[3] + ': ' + (c.images.length ? '첨부 ' + c.images.join(', ') + ' (보고서에 넣어 주세요)' : '(여기에 디자인 결과물 이미지 삽입)'));
    } else {
      list(L[0], c.tasks);
      out.push('- ' + L[1] + ': ' + (c.schedule || '-'));
      list(L[2], c.issues);
    }
    return out;
  }

  function buildReport(state) {
    var period = state.period, mails = state.mails || [], items = (state.items || []).filter(function (x) { return !x.excluded; });
    var mailById = {}; mails.forEach(function (m) { mailById[m.id] = m; });
    items = items.map(function (x) {
      var y = Object.assign({}, x);
      y._inPeriod = x.evidence.length ? x.evidence.some(function (e) { return mailById[e] && inPeriod(mailById[e].day, period); }) : true;
      return y;
    }).filter(function (x) { return inReport(x, period); });
    var perf = items.filter(function (x) { return x.category === '실적'; });
    var plan = items.filter(function (x) { return x.category === '계획'; });
    var issue = items.filter(function (x) { return x.category === '이슈'; });
    var used = uniq([].concat.apply([], items.map(function (x) { return x.evidence; }))).filter(function (id) { return mailById[id]; }).sort();
    var check = items.filter(function (x) { return x.status === '확인 필요' || x.conflict || !x.explicit || !x.evidence.length; });
    var projects = byProject(items).map(function (g) { return g.project; });
    var tasks = state.tasks || [];
    var status = projects.map(function (p) {
      var ts = tasks.filter(function (t) { return t.project === p; }).map(function (t) { var s = taskStatus(t, items, mails); return { task: t.name, status: s.status, history: s.history, mails: t.mailIds.length }; });
      return { project: p, tasks: ts };
    });
    var summary = [];
    summary.push((period ? period.label : '기간 미지정') + ' 동안 메일 ' + used.length + '통을 근거로 실적 ' + perf.length + '건 · 계획 ' + plan.length + '건 · 이슈 ' + issue.length + '건을 정리했습니다.');
    var done = perf.filter(function (x) { return x.status === '완료'; }).length;
    if (perf.length) summary.push('실적 ' + perf.length + '건 중 완료가 확인된 것은 ' + done + '건입니다.');
    var delayed = issue.filter(function (x) { return x.status === '지연'; }).length;
    if (issue.length) summary.push('이슈 ' + issue.length + '건' + (delayed ? '(지연 ' + delayed + '건)' : '') + (issue.some(function (x) { return x.decision; }) ? ', 의사결정이 필요한 사항이 있습니다.' : '이 있습니다.'));
    if (check.length) summary.push('확인이 필요한 항목이 ' + check.length + '건 있습니다(완료 불명확·상충·AI 추론·근거 없음). 보고 전에 확인해 주세요.');
    var carry = state.carry || [];
    if (carry.length) {
      var cnt = {}; carry.forEach(function (c) { var k = c.final || c.suggest; cnt[k] = (cnt[k] || 0) + 1; });
      summary.push('이전 보고서 계획 ' + carry.length + '건: ' + ['완료', '진행', '지연', '이월'].filter(function (k) { return cnt[k]; }).map(function (k) { return k + ' ' + cnt[k]; }).join(' · ') + '.');
    }
    return {
      type: state.type || (period && period.type) || 'weekly', title: state.title || '', author: state.author || '',
      period: period, approved: state.approved || null, generated: state.now || '',
      summary: state.summaryOverride ? str(state.summaryOverride).split(/\n/).filter(Boolean) : summary,
      performance: byProject(perf), plan: byProject(plan), issue: byProject(issue),
      decision: issue.filter(function (x) { return x.decision; }), status: status, carry: carry, projects: state.projects || [], boardStyle: state.boardStyle || 'brief',
      counts: { performance: perf.length, plan: plan.length, issue: issue.length, check: check.length, mails: used.length },
      evidence: used.map(function (id) { var m = mailById[id]; return { id: id, day: m.day, time: m.time, from: m.from ? (m.from.name || m.from.email) : '', subject: m.subject, attachments: (m.attachments || []).map(function (a) { return a.name; }), file: m.file || '' }; })
    };
  }
  /* 양식 표는 보고서가 다 만들어진 뒤(이전 계획 판정 포함) 계산합니다 */
  function boardOf(rep) {
    if (!rep._board) rep._board = weeklyBoard(rep, rep.projects, rep.evidence.map(function (e) { return { id: e.id, attachments: e.attachments.map(function (n) { return { name: n }; }) }; }), { style: rep.boardStyle });
    return rep._board;
  }
  function reportTitle(rep) {
    var t = rep.type === 'monthly' ? '월간 업무보고' : '주간 업무보고';
    return (rep.title ? rep.title + ' — ' : '') + t + (rep.period ? ' (' + rep.period.start + ' ~ ' + rep.period.end + ')' : '');
  }
  function flagText(x) {
    var f = [];
    if (x.status === '확인 필요') f.push('확인 필요');
    if (x.conflict) f.push('상충');
    if (!x.explicit) f.push('AI 추론');
    if (x.origin === 'ai' && x.explicit) f.push('AI 추출');
    if (!x.evidence.length) f.push('근거 없음');
    if (x.source === 'attachment') f.push('첨부 근거');   // data09-27: 메일 본문이 아니라 첨부 파일 글에서 뽑음
    return f;
  }
  function itemLine(x) { return x.text + (x.date && x.category === '계획' ? ' (' + x.date + ')' : '') + (x.status && x.category !== '계획' ? ' [' + x.status + ']' : ''); }
  /* 화면·Word(HTML)·인쇄가 함께 쓰는 본문 */
  var REPORT_CSS = [
    '.rp table.board td{white-space:normal;min-width:110px}.rp table.board td:nth-child(3),.rp table.board td:nth-child(4){min-width:240px}',
    '.rp{font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif;color:#16202c;line-height:1.6;word-break:keep-all;overflow-wrap:break-word}',
    '.rp h1{font-size:20pt;margin:0 0 4pt}.rp h2{font-size:13pt;margin:16pt 0 6pt;border-bottom:1.5pt solid #0f2544;padding-bottom:2pt}',
    '.rp h3{font-size:11pt;margin:10pt 0 4pt;color:#0f2544}.rp .meta{color:#56616f;font-size:9.5pt}',
    '.rp ul{margin:2pt 0 6pt;padding-left:18pt}.rp li{margin:2pt 0}',
    '.rp .ev{font-size:8.5pt;color:#215cb4;font-weight:bold;margin-left:4pt;text-decoration:none}',
    '.rp .flag{font-size:8.5pt;font-weight:bold;color:#8a4b00;background:#fdf0dc;padding:0 4pt;margin-left:4pt}',
    '.rp .inferred{color:#56616f;font-style:italic}',
    '.rp table{border-collapse:collapse;width:100%;font-size:9.5pt;margin:4pt 0 8pt}.rp th,.rp td{border:1px solid #b8c2cf;padding:3pt 5pt;text-align:left;vertical-align:top}.rp th{background:#eef2f7}',
    '.rp .draft{color:#b3261e;font-weight:bold}'
  ].join('\n');
  function evidenceLinks(x, linkBase) {
    return x.evidence.map(function (e) { return '<a class="ev" href="' + esc((linkBase || '#ev-') + e) + '">' + esc(e) + '</a>'; }).join('');
  }
  function itemsHtml(groups, opts) {
    if (!groups.length) return '<p class="meta">해당 항목이 없습니다.</p>';
    return groups.map(function (g) {
      return '<h3>' + esc(g.project) + '</h3><ul>' + g.items.map(function (x) {
        return '<li data-item="' + esc(x.id) + '"' + (!x.explicit ? ' class="inferred"' : '') + '>' + esc(itemLine(x)) +
          flagText(x).map(function (f) { return '<span class="flag">' + esc(f) + '</span>'; }).join('') + evidenceLinks(x, opts.linkBase) +
          (x.conflict ? '<br><span class="meta">' + esc(x.conflict) + '</span>' : '') + '</li>';
      }).join('') + '</ul>';
    }).join('');
  }
  function sectionsOf(rep) { return rep.sections || SECTIONS[rep.type] || SECTIONS.weekly; }
  /* data09-27: 취합 보고서의 「보고자별 취합 현황」 표 — 줄 = 받은 보고서 한 개 */
  var SOURCE_HEAD = ['보고자', '단계 · 보고 단위', '실적', '계획', '이슈', '확인 필요', '상태'];
  function sourceRow(s) {
    return [s.author + (s.own ? ' (나)' : '') + (s.rollup && s.reporters.length ? ' — ' + s.reporters.length + '명 취합: ' + s.reporters.join(', ') : ''),
      s.level + (s.unit ? ' · ' + s.unit : ''), String(s.counts.performance), String(s.counts.plan), String(s.counts.issue), String(s.counts.check),
      s.approved ? '승인 ' + s.approved : '초안(승인 전)'];
  }
  function sectionHtml(rep, id, opts) {
    if (id === 'sources') {
      if (!(rep.sources || []).length) return '<p class="meta">취합한 보고서가 없습니다.</p>';
      return '<table><tr>' + SOURCE_HEAD.map(function (x) { return '<th>' + esc(x) + '</th>'; }).join('') + '</tr>' + rep.sources.map(function (s) {
        return '<tr>' + sourceRow(s).map(function (x) { return '<td>' + esc(x) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</table><p class="meta">항목 문장 앞의 [이름]이 그 항목을 보고한 사람입니다. 근거 메일 ID 는 「보고자·메일ID」입니다. 확인 필요 표시는 보고자가 붙인 그대로입니다.</p>';
    }
    if (id === 'board') {
      var bd = boardOf(rep);
      if (!bd.rows.length) return '<p class="meta">해당 항목이 없습니다.</p>';
      return '<table class="board"><tr>' + bd.head.map(function (x) { return '<th>' + esc(x) + '</th>'; }).join('') + '</tr>' + bd.rows.map(function (r) {
        return '<tr><td>' + esc(r.group || '-') + '</td><td>' + esc(r.project) + '</td><td>' + boardCellLines(r, 'perf').map(esc).join('<br>') + '</td><td>' +
          boardCellLines(r, 'plan').map(esc).join('<br>') + (r.evidence.length ? '<br><span class="meta">근거 </span>' + r.evidence.map(function (e) { return '<a class="ev" href="' + esc((opts.linkBase || '#ev-') + e) + '">' + esc(e) + '</a>'; }).join('') : '') + '</td></tr>';
      }).join('') + '</table><p class="meta">주간업무보고 양식(웹보드 샘플)의 열 구성입니다. ' + (bd.style === 'brief' ? '문장은 개조식으로 줄였고 원문은 아래 01~03 에 있습니다. ' : '') +
        'Business Group 은 「01 보고 설정」의 프로젝트마다 적습니다. 결과물 배포일은 첨부 파일에 적힌 배포일 · 발행일, 내가 결과물을 첨부해 보낸 메일의 날짜, 없으면 완료 실적의 근거 메일 날짜입니다(다르면 고쳐 주세요). 디자인 결과물 이미지는 근거 메일에 붙은 그림 · 일러스트 파일 이름입니다. 차주 이슈는 이전 계획 중 이월·지연과 의사결정이 필요한 이슈입니다.</p>';
    }
    if (id === 'summary') return '<ul>' + rep.summary.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>';
    if (id === 'performance') return itemsHtml(rep.performance, opts);
    if (id === 'plan') return (rep.period ? '<p class="meta">대상 기간: ' + esc(rep.period.next.label) + '</p>' : '') + itemsHtml(rep.plan, opts);
    if (id === 'issue') {
      if (!rep.issue.length) return '<p class="meta">해당 항목이 없습니다.</p>';
      return '<table><tr><th>프로젝트</th><th>이슈 · 현황</th><th>상태</th><th>의사결정</th><th>근거</th></tr>' + [].concat.apply([], rep.issue.map(function (g) {
        return g.items.map(function (x) { return '<tr><td>' + esc(g.project) + '</td><td>' + esc(x.text) + (x.conflict ? '<br><span class="meta">' + esc(x.conflict) + '</span>' : '') + '</td><td>' + esc(x.status) + '</td><td>' + (x.decision ? '필요' : '') + '</td><td>' + evidenceLinks(x, opts.linkBase) + '</td></tr>'; });
      })).join('') + '</table><p class="meta">영향·대응은 메일에 적힌 범위만 옮겼습니다. 보고 전에 보완해 주세요.</p>';
    }
    if (id === 'status') {
      if (!rep.status.length) return '<p class="meta">해당 항목이 없습니다.</p>';
      return '<table><tr><th>프로젝트</th><th>업무</th><th>현재 상태</th><th>상태 변화</th></tr>' + [].concat.apply([], rep.status.map(function (g) {
        return g.tasks.map(function (t) { return '<tr><td>' + esc(g.project) + '</td><td>' + esc(t.task) + '</td><td>' + esc(t.status) + '</td><td>' + esc(t.history.map(function (h) { return h.day.slice(5) + ' ' + h.status; }).join(' → ')) + '</td></tr>'; });
      })).join('') + '</table>';
    }
    if (id === 'decision') {
      if (!rep.decision.length) return '<p class="meta">메일에서 의사결정 요청을 찾지 못했습니다.</p>';
      return '<ul>' + rep.decision.map(function (x) { return '<li>' + esc('[' + x.project + '] ' + x.text) + evidenceLinks(x, opts.linkBase) + '</li>'; }).join('') + '</ul>';
    }
    if (id === 'carry') {
      if (!rep.carry.length) return '<p class="meta">비교할 이전 보고서 계획이 없습니다.</p>';
      return '<table><tr><th>이전 계획</th><th>판정</th><th>근거·이유</th></tr>' + rep.carry.map(function (c) {
        var fin = c.final || c.suggest;
        return '<tr><td>' + esc((c.plan.project ? '[' + c.plan.project + '] ' : '') + c.plan.text) + '</td><td>' + esc(fin) + (c.final ? '' : ' <span class="flag">제안</span>') + '</td><td>' +
          esc(c.reason) + (c.match ? ' ' + evidenceLinks(c.match, opts.linkBase) : '') + '</td></tr>';
      }).join('') + '</table>';
    }
    return '';
  }
  function reportBodyHtml(rep, opts) {
    opts = opts || {};
    var secs = sectionsOf(rep);
    var h = '<div class="rp"><h1>' + esc(reportTitle(rep)) + '</h1><p class="meta">' +
      (rep.author ? '작성: ' + esc(rep.author) + ' · ' : '') + (rep.generated ? '생성: ' + esc(rep.generated) + ' · ' : '') +
      (rep.approved ? '승인: ' + esc(rep.approved) : '<span class="draft">초안 — 검토·승인 전</span>') + '</p>';
    secs.forEach(function (s) { h += '<section data-section="' + s.id + '"><h2>' + esc(s.name) + '</h2>' + sectionHtml(rep, s.id, opts) + '</section>'; });
    h += '<section data-section="evidence"><h2>근거 메일 목록</h2>' + (rep.evidence.length ? '<table><tr><th>ID</th><th>날짜</th><th>보낸이</th><th>제목</th><th>첨부</th></tr>' + rep.evidence.map(function (e) {
      return '<tr id="' + esc((opts.anchorPrefix || 'ev-') + e.id) + '"><td>' + esc(e.id) + '</td><td>' + esc(e.day + (e.time ? ' ' + e.time : '')) + '</td><td>' + esc(e.from) + '</td><td>' + esc(e.subject) + '</td><td>' + esc(e.attachments.join(', ')) + '</td></tr>';
    }).join('') + '</table>' : '<p class="meta">근거 메일이 없습니다.</p>') +
      '<p class="meta">표시: <span class="flag">확인 필요</span> 완료 여부 불명확 · <span class="flag">상충</span> 메일끼리 내용이 다름 · <span class="flag">AI 추론</span> 메일에 명시되지 않고 문맥으로 추론(기울임) · <span class="flag">AI 추출</span> AI 가 메일에서 뽑은 명시 사실 · <span class="flag">첨부 근거</span> 메일에 붙은 파일(워드·PPT·엑셀·PDF)의 글에서 뽑음.</p></section></div>';
    return h;
  }
  /* Word 로 여는 HTML(.doc). Word 가 HTML 을 그대로 열 수 있다 */
  function reportWordHtml(rep) {
    return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">' +
      '<head><meta charset="utf-8"><title>' + esc(reportTitle(rep)) + '</title><!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->' +
      '<style>' + REPORT_CSS + '</style></head><body>' + reportBodyHtml(rep, {}) + '</body></html>';
  }
  function reportHtml(rep) {
    return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + esc(reportTitle(rep)) +
      '</title><style>body{margin:24px auto;max-width:900px;padding:0 16px}' + REPORT_CSS + '</style></head><body>' + reportBodyHtml(rep, {}) + '</body></html>';
  }

  /* ── .docx (Office Open XML) — 문단·목록·표만 쓰는 최소 구성 ── */
  function wRun(text, o) {
    o = o || {};
    var pr = (o.b ? '<w:b/>' : '') + (o.i ? '<w:i/>' : '') + (o.color ? '<w:color w:val="' + o.color + '"/>' : '') + (o.sz ? '<w:sz w:val="' + o.sz + '"/>' : '') + (o.shd ? '<w:shd w:val="clear" w:color="auto" w:fill="' + o.shd + '"/>' : '');
    return '<w:r>' + (pr ? '<w:rPr><w:rFonts w:ascii="Malgun Gothic" w:eastAsia="Malgun Gothic" w:hAnsi="Malgun Gothic"/>' + pr + '</w:rPr>' : '<w:rPr><w:rFonts w:ascii="Malgun Gothic" w:eastAsia="Malgun Gothic" w:hAnsi="Malgun Gothic"/></w:rPr>') +
      '<w:t xml:space="preserve">' + xmlEsc(text) + '</w:t></w:r>';
  }
  function wPara(runs, o) {
    o = o || {};
    var ppr = (o.indent ? '<w:ind w:left="' + o.indent + '" w:hanging="200"/>' : '') + (o.spaceBefore ? '<w:spacing w:before="' + o.spaceBefore + '" w:after="80"/>' : '') + (o.border ? '<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="1" w:color="0F2544"/></w:pBdr>' : '');
    return '<w:p>' + (ppr ? '<w:pPr>' + ppr + '</w:pPr>' : '') + (Array.isArray(runs) ? runs.join('') : runs) + '</w:p>';
  }
  function wTable(header, rows) {
    var cell = function (t, head) { return '<w:tc><w:tcPr>' + (head ? '<w:shd w:val="clear" w:color="auto" w:fill="EEF2F7"/>' : '') + '</w:tcPr>' + (Array.isArray(t) ? (t.length ? t : ['']) : [t]).map(function (ln) { return wPara(wRun(ln, { b: head, sz: 18 })); }).join('') + '</w:tc>'; };
    var b = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(function (s) { return '<w:' + s + ' w:val="single" w:sz="4" w:space="0" w:color="B8C2CF"/>'; }).join('') + '</w:tblBorders>';
    return '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>' + b + '</w:tblPr>' +
      '<w:tr>' + header.map(function (x) { return cell(x, true); }).join('') + '</w:tr>' +
      rows.map(function (r) { return '<w:tr>' + r.map(function (x) { return cell(x, false); }).join('') + '</w:tr>'; }).join('') + '</w:tbl>' + wPara('');
  }
  function docxItems(groups) {
    if (!groups.length) return [wPara(wRun('해당 항목이 없습니다.', { color: '56616F' }))];
    var out = [];
    groups.forEach(function (g) {
      out.push(wPara(wRun(g.project, { b: true, color: '0F2544' }), { spaceBefore: 120 }));
      g.items.forEach(function (x) {
        var runs = [wRun('• ' + itemLine(x), { i: !x.explicit })];
        flagText(x).forEach(function (f) { runs.push(wRun(' ' + f + ' ', { b: true, sz: 16, color: '8A4B00', shd: 'FDF0DC' })); });
        if (x.evidence.length) runs.push(wRun(' [' + x.evidence.join(', ') + ']', { b: true, sz: 16, color: '215CB4' }));
        out.push(wPara(runs, { indent: 360 }));
        if (x.conflict) out.push(wPara(wRun(x.conflict, { sz: 16, color: '56616F' }), { indent: 560 }));
      });
    });
    return out;
  }
  function docxBody(rep) {
    var out = [wPara(wRun(reportTitle(rep), { b: true, sz: 36 })),
      wPara(wRun((rep.author ? '작성: ' + rep.author + ' · ' : '') + (rep.generated ? '생성: ' + rep.generated + ' · ' : '') + (rep.approved ? '승인: ' + rep.approved : '초안 — 검토·승인 전'), { sz: 18, color: rep.approved ? '56616F' : 'B3261E' }))];
    sectionsOf(rep).forEach(function (s) {
      out.push(wPara(wRun(s.name, { b: true, sz: 26 }), { spaceBefore: 280, border: true }));
      if (s.id === 'sources') out.push((rep.sources || []).length ? wTable(SOURCE_HEAD, rep.sources.map(sourceRow)) : wPara(wRun('취합한 보고서가 없습니다.', { color: '56616F' })));
      else if (s.id === 'summary') rep.summary.forEach(function (t) { out.push(wPara(wRun('• ' + t), { indent: 360 })); });
      else if (s.id === 'board') { var bd = boardOf(rep); out.push(bd.rows.length ? wTable(bd.head, bd.rows.map(function (r) { return [r.group || '-', r.project, boardCellLines(r, 'perf'), boardCellLines(r, 'plan').concat(r.evidence.length ? ['근거 ' + r.evidence.join(', ')] : [])]; })) : wPara(wRun('해당 항목이 없습니다.', { color: '56616F' }))); }
      else if (s.id === 'performance') out = out.concat(docxItems(rep.performance));
      else if (s.id === 'plan') { if (rep.period) out.push(wPara(wRun('대상 기간: ' + rep.period.next.label, { sz: 18, color: '56616F' }))); out = out.concat(docxItems(rep.plan)); }
      else if (s.id === 'issue') out.push(rep.issue.length ? wTable(['프로젝트', '이슈 · 현황', '상태', '의사결정', '근거'], [].concat.apply([], rep.issue.map(function (g) { return g.items.map(function (x) { return [g.project, x.text + (x.conflict ? ' — ' + x.conflict : ''), x.status, x.decision ? '필요' : '', x.evidence.join(', ')]; }); }))) : wPara(wRun('해당 항목이 없습니다.', { color: '56616F' })));
      else if (s.id === 'status') out.push(rep.status.length ? wTable(['프로젝트', '업무', '현재 상태', '상태 변화'], [].concat.apply([], rep.status.map(function (g) { return g.tasks.map(function (t) { return [g.project, t.task, t.status, t.history.map(function (h) { return h.day.slice(5) + ' ' + h.status; }).join(' → ')]; }); }))) : wPara(wRun('해당 항목이 없습니다.', { color: '56616F' })));
      else if (s.id === 'decision') { if (!rep.decision.length) out.push(wPara(wRun('메일에서 의사결정 요청을 찾지 못했습니다.', { color: '56616F' }))); rep.decision.forEach(function (x) { out.push(wPara(wRun('• [' + x.project + '] ' + x.text + ' [' + x.evidence.join(', ') + ']'), { indent: 360 })); }); }
      else if (s.id === 'carry') out.push(rep.carry.length ? wTable(['이전 계획', '판정', '근거·이유'], rep.carry.map(function (c) { return [(c.plan.project ? '[' + c.plan.project + '] ' : '') + c.plan.text, (c.final || c.suggest) + (c.final ? '' : ' (제안)'), c.reason + (c.match ? ' [' + c.match.evidence.join(', ') + ']' : '')]; })) : wPara(wRun('비교할 이전 보고서 계획이 없습니다.', { color: '56616F' })));
    });
    out.push(wPara(wRun('근거 메일 목록', { b: true, sz: 26 }), { spaceBefore: 280, border: true }));
    out.push(rep.evidence.length ? wTable(['ID', '날짜', '보낸이', '제목', '첨부'], rep.evidence.map(function (e) { return [e.id, e.day + (e.time ? ' ' + e.time : ''), e.from, e.subject, e.attachments.join(', ')]; })) : wPara(wRun('근거 메일이 없습니다.', { color: '56616F' })));
    return out.join('');
  }
  /* 경로 → 내용(문자열). 화면에서 XLSX.CFB 로 zip 을 만든다 */
  function docxParts(rep) {
    return {
      '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      'word/document.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + docxBody(rep) +
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>'
    };
  }

  /* ── 엑셀(업무 데이터·이력 관리, 4.3 우선순위 2) ── */
  function reportSheets(rep, items, mails, tasks) {
    var head = ['항목ID', '분류', '프로젝트', '업무', '내용', '상태', '날짜', '근거 메일', '출처', '명시/추론', '상충', '의사결정', '확인 표시', '메모'];
    var rows = [head].concat((items || []).filter(function (x) { return !x.excluded; }).map(function (x) {
      return [x.id, x.category, x.project, x.taskName, x.text, x.status, x.date, x.evidence.join(', '), ORIGINS[x.origin] || x.origin, x.explicit ? '명시' : '추론', x.conflict, x.decision ? '필요' : '', flagText(x).join(', '), x.note || ''];
    }));
    var mailRows = [['메일ID', '날짜', '시각', '보낸이', '보낸이 메일', '받는이', '제목', '정규화 제목', '업무ID', '첨부 파일', '파일']].concat((mails || []).map(function (m) {
      var t = taskOfMail(tasks || [], m.id);
      return [m.id, m.day, m.time, m.from.name, m.from.email, m.to.map(function (a) { return a.name || a.email; }).join(', '), m.subject, m.subjectNorm, t ? t.id : '', (m.attachments || []).map(function (a) { return a.name; }).join(', '), m.file || ''];
    }));
    var taskRows = [['업무ID', '프로젝트', '업무', '메일 수', '처음', '마지막', '현재 상태', '첨부']].concat((tasks || []).map(function (t) {
      return [t.id, t.project, t.name, t.mailIds.length, t.first, t.last, taskStatus(t, items || [], mails || []).status, t.attachments.join(', ')];
    }));
    var carryRows = [['이전 계획', '프로젝트', '판정', '확정 여부', '이유', '연결 항목', '근거 메일', '유사도']].concat((rep.carry || []).map(function (c) {
      return [c.plan.text, c.plan.project, c.final || c.suggest, c.final ? '확정' : '제안', c.reason, c.match ? c.match.id : '', c.match ? c.match.evidence.join(', ') : '', c.sim];
    }));
    var sumRows = [['항목', '값'], ['보고서', reportTitle(rep)], ['유형', rep.type === 'monthly' ? '월간' : '주간'], ['기간', rep.period ? rep.period.start + ' ~ ' + rep.period.end : ''],
      ['상태', rep.approved ? '승인 ' + rep.approved : '초안'], ['실적', rep.counts.performance], ['계획', rep.counts.plan], ['이슈', rep.counts.issue], ['확인 필요', rep.counts.check], ['근거 메일', rep.counts.mails]]
      .concat(rep.summary.map(function (s, i) { return ['요약 ' + (i + 1), s]; }));
    var out = [{ name: '요약', aoa: sumRows }];
    if (rep.type !== 'monthly') {
      var bd = boardOf(rep);
      out.push({ name: '주간보고표', aoa: [bd.head.concat(['근거 메일'])].concat(bd.rows.map(function (r) { return [r.group, r.project, boardCellLines(r, 'perf').join('\n'), boardCellLines(r, 'plan').join('\n'), r.evidence.join(', ')]; })) });
    }
    return out.concat([{ name: '업무항목', aoa: rows }, { name: '업무그룹', aoa: taskRows }, { name: '근거메일', aoa: mailRows }, { name: '이전계획대비', aoa: carryRows }]);
  }

  /* ── 저장 형태 ───────────────────────── */
  /* data09-27: 보고서 취합 — 받은 보고서 파일(rollup-logic.parsePackage 결과)과 내 메일 보고서 넣기 여부 */
  /* found: 모은 메일의 첨부에서 찾은 보고서 파일(rollup-logic.findMailedPackages 결과 — 2026-09-30 「메일로 송/수신」). 불러오기 전까지 여기 둔다 */
  function emptyRollup() { return { sources: [], includeOwn: false, approved: null, found: [] }; }
  function emptyState() {
    return { schema: SCHEMA_VERSION, settings: { type: 'weekly', refDay: '', weekStart: 1, author: '', title: '', boardStyle: 'brief', level: '팀원' }, projects: [], mails: [], items: [], prevPlansText: '', carryFinal: {}, taskProject: {}, history: [], summaryOverride: '', approved: null, collect: null, rollup: emptyRollup(), _sample: false };
  }
  function restoreState(p) {
    var s = emptyState();
    if (!p || typeof p !== 'object') return s;
    if (p.settings) Object.keys(s.settings).forEach(function (k) { if (p.settings[k] != null) s.settings[k] = p.settings[k]; });
    s.projects = cleanProjects(p.projects);
    s.mails = Array.isArray(p.mails) ? p.mails.filter(function (m) { return m && m.id; }) : [];
    s.items = Array.isArray(p.items) ? p.items.filter(function (x) { return x && x.id && CATEGORIES.indexOf(x.category) >= 0; }).map(function (x) {
      x.evidence = Array.isArray(x.evidence) ? x.evidence : []; if (x.explicit == null) x.explicit = true; return x;
    }) : [];
    ['prevPlansText', 'summaryOverride'].forEach(function (k) { if (typeof p[k] === 'string') s[k] = p[k]; });
    if (p.carryFinal && typeof p.carryFinal === 'object') s.carryFinal = p.carryFinal;
    if (p.taskProject && typeof p.taskProject === 'object') s.taskProject = p.taskProject;
    if (typeof p.approved === 'string') s.approved = p.approved;
    s.history = Array.isArray(p.history) ? p.history.filter(function (h) { return h && h.period; }) : [];
    s._sample = !!p._sample;
    if (p.collect && typeof p.collect === 'object') s.collect = p.collect;   // data09-27: 마지막 자동 수집 요약
    if (['팀원', '파트리더', '팀장', '임원'].indexOf(s.settings.level) < 0) s.settings.level = '팀원';
    if (p.rollup && typeof p.rollup === 'object' && Array.isArray(p.rollup.sources)) {
      s.rollup = { sources: p.rollup.sources.filter(function (x) { return x && x.author && x.period && Array.isArray(x.items); }), includeOwn: !!p.rollup.includeOwn, approved: typeof p.rollup.approved === 'string' ? p.rollup.approved : null,
        found: Array.isArray(p.rollup.found) ? p.rollup.found.filter(function (f) { return f && f.key && f.pkg && f.pkg.author && f.pkg.period && Array.isArray(f.pkg.items); }) : [] };
    }
    return s;
  }
  /* 승인한 보고서 → 이력 1건. 다음 보고 때 「이전 보고서 계획」으로 쓴다 */
  function historyEntry(rep, now) {
    return {
      id: 'H' + str(now).replace(/\D/g, '').slice(0, 12), type: rep.type, period: { start: rep.period.start, end: rep.period.end, label: rep.period.label },
      approved: now, counts: rep.counts,
      plans: [].concat.apply([], rep.plan.map(function (g) { return g.items.map(function (x) { return { project: g.project, text: x.text }; }); }))
    };
  }
  function plansFromHistory(history, period) {
    // 이번 기간 바로 앞 기간의 승인 보고서를 고른다(없으면 가장 최근)
    var list = (history || []).filter(function (h) { return !period || h.period.end < period.start; }).sort(function (a, b) { return b.period.end.localeCompare(a.period.end); });
    if (!list.length) return null;
    return { entry: list[0], text: list[0].plans.map(function (p) { return (p.project ? '[' + p.project + '] ' : '') + p.text; }).join('\n') };
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION, CATEGORIES: CATEGORIES, CATEGORY_EN: CATEGORY_EN, STATUSES: STATUSES, ORIGINS: ORIGINS,
    REPORT_TYPES: REPORT_TYPES, SECTIONS: SECTIONS, OTHER_PROJECT: OTHER_PROJECT, dateSpan: dateSpan, RULES: RULES, REPORT_CSS: REPORT_CSS,
    esc: esc, normCharset: normCharset, binToBytes: binToBytes, bytesToBin: bytesToBin, decodeBytes: decodeBytes,
    base64ToBytes: base64ToBytes, bytesToBase64: bytesToBase64, qpToBytes: qpToBytes, decodeWords: decodeWords, decodeHeaderValue: decodeHeaderValue,
    parseHeaders: parseHeaders, parseParams: parseParams, parseAddressList: parseAddressList, parseMailDate: parseMailDate,
    htmlToText: htmlToText, mainText: mainText, subjectParts: subjectParts, normalizeSubject: normalizeSubject,
    parseEml: parseEml, mailFromPaste: mailFromPaste, koreanDateToDay: koreanDateToDay, nextMailId: nextMailId, addMails: addMails,
    parseDay: parseDay, addDays: addDays, periodFor: periodFor, previousPeriod: previousPeriod, inPeriod: inPeriod,
    cleanProjects: cleanProjects, projectOf: projectOf, groupTasks: groupTasks, taskOfMail: taskOfMail,
    classifySentence: classifySentence, sentences: sentences, extractDates: extractDates, ruleItems: ruleItems,
    similarity: similarity, sharedBigrams: sharedBigrams, markConflicts: markConflicts, taskStatus: taskStatus,
    maskPII: maskPII, aiPrompt: aiPrompt, extractJsonArray: extractJsonArray, parseAiItems: parseAiItems,
    parsePlanLines: parsePlanLines, carryOver: carryOver,
    buildReport: buildReport, reportTitle: reportTitle, flagText: flagText, reportBodyHtml: reportBodyHtml, reportWordHtml: reportWordHtml, reportHtml: reportHtml,
    docxParts: docxParts, reportSheets: reportSheets,
    BOARD_LABELS: BOARD_LABELS, boardStyle: boardStyle, workdayRange: workdayRange, weeklyBoard: weeklyBoard, boardCellLines: boardCellLines, boardOf: boardOf,
    emptyState: emptyState, emptyRollup: emptyRollup, restoreState: restoreState, sectionsOf: sectionsOf, historyEntry: historyEntry, plansFromHistory: plansFromHistory
  };
});
