// 예시 첨부 PDF · 일러스트(.ai) 만들기 — 내용은 모두 가상입니다. 크로뮴의 PDF 인쇄를 씁니다(data09-26 과 같은 방식).
//   npm i playwright (또는 PLAYWRIGHT=<playwright 폴더> 로 이미 설치된 것을 가리킴)
//   node scripts/make-sample-pdf.cjs
// 일러스트(.ai)는 보통 「PDF 호환 파일 만들기」가 켜진 채 저장되어 파일 머리가 %PDF 입니다. 그 모양을 흉내 내려고
// PDF 를 .ai 이름으로 저장합니다(실제 일러스트 편집 정보는 없음).
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const ATT = path.join(__dirname, '..', 'samples', 'collect', 'att');
const page = (title, lines) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
body{font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;margin:48px;font-size:14pt;line-height:1.7}h1{font-size:20pt}</style></head>
<body><h1>${title}</h1>${lines.map((l) => `<p>${l}</p>`).join('')}</body></html>`;
const docs = [
  ['M0006', '조작부_치수도면_Rev2.pdf', page('조작부 치수 도면 Rev.2 (가상)', ['발행일: 2026-09-25', '버튼 간격 18mm → 20mm 변경', '최종 확정은 10/1 예정입니다.', '협력사 설계 담당(가상)'])],
  ['M0005', '로고_시안_B안.ai', page('전시 로고 시안 B안 (가상)', ['색상: 딥블루 · 웜그레이', '부스 전면 그래픽 적용안'])]
];
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage();
  for (const [mid, name, html] of docs) {
    await pg.setContent(html);
    fs.mkdirSync(path.join(ATT, mid), { recursive: true });
    fs.writeFileSync(path.join(ATT, mid, name), await pg.pdf({ format: 'A4', printBackground: false }));
    console.log('ok', mid, name);
  }
  await b.close();
})();
