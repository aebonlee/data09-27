// 과제 B 예시 메일(.eml) 만들기 — 실행: node scripts/make-eml-samples.js
//   결과 1) samples/eml/*.eml        — 「메일 파일 불러오기」로 직접 넣어 볼 수 있는 파일
//   결과 2) js/report-sample.js         — 같은 파일을 base64 로 담아 「예시 불러오기」가 쓴다
//                                          (file:// 로 열면 fetch 가 막혀 파일을 읽을 수 없기 때문)
// 인물·회사·업무는 모두 가상입니다. 주소는 example.com, 이름에는 「(가상)」을 붙였습니다.
// 파서가 실제 Outlook 메일에서 만날 형식을 골고루 넣었습니다:
//   RFC 2047 B·Q 인코딩 제목, 인코딩 단어 두 개로 나뉜 제목, ks_c_5601-1987(EUC-KR) 메일,
//   multipart/alternative(text+html), multipart/mixed + 첨부(RFC 2231 filename*, RFC 2047 name),
//   base64 · quoted-printable · 8bit 본문, html 만 있는 메일, 회신·전달 인용문
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const b64wrap = (buf) => (Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'utf8')).toString('base64').replace(/.{1,76}/g, '$&\r\n').trimEnd();
const encB = (s) => '=?UTF-8?B?' + b64(s) + '?=';
function encQ(s) {
  return '=?UTF-8?Q?' + Array.from(Buffer.from(s, 'utf8')).map((c) =>
    (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) ? String.fromCharCode(c) : c === 0x20 ? '_' : '=' + c.toString(16).toUpperCase().padStart(2, '0')).join('') + '?=';
}
function qp(s) {
  // quoted-printable (UTF-8), 76자 부드러운 줄바꿈
  return s.split('\r\n').map((line) => {
    let out = '', cur = '';
    for (const c of Buffer.from(line, 'utf8')) {
      const t = (c >= 33 && c <= 126 && c !== 61) || c === 32 ? String.fromCharCode(c) : '=' + c.toString(16).toUpperCase().padStart(2, '0');
      if (cur.length + t.length > 75) { out += cur + '=\r\n'; cur = ''; }
      cur += t;
    }
    return out + cur;
  }).join('\r\n');
}
const crlf = (s) => s.replace(/\r?\n/g, '\r\n');
const addr = (name, email) => encB(name) + ' <' + email + '>';

const LEAD = ['디자인팀장(가상)', 'lead@example.com'];
const ME = ['보고자(가상)', 'me@example.com'];
const VENDOR = ['협력사 CMF 담당(가상)', 'vendor.cmf@example.com'];
const VENDOR2 = ['협력사 설계 담당(가상)', 'vendor.design@example.com'];
const EXPO = ['전시 운영 담당(가상)', 'expo@example.com'];
const TEAM = ['팀 공지(가상)', 'team@example.com'];

function head(h) {
  return Object.entries(h).filter(([, v]) => v != null).map(([k, v]) => k + ': ' + v).join('\r\n');
}
const files = [];
function add(name, headers, body) {
  const hd = head(Object.assign({ 'MIME-Version': '1.0' }, headers));
  const buf = Buffer.isBuffer(body) ? Buffer.concat([Buffer.from(hd + '\r\n\r\n', 'utf8'), body]) : Buffer.from(hd + '\r\n\r\n' + body, 'utf8');
  files.push({ name, buf });
}

// E1 — multipart/alternative: text/plain(base64) + text/html(quoted-printable), B 인코딩 제목
const e1Text = crlf(`안녕하세요.
오늘 1차 시안 검토 회의를 마쳤습니다.
시안 3종 검토 완료했고, B안을 최종 시안으로 선정했습니다.
차주에는 B안 기준으로 3D 모델링 업데이트를 진행할 예정입니다(10/2까지).
회의록은 본문으로 대신합니다.

디자인팀장(가상) 드림`);
const e1Html = crlf(`<html><body><p>안녕하세요.</p>
<p>오늘 1차 시안 검토 회의를 마쳤습니다.<br>시안 3종 검토 완료했고, <b>B안</b>을 최종 시안으로 선정했습니다.</p>
<p>차주에는 B안 기준으로 3D 모델링 업데이트를 진행할 예정입니다(10/2까지).</p></body></html>`);
add('01_cab_review_result.eml', {
  From: addr(...LEAD), To: addr(...ME), Date: 'Mon, 21 Sep 2026 09:12:00 +0900',
  Subject: encB('[캡 인테리어 개선] 1차 시안 검토 회의 결과 공유'), 'Message-ID': '<cab-001@example.com>',
  'Content-Type': 'multipart/alternative; boundary="ALT-e1"'
}, `--ALT-e1\r\nContent-Type: text/plain; charset="utf-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64wrap(e1Text)}\r\n` +
  `--ALT-e1\r\nContent-Type: text/html; charset="utf-8"\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${qp(e1Html)}\r\n--ALT-e1--\r\n`);

// E2 — 회신(RE:), Q 인코딩 제목, 8bit UTF-8 본문, 인용문(Original Message) 포함
add('02_cab_reply_modeling.eml', {
  From: addr(...ME), To: addr(...LEAD), Date: 'Tue, 22 Sep 2026 10:30:00 +0900',
  Subject: encQ('RE: [캡 인테리어 개선] 1차 시안 검토 회의 결과 공유'), 'Message-ID': '<cab-002@example.com>',
  'In-Reply-To': '<cab-001@example.com>', References: '<cab-001@example.com>',
  'Content-Type': 'text/plain; charset=utf-8', 'Content-Transfer-Encoding': '8bit'
}, crlf(`팀장님, B안 기준으로 3D 모델링 업데이트에 착수했습니다.
다만 조작부 치수 자료가 협력사에서 아직 회신이 없어 일정 지연이 우려됩니다.

-----Original Message-----
From: 디자인팀장(가상)
Sent: Monday, September 21, 2026 9:12 AM
시안 3종 검토 완료했고, B안을 최종 시안으로 선정했습니다.
`));

// E3 — multipart/mixed: 본문 quoted-printable + 엑셀 첨부(RFC 2231 filename*), 인코딩 단어 두 개로 나뉜 제목
const e3Text = crlf(`안녕하세요, 협력사 CMF 담당(가상)입니다.
색상 샘플 12종 입고 완료했습니다.
평가는 다음 주 화요일(9/29)에 진행할 예정입니다.
샘플 목록은 첨부 파일을 봐 주세요.`);
add('03_cmf_sample_arrival.eml', {
  From: addr(...VENDOR), To: addr(...ME), Cc: addr(...LEAD), Date: 'Wed, 23 Sep 2026 14:05:00 +0900',
  Subject: encB('[CMF 샘플 평가] 색상 샘플 입고') + '\r\n ' + encB(' 및 평가 일정 안내'), 'Message-ID': '<cmf-001@example.com>',
  'Content-Type': 'multipart/mixed; boundary="MIX-e3"'
}, `--MIX-e3\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${qp(e3Text)}\r\n` +
  `--MIX-e3\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\nContent-Disposition: attachment; filename*=UTF-8''${encodeURIComponent('CMF_샘플목록.xlsx')}\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64wrap('가상 첨부 — 실제 엑셀 내용 아님')}\r\n--MIX-e3--\r\n`);

// E4 — 전달(FW:), 본문 base64, 첨부 2개(RFC 2047 name), Forwarded message 인용
const e4Text = crlf(`부스 렌더링 이미지 5컷을 제출했습니다.
보완 요청이 있으면 금요일까지 반영하겠습니다.

---------- Forwarded message ---------
From: 전시 운영 담당(가상)
부스 렌더링 요청드립니다. 다음 주 중으로 5컷 부탁드립니다.
`);
add('04_expo_rendering_fw.eml', {
  From: addr(...ME), To: addr(...EXPO), Date: 'Thu, 24 Sep 2026 11:20:00 +0900',
  Subject: encB('FW: [전시회 준비] 부스 렌더링 요청'), 'Message-ID': '<expo-002@example.com>',
  'Content-Type': 'multipart/mixed; boundary="MIX-e4"'
}, `--MIX-e4\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64wrap(e4Text)}\r\n` +
  `--MIX-e4\r\nContent-Type: application/pdf; name="${encB('부스_렌더링_5컷.pdf')}"\r\nContent-Disposition: attachment\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64wrap('%PDF-1.4 가상 첨부')}\r\n` +
  `--MIX-e4\r\nContent-Type: image/png; name="booth_front.png"\r\nContent-Disposition: attachment; filename="booth_front.png"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64wrap(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))}\r\n--MIX-e4--\r\n`);

// E5 — html 만 있는 메일(base64)
const e5Html = crlf(`<html><head><style>p{margin:0}</style></head><body>
<p>안녕하세요.</p>
<p>지난주 요청드린 조작부 치수 자료 회신이 지연되고 있습니다.</p>
<p>모델링 일정을 지키기 위해 <b>9/30까지</b> 회신 부탁드립니다.</p>
<p>보고자(가상) 드림</p></body></html>`);
add('05_cab_dimension_request.eml', {
  From: addr(...ME), To: addr(...VENDOR2), Date: 'Thu, 24 Sep 2026 16:40:00 +0900',
  Subject: encB('[캡 인테리어 개선] 조작부 치수 자료 요청 (재요청)'), 'Message-ID': '<cab-003@example.com>',
  'Content-Type': 'text/html; charset=utf-8', 'Content-Transfer-Encoding': 'base64'
}, b64wrap(e5Html) + '\r\n');

// E6 — Outlook 한글 기본(ks_c_5601-1987 = EUC-KR), 제목·이름·본문 모두 EUC-KR
add('06_expo_schedule_change.eml', {
  From: '=?ks_c_5601-1987?B?wPy9wyC/7r+1KLChu/Mp?= <expo@example.com>', To: addr(...ME), Date: 'Fri, 25 Sep 2026 09:00:00 +0900',
  Subject: '=?ks_c_5601-1987?B?W8D8vcPIuCDB2LrxXSC6zr26ILyzxKEgwM/BpCC6r7DmIL7Is7s=?=', 'Message-ID': '<expo-003@example.com>',
  'Content-Type': 'text/plain; charset="ks_c_5601-1987"', 'Content-Transfer-Encoding': 'base64'
}, 'vsiz58fPvLy/5C4NCg0KwPy9wyC6zr26ILyzxKEgwM/BpMDMIDEwLzEyv6G8rSAxMC8xNbfOILqvsOa1x776vcC0z7TZLg0Kv+682yDAz8GksPogw+a1uSCwobTJvLrAzCDA1r7uIMiuwM7AzCDHyr/kx9W0z7TZLg0Kv+6827vnILqvsOYgv6m6zr+hILTrx9EgwMe757DhwaTAzCDHyr/kx9W0z7TZLg0KOS8zMLHuwfYgxse03CC6zsW5teW4s7TPtNkuDQoNCsD8vcMgv+6/tSC047TnKLChu/MpILXluLINCg==\r\n');

// E7 — 회신 + docx 첨부
add('07_cmf_criteria_reply.eml', {
  From: addr(...ME), To: addr(...LEAD), Date: 'Sat, 26 Sep 2026 17:10:00 +0900',
  Subject: encB('RE: [CMF 샘플 평가] 평가 기준표'), 'Message-ID': '<cmf-002@example.com>', 'In-Reply-To': '<cmf-000@example.com>',
  'Content-Type': 'multipart/mixed; boundary="MIX-e7"'
}, `--MIX-e7\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64wrap(crlf('평가 기준표 초안 작성 완료했습니다.\n차주 평가 회의에서 기준을 확정할 예정입니다.\n'))}\r\n` +
  `--MIX-e7\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\nContent-Disposition: attachment; filename="${encB('평가기준표_초안.docx')}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64wrap('가상 첨부')}\r\n--MIX-e7--\r\n`);

// E8 — 지난주 메일(보고 기간 밖) — 기간 거르기 확인용
add('08_cab_kickoff_prevweek.eml', {
  From: addr(...LEAD), To: addr(...ME), Date: 'Thu, 17 Sep 2026 15:00:00 +0900',
  Subject: encB('[캡 인테리어 개선] 킥오프 회의 안내'), 'Message-ID': '<cab-000@example.com>',
  'Content-Type': 'text/plain; charset=utf-8', 'Content-Transfer-Encoding': 'base64'
}, b64wrap(crlf('캡 인테리어 개선 킥오프 회의를 9/21에 진행할 예정입니다.\n')) + '\r\n');

// E9 — 프로젝트 없는 공지(→ 기타)
add('09_team_weekly_meeting.eml', {
  From: addr(...TEAM), To: addr(...ME), Date: 'Sat, 26 Sep 2026 08:30:00 +0900',
  Subject: encB('주간 팀 회의 일정 안내'), 'Message-ID': '<team-001@example.com>',
  'Content-Type': 'text/plain; charset=utf-8', 'Content-Transfer-Encoding': 'quoted-printable'
}, qp(crlf('10/1(목) 오전 10시에 주간 팀 회의를 진행할 예정입니다.\n')) + '\r\n');

const dir = path.join(ROOT, 'samples', 'report');
fs.mkdirSync(dir, { recursive: true });
for (const f of fs.readdirSync(dir)) if (f.endsWith('.eml')) fs.unlinkSync(path.join(dir, f));
for (const f of files) fs.writeFileSync(path.join(dir, f.name), f.buf);

const sample = {
  settings: { type: 'weekly', refDay: '2026-09-25', weekStart: 1, author: '보고자(가상)', title: '디자인팀(가상)' },
  projects: [
    // group = 주간보고 양식 표의 Business Group(가상)
    { name: '캡 인테리어 개선', keywords: ['캡', '조작부', '모델링'], group: '건설기계(가상)' },
    { name: 'CMF 샘플 평가', keywords: ['CMF', '색상', '샘플'], group: '건설기계(가상)' },
    { name: '전시회 준비', keywords: ['전시', '부스'], group: '전시·홍보(가상)' }
  ],
  // 지난주(09-14 ~ 09-20)에 승인한 가상 보고서 — 「이전 보고서 계획 대비」 시연용
  history: [{
    id: 'H202609190000', type: 'weekly', period: { start: '2026-09-14', end: '2026-09-20', label: '2026-09-14(월) ~ 2026-09-20(일)' },
    approved: '2026-09-19 17:00', counts: { performance: 3, plan: 5, issue: 1, check: 0, mails: 6 },
    plans: [
      { project: '캡 인테리어 개선', text: '1차 시안 검토 회의 진행 및 최종 시안 선정' },
      { project: '캡 인테리어 개선', text: '협력사로부터 조작부 치수 자료 회신 받기' },
      { project: 'CMF 샘플 평가', text: '색상 샘플 입고 확인' },
      { project: '전시회 준비', text: '부스 렌더링 이미지 제출' },
      { project: '디자인 가이드', text: '사내 디자인 가이드 개정안 작성' }
    ]
  }],
  files: files.map((f) => ({ name: f.name, b64: f.buf.toString('base64') }))
};
const js = '/* 과제 B 예시 데이터 — scripts/make-eml-samples.js 가 만든 파일입니다. 직접 고치지 말고 스크립트를 고쳐 다시 만드세요.\n' +
  '   인물·업무는 모두 가상(example.com). files 는 samples/eml/*.eml 과 같은 바이트(base64) */\n' +
  '(function (root, data) {\n  if (typeof module === \'object\' && module.exports) module.exports = data;\n  else root.RPSample = data;\n})(typeof self !== \'undefined\' ? self : this, ' +
  JSON.stringify(sample, null, 1) + ');\n';
fs.writeFileSync(path.join(ROOT, 'js', 'report-sample.js'), js);
console.log('samples/eml/*.eml ' + files.length + '개, js/report-sample.js 작성');
