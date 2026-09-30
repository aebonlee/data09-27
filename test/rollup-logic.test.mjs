// 보고 단계 · 보고서 취합 테스트 — 실행: node test/rollup-logic.test.mjs (node test/logic.test.mjs 가 함께 돌린다)
// 2026-09-30 답변: 팀원 → 파트리더 → 팀장 → 담당 임원. 아래 기대값은 손으로 센 값입니다(보고서 파일 3개 · 항목 7개).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../js/report-logic.js');
const C = require('../js/collect-logic.js');
const R = require('../js/rollup-logic.js');
const S = require('../js/sample-collect.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
const W = L.periodFor('weekly', '2026-09-21', 1);           // 2026-09-21(월) ~ 2026-09-27(일)
const PREV = L.periodFor('weekly', '2026-09-14', 1);
const it = (category, project, text, o) => Object.assign({ category, project, text, status: '', date: '', decision: false, explicit: true, origin: 'rule', source: '', conflict: '', evidence: [], reporter: '' }, o);
const ev = (id, day, time, subject) => ({ id, day, time, from: '협력사(가상)', subject, attachments: [] });
const row = (group, project, evidence, perf, plan) => ({ group, project, evidence, perf: Object.assign({ progress: [], release: '', issues: [], images: [] }, perf), plan: Object.assign({ tasks: [], schedule: '', issues: [] }, plan) });
const pkg = (o) => JSON.stringify(Object.assign({ schema: R.PACKAGE_SCHEMA, level: '팀원', unit: 'A파트(가상)', type: 'weekly', period: W, approved: null, generatedAt: '2026-09-25 18:00', rollup: false, sources: [], summary: [], evidence: [], board: null }, o));

// 팀원 김가상 — 승인함. 실적 1 · 계획 1 · 이슈 1(지연), 확인 필요 0
const P1 = pkg({ author: '김가상', approved: '2026-09-25 18:00',
  items: [it('실적', '캡', 'B안 최종 시안 선정', { status: '완료', evidence: ['M0001'] }),
    it('계획', '캡', '3D 모델링 업데이트 진행 예정', { status: '예정', date: '2026-10-02', evidence: ['M0001'] }),
    it('이슈', '캡', '협력사 치수 회신 지연', { status: '지연', evidence: ['M0002'] })],
  evidence: [ev('M0001', '2026-09-21', '09:12', '[캡] 1차 시안 회의'), ev('M0002', '2026-09-22', '10:30', 'RE: [캡] 치수')],
  board: { head: ['Business Group', '프로젝트명', '금주 실적 (2026.09.21 ~ 2026.09.25)', '차주 계획 (2026.09.28 ~ 2026.10.02)'],
    rows: [row('건설기계', '캡', ['M0001', 'M0002'], { progress: ['B안 최종 시안 선정'], release: '2026-09-21', issues: ['협력사 치수 회신 지연'], images: ['B안.png'] }, { tasks: ['3D 모델링 업데이트 진행 예정'], schedule: '2026-10-02' })] } });
// 팀원 이가상 — 초안. 실적 2(하나는 AI 추론) · 이슈 1(확인 필요 · 근거 없음 · 의사결정), 확인 필요 2
const P2items = [it('실적', 'CMF', '샘플 3종 평가 완료', { status: '완료', evidence: ['M0001'] }),
  it('실적', '캡', '조작부 도면 검토', { status: '진행 중', explicit: false, origin: 'ai', evidence: ['M0003'] }),
  it('이슈', 'CMF', '재도장 필요', { status: '확인 필요', decision: true, evidence: [] })];
const P2 = pkg({ author: '이가상', generatedAt: '2026-09-25 17:00', items: P2items,
  evidence: [ev('M0001', '2026-09-23', '14:05', '[CMF] 샘플 입고'), ev('M0003', '2026-09-24', '09:40', '[캡] 도면')],
  board: { head: ['Business Group', '프로젝트명', '금주 실적 (2026.09.21 ~ 2026.09.25)', '차주 계획 (2026.09.28 ~ 2026.10.02)'],
    rows: [row('건설기계', '캡', ['M0003'], { progress: ['조작부 도면 검토 (진행 중)'] }, {}),
      row('건설기계', 'CMF', ['M0001'], { progress: ['샘플 3종 평가 완료'], release: '2026-09-23', issues: ['재도장 필요 (의사결정 필요)'] }, { issues: ['의사결정 필요: 재도장 필요'] })] } });
// 팀원 박가상 — 지난주 보고서(기간이 달라 빠져야 함)
const P3 = pkg({ author: '박가상', period: PREV, items: [it('실적', '캡', '지난주 일', { status: '완료', evidence: ['M0009'] })] });
// B파트 팀원 한가상
const P5 = pkg({ author: '한가상', unit: 'B파트(가상)', approved: '2026-09-26 09:00',
  items: [it('실적', '전시', '부스 렌더링 v2 배포', { status: '완료', evidence: ['M0005'] })], evidence: [ev('M0005', '2026-09-24', '16:20', '[전시] 렌더링 배포')],
  board: { head: ['Business Group', '프로젝트명', '금주 실적', '차주 계획'], rows: [row('전시·홍보', '전시', ['M0005'], { progress: ['부스 렌더링 v2 배포'], release: '2026-09-24' }, {})] } });
const part = (files, opts) => R.mergePackages(files.map((f, i) => Object.assign(R.parsePackage(f), { _name: '파일' + (i + 1) })), Object.assign({ level: '파트리더', author: '최파트', unit: 'A파트(가상)', now: '2026-09-26 10:00' }, opts));

console.log('\n[취합] 보고서 파일 읽기');
test('보고 단계 순서 · 다음 단계', () => {
  assert.deepEqual(R.LEVELS, ['팀원', '파트리더', '팀장', '임원']);
  assert.equal(R.nextLevel('팀원'), '파트리더'); assert.equal(R.nextLevel('팀장'), '임원'); assert.equal(R.nextLevel('임원'), '');
  assert.equal(R.lowerLevel('파트리더'), '팀원'); assert.equal(R.lowerLevel('팀원'), '');
});
test('파일 점검: 백업 파일 · 다른 JSON · 이름 없음은 알아듣게 거절, 모르는 분류 항목은 뺌', () => {
  assert.throws(() => R.parsePackage('{"settings":{},"mails":[]}'), /백업 파일/);
  assert.throws(() => R.parsePackage('{"a":1}'), /업무보고 파일이 아닙니다/);
  assert.throws(() => R.parsePackage('xx'), /JSON 파일이 아닙니다/);
  assert.throws(() => R.parsePackage(pkg({ author: ' ', items: [] })), /보고자 이름이 없습니다/);
  const p = R.parsePackage(pkg({ author: '김가상', level: '사장', items: [it('기타분류', 'x', 'y'), it('실적', '', '프로젝트 없는 항목')] }));
  assert.equal(p.level, '팀원');                  // 모르는 단계는 팀원으로
  assert.equal(p.items.length, 1); assert.equal(p.dropped, 1);
  assert.equal(p.items[0].project, '기타');
  assert.equal(p.period.next.start, '2026-09-28');
});

console.log('\n[취합] 파트리더 — 팀원 보고서 2개 + 기간이 다른 1개');
const A = part([P1, P2, P3]);
const rep = A.rep;
test('기간이 다른 파일은 빼고 이유를 알림', () => {
  assert.equal(A.used.length, 2);
  assert.deepEqual(A.skipped.map((s) => s.name), ['파일3']);
  assert.match(A.skipped[0].reason, /기간이 다릅니다\(주간 2026-09-14 ~ 2026-09-20 — 취합 기간은 주간 2026-09-21 ~ 2026-09-27\)/);
  assert.deepEqual(A.warnings, []);
  assert.equal(rep.period.start, '2026-09-21'); assert.equal(rep.title, 'A파트(가상) 파트리더 취합');
});
test('건수: 실적 3 · 계획 1 · 이슈 2 · 확인 필요 2 · 근거 메일 4 · 보고자 2명', () => {
  assert.deepEqual(rep.counts, { performance: 3, plan: 1, issue: 2, check: 2, mails: 4, files: 2, reporters: 2 });
});
test('항목 문장 앞에 [보고자], 근거 메일 ID 는 보고자·메일ID, 프로젝트별로 묶음(처음 나온 순서)', () => {
  assert.deepEqual(rep.performance.map((g) => [g.project, g.items.map((x) => x.id + ' ' + x.text)]), [
    ['캡', ['R001 [김가상] B안 최종 시안 선정', 'R005 [이가상] 조작부 도면 검토']],
    ['CMF', ['R004 [이가상] 샘플 3종 평가 완료']]]);
  assert.deepEqual(rep.plan[0].items[0].evidence, ['김가상·M0001']);
  assert.deepEqual(rep.issue.map((g) => g.items.map((x) => x.text)), [['[김가상] 협력사 치수 회신 지연'], ['[이가상] 재도장 필요']]);
  assert.deepEqual(rep.evidence.map((e) => e.id), ['김가상·M0001', '김가상·M0002', '이가상·M0001', '이가상·M0003']);   // 두 사람의 M0001 이 겹치지 않음
});
test('확인 필요 표시는 보고자가 붙인 그대로 가져옴', () => {
  const r5 = rep.performance[0].items[1], r6 = rep.issue[1].items[0];
  assert.deepEqual(L.flagText(r5), ['AI 추론']);
  assert.deepEqual(L.flagText(r6), ['확인 필요', '근거 없음']);
  assert.deepEqual(rep.decision.map((x) => x.id), ['R006']);
});
test('요약 문장', () => {
  assert.deepEqual(rep.summary, [
    W.label + ' — 보고서 2개(보고자 2명)를 취합했습니다: 실적 3건 · 계획 1건 · 이슈 2건.',
    '실적 3건 중 완료가 확인된 것은 2건입니다.',
    '이슈 2건(지연 1건) 가운데 의사결정이 필요한 사항이 1건 있습니다.',
    '확인이 필요한 항목이 2건 있습니다(보고자가 붙인 표시를 그대로 가져왔습니다). 보고 전에 해당 보고자에게 확인해 주세요.',
    '아직 승인하지 않은 초안 보고서가 1개 있습니다: 이가상.']);
});
test('보고자별 현황: 보고자마다 건수 · 승인 여부', () => {
  assert.deepEqual(rep.sources.map((s) => [s.author, s.counts.performance, s.counts.plan, s.counts.issue, s.counts.check, s.approved]),
    [['김가상', 1, 1, 1, 0, '2026-09-25 18:00'], ['이가상', 2, 0, 1, 2, null]]);
});
test('양식 표: 프로젝트마다 한 줄, 칸 안 줄마다 [보고자], 배포일 · 일정도 보고자별', () => {
  const bd = L.boardOf(rep);
  assert.equal(bd.head[2], '금주 실적 (2026.09.21 ~ 2026.09.25)');
  assert.deepEqual(bd.rows.map((r) => r.project), ['캡', 'CMF']);
  const cab = bd.rows[0], cmf = bd.rows[1];
  assert.deepEqual(cab.perf.progress, ['[김가상] B안 최종 시안 선정', '[이가상] 조작부 도면 검토 (진행 중)']);
  assert.equal(cab.perf.release, '[김가상] 2026-09-21');
  assert.deepEqual(cab.perf.images, ['[김가상] B안.png']);
  assert.equal(cab.plan.schedule, '[김가상] 2026-10-02');
  assert.deepEqual(cab.evidence, ['김가상·M0001', '김가상·M0002', '이가상·M0003']);
  assert.equal(cab.group, '건설기계');
  assert.deepEqual(cmf.plan.issues, ['[이가상] 의사결정 필요: 재도장 필요']);
  assert.deepEqual(L.boardCellLines(cab, 'perf').slice(0, 3), ['- 진행 내용:', '  · [김가상] B안 최종 시안 선정', '  · [이가상] 조작부 도면 검토 (진행 중)']);
});
test('Word · HTML · 엑셀: 같은 주간보고 양식(보고자별 현황 절이 앞에)', () => {
  const html = L.reportBodyHtml(rep, {});
  const order = ['기간·요약', '보고자별 취합 현황', '주간 업무보고 — 양식 표', '01. Weekly Performance', '02. Next Week Plan', '03. Key Issues'].map((t) => html.indexOf(t));
  assert.ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), '절 순서 ' + order);
  assert.ok(html.includes('<td>이가상</td><td>팀원 · A파트(가상)</td><td>2</td><td>0</td><td>1</td><td>2</td><td>초안(승인 전)</td>'));
  assert.ok(html.includes('A파트(가상) 파트리더 취합 — 주간 업무보고 (2026-09-21 ~ 2026-09-27)'));
  assert.ok(L.docxParts(rep)['word/document.xml'].includes('보고자별 취합 현황'));
  const sh = R.rollupSheets(rep);
  assert.deepEqual(sh.map((s) => s.name), ['요약', '보고자별', '주간보고표', '업무항목']);
  assert.deepEqual(sh[3].aoa[1], ['김가상', '실적', '캡', 'B안 최종 시안 선정', '완료', '', '', '', '김가상·M0001']);
  assert.equal(sh[3].aoa.length, 1 + 6);
});

console.log('\n[취합] 팀장 — 파트 취합본을 다시 취합(파일 → 파일)');
const pkgA = JSON.stringify(R.makePackage(part([P1, P2], { approved: '2026-09-26 11:00' }).rep, { level: '파트리더', author: '최파트', unit: 'A파트(가상)' }));
const pkgB = JSON.stringify(R.makePackage(part([P5], { author: '정파트', unit: 'B파트(가상)' }).rep, { level: '파트리더', author: '정파트', unit: 'B파트(가상)' }));
const T = R.mergePackages([R.parsePackage(pkgA), R.parsePackage(pkgB)], { level: '팀장', author: '팀장(가상)', unit: '디자인팀(가상)' }).rep;
test('원래 보고자 이름이 남고 [파트리더] 가 겹쳐 붙지 않음', () => {
  assert.deepEqual(T.performance.map((g) => g.items.map((x) => x.text)), [
    ['[김가상] B안 최종 시안 선정', '[이가상] 조작부 도면 검토'], ['[이가상] 샘플 3종 평가 완료'], ['[한가상] 부스 렌더링 v2 배포']]);
  assert.deepEqual(T.plan[0].items[0].evidence, ['김가상·M0001']);
  assert.deepEqual(T.counts, { performance: 4, plan: 1, issue: 2, check: 2, mails: 5, files: 2, reporters: 3 });
});
test('보고자별 현황은 파트 단위, 들어 있는 보고자 이름', () => {
  assert.deepEqual(T.sources.map((s) => [s.author, s.level, s.rollup, s.reporters.join(','), s.counts.performance, s.approved]),
    [['최파트', '파트리더', true, '김가상,이가상', 3, '2026-09-26 11:00'], ['정파트', '파트리더', true, '한가상', 1, null]]);
  assert.equal(T.summary[0], W.label + ' — 보고서 2개(보고자 3명)를 취합했습니다: 실적 4건 · 계획 1건 · 이슈 2건.');
  assert.equal(T.summary[T.summary.length - 1], '아직 승인하지 않은 초안 보고서가 1개 있습니다: 정파트.');
});
test('양식 표도 원래 보고자 표시 그대로(겹쳐 붙이지 않음)', () => {
  const bd = L.boardOf(T);
  assert.deepEqual(bd.rows.map((r) => r.project), ['캡', 'CMF', '전시']);
  assert.deepEqual(bd.rows[0].perf.progress, ['[김가상] B안 최종 시안 선정', '[이가상] 조작부 도면 검토 (진행 중)']);
  assert.equal(bd.rows[2].perf.release, '[한가상] 2026-09-24');
  assert.equal(bd.rows[2].group, '전시·홍보');
});

console.log('\n[취합] 같은 사람 두 번 · 단계 확인 · 내 메일 보고서');
test('같은 보고자의 파일이 두 개면 나중에 만든 것만', () => {
  const P2b = pkg({ author: '이가상', generatedAt: '2026-09-25 19:00', items: P2items.concat([it('계획', 'CMF', '재평가 예정', { evidence: ['M0001'] })]) });
  const r = part([P2b, P1, P2]);
  assert.equal(r.used.length, 2);
  assert.equal(r.rep.counts.plan, 2);                       // P2b 의 계획이 남음(P1 1 + P2b 1)
  assert.equal(r.warnings.length, 1); assert.match(r.warnings[0], /이가상\(A파트\(가상\)\) 의 보고서가 두 개라 나중에 만든 것\(2026-09-25 19:00\)만/);
});
test('보낸 사람의 단계가 내 단계보다 낮지 않으면 알림(취합은 함)', () => {
  const r = part([pkg({ author: '윗사람', level: '팀장', items: [] }), P1]);
  assert.equal(r.used.length, 2);
  assert.match(r.warnings[0], /보고 단계\(팀장\)가 내 단계\(파트리더\)보다 낮지 않습니다/);
});
test('기간은 받은 파일의 다수결, 내 메일 보고서도 같은 기간이면 (나)로 함께', () => {
  const mails = L.addMails([], C.mailsFromManifest(S.manifest, L.mainText, L.normalizeSubject)).mails;
  const tasks = L.groupTasks(mails, S.projects);
  const body = L.ruleItems(mails, tasks);
  const items = C.applyReleaseDates(L.markConflicts(body.concat(C.attachmentItems(mails, tasks, body, L))), mails, L.extractDates);
  const mine = L.buildReport({ type: 'weekly', period: W, mails, items, tasks, projects: S.projects, now: '2026-09-25 18:00' });
  const own = R.parsePackage(JSON.stringify(R.makePackage(mine, { level: '파트리더', author: '최파트', unit: 'A파트(가상)' })));
  assert.ok(!JSON.stringify(own).includes('안녕하세요'), '보고서 파일에 메일 본문이 들어감');
  assert.equal(own.items.length, mine.counts.performance + mine.counts.plan + mine.counts.issue);
  const r = part([P3, P1, P2], { own });                  // 받은 파일: 이번 주 2 · 지난주 1 → 이번 주
  assert.equal(r.rep.period.start, '2026-09-21');
  assert.deepEqual(r.rep.sources.map((s) => s.author + (s.own ? '(나)' : '')), ['최파트(나)', '김가상', '이가상']);
  assert.equal(r.rep.counts.performance, 3 + mine.counts.performance);
  assert.ok(r.rep.evidence.some((e) => e.id === '최파트·E001'));
  const ownOld = Object.assign({}, own, { period: PREV });
  const r2 = part([P1], { own: ownOld });
  assert.deepEqual(r2.skipped.map((s) => s.name), ['내 메일 보고서']);
});
test('저장 형태: 보고 단계 · 취합 상태가 복원됨, 모르는 단계는 팀원', () => {
  const st = L.emptyState();
  assert.equal(st.settings.level, '팀원'); assert.deepEqual(st.rollup, { sources: [], includeOwn: false, approved: null });
  const back = L.restoreState(JSON.parse(JSON.stringify(Object.assign(st, { settings: Object.assign(st.settings, { level: '팀장' }), rollup: { sources: [R.parsePackage(P1), { bad: 1 }], includeOwn: true, approved: null } }))));
  assert.equal(back.settings.level, '팀장'); assert.equal(back.rollup.sources.length, 1); assert.equal(back.rollup.includeOwn, true);
  assert.equal(L.restoreState({ settings: { level: '사장' } }).settings.level, '팀원');
});
test('파일 이름', () => {
  assert.equal(R.packageFileName(R.parsePackage(P1)), '주간업무보고_20260921_김가상.json');
  assert.equal(R.packageFileName(R.parsePackage(pkgB)), '주간업무보고_20260921_파트리더취합_정파트_초안.json');
});

console.log('\n[취합] ' + passed + '개 통과' + (process.exitCode ? ' · 실패 있음' : ''));
