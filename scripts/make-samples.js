// 예시 수집 결과 만들기 — 실행: node scripts/make-samples.js  (먼저 make-sample-office.py · make-sample-pdf.cjs 로 첨부 원본을 만든 뒤)
//   결과 1) samples/collect/        — 수집기가 남기는 폴더와 같은 모양(manifest.json · manifest.js · pdfdata.js · att/…)
//                                      도구의 「수집 폴더 열기」로 이 폴더를 골라 볼 수 있습니다.
//   결과 2) js/sample-collect.js     — 같은 내용을 담아 「예시로 해 보기」가 씁니다(file:// 에서는 폴더 파일을 읽을 수 없어서)
// 메일 · 인물 · 업무는 모두 가상입니다(example.com, 이름에 「(가상)」).
// 첨부 글은 수집기(collector/CollectorCore.ps1)와 같은 규칙의 JS 쌍둥이(js/collect-logic.js)로 뽑았습니다.
// 수집기가 Windows 에서 뽑는 글과 같은지는 collector/Test-Collector.ps1 이 이 폴더의 .txt 와 대조해 확인합니다.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const JSZip = require('../vendor/jszip.min.js');
const C = require('../js/collect-logic.js');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'samples', 'collect');

// ── 그림(PNG) · 옛 워드(.doc) 흉내 파일 ──
function crc32(buf) { let c, crc = 0xFFFFFFFF; for (const b of buf) { c = (crc ^ b) & 0xFF; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function png(w, h, seed, rgb) {
  // 무늬가 있는 그림(압축이 덜 되어 서명 로고보다 크게 — 수집기는 작은그림KB 보다 작은 그림을 뺀다)
  let s = seed; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3, v = rnd() * 60; raw[o] = rgb[0] * (x / w) + v; raw[o + 1] = rgb[1] * (y / h) + v; raw[o + 2] = rgb[2] + v; }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function fakeDoc() { const b = Buffer.alloc(20480); Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]).copy(b); return b; }
function put(mid, name, buf) { const d = path.join(OUT, 'att', mid); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, name), buf); }
put('M0001', 'B안_렌더링_정면.png', png(120, 90, 7, [40, 80, 160]));
put('M0005', '부스_투시도_v2.png', png(120, 90, 11, [160, 90, 40]));
put('M0006', '이전_회의록.doc', fakeDoc());

// ── 메일 ──
const LEAD = { name: '디자인팀장(가상)', email: 'lead@example.com' };
const ME = { name: '보고자(가상)', email: 'me@example.com' };
const VENDOR = { name: '협력사 CMF 담당(가상)', email: 'vendor.cmf@example.com' };
const VENDOR2 = { name: '협력사 설계 담당(가상)', email: 'vendor.design@example.com' };
const EXPO = { name: '전시 운영 담당(가상)', email: 'expo@example.com' };
const TEAM = { name: '팀 공지(가상)', email: 'team@example.com' };
const ONLINE = 'me@example.com (가상)', PST = 'Mail backup (가상)';
const utc = (day, time) => new Date(day + 'T' + time + ':00+09:00').toISOString();
const MAILS = [
  { id: 'M0001', store: ONLINE, storeKind: 'online', folder: '받은 편지함\\캡 인테리어', direction: 'received', messageId: 'cab-101@example.com',
    from: LEAD, to: [ME], day: '2026-09-21', time: '09:12', subject: '[캡 인테리어 개선] 1차 시안 검토 회의 결과 공유',
    body: '안녕하세요.\r\n오늘 1차 시안 검토 회의를 마쳤습니다.\r\n시안 3종 검토 완료했고, B안을 최종 시안으로 선정했습니다.\r\n차주에는 B안 기준으로 3D 모델링 업데이트를 진행할 예정입니다(10/2까지).\r\n회의록과 B안 렌더링을 첨부합니다.\r\n\r\n디자인팀장(가상) 드림',
    atts: ['캡_1차시안_검토회의록.docx', 'B안_렌더링_정면.png'] },
  { id: 'M0002', store: ONLINE, storeKind: 'online', folder: '보낸 편지함', direction: 'sent', messageId: 'cab-102@example.com', inReplyTo: 'cab-101@example.com', references: ['cab-101@example.com'],
    from: ME, to: [LEAD], day: '2026-09-22', time: '10:30', subject: 'RE: [캡 인테리어 개선] 1차 시안 검토 회의 결과 공유',
    body: '팀장님, B안 기준으로 3D 모델링 업데이트에 착수했습니다.\r\n다만 조작부 치수 자료가 아직 오지 않아 협력사에 다시 요청했습니다.\r\n\r\n-----Original Message-----\r\nFrom: 디자인팀장(가상)\r\n오늘 1차 시안 검토 회의를 마쳤습니다.', atts: [] },
  { id: 'M0003', store: PST, storeKind: 'pst', folder: '2026\\CMF 샘플', direction: 'received', messageId: 'cmf-201@example.com',
    from: VENDOR, to: [ME], day: '2026-09-23', time: '14:05', subject: '[CMF 샘플 평가] 샘플 입고 및 평가표 송부',
    body: '안녕하세요, 협력사 CMF 담당(가상)입니다.\r\nCMF 샘플 5종이 입고되었습니다. 평가표를 첨부드립니다.\r\n색상 샘플 2종은 재도장이 필요해 9/30까지 재입고할 예정입니다.', atts: ['CMF_샘플_평가표.xlsx'] },
  { id: 'M0004', store: PST, storeKind: 'pst', folder: '보낸 편지함', direction: 'sent', messageId: 'cmf-202@example.com', inReplyTo: 'cmf-201@example.com', references: ['cmf-201@example.com'],
    from: ME, to: [VENDOR], day: '2026-09-24', time: '09:40', subject: 'RE: [CMF 샘플 평가] 샘플 입고 및 평가표 송부',
    body: '평가표 검토했습니다.\r\n합격 3종은 평가 완료로 정리했습니다.\r\n재도장 2종은 입고되면 바로 평가하겠습니다.', atts: [] },
  { id: 'M0005', store: ONLINE, storeKind: 'online', folder: '보낸 편지함', direction: 'sent', messageId: 'expo-301@example.com',
    from: ME, to: [EXPO], cc: [LEAD], day: '2026-09-24', time: '16:20', subject: '[전시회 준비] 부스 렌더링 v2 배포',
    body: '전시 부스 렌더링 v2를 배포합니다.\r\n조명 위치를 조정했고 관람 동선 안을 반영했습니다.\r\n의견은 9/29까지 회신 부탁드립니다.', atts: ['전시부스_렌더링_v2.pptx', '부스_투시도_v2.png', '로고_시안_B안.ai'] },
  { id: 'M0006', store: ONLINE, storeKind: 'online', folder: '받은 편지함\\캡 인테리어', direction: 'received', messageId: 'cab-103@example.com', references: ['cab-101@example.com'],
    from: VENDOR2, to: [ME], day: '2026-09-25', time: '11:00', subject: '[캡 인테리어 개선] 조작부 치수 도면 회신',
    body: '요청하신 조작부 치수 도면을 첨부합니다.\r\n버튼 간격은 기존보다 2mm 넓어졌습니다.\r\n최종 확정은 내부 검토 후 10/1까지 알려 드리겠습니다.', atts: ['조작부_치수도면_Rev2.pdf', '이전_회의록.doc'] },
  { id: 'M0007', store: ONLINE, storeKind: 'online', folder: '받은 편지함', direction: 'received', messageId: 'team-401@example.com',
    from: TEAM, to: [ME], day: '2026-09-25', time: '17:30', subject: '[팀 공지] 주간 회의 일정 안내',
    body: '다음 주 주간 회의는 10/1(수) 10시에 진행할 예정입니다.', atts: [] }
];

(async () => {
  const pdfData = {};
  const mails = [];
  for (const m of MAILS) {
    const attachments = [];
    for (const name of m.atts) {
      const rel = 'att/' + m.id + '/' + name, file = path.join(OUT, rel), buf = fs.readFileSync(file), kind = C.kindOf(name);
      const rec = { name, kind, size: buf.length, file: rel, extract: 'meta', text: '', note: '' };
      if (['word', 'ppt', 'excel'].includes(kind)) {
        rec.text = await C.ooxmlTextFromZip(await JSZip.loadAsync(buf), kind);
        rec.extract = rec.text.trim() ? 'ok' : 'empty';
        fs.writeFileSync(file + '.txt', rec.text);                        // 수집기와 같이 뽑은 글을 옆에 남긴다
      } else if (kind === 'pdf' || kind === 'illustrator') {
        rec.extract = C.looksPdf(buf) ? 'browser' : 'meta';
        if (rec.extract === 'browser') pdfData[rel] = buf.toString('base64');
      } else if (kind === 'image') rec.note = '그림 — 이름 · 크기만(글자 읽기는 2단계)';
      else if (kind === 'old-office' || kind === 'hwp') { rec.extract = 'unsupported'; rec.note = '옛 Office · 한글 파일은 1단계에서 글을 뽑지 않음(2단계)'; }
      attachments.push(rec);
    }
    mails.push({
      id: m.id, store: m.store, storeKind: m.storeKind, folder: m.folder, direction: m.direction,
      messageId: m.messageId, inReplyTo: m.inReplyTo || '', references: m.references || [],
      from: m.from, to: m.to, cc: m.cc || [], sentAt: utc(m.day, m.time), day: m.day, time: m.time,
      subject: m.subject, body: m.body, attachments
    });
  }
  const manifest = {
    schema: C.MANIFEST_SCHEMA, tool: 'data09-27 scripts/make-samples.js (가상 예시 — 수집기 출력과 같은 모양)',
    generatedAt: '2026-09-25 18:00', computer: 'EXAMPLE-PC',
    period: { type: 'weekly', start: '2026-09-21', end: '2026-09-27', weekStart: 1, label: '2026-09-21 ~ 2026-09-27' },
    stores: [
      { name: ONLINE, kind: 'online', path: 'C:\\Users\\user\\AppData\\Local\\Microsoft\\Outlook\\me@example.com (가상).ost', folders: 9, mails: 5, added: false },
      { name: PST, kind: 'pst', path: 'D:\\메일백업(가상)\\Mail backup.pst', folders: 24, mails: 2, added: false }
    ],
    skippedFolders: ['\\\\' + ONLINE + '\\지운 편지함', '\\\\' + ONLINE + '\\정크 메일', '\\\\' + ONLINE + '\\임시 보관함', '\\\\' + PST + '\\지운 편지함'],
    duplicates: 1,
    warnings: [],
    mails
  };
  const json = JSON.stringify(manifest, null, 1);
  fs.writeFileSync(path.join(OUT, 'manifest.json'), json + '\n');
  fs.writeFileSync(path.join(OUT, 'manifest.js'), 'window.P27_COLLECT = ' + json + ';\n');
  fs.writeFileSync(path.join(OUT, 'pdfdata.js'), 'window.P27_PDF = ' + JSON.stringify(pdfData) + ';\n');
  fs.writeFileSync(path.join(OUT, '수집기록.txt'), '업무보고 자동수집 기록(가상 예시)\r\n기간: 주간 2026-09-21 ~ 2026-09-27\r\n데이터 파일: ' + ONLINE + ' [online] — 메일 5통\r\n데이터 파일: ' + PST + ' [pst] — 메일 2통\r\n뺀 폴더: 지운 편지함 · 정크 메일 · 임시 보관함\r\n같은 메일 한 번만: 1통\r\n');

  const sample = {
    manifest, pdf: pdfData,
    settings: { author: '보고자(가상)', title: '디자인팀(가상)' },
    projects: [
      { name: '캡 인테리어 개선', keywords: ['캡', '조작부', '모델링'], group: '건설기계(가상)' },
      { name: 'CMF 샘플 평가', keywords: ['CMF', '색상', '샘플'], group: '건설기계(가상)' },
      { name: '전시회 준비', keywords: ['전시', '부스'], group: '전시·홍보(가상)' }
    ],
    history: require('../js/report-sample.js').history
  };
  const js = '/* 예시 수집 결과 — scripts/make-samples.js 가 만든 파일입니다. 직접 고치지 말고 스크립트를 고쳐 다시 만드세요.\n' +
    '   메일 · 인물 · 업무는 모두 가상(example.com). manifest 는 samples/collect/manifest.json 과 같고, pdf 는 PDF · 일러스트 첨부의 바이트(base64) */\n' +
    '(function (root, data) {\n  if (typeof module === \'object\' && module.exports) module.exports = data;\n  else root.P27_SAMPLE = data;\n})(typeof self !== \'undefined\' ? self : this, ' + JSON.stringify(sample, null, 1) + ');\n';
  fs.writeFileSync(path.join(ROOT, 'js', 'sample-collect.js'), js);
  console.log('samples/collect: 메일 ' + mails.length + '통 · 첨부 ' + mails.reduce((n, m) => n + m.attachments.length, 0) + '개, js/sample-collect.js 작성');
})();
