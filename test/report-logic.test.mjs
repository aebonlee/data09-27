// 보고서 로직(data09-10 과제 B 에서 가져옴) 테스트 — 실행: node test/report-logic.test.mjs  (node test/logic.test.mjs 가 함께 돌린다)
// 예시 메일은 scripts/make-eml-samples.js 가 만든 samples/eml/*.eml 과 같은 바이트다.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const L = require('../js/report-logic.js');
const S = require('../js/report-sample.js');
const X = require('../vendor/xlsx.full.min.js');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
const u8 = (s) => new Uint8Array(Buffer.from(s, 'utf8'));
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

console.log('\n[보고서] 인코딩');
test('base64 · quoted-printable 풀기, base64 왕복', () => {
  assert.equal(L.decodeBytes(L.base64ToBytes(b64('업무보고 OK')), 'utf-8'), '업무보고 OK');
  assert.equal(L.decodeBytes(L.base64ToBytes(b64('줄\r\n바꿈').replace(/(.{4})/g, '$1\r\n')), 'utf-8'), '줄\r\n바꿈'); // 줄 나뉜 base64
  assert.equal(L.decodeBytes(L.qpToBytes('=EC=99=84=EB=A3=8C =\r\nOK'), 'utf-8'), '완료 OK'); // 부드러운 줄바꿈
  const bytes = u8('가나다라마');
  assert.deepEqual(Array.from(L.base64ToBytes(L.bytesToBase64(bytes))), Array.from(bytes));
  assert.equal(L.bytesToBase64(u8('a')), 'YQ==');
});
test('RFC 2047 제목: B · Q · 둘로 나뉜 단어 · EUC-KR(ks_c_5601-1987) · 섞인 글', () => {
  assert.equal(L.decodeHeaderValue('=?UTF-8?B?' + b64('[캡] 시안 검토') + '?='), '[캡] 시안 검토');
  assert.equal(L.decodeHeaderValue('=?utf-8?Q?RE:_=ED=9A=8C=EC=9D=98?='), 'RE: 회의');
  // 「한」(ED 95 9C)의 바이트를 두 단어에 걸쳐 나눈 경우 — 이어 붙여 풀어야 깨지지 않는다
  assert.equal(L.decodeHeaderValue('=?UTF-8?B?7ZU=?= =?UTF-8?B?nOq4gA==?='), '한글');
  assert.equal(L.decodeHeaderValue('=?ks_c_5601-1987?B?x9Gx2w==?='), '한글');
  assert.equal(L.decodeHeaderValue('FW: =?UTF-8?B?' + b64('일정') + '?= 안내'), 'FW: 일정 안내');
  assert.equal(L.decodeHeaderValue('plain subject'), 'plain subject');
});
test('Content-Type 매개변수: 따옴표 · RFC 2231 filename* · 이어붙이기(*0* *1*) · RFC 2047 name', () => {
  assert.equal(L.parseParams('multipart/mixed; boundary="a;b=c"').params.boundary, 'a;b=c');
  assert.equal(L.parseParams("attachment; filename*=UTF-8''%EC%83%98%ED%94%8C.xlsx").params.filename, '샘플.xlsx');
  assert.equal(L.parseParams("attachment; filename*0*=UTF-8''%EC%83%98; filename*1*=%ED%94%8C.xlsx").params.filename, '샘플.xlsx');
  assert.equal(L.decodeHeaderValue(L.parseParams('application/pdf; name="=?UTF-8?B?' + b64('부스.pdf') + '?="').params.name), '부스.pdf');
  assert.equal(L.parseParams('TEXT/Plain; Charset=UTF-8').value, 'text/plain');
});
test('주소 목록: 따옴표 안 쉼표 · 인코딩 이름 · 주소만', () => {
  const a = L.parseAddressList('"김, 가상" <a@example.com>, =?UTF-8?B?' + b64('이예시') + '?= <b@example.com>, c@example.com');
  assert.deepEqual(a.map((x) => x.name), ['김, 가상', '이예시', '']);
  assert.deepEqual(a.map((x) => x.email), ['a@example.com', 'b@example.com', 'c@example.com']);
});
test('날짜: 보낸 쪽 시간대의 날짜를 쓰고 UTC 로도 보관', () => {
  const d = L.parseMailDate('Mon, 21 Sep 2026 01:30:00 +0900');
  assert.equal(d.day, '2026-09-21');
  assert.equal(d.iso, '2026-09-20T16:30:00.000Z');
  assert.equal(L.parseMailDate('21 Sep 2026 09:12 -0500').iso, '2026-09-21T14:12:00.000Z');
  assert.equal(L.parseMailDate('엉터리'), null);
});

console.log('\n[보고서] .eml 파서');
const files = readdirSync(path.join(ROOT, 'samples/eml')).filter((f) => f.endsWith('.eml')).sort();
const parsed = files.map((f) => L.parseEml(new Uint8Array(readFileSync(path.join(ROOT, 'samples/eml', f))), { file: f }));
const mails = L.addMails([], parsed).mails;
const byFile = Object.fromEntries(mails.map((m) => [m.file, m]));
test('예시 .eml 9개 = js/report-sample.js 와 같은 바이트', () => {
  assert.equal(files.length, 9);
  assert.deepEqual(S.files.map((f) => f.name).sort(), files);
  for (const f of S.files) assert.equal(f.b64, readFileSync(path.join(ROOT, 'samples/eml', f.name)).toString('base64'), f.name);
});
test('9통 모두 경고 없이 제목·보낸이·날짜를 읽음', () => {
  for (const m of mails) { assert.deepEqual(m.warnings, [], m.file); assert.ok(m.subject && m.from.email && m.day, m.file); }
});
test('multipart/alternative(base64 text + QP html) → text/plain 을 씀', () => {
  const m = byFile['01_cab_review_result.eml'];
  assert.equal(m.subject, '[캡 인테리어 개선] 1차 시안 검토 회의 결과 공유');
  assert.ok(m.hasHtml);
  assert.ok(m.text.includes('B안을 최종 시안으로 선정했습니다.'));
  assert.ok(!m.text.includes('<b>'));
  assert.equal(m.from.name, '디자인팀장(가상)');
  assert.equal(m.day + ' ' + m.time, '2026-09-21 09:12');
});
test('Q 인코딩 회신 · 8bit 본문 · 인용문(Original Message)은 main 에서 뺌', () => {
  const m = byFile['02_cab_reply_modeling.eml'];
  assert.equal(m.subject, 'RE: [캡 인테리어 개선] 1차 시안 검토 회의 결과 공유');
  assert.equal(m.inReplyTo, 'cab-001@example.com');
  assert.ok(m.text.includes('Original Message'));
  assert.ok(!m.main.includes('선정했습니다')); // 인용된 E1 문장
  assert.ok(m.main.includes('착수했습니다'));
});
test('multipart/mixed: QP 본문 + RFC 2231 첨부, 접힌 제목(인코딩 단어 2개)', () => {
  const m = byFile['03_cmf_sample_arrival.eml'];
  assert.equal(m.subject, '[CMF 샘플 평가] 색상 샘플 입고 및 평가 일정 안내');
  assert.deepEqual(m.attachments.map((a) => a.name), ['CMF_샘플목록.xlsx']);
  assert.ok(m.attachments[0].size > 0);
  assert.equal(m.cc[0].name, '디자인장(가상)'.replace('디자인장', '디자인팀장'));
  assert.ok(m.text.includes('색상 샘플 12종 입고 완료했습니다.'));
});
test('전달(FW) · 첨부 2개(RFC 2047 name / 일반 filename) · Forwarded 인용 제외', () => {
  const m = byFile['04_expo_rendering_fw.eml'];
  assert.deepEqual(m.attachments.map((a) => a.name), ['부스_렌더링_5컷.pdf', 'booth_front.png']);
  assert.equal(m.attachments[1].size, 8);
  assert.ok(!m.main.includes('요청드립니다'));
});
test('html 만 있는 메일 → 글자만 남김(style·태그 제거)', () => {
  const m = byFile['05_cab_dimension_request.eml'];
  assert.ok(m.text.includes('9/30까지 회신 부탁드립니다.'));
  assert.ok(!/[<>]|margin/.test(m.text));
});
test('ks_c_5601-1987(EUC-KR) 제목 · 보낸이 · 본문', () => {
  const m = byFile['06_expo_schedule_change.eml'];
  assert.equal(m.subject, '[전시회 준비] 부스 설치 일정 변경 안내');
  assert.equal(m.from.name, '전시 운영(가상)');
  assert.ok(m.text.includes('의사결정이 필요합니다.'));
});
test('손으로 만든 multipart(base64 본문 + 첨부) · 경계 문자열에 특수문자', () => {
  const raw = ['From: a@example.com', 'Date: Tue, 29 Sep 2026 10:00:00 +0900', 'Subject: =?UTF-8?B?' + b64('테스트') + '?=',
    'Content-Type: multipart/mixed; boundary="=_b:1"', '', 'preamble', '--=_b:1', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
    b64('본문 완료했습니다.'), '--=_b:1', 'Content-Type: application/octet-stream; name="x.bin"', 'Content-Transfer-Encoding: base64', '', 'AAEC', '--=_b:1--', ''].join('\r\n');
  const m = L.parseEml(u8(raw));
  assert.equal(m.subject, '테스트');
  assert.equal(m.text, '본문 완료했습니다.');
  assert.deepEqual(m.attachments, [{ name: 'x.bin', type: 'application/octet-stream', size: 3 }]);
});
test('유니코드 문자열로 붙여 넣은 .eml 원문도 같은 결과', () => {
  const raw = readFileSync(path.join(ROOT, 'samples/eml/02_cab_reply_modeling.eml'), 'utf8');
  const m = L.parseEml(raw);
  assert.equal(m.main, byFile['02_cab_reply_modeling.eml'].main);
});
test('머리글이 없는 파일은 경고', () => {
  assert.ok(L.parseEml('그냥 글입니다').warnings.length >= 1);
});
test('붙여넣기: Outlook 한국어 머리글(보낸 사람·보낸 날짜·제목)을 읽음', () => {
  const m = L.mailFromPaste('보낸 사람: 가상인 <v@example.com>\n보낸 날짜: 2026년 9월 24일 목요일 오후 3:10\n받는 사람: 보고자\n제목: RE: [전시회 준비] 운송 견적\n\n운송 견적을 받았습니다.\n> 인용문');
  assert.equal(m.day, '2026-09-24');
  assert.equal(m.subject, 'RE: [전시회 준비] 운송 견적');
  assert.equal(m.from.email, 'v@example.com');
  assert.equal(m.main, '운송 견적을 받았습니다.');
  const n = L.mailFromPaste('본문만 있습니다.', { subject: '직접 제목', day: '2026-09-22' });
  assert.equal(n.subjectNorm, '직접 제목');
  assert.deepEqual(n.warnings, []);
  assert.equal(L.mailFromPaste('본문만').warnings.length, 1);
});
test('제목 정규화: RE:/FW:/Fwd:/회신:/전달:/RE[2]: 와 [외부] 제거, [프로젝트] 유지', () => {
  assert.equal(L.normalizeSubject('RE: FW: [외부] [캡 인테리어 개선] 시안 검토'), '[캡 인테리어 개선] 시안 검토');
  assert.equal(L.normalizeSubject('Re[2]: 회신: 전달: Fwd:  일정   안내'), '일정 안내');
  assert.deepEqual(L.subjectParts('[긴급][CMF] RE: 샘플').tags, ['CMF']);
});
test('addMails: 날짜 순 번호(E001 = 가장 오래된 메일), 같은 Message-ID 는 건너뜀', () => {
  assert.equal(mails[0].id, 'E001');
  assert.equal(mails[0].file, '08_cab_kickoff_prevweek.eml');
  assert.deepEqual(mails.map((m) => m.id), ['E001', 'E002', 'E003', 'E004', 'E005', 'E006', 'E007', 'E008', 'E009']);
  const again = L.addMails(mails, [parsed[0]]);
  assert.equal(again.added.length, 0);
  assert.equal(again.duplicates.length, 1);
});

console.log('\n[보고서] 기간 · 그룹핑 · 분류');
const P = L.periodFor('weekly', '2026-09-25', 1);
test('주간 기간(월요일 시작 / 일요일 시작) · 월간 기간(윤년 2월) · 이전 기간', () => {
  assert.deepEqual([P.start, P.end, P.next.start, P.next.end], ['2026-09-21', '2026-09-27', '2026-09-28', '2026-10-04']);
  const sun = L.periodFor('weekly', '2026-09-25', 0);
  assert.deepEqual([sun.start, sun.end], ['2026-09-20', '2026-09-26']);
  assert.deepEqual([L.periodFor('weekly', '2026-09-21', 1).start, L.periodFor('weekly', '2026-09-27', 1).start], ['2026-09-21', '2026-09-21']);
  const mo = L.periodFor('monthly', '2028-02-10');
  assert.deepEqual([mo.start, mo.end, mo.next.end], ['2028-02-01', '2028-02-29', '2028-03-31']);
  assert.equal(L.periodFor('monthly', '2026-12-31').next.label, '2027년 1월');
  assert.equal(L.previousPeriod(P, 1).start, '2026-09-14');
  assert.equal(L.periodFor('weekly', 'x'), null);
});
const tasks = L.groupTasks(mails, S.projects);
const idOf = (file) => byFile[file].id;
test('업무 그룹: 회신(In-Reply-To)은 같은 업무, 다른 제목은 다른 업무', () => {
  assert.equal(tasks.length, 8);
  const t = L.taskOfMail(tasks, idOf('01_cab_review_result.eml'));
  assert.deepEqual(t.mailIds, [idOf('01_cab_review_result.eml'), idOf('02_cab_reply_modeling.eml')]);
  assert.equal(t.name, '1차 시안 검토 회의 결과 공유');
  assert.notEqual(L.taskOfMail(tasks, idOf('05_cab_dimension_request.eml')).id, t.id);
});
test('프로젝트: 제목 [태그]·키워드로 배정, 없으면 기타', () => {
  const pj = (f) => L.taskOfMail(tasks, idOf(f)).project;
  assert.equal(pj('05_cab_dimension_request.eml'), '캡 인테리어 개선');
  assert.equal(pj('06_expo_schedule_change.eml'), '전시회 준비');
  assert.equal(pj('07_cmf_criteria_reply.eml'), 'CMF 샘플 평가');
  assert.equal(pj('09_team_weekly_meeting.eml'), '기타');
  assert.equal(tasks[tasks.length - 1].project, '기타'); // 기타는 맨 뒤
  // 프로젝트 목록이 없으면 제목 [태그]를 프로젝트로 쓴다
  assert.equal(L.projectOf(byFile['03_cmf_sample_arrival.eml'], []).project, 'CMF 샘플 평가');
  // 제목에 없어도 키워드가 본문에만 있으면 약하게(1점) — 3점 미만은 태그 쪽을 쓴다
  assert.equal(L.projectOf({ subject: '안내', main: '부스 전시', attachments: [] }, [{ name: '전시회 준비', keywords: ['전시', '부스'] }]).project, '기타');
});
test('Message-ID 가 없어도 정규화 제목이 같으면 한 업무', () => {
  const ms = [
    { id: 'E001', subject: '[A] 도면 검토', day: '2026-09-21', date: '2026-09-21T00:00:00Z', attachments: [], references: [] },
    { id: 'E002', subject: 'RE: [외부] [A] 도면 검토', day: '2026-09-22', date: '2026-09-22T00:00:00Z', attachments: [], references: [] },
    { id: 'E003', subject: '도면 검토 결과', day: '2026-09-23', date: '2026-09-23T00:00:00Z', attachments: [], references: [] }];
  const ts = L.groupTasks(ms, []);
  assert.equal(ts.length, 2);
  assert.deepEqual(ts.find((t) => t.project === 'A').mailIds, ['E001', 'E002']);
});
test('문장 분류: 실적(완료·진행 중·확인 필요) · 계획 · 이슈(지연·보류·결정) · 업무 아님', () => {
  const c = (s) => { const r = L.classifySentence(s); return r ? r.category + '/' + r.status + (r.decision ? '/결정' : '') : null; };
  assert.equal(c('시안 3종 검토 완료했습니다.'), '실적/완료');
  assert.equal(c('모델링 업데이트에 착수했습니다.'), '실적/진행 중');
  assert.equal(c('협력사와 일정을 협의했습니다.'), '실적/확인 필요'); // 끝났는지 모름 → 확정하지 않음
  assert.equal(c('다음 주에 평가를 진행할 예정입니다.'), '계획/예정');
  assert.equal(c('10월 말 완료 예정입니다.'), '계획/예정'); // 「완료 예정」은 계획
  assert.equal(c('자료 회신이 지연되고 있습니다.'), '이슈/지연');
  assert.equal(c('예산 문제로 보류되었습니다.'), '이슈/보류');
  assert.equal(c('운송사 변경 여부에 대한 의사결정이 필요합니다.'), '이슈/확인 필요/결정');
  assert.equal(c('안녕하세요 반갑습니다'), null);
});
test('문장 나누기: 인사·서명 제외, 날짜 앞 숫자를 목록 번호로 오인하지 않음', () => {
  assert.deepEqual(L.sentences('안녕하세요.\n9/30까지 판단 부탁드립니다. 1. 번호 항목입니다\n보고자 드림'), ['9/30까지 판단 부탁드립니다.', '번호 항목입니다']);
});
test('날짜 표현 → YYYY-MM-DD (글에 나온 순서)', () => {
  assert.deepEqual(L.extractDates('10/2까지, 10월 5일, 2026-10-07, 10/1(목)', '2026-09-25'), ['2026-10-02', '2026-10-05', '2026-10-07', '2026-10-01']);
  assert.deepEqual(L.extractDates('버전 1.2.3 과 13/40', '2026-09-25'), []);
});
const items = L.ruleItems(mails, tasks);
test('규칙 항목: 모든 항목에 근거 메일 ID, 기간 안 기준 실적 6 · 계획 6 · 이슈 5', () => {
  assert.ok(items.every((x) => x.evidence.length === 1 && byFile[x.evidence.length && mails.find((m) => m.id === x.evidence[0]).file]));
  const inP = items.filter((x) => L.inPeriod(mails.find((m) => m.id === x.evidence[0]).day, P));
  const n = (c) => inP.filter((x) => x.category === c).length;
  // 손으로 센 값(메일 번호는 날짜 순): 실적 = E002 마쳤·선정, E003 착수, E004 입고, E005 제출, E009 초안 작성 → 6
  //   계획 = E002 모델링(10/2), E004 평가(9/29), E005 금요일까지 반영, E006 9/30까지 회신, E008 팀 회의, E009 기준 확정 → 6
  //   이슈 = E003 회신 없음·지연, E006 회신 지연, E007 충돌·의사결정·판단 요청 → 5
  assert.deepEqual({ 실적: n('실적'), 계획: n('계획'), 이슈: n('이슈') }, { 실적: 6, 계획: 6, 이슈: 5 });
  assert.equal(items.length - inP.length, 1); // 지난주 킥오프 메일의 계획 1건은 기간 밖
  const plan = inP.find((x) => x.text.includes('3D 모델링 업데이트를 진행할 예정'));
  assert.equal(plan.date, '2026-10-02');
  assert.ok(inP.filter((x) => x.decision).length === 2);
});
test('상충 표시: 같은 업무에 「완료」와 비슷한 「지연」이 함께 있으면 둘 다 확인 필요', () => {
  const xs = L.markConflicts([
    { id: 'a', taskId: 'T1', category: '실적', status: '완료', text: '치수 자료 수령 완료했습니다', evidence: ['E001'] },
    { id: 'b', taskId: 'T1', category: '이슈', status: '지연', text: '치수 자료 수령이 지연되고 있습니다', evidence: ['E002'] },
    { id: 'c', taskId: 'T2', category: '이슈', status: '지연', text: '치수 자료 수령이 지연되고 있습니다', evidence: ['E003'] }]);
  assert.ok(xs[0].conflict.includes('E002'));
  assert.ok(xs[1].conflict.includes('E001'));
  assert.equal(xs[2].conflict, ''); // 다른 업무는 상충 아님
  assert.ok(items.every((x) => x.conflict === '')); // 예시에는 상충 없음
});
test('업무 상태: 가장 최근 근거 상태 + 바뀐 이력', () => {
  const t = L.taskOfMail(tasks, idOf('01_cab_review_result.eml'));
  const s = L.taskStatus(t, items, mails);
  assert.equal(s.status, '지연'); // E003(회신)의 마지막 문장이 지연 이슈
  assert.deepEqual(s.history.map((h) => h.status), ['완료', '예정', '진행 중', '지연']);
});

console.log('\n[보고서] AI 반자동');
test('프롬프트: 메일 ID·규칙 포함, 메일주소·전화번호 가림(끄면 그대로)', () => {
  const inP = mails.filter((m) => L.inPeriod(m.day, P));
  const p = L.aiPrompt(inP, P, S.projects);
  assert.ok(p.includes('### E002 | 2026-09-21'));
  assert.ok(!p.includes('### E001 |')); // 기간 밖 메일은 넣지 않았다
  assert.ok(p.includes('만들지 마'));
  assert.ok(p.includes('「확인 필요」'));
  assert.ok(!p.includes('@example.com'));
  assert.equal(L.maskPII('연락 010-1234-5678, a.b@c.co.kr'), '연락 [전화번호], [메일주소]');
  assert.ok(L.aiPrompt(inP, P, S.projects, { mask: false }).includes('디자인팀장(가상)'));
});
test('AI 답 읽기: ```json 울타리, 없는 ID 제거, 허용 밖 상태 → 확인 필요, 근거 없으면 확인 필요, 추론 구분', () => {
  const ans = '다음과 같습니다.\n```json\n[' +
    '{"project":"캡 인테리어 개선","task":"시안","category":"실적","status":"완료","text":"B안 선정","evidence":["E002","E099"],"explicit":true},' +
    '{"category":"계획","status":"곧","text":"모델링 업데이트","evidence":"E002, E003","explicit":false},' +
    '{"category":"이슈","status":"지연","text":"근거 없는 이슈","evidence":[]},' +
    '{"category":"잡담","text":"분류 없음","evidence":["E004"]},' +
    '{"category":"실적","text":""}]\n```';
  const r = L.parseAiItems(ans, mails, tasks);
  assert.equal(r.items.length, 4);
  assert.deepEqual(r.items[0].evidence, ['E002']);
  assert.equal(r.items[0].status, '완료');
  assert.equal(r.items[0].origin, 'ai');
  assert.equal(r.items[1].status, '확인 필요');
  assert.equal(r.items[1].explicit, false);
  assert.equal(r.items[1].project, '캡 인테리어 개선'); // 근거 메일의 업무에서 채움
  assert.equal(r.items[2].status, '확인 필요');
  assert.ok(r.items[2].note.includes('근거'));
  assert.equal(r.items[3].category, '이슈');
  assert.ok(r.errors.some((e) => e.includes('E099')));
  assert.ok(r.errors.some((e) => e.includes('text')));
  assert.throws(() => L.parseAiItems('JSON 이 아닙니다', mails, tasks), /JSON/);
});

console.log('\n[보고서] 이전 계획 대비 · 보고서');
const inPeriodItems = items.filter((x) => L.inPeriod(mails.find((m) => m.id === x.evidence[0]).day, P));
const prev = L.plansFromHistory(S.history, P);
const plans = L.parsePlanLines(prev.text);
const carry = L.carryOver(plans, inPeriodItems);
test('이전 계획 5건 → 완료 3 · 지연 1 · 이월 1 (손으로 대조)', () => {
  assert.equal(plans.length, 5);
  assert.equal(plans[0].project, '캡 인테리어 개선');
  assert.deepEqual(carry.map((c) => c.suggest), ['완료', '지연', '완료', '완료', '이월']);
  assert.ok(carry[1].match.text.includes('회신'));
  assert.equal(carry[4].match, null);
  assert.ok(carry.every((c) => c.sim <= 1));
  assert.equal(L.plansFromHistory(S.history, L.periodFor('weekly', '2026-09-15', 1)), null); // 그 기간보다 앞선 이력 없음
});
test('짧은 계획이 「작성」 같은 흔한 두 글자만으로 엉뚱한 완료 항목에 붙지 않음(스모크에서 잡은 오판)', () => {
  const xs = [{ category: '실적', status: '완료', project: 'CMF 샘플 평가', text: '평가 기준표 초안 작성 완료했습니다.', evidence: ['E009'] }];
  assert.equal(L.carryOver([{ project: '디자인 가이드', text: '개정안 작성' }], xs)[0].suggest, '이월');
  assert.equal(L.carryOver([{ text: '개정안 작성' }], xs)[0].suggest, '이월');
  assert.equal(L.carryOver([{ project: 'CMF 샘플 평가', text: '평가 기준표 초안 작성' }], xs)[0].suggest, '완료');
});
test('다시 계획으로 나오면 이월, 완료 불명확 실적이면 진행', () => {
  const r = L.carryOver([{ text: '평가 회의 진행' }, { text: '운송사 협의' }], [
    { category: '계획', status: '예정', text: '평가 회의를 진행할 예정입니다', evidence: ['E1'] },
    { category: '실적', status: '확인 필요', text: '운송사와 협의했습니다', evidence: ['E2'] }]);
  assert.deepEqual(r.map((c) => c.suggest), ['이월', '진행']);
});
const carryWithFinal = carry.map((c, i) => (i === 4 ? Object.assign({}, c, { final: '이월' }) : c));
const rep = L.buildReport({ type: 'weekly', period: P, mails, items, tasks, carry: carryWithFinal, author: '보고자(가상)', title: '디자인팀(가상)', now: '2026-09-27 18:00' });
test('주간 보고서: 기간 밖 메일 근거 제외, 건수(확인 필요 3 = E007 이슈 3건)·요약·근거 목록', () => {
  assert.deepEqual(rep.counts, { performance: 6, plan: 6, issue: 5, check: 3, mails: 8 });
  assert.ok(!rep.evidence.some((e) => e.id === 'E001'));
  assert.deepEqual(rep.evidence.map((e) => e.id), ['E002', 'E003', 'E004', 'E005', 'E006', 'E007', 'E008', 'E009']);
  assert.equal(rep.performance[0].project, '캡 인테리어 개선');
  assert.equal(rep.plan[rep.plan.length - 1].project, '기타');
  assert.ok(rep.summary[0].startsWith('2026-09-21(월) ~ 2026-09-27(일) 동안 메일 8통'));
  assert.ok(rep.summary.some((s) => s.includes('의사결정')));
  assert.ok(rep.summary.some((s) => s.includes('완료 3 · 지연 1 · 이월 1')));
  assert.equal(rep.decision.length, 2);
  assert.deepEqual(L.buildReport({ period: P, mails, items: items.map((x) => Object.assign({}, x, { excluded: true })), tasks }).counts.performance, 0);
  assert.deepEqual(L.buildReport({ period: P, mails, items, tasks, summaryOverride: '한 줄\n두 줄' }).summary, ['한 줄', '두 줄']);
});
test('보고서 HTML: 섹션(주간 5 · 월간 7) + 근거 목록, 근거 링크, 글자 이스케이프, 초안 표시', () => {
  const html = L.reportBodyHtml(rep, { linkBase: '#/mail/' });
  assert.equal((html.match(/data-section="/g) || []).length, L.SECTIONS.weekly.length + 1);
  assert.ok(html.includes('href="#/mail/E003"'));
  assert.ok(html.includes('초안 — 검토·승인 전'));
  const mo = L.buildReport({ type: 'monthly', period: L.periodFor('monthly', '2026-09-25'), mails, items, tasks, approved: '2026-09-30 10:00' });
  const mh = L.reportBodyHtml(mo, {});
  assert.equal((mh.match(/data-section="/g) || []).length, L.SECTIONS.monthly.length + 1);
  assert.ok(mh.includes('Decision Required') && mh.includes('승인: 2026-09-30 10:00'));
  assert.ok(mh.includes('href="#ev-E006"') && mh.includes('id="ev-E006"')); // 파일 안 근거 링크
  const bad = L.buildReport({ period: P, mails, tasks, items: [Object.assign({}, items[1], { text: '<script>alert(1)</script>' })] });
  const bh = L.reportHtml(bad);
  assert.ok(!bh.includes('<script>alert') && bh.includes('&lt;script&gt;'));
  assert.ok(L.reportWordHtml(bad).includes('urn:schemas-microsoft-com:office:word'));
});
test('.docx 부품: XML 3개, 문단 짝이 맞고 이스케이프, zip 으로 묶임', () => {
  const bad = L.buildReport({ period: P, mails, tasks, carry, items: items.concat([Object.assign({}, items[1], { id: 'X', text: 'A&B <tag> \u0001제어' })]) });
  const parts = L.docxParts(bad);
  assert.deepEqual(Object.keys(parts), ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']);
  const doc = parts['word/document.xml'];
  assert.equal((doc.match(/<w:p>|<w:p /g) || []).length, (doc.match(/<\/w:p>/g) || []).length);
  assert.equal((doc.match(/<w:tbl>/g) || []).length, (doc.match(/<\/w:tbl>/g) || []).length);
  assert.ok(doc.includes('A&amp;B &lt;tag&gt; 제어'));
  assert.ok(!doc.includes('\u0001'));
  const cfb = X.CFB.utils.cfb_new();
  for (const [p, v] of Object.entries(parts)) X.CFB.utils.cfb_add(cfb, '/' + p, Buffer.from(v, 'utf8'));
  const zip = X.CFB.write(cfb, { fileType: 'zip', type: 'buffer' });
  assert.equal(Buffer.from(zip).subarray(0, 2).toString(), 'PK');
});
test('엑셀 시트: 주간은 요약 · 주간보고표 · 업무항목 · 업무그룹 · 근거메일 · 이전계획대비, 월간은 주간보고표 없음', () => {
  const sh = L.reportSheets(rep, items, mails, tasks);
  assert.deepEqual(sh.map((s) => s.name), ['요약', '주간보고표', '업무항목', '업무그룹', '근거메일', '이전계획대비']);
  assert.equal(sh[2].aoa.length, items.length + 1);
  assert.equal(sh[4].aoa.length, mails.length + 1);
  assert.equal(sh[5].aoa[5][2], '이월');
  assert.equal(sh[5].aoa[5][3], '확정');
  const mo = L.buildReport({ type: 'monthly', period: L.periodFor('monthly', '2026-09-25'), mails, items, tasks });
  assert.ok(!L.reportSheets(mo, items, mails, tasks).some((x) => x.name === '주간보고표'));
});

console.log('[보고서] 주간보고 양식 표 (2026-09-29 오후 늦게 — 양식 샘플 구조)');
test('개조식 문체: 「~했습니다」「~예정입니다」「~부탁드립니다」「~이 필요합니다」 → 명사로 끝남', () => {
  const cases = [
    ['오늘 1차 시안 검토 회의를 마쳤습니다.', '오늘 1차 시안 검토 회의 완료'],
    ['부스 렌더링 이미지 5컷을 제출했습니다.', '부스 렌더링 이미지 5컷 제출'],
    ['차주에는 B안 기준으로 3D 모델링 업데이트를 진행할 예정입니다(10/2까지).', '차주에는 B안 기준으로 3D 모델링 업데이트 진행 예정 (10/2까지)'],
    ['보완 요청이 있으면 금요일까지 반영하겠습니다.', '보완 요청이 있으면 금요일까지 반영 예정'],
    ['모델링 일정을 지키기 위해 9/30까지 회신 부탁드립니다.', '모델링 일정 지키기 위해 9/30까지 회신 요청'],
    ['운송 일정과 충돌 가능성이 있어 확인이 필요합니다.', '운송 일정과 충돌 가능성이 있어 확인 필요'],
    ['지난주 요청드린 조작부 치수 자료 회신이 지연되고 있습니다.', '지난주 요청드린 조작부 치수 자료 회신이 지연 중'],
    ['팀장님, B안 기준으로 3D 모델링 업데이트에 착수했습니다.', 'B안 기준으로 3D 모델링 업데이트에 착수'],
    ['금형 수정에 따른 양산 일정 확인 필요', '금형 수정에 따른 양산 일정 확인 필요'],   // 이미 개조식이면 그대로
    ['샘플을 받았습니다.', '샘플 받음'],
    ['', '']
  ];
  cases.forEach(([a, b]) => assert.equal(L.boardStyle(a), b, a));
});
test('양식 기간 표기: 금주·차주 평일(월~금), 점 날짜', () => {
  assert.deepEqual(L.workdayRange(L.periodFor('weekly', '2026-09-30', 1)), { start: '2026-09-28', end: '2026-10-02', label: '2026.09.28 ~ 2026.10.02' });
  assert.equal(L.workdayRange(L.periodFor('weekly', '2026-09-30', 0)).label, '2026.09.28 ~ 2026.10.02');   // 일요일 시작 주도 평일만
  assert.equal(L.workdayRange(null), null);
});
const repB = L.buildReport({ type: 'weekly', period: P, mails, items, tasks, carry: carryWithFinal, projects: S.projects, now: '2026-09-27 18:00' });
const board = L.boardOf(repB);
test('양식 표: 열 = Business Group · 프로젝트명 · 금주 실적(기간) · 차주 계획(기간), 행 = 설정한 프로젝트 순서', () => {
  assert.deepEqual(board.head, ['Business Group', '프로젝트명', '금주 실적 (2026.09.21 ~ 2026.09.25)', '차주 계획 (2026.09.28 ~ 2026.10.02)']);
  assert.deepEqual(board.rows.map((r) => r.project), ['캡 인테리어 개선', 'CMF 샘플 평가', '전시회 준비', '디자인 가이드', '기타']);
  assert.deepEqual(board.rows.slice(0, 3).map((r) => r.group), ['건설기계(가상)', '건설기계(가상)', '전시·홍보(가상)']);
});
test('양식 칸: 진행 내용 · 결과물 배포일 · 이슈 사항 · 디자인 결과물 이미지 / 실행 예정 업무 · 일정 · 이슈 사항', () => {
  const expo = board.rows.find((r) => r.project === '전시회 준비');
  const perf = L.boardCellLines(expo, 'perf');
  assert.deepEqual(perf.filter((x) => x.startsWith('- ')).map((x) => x.slice(2).split(':')[0]), L.BOARD_LABELS.perf);
  assert.equal(perf[0], '- 진행 내용: 부스 렌더링 이미지 5컷 제출');
  assert.ok(perf.includes('- 디자인 결과물 이미지: 첨부 booth_front.png (보고서에 넣어 주세요)'));   // 근거 메일의 이미지 첨부 이름
  assert.ok(perf.some((x) => x.includes('의사결정 필요')));
  const plan = L.boardCellLines(expo, 'plan');
  assert.deepEqual(plan.filter((x) => x.startsWith('- ')).map((x) => x.slice(2).split(':')[0]), L.BOARD_LABELS.plan);
  const cab = board.rows[0];
  assert.equal(L.boardCellLines(cab, 'plan').find((x) => x.startsWith('- 일정')), '- 일정: 2026-09-30 ~ 2026-10-02');
  assert.ok(L.boardCellLines(cab, 'perf').includes('- 디자인 결과물 이미지: (여기에 디자인 결과물 이미지 삽입)'));
  const guide = board.rows.find((r) => r.project === '디자인 가이드');                               // 이월만 있는 프로젝트도 행이 생김
  assert.deepEqual(guide.plan.issues, ['이월: 사내 디자인 가이드 개정안 작성']);
  const cmf = board.rows.find((r) => r.project === 'CMF 샘플 평가');
  assert.equal(cmf.perf.release, '2026-09-23 ~ 2026-09-26');
});
test('문체 설정 「메일 문장 그대로」, 화면·Word·docx 에 양식 표, 월간에는 없음', () => {
  const orig = L.weeklyBoard(repB, S.projects, mails, { style: 'original' });
  assert.equal(orig.rows.find((r) => r.project === '전시회 준비').perf.progress[0], '부스 렌더링 이미지 5컷을 제출했습니다.');
  const html = L.reportHtml(repB);
  assert.ok(html.indexOf('data-section="board"') > html.indexOf('data-section="summary"') && html.indexOf('data-section="board"') < html.indexOf('data-section="performance"'));
  assert.ok(html.includes('<th>Business Group</th>') && html.includes('- 결과물 배포일:'));
  const doc = L.docxParts(repB)['word/document.xml'];
  assert.ok(doc.includes('Business Group') && doc.includes('- 실행 예정 업무:'));
  assert.equal((doc.match(/<w:p>|<w:p /g) || []).length, (doc.match(/<\/w:p>/g) || []).length);
  const mo = L.buildReport({ type: 'monthly', period: L.periodFor('monthly', '2026-09-25'), mails, items, tasks, projects: S.projects });
  assert.ok(!L.reportHtml(mo).includes('data-section="board"'));
  assert.equal(L.restoreState({ settings: { boardStyle: 'original' } }).settings.boardStyle, 'original');
  assert.equal(L.cleanProjects([{ name: 'A', keywords: 'x', group: ' 산업차량 ' }])[0].group, '산업차량');
});

console.log('[보고서] data09-10 Outlook 내보내기(.eml) 형식 — 직접 넣기 대안');
test('Export-OutlookMail.ps1 형식의 .eml: 나뉜 제목, 이름만 받는 사람, 시간대, 회신 흐름, 이름·크기만 담은 첨부', () => {
  const m = L.parseEml(new Uint8Array(readFileSync(path.join(ROOT, 'test/fixtures/outlook-export.eml'))), { file: 'x.eml' });
  assert.deepEqual(m.warnings, []);
  assert.equal(m.subject, 'RE: [캡 인테리어 개선] 2차 시안 검토 결과 공유 및 조작부 모델링 일정 안내');
  assert.deepEqual(m.from, { name: '디자이너A(가상)', email: 'designer.a@example.com' });
  assert.deepEqual(m.to.map((a) => a.name), ['팀장B(가상)', '설계담당(가상)']);
  assert.deepEqual([m.day, m.time, m.date], ['2026-09-29', '23:40', '2026-09-29T14:40:00.000Z']);
  assert.deepEqual([m.messageId, m.inReplyTo, m.references.length], ['export-0002@example.com', 'export-0001@example.com', 2]);
  assert.deepEqual(m.attachments.map((a) => [a.name, a.size]), [['캡_2차시안_렌더링.png', 524288], ['조작부 치수표.xlsx', 20480]]);
  assert.ok(!m.main.includes('인용문'));
  // (data09-10 의 Export-OutlookMail.ps1 은 이 리포에 없다 — 자동 수집기 검사는 test/collect-logic.test.mjs)
});
test('저장 형태: 복원 · 승인 이력 → 다음 기간 이전 계획', () => {
  const s = L.restoreState({ settings: { type: 'monthly', refDay: '2026-09-01' }, items: [{ id: 'x', category: '잡담', evidence: [] }, { id: 'y', category: '계획', evidence: ['E1'] }], taskProject: { k: 'A' }, approved: '2026-09-27 18:00' });
  assert.equal(s.settings.type, 'monthly');
  assert.equal(s.settings.weekStart, 1);
  assert.deepEqual(s.items.map((x) => x.id), ['y']);
  assert.equal(s.taskProject.k, 'A');
  assert.equal(L.restoreState(null).mails.length, 0);
  const h = L.historyEntry(rep, '2026-09-27 18:00');
  assert.equal(h.plans.length, 6);
  const nextP = L.periodFor('weekly', '2026-10-01', 1);
  const got = L.plansFromHistory(S.history.concat([h]), nextP);
  assert.equal(got.entry.period.start, '2026-09-21');
  assert.equal(L.parsePlanLines(got.text).length, 6);
});

console.log('\n[보고서] ' + passed + '개 통과' + (failed ? ' · 실패 ' + failed : ''));
export const reportPassed = passed, reportFailed = failed;
