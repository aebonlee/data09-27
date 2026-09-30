// 자동 수집(manifest) · 첨부 글 뽑기 · 분류 보강 테스트 — 실행: node test/collect-logic.test.mjs (node test/logic.test.mjs 가 함께 돌린다)
// 수집기(PowerShell · Outlook COM)는 macOS 에서 돌릴 수 없어서, 여기서는
//   ① 수집기와 같은 규칙의 JS 쌍둥이로 같은 예시 파일(samples/collect/att/*)의 워드·PPT·엑셀 글 뽑기를 검사하고
//   ② 수집기 스크립트를 글자로 읽어 「읽기 전용」 · 형식 약속(스키마 이름 · 칸 이름) · BOM 을 검사한다.
// Outlook 에 붙는 부분은 수강생 PC 에서 한 번 돌려 확인해야 한다(README 「처음 쓰는 법」 5단계).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const L = require('../js/report-logic.js');
const C = require('../js/collect-logic.js');
const S = require('../js/sample-collect.js');
const R = require('../js/rollup-logic.js');
const JSZip = require('../vendor/jszip.min.js');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = path.join(ROOT, 'samples/collect');

let passed = 0;
const pending = [];
function test(name, fn) {
  const ok = () => { passed++; console.log('  ok  ' + name); };
  const bad = (e) => { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; };
  try { const r = fn(); if (r && r.then) pending.push(r.then(ok, bad)); else ok(); } catch (e) { bad(e); }
}

console.log('\n[자동 수집] 워드 · PPT · 엑셀 글 뽑기 (수집기 CollectorCore.ps1 과 같은 규칙)');
test('XML 글자 풀기: &lt; &amp; &#44032; &#xAC01; &apos;', () => {
  assert.equal(C.decodeXml('a &lt;b&gt; &amp; &#44032;&#xAC01; &apos;x&quot;'), 'a <b> & 가각 \'x"');
});
test('Word XML: 문단 · 탭 · 줄바꿈 · 표(칸은 | ) · 탭 멈춤(w:tab 속성)은 글자가 아님', () => {
  const xml = '<w:document><w:body>' +
    '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>시안</w:t></w:r><w:r><w:t xml:space="preserve"> 검토 </w:t></w:r><w:r><w:t>완료</w:t></w:r></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>항목</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>일자</w:t></w:r></w:p></w:tc></w:tr>' +
    '<w:tr><w:tc><w:p><w:r><w:t>배포</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>9/24</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
    '<w:p><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t><w:br/><w:t>C &amp; D</w:t></w:r></w:p><w:p/>' +
    '</w:body></w:document>';
  assert.equal(C.docxXmlToText(xml), '시안 검토 완료\n항목 | 일자\n배포 | 9/24\nA\tB\nC & D');
});
test('PPT 슬라이드: 번호 순(10 이 2 뒤) · 문단마다 한 줄 · 빈 문단 빼기 · a:br', () => {
  const sl = (t) => '<p:sld><p:txBody>' + t.map((x) => '<a:p><a:r><a:t>' + x + '</a:t></a:r></a:p>').join('') + '<a:p><a:endParaRPr/></a:p></p:txBody></p:sld>';
  const out = C.pptxSlidesToText([{ n: 10, xml: sl(['열째']) }, { n: 2, xml: sl(['둘째', '배포일: 2026-09-24']) }, { n: 1, xml: '<a:p><a:r><a:t>첫</a:t></a:r><a:br/><a:r><a:t>줄</a:t></a:r></a:p>' }]);
  assert.equal(out, '[슬라이드 1]\n첫\n줄\n[슬라이드 2]\n둘째\n배포일: 2026-09-24\n[슬라이드 10]\n열째');
});
test('엑셀: 공유 문자열(t="s") · 서식 글(r) · 발음(rPh) 빼기 · 인라인 글 · 참거짓 · 숫자 · 빈 줄 · 시트 이름·순서', () => {
  const parts = {
    workbook: '<workbook><sheets><sheet name="일정" sheetId="2" r:id="rId2"/><sheet name="평가 &amp; 결과" sheetId="1" r:id="rId1"/></sheets></workbook>',
    rels: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="x"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml" Type="x"/></Relationships>',
    shared: '<sst><si><t>샘플</t></si><si><r><t>재도장</t></r><r><t xml:space="preserve"> 필요</t></r></si><si><t>한자</t><rPh sb="0" eb="1"><t>かんじ</t></rPh></si></sst>',
    sheets: {
      'xl/worksheets/sheet1.xml': '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"/><row r="3"><c r="A3" t="inlineStr"><is><t>인라인</t></is></c><c r="B3" t="b"><v>1</v></c><c r="C3" s="2"><v>2.9</v></c><c r="D3" t="s"><v>2</v></c><c r="E3"/></row></sheetData>',
      'xl/worksheets/sheet2.xml': '<sheetData><row r="1"><c r="A1" t="str"><f>A2</f><v>재입고</v></c></row></sheetData>'
    }
  };
  assert.deepEqual(C.xlsxSheetList(parts.workbook, parts.rels), [{ name: '일정', path: 'xl/worksheets/sheet2.xml' }, { name: '평가 & 결과', path: 'xl/worksheets/sheet1.xml' }]);
  assert.equal(C.xlsxToText(parts), '[시트 일정]\n재입고\n[시트 평가 & 결과]\n샘플 | 재도장 필요\n인라인 | TRUE | 2.9 | 한자');
});
test('예시 첨부 원본(docx · pptx · xlsx)에서 뽑은 글 = samples/collect 의 .txt = manifest 의 text', async () => {
  const man = JSON.parse(readFileSync(path.join(SAMPLE, 'manifest.json'), 'utf8'));
  const want = {
    '캡_1차시안_검토회의록.docx': ['일시 | 2026-09-21 09:00', 'B안 최종 시안 선정 완료.', '협력사 조작부 치수 회신이 지연되고 있어 확인이 필요합니다.', '3D 모델링 업데이트\t10/2까지'],
    'CMF_샘플_평가표.xlsx': ['[시트 평가표]', '3 | 웜그레이 | 2.9 | 재도장 필요 | 기준 2.0 초과', '[시트 일정]', '재도장 샘플 재입고 예정 | 2026-09-30'],
    '전시부스_렌더링_v2.pptx': ['[슬라이드 1]', '배포일: 2026-09-24', '[슬라이드 3]', '부스 그래픽 시안 확정 예정(10/5)']
  };
  let n = 0;
  for (const m of man.mails) for (const a of m.attachments) {
    if (!want[a.name]) continue;
    const buf = readFileSync(path.join(SAMPLE, a.file));
    const text = await C.ooxmlTextFromZip(await JSZip.loadAsync(buf), a.kind);
    for (const w of want[a.name]) assert.ok(text.split('\n').includes(w), a.name + ' 에 「' + w + '」 줄이 없음');
    assert.equal(text, readFileSync(path.join(SAMPLE, a.file + '.txt'), 'utf8'), a.name + ' .txt');
    assert.equal(text, a.text, a.name + ' manifest');
    assert.equal(a.extract, 'ok');
    n++;
  }
  assert.equal(n, 3);
});

console.log('\n[자동 수집] 설정 · manifest · 메일');
test('수집설정.txt: 기본값 · BOM · # 설명 · 모르는 이름 · 늘 빼는 폴더(지운 편지함 · 정크)', () => {
  const raw = readFileSync(path.join(ROOT, 'collector/수집설정.txt'), 'utf8');
  assert.equal(raw.charCodeAt(0), 0xFEFF);                                           // PowerShell 5.1 이 UTF-8 로 읽게
  const s = C.parseSettingsText(raw);
  assert.deepEqual(s._unknown, []);
  assert.equal(s['PST폴더'], '');
  assert.equal(s['첨부최대MB'], '30');
  assert.ok(s['제외폴더'].includes('임시 보관함'));
  const t = C.parseSettingsText('\uFEFF# 설명\r\nPST폴더 = D:\\메일백업\r\n모르는칸=1\r\n=값만\r\n');
  assert.equal(t['PST폴더'], 'D:\\메일백업');
  assert.deepEqual(t._unknown, ['모르는칸']);
  const names = C.skipFolderNames(s);
  for (const k of ['지운 편지함', 'Deleted Items', '정크 메일', 'Junk Email', '보낼 편지함']) assert.ok(names.includes(k), k);
  // 수집기와 같은 이름표를 쓰는가(한쪽만 바꾸면 여기서 걸린다)
  const core = readFileSync(path.join(ROOT, 'collector/CollectorCore.ps1'), 'utf8');
  for (const k of Object.keys(C.SETTING_DEFAULTS)) assert.ok(core.includes("'" + k + "' = '" + C.SETTING_DEFAULTS[k] + "'"), '수집기 기본값: ' + k);
  for (const k of C.ALWAYS_SKIP) assert.ok(core.includes("'" + k + "'"), '수집기 늘 빼는 폴더: ' + k);
});
test('manifest 읽기: .json 글 · manifest.js 글 · 객체, 틀린 형식은 알아듣게 거절', () => {
  const json = readFileSync(path.join(SAMPLE, 'manifest.json'), 'utf8');
  const js = readFileSync(path.join(SAMPLE, 'manifest.js'), 'utf8');
  assert.equal(C.parseManifest(json).mails.length, 7);
  assert.equal(C.parseManifest(js).mails.length, 7);
  assert.equal(C.parseManifest(S.manifest).period.start, '2026-09-21');
  assert.throws(() => C.parseManifest('{"schema":"other","period":{},"mails":[]}'), /형식이 다릅니다/);
  assert.throws(() => C.parseManifest({ schema: C.MANIFEST_SCHEMA, period: { start: '2026-9-1', end: '2026-09-30' }, mails: [] }), /기간/);
  assert.throws(() => C.parseManifest({ schema: C.MANIFEST_SCHEMA, period: { start: '2026-09-01', end: '2026-09-30' } }), /메일 목록/);
});
const mails0 = C.mailsFromManifest(S.manifest, L.mainText, L.normalizeSubject);
const mails = L.addMails([], mails0).mails;
test('manifest → 메일: 보낸이 · 받는이 · 날짜(로컬 날짜 + UTC) · 회신 흐름 · 인용문 떼기 · 위치(Online/.pst) · 보낸 메일', () => {
  assert.equal(mails.length, 7);
  const m2 = mails.find((m) => m.cid === 'M0002');
  assert.equal(m2.id, 'E002');                                                        // 날짜 순 번호
  assert.deepEqual([m2.day, m2.time, m2.date], ['2026-09-22', '10:30', '2026-09-22T01:30:00.000Z']);
  assert.equal(m2.direction, 'sent');
  assert.equal(m2.inReplyTo, 'cab-101@example.com');
  assert.ok(!m2.main.includes('Original Message') && m2.text.includes('Original Message'));
  const m3 = mails.find((m) => m.cid === 'M0003');
  assert.deepEqual([m3.storeKind, m3.store, m3.folder], ['pst', 'Mail backup (가상)', '2026\\CMF 샘플']);
  assert.equal(m3.from.email, 'vendor.cmf@example.com');
  assert.equal(m3.subjectNorm, '[CMF 샘플 평가] 샘플 입고 및 평가표 송부');
});
test('수집 요약: Online · .pst · 보낸 메일 · 첨부 상태 · 뺀 폴더 · 같은 메일', () => {
  const s = C.collectSummary(S.manifest);
  assert.deepEqual([s.mails, s.online, s.pst, s.sent, s.duplicates], [7, 5, 2, 3, 1]);
  assert.deepEqual(s.attachments.byExtract, { ok: 3, meta: 2, browser: 2, unsupported: 1 });
  assert.equal(s.stores.length, 2);
  assert.ok(s.skippedFolders.some((f) => f.endsWith('지운 편지함')));
});
test('파일 종류 · PDF 머리 · 브라우저에서 읽을 첨부(PDF · 일러스트) · 저장소용 줄이기', () => {
  assert.deepEqual(['a.DOCX', 'b.pptx', 'c.xlsm', 'd.pdf', 'e.ai', 'f.JPG', 'g.png', 'h.hwp', 'i.doc', 'j.zip', 'k'].map(C.kindOf),
    ['word', 'ppt', 'excel', 'pdf', 'illustrator', 'image', 'image', 'hwp', 'old-office', 'archive', 'other']);
  assert.ok(C.looksPdf(new Uint8Array(readFileSync(path.join(SAMPLE, 'att/M0005/로고_시안_B안.ai')))));
  assert.ok(!C.looksPdf(new Uint8Array(readFileSync(path.join(SAMPLE, 'att/M0006/이전_회의록.doc')))));
  const pend = C.pendingBrowserReads(mails).map((j) => j.att.name).sort();
  assert.deepEqual(pend, ['로고_시안_B안.ai', '조작부_치수도면_Rev2.pdf']);
  const long = [{ attachments: [{ name: 'x.docx', text: '가'.repeat(C.STATE_TEXT_CAP + 50) }] }];
  assert.equal(C.slimForState(long)[0].attachments[0].text.length, C.STATE_TEXT_CAP);
  assert.equal(long[0].attachments[0].text.length, C.STATE_TEXT_CAP + 50);           // 원본은 그대로
});
test('pdf.js 글 조각 → 줄: 같은 높이는 한 줄, 위에서 아래로, 쪽 머리', () => {
  const t = C.pdfPagesToText([[{ str: '발행일:', x: 10, y: 700, w: 40, h: 10 }, { str: '2026-09-25', x: 55, y: 700, w: 60, h: 10 }, { str: '조작부 치수 도면', x: 10, y: 750, w: 90, h: 12 }]]);
  assert.equal(t, '[쪽 1]\n조작부 치수 도면\n발행일: 2026-09-25');
});

console.log('\n[자동 수집] 첨부 글 → 분류 · 배포일 · 결과물 이미지');
const P = L.periodFor('weekly', '2026-09-21', 1);
const tasks = L.groupTasks(mails, S.projects);
const body = L.ruleItems(mails, tasks);
const fromAtt = C.attachmentItems(mails, tasks, body, L);
test('첨부 글에서 업무 문장 뽑기: 「첨부 근거」 표시 · 근거 메일 · 같은 메일 본문과 겹치면 빼기 · 시트 칸 구분은 · 로', () => {
  const t = fromAtt.map((x) => x.category + '|' + x.text);
  assert.ok(t.includes('이슈|협력사 조작부 치수 회신이 지연되고 있어 확인이 필요합니다.'));
  assert.ok(t.includes('계획|부스 그래픽 시안 확정 예정(10/5)'));
  assert.ok(t.includes('계획|재도장 샘플 재입고 예정 · 2026-09-30'));
  assert.ok(!t.some((x) => x.includes('B안 최종 시안 선정 완료')), '본문(E001)에 이미 있는 「B안 최종 시안 선정」이 또 나옴');
  for (const x of fromAtt) {
    assert.equal(x.source, 'attachment');
    assert.equal(x.evidence.length, 1);
    assert.ok(L.flagText(x).includes('첨부 근거'));
    assert.ok(/^F\d{3}$/.test(x.id));
  }
  const issue = fromAtt.find((x) => x.category === '이슈');
  assert.equal(mails.find((m) => m.id === issue.evidence[0]).cid, 'M0001');
  assert.equal(issue.project, '캡 인테리어 개선');
});
test('프로젝트 판정에 첨부 글도 쓴다: 제목 · 본문에 키워드가 없어도 첨부 글에 있으면', () => {
  const m = { subject: '자료 송부', main: '확인 부탁드립니다.', attachments: [{ name: 'a.docx', text: '부스 그래픽 수정안' }] };
  assert.equal(L.projectOf(m, L.cleanProjects(S.projects)).project, '기타');           // 키워드 1점(본문 수준)은 3점 기준에 못 미침
  m.attachments[0].text = '전시 부스 그래픽 · 부스 조명';
  assert.equal(L.projectOf(m, L.cleanProjects(S.projects)).project, '기타');
  const withName = { subject: '자료 송부', main: '', attachments: [{ name: '전시_부스.pptx', text: '전시 부스' }] };
  assert.equal(L.projectOf(withName, L.cleanProjects(S.projects)).project, '전시회 준비');
});
test('결과물 배포일: 첨부의 「배포일:」 > 내가 결과물을 첨부해 보낸 메일 날짜 > (없음)', () => {
  const e5 = mails.find((m) => m.cid === 'M0005');
  assert.deepEqual(C.releaseDateOf(e5, L.extractDates), { day: '2026-09-24', by: '첨부 「전시부스_렌더링_v2.pptx」의 배포일' });
  const sent = { day: '2026-09-26', direction: 'sent', subject: '시안 송부', main: '', attachments: [{ name: 'a.png', kind: 'image', text: '' }] };
  assert.equal(C.releaseDateOf(sent, L.extractDates).day, '2026-09-26');
  assert.equal(C.releaseDateOf(Object.assign({}, sent, { direction: 'received' }), L.extractDates), null);   // 받은 메일은 배포가 아님
  assert.equal(C.releaseDateOf(Object.assign({}, sent, { attachments: [] }), L.extractDates), null);       // 결과물 첨부가 없으면 아님
  const pdfDay = { day: '2026-09-25', direction: 'received', attachments: [{ name: 'x.pdf', kind: 'pdf', text: '[쪽 1]\n발행일: 2026-09-25' }] };
  assert.equal(C.releaseDateOf(pdfDay, L.extractDates).day, '2026-09-25');
});
test('보고서 양식 표: 배포일은 첨부 기준, 이미지 칸에 그림 · 일러스트(.ai)', () => {
  const items = C.applyReleaseDates(L.markConflicts(body.concat(fromAtt)), mails, L.extractDates);
  const rep = L.buildReport({ type: 'weekly', period: P, mails, items, tasks, projects: S.projects, now: '2026-09-25 18:00' });
  const bd = L.weeklyBoard(rep, S.projects, mails);
  const row = bd.rows.find((r) => r.project === '전시회 준비');
  assert.equal(row.perf.release, '2026-09-24');
  assert.deepEqual(row.perf.images, ['부스_투시도_v2.png', '로고_시안_B안.ai']);
  assert.equal(bd.rows.find((r) => r.project === '캡 인테리어 개선').perf.images[0], 'B안_렌더링_정면.png');
  assert.ok(L.reportBodyHtml(rep, {}).includes('<span class="flag">첨부 근거</span>'));
});
test('AI 프롬프트에 첨부 글 발췌 · 메일주소 가리기', () => {
  const p = L.aiPrompt(mails.filter((m) => L.inPeriod(m.day, P)), P, S.projects);
  assert.ok(p.includes('[첨부 전시부스_렌더링_v2.pptx] [슬라이드 1] 전시 부스 렌더링 v2 (가상) 배포일: 2026-09-24'));
  assert.ok(!p.includes('@example.com'));
  assert.ok(L.aiPrompt(mails, P, S.projects, { attChars: 10 }).includes('[첨부 CMF_샘플_평가표.xlsx] [시트 평가표] 번'));
});
test('기간: 수집 기간 → 보고 설정, 보고 기간이 수집 기간보다 넓으면 알림', () => {
  assert.deepEqual(C.settingsFromManifest(S.manifest), { type: 'weekly', refDay: '2026-09-21', weekStart: 1 });
  assert.ok(C.periodCovered(S.manifest.period, P).ok);
  const mo = C.periodCovered(S.manifest.period, L.periodFor('monthly', '2026-09-21'));
  assert.equal(mo.ok, false);
  assert.equal(mo.missing.length, 2);
});
test('수집 폴더 경로 맞추기: 고른 폴더 이름이 앞에 붙어도 · 역슬래시', () => {
  const idx = C.relPathIndex(['2026-09-21_주간_0925-1800/manifest.json', '2026-09-21_주간_0925-1800/att/M0006/a.pdf', 'x\\att\\M0001\\b.docx']);
  assert.equal(idx['manifest.json'], '2026-09-21_주간_0925-1800/manifest.json');
  assert.equal(idx['att/M0006/a.pdf'], '2026-09-21_주간_0925-1800/att/M0006/a.pdf');
  assert.equal(idx['att/M0001/b.docx'], 'x\\att\\M0001\\b.docx');
});
test('자동 열기 주소 점검: file:// 도구에서 file://…/manifest.js 만, 온라인 주소 · 다른 스크립트는 거절', () => {
  const u = 'file:///C:/Users/me/Documents/%EC%97%85/2026-09-21/manifest.js';
  assert.equal(C.collectParam('#/make?collect=' + encodeURIComponent(u), 'file:').url, u);
  assert.match(C.collectParam('#/make?collect=' + encodeURIComponent(u), 'https:').error, /내 PC/);
  assert.match(C.collectParam('#/make?collect=' + encodeURIComponent('https://evil.example/manifest.js'), 'file:').error, /주소가 아닙니다/);
  assert.match(C.collectParam('#/make?collect=' + encodeURIComponent('file:///C:/x/evil.js'), 'file:').error, /주소가 아닙니다/);
  assert.deepEqual(C.collectParam('#/make', 'file:'), { url: '', error: '' });
});

console.log('\n[자동 수집] 수집기 스크립트(PowerShell) — 글자로 검사 (Outlook 부분은 수강생 PC 에서 확인)');
const collector = readFileSync(path.join(ROOT, 'collector/Collect-OutlookMail.ps1'), 'utf8');
const core = readFileSync(path.join(ROOT, 'collector/CollectorCore.ps1'), 'utf8');
test('UTF-8 BOM(Windows PowerShell 5.1 한글) · .bat 은 영문만(명령 창 코드 페이지와 무관)', () => {
  for (const f of ['collector/Collect-OutlookMail.ps1', 'collector/CollectorCore.ps1', 'collector/Test-Collector.ps1']) assert.equal(readFileSync(path.join(ROOT, f), 'utf8').charCodeAt(0), 0xFEFF, f);
  for (const f of ['주간보고.bat', '월간보고.bat']) {
    const b = readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(/^[\x00-\x7F]*$/.test(b), f + ' 에 영문 밖 글자');
    assert.ok(b.includes('-ExecutionPolicy Bypass -File "%~dp0collector\\Collect-OutlookMail.ps1"'), f);
    assert.ok(b.includes('\r\n'), f + ' CRLF');
  }
  assert.ok(readFileSync(path.join(ROOT, '월간보고.bat'), 'utf8').includes('-Mode monthly'));
});
test('읽기 전용: 메일을 지우기 · 옮기기 · 보내기 · 저장 · 읽음 표시하는 호출이 없다', () => {
  const code = collector.replace(/<#[\s\S]*?#>/g, '').split('\n').map((l) => l.replace(/#.*$/, '')).join('\n');
  for (const bad of ['.Delete(', '.Move(', '.Send(', '.Save()', '.UnRead', 'MarkAsRead', '.Copy(', '.Close(', 'Remove-Item -Recurse'])
    assert.ok(!code.includes(bad), '읽기 전용인데 ' + bad);
  // 지우는 것은 방금 내가 저장한 첨부 복사본뿐(첨부저장=아니오일 때)
  assert.equal((code.match(/Remove-Item/g) || []).length, 1);
  assert.ok(code.includes('$a.SaveAsFile($path)'));                                  // 첨부 → 내 PC 로 복사
  assert.ok(code.includes('$ns.RemoveStore('));                                       // 잠깐 연 .pst 는 닫는다
});
test('형식 약속: 스키마 이름 · 메일 칸 · 첨부 칸 · 결과 파일 이름이 브라우저 쪽과 같다', () => {
  assert.ok(collector.includes("schema = '" + C.MANIFEST_SCHEMA + "'"));
  for (const k of ['id', 'store', 'storeKind', 'folder', 'direction', 'messageId', 'inReplyTo', 'references', 'from', 'to', 'cc', 'sentAt', 'day', 'time', 'subject', 'body', 'attachments'])
    assert.ok(new RegExp('[{;\\s]' + k + ' = ').test(collector), '메일 칸 ' + k);
  for (const k of ['name', 'kind', 'size', 'file', 'extract', 'text', 'note']) assert.ok(collector.includes(k + ' = '), '첨부 칸 ' + k);
  for (const f of ["'manifest.json'", "'manifest.js'", "'pdfdata.js'", "'window.P27_COLLECT = '", "'window.P27_PDF = '", "'#/make?collect='"]) assert.ok(collector.includes(f), f);
  for (const ex of Object.keys(C.EXTRACT_LABEL).filter((k) => k !== 'no-file' && k !== 'skipped')) assert.ok(collector.includes("'" + ex + "'"), '추출 상태 ' + ex);
  // 첨부 종류 표가 JS 와 같은가
  for (const [name, kind] of [['a.docx', 'word'], ['b.pptx', 'ppt'], ['c.xlsx', 'excel'], ['d.pdf', 'pdf'], ['e.ai', 'illustrator'], ['f.jpeg', 'image'], ['g.hwpx', 'hwp'], ['h.xls', 'old-office']])
    assert.equal(C.kindOf(name), kind);
  assert.ok(core.includes("'^(docx|docm|dotx)$' { return 'word' }") && core.includes("'^ai$' { return 'illustrator' }"));
});
test('형식 약속(2026-09-30 메일로 송/수신): 업무보고 파일 알아보는 규칙 · reports.js · 첨부저장=아니오 예외가 브라우저 쪽과 같다', () => {
  const m = /\$Script:ReportMarker = '([^']+)'/.exec(core);
  assert.ok(m, 'CollectorCore.ps1 에 ReportMarker');
  const re = new RegExp(m[1]);                                   // PowerShell 정규식을 JS 로 그대로 — 같은 글을 같게 판정해야 함
  for (const t of ['{"schema": "p27-report-file-v1"}', '{\n "schema":"p27-report-file-v1"', '{"schema": "p27-collect-v1"}', '{"x":"schema p27-report-file-v1"}'])
    assert.equal(re.test(t), R.looksLikePackageText(t), t);
  assert.ok(R.looksLikePackageText(JSON.stringify({ schema: R.PACKAGE_SCHEMA }, null, 1)));
  assert.ok(collector.includes("'reports.js'") && collector.includes("'window.P27_REPORTS = '"));
  assert.ok(/-not \$keepFiles -and \$rec\.extract -ne 'browser' -and \$rec\.extract -ne 'report'/.test(collector), '첨부저장=아니오 여도 업무보고 파일은 남김');
  assert.ok(/if \(\$kind -eq 'other'\)[^\n]*Get-ReportPackageText/.test(collector), '.json(other)만 형식 표시를 봄');
});
test('Outlook 폴더 고르기: 보낸 편지함은 보낸 날짜(SentOn)로, 지운 편지함 · 정크는 기본 폴더 ID 로도 뺀다, 공용 폴더 제외', () => {
  assert.ok(collector.includes("$field = 'SentOn'"));
  assert.ok(collector.includes('$olFolderDeletedItems') && collector.includes('$olFolderJunk'));
  assert.ok(collector.includes('$olExchangePublicFolder'));
  assert.ok(collector.includes('.Restrict($filter)'));
  assert.ok(collector.includes("$items.Sort('[' + $field + ']', $true)"));            // Restrict 가 날짜 형식 탓에 0 건일 때 대신 훑기
});
test('Online 사서함 범위(2026-09-30 답변): 기본은 받은 편지함 · 보낸 편지함만, 기본 폴더 번호(6 · 5)로 찾음, .pst 는 모든 폴더', () => {
  const setText = readFileSync(path.join(ROOT, 'collector/수집설정.txt'), 'utf8');
  assert.match(setText, /^Online폴더=받은보낸\r?$/m);
  const s = C.parseSettingsText(setText);
  assert.deepEqual(s._unknown, []);
  assert.deepEqual(C.onlineScope(s), { scope: 'inbox-sent', ok: true });
  assert.deepEqual(C.onlineScope({}), { scope: 'inbox-sent', ok: true });
  assert.deepEqual(C.onlineScope({ 'Online폴더': '받은 · 보낸' }), { scope: 'inbox-sent', ok: true });
  assert.deepEqual(C.onlineScope({ 'Online폴더': '받은보낸하위' }), { scope: 'inbox-sent-sub', ok: true });
  assert.deepEqual(C.onlineScope({ 'Online폴더': '전체' }), { scope: 'all', ok: true });
  assert.deepEqual(C.onlineScope({ 'Online폴더': '모두' }), { scope: 'inbox-sent', ok: false });   // 모르는 값 → 기본 + 알림
  assert.ok(core.includes("'Online폴더' = '받은보낸'") && core.includes("'받은보낸하위' { return @{ scope = 'inbox-sent-sub'"));
  assert.ok(collector.includes('$olFolderInbox = 6') && collector.includes('$olFolderSentMail = 5'));
  assert.ok(collector.includes('foreach ($k in @($olFolderInbox, $olFolderSentMail))') && collector.includes('$st.GetDefaultFolder($k)'));
  assert.ok(collector.includes("if ($kind -eq 'online' -and $onlineScope -ne 'all')"));   // .pst 는 이 조건에 안 걸려 모든 폴더
  // 예시 수집 결과도 같은 모양: Online 메일은 받은 · 보낸 편지함에만, 범위 표시
  const on = S.manifest.stores.find((x) => x.kind === 'online'), pst = S.manifest.stores.find((x) => x.kind === 'pst');
  assert.equal(on.scope, 'inbox-sent'); assert.equal(pst.scope, 'all');
  assert.deepEqual([...new Set(S.manifest.mails.filter((m) => m.storeKind === 'online').map((m) => m.folder))].sort(), ['받은 편지함', '보낸 편지함']);
  assert.equal(C.collectSummary(S.manifest).stores[0].scope, 'inbox-sent');
});
test('Outlook 은 켜져 있는 것에 붙고, 꺼져 있으면 새로 띄우지 않고 알린다(2026-09-30 답변: 늘 켜 둠)', () => {
  const code = collector.replace(/<#[\s\S]*?#>/g, '');
  const check = code.indexOf("Get-Process -Name 'OUTLOOK'"), make = code.indexOf('New-Object -ComObject Outlook.Application');
  assert.ok(check > 0 && make > check, '켜져 있는지 먼저 확인한 뒤에만 New-Object');
  assert.ok(code.includes('Outlook 이 꺼져 있습니다.'));
});
test('수집기 자가검사(Test-Collector.ps1)가 이 폴더의 예시 파일 · .txt 와 대조한다', () => {
  const t = readFileSync(path.join(ROOT, 'collector/Test-Collector.ps1'), 'utf8');
  assert.ok(t.includes('samples\\collect') || t.includes("'samples'"));
  assert.ok(t.includes('Get-OoxmlTextFromFile') && t.includes(".txt'"));
  assert.ok(existsSync(path.join(SAMPLE, 'att/M0001/캡_1차시안_검토회의록.docx.txt')));
});

// PowerShell 이 있으면(Windows · 또는 pwsh 를 깐 PC) 수집기 자가검사와 가짜 Outlook 수집까지 돌린다. 없으면 건너뛴다.
const PWSH = process.env.PWSH || ['pwsh', 'powershell'].find((c) => spawnSync(c, ['-NoProfile', '-Command', '1'], { encoding: 'utf8' }).status === 0);
if (PWSH) {
  for (const [label, file, args] of [['수집기 자가검사(Test-Collector.ps1)', 'collector/Test-Collector.ps1', []],
    ['가짜 Outlook 수집 — Restrict 가 0 건일 때 훑기(Run-MockCollect.ps1)', 'test/pwsh/Run-MockCollect.ps1', ['-Restrict', 'empty']],
    ['가짜 Outlook 수집 — Restrict 로 거르기', 'test/pwsh/Run-MockCollect.ps1', ['-Restrict', 'ok']],
    ['가짜 Outlook 수집 — Online폴더=받은보낸하위(하위 폴더까지)', 'test/pwsh/Run-MockCollect.ps1', ['-Restrict', 'ok', '-OnlineScope', '받은보낸하위']],
    ['가짜 Outlook 수집 — Online폴더=전체(모든 메일 폴더)', 'test/pwsh/Run-MockCollect.ps1', ['-Restrict', 'ok', '-OnlineScope', '전체']],
    ['가짜 Outlook 수집 — 첨부저장=아니오(업무보고 파일 · PDF 는 남김)', 'test/pwsh/Run-MockCollect.ps1', ['-Restrict', 'ok', '-KeepFiles', '아니오']]]) {
    test('PowerShell: ' + label, () => {
      const r = spawnSync(PWSH, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, file)].concat(args), { encoding: 'utf8', cwd: ROOT });
      const tail = (r.stdout || '').trim().split('\n').slice(-1)[0];
      assert.equal(r.status, 0, (r.stdout || '').split('\n').filter((l) => /FAIL|번째|오류|Error/.test(l)).join(' / ') + (r.stderr || '').slice(0, 300));
      assert.match(tail, /실패 0/);
    });
  }
  // 수집기 → 도구: 가짜 Outlook 결과 폴더를 도구 쪽 로직으로 읽어 「받은 메일에서 찾은 보고서 파일」이 나오는지(자동 열기 · 폴더 열기 두 길)
  test('PowerShell → 도구: 받은 메일 첨부에서 업무보고 파일 1개 찾기(자동 열기 reports.js · 폴더 열기 파일 읽기)', () => {
    const out = path.join(os.tmpdir(), 'p27-mock-found-' + process.pid);
    const r = spawnSync(PWSH, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'test/pwsh/Run-MockCollect.ps1'), '-Restrict', 'ok', '-KeepFiles', '아니오', '-OutDir', out, '-Keep'], { encoding: 'utf8', cwd: ROOT });
    try {
      assert.equal(r.status, 0, (r.stdout || '').slice(-400));
      const man = JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8'));
      const mails = C.mailsFromManifest(man, L.mainText, L.normalizeSubject);
      const auto = Function('window', readFileSync(path.join(out, 'reports.js'), 'utf8') + '; return window.P27_REPORTS;')({});
      const folder = {};
      mails.forEach((m) => m.attachments.forEach((a) => { if (/\.json$/i.test(a.name) && a.file && existsSync(path.join(out, a.file))) folder[a.file] = readFileSync(path.join(out, a.file), 'utf8'); }));
      assert.deepEqual(Object.keys(folder).length, 1);                // 다른 .json 은 첨부저장=아니오라 지워짐 → 업무보고 파일 하나만 남음
      for (const texts of [auto, folder]) {
        const f = R.findMailedPackages(mails, texts);
        assert.deepEqual([f.found.length, f.bad.length], [1, 0]);
        const x = f.found[0];
        assert.deepEqual([x.pkg.author, x.pkg.unit, x.pkg.period.start, x.pkg.items.length, x.from, x.day, x.time, x.direction, x.name],
          ['김가상', 'A파트(가상)', '2026-09-21', 3, '김가상(가상)', '2026-09-25', '17:30', 'received', '주간업무보고_20260921_김가상.json']);
      }
    } finally { rmSync(out, { recursive: true, force: true }); }
  });
} else console.log('  --  PowerShell(pwsh) 이 없어 수집기 자가검사 · 가짜 Outlook 수집은 건너뜁니다 (PWSH=<pwsh 경로> 로 지정 가능)');

await Promise.all(pending);
console.log('\n[자동 수집] ' + passed + '개 통과' + (process.exitCode ? ' · 실패 있음' : ''));
