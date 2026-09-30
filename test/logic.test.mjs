// 전체 로직 테스트 — 실행: node test/logic.test.mjs (의존성 없음)
//   collect-logic.test.mjs : 자동 수집(manifest) · 워드·PPT·엑셀 글 뽑기 · 첨부 → 분류 보강 · 수집기 스크립트 글자 검사
//   report-logic.test.mjs  : 보고서 로직(data09-10 과제 B 에서 가져옴) — .eml 파서 · 그룹핑 · 분류 · 양식 표 · 내보내기
//   ai-endpoint.test.mjs   : AI 연결 설정(OpenAI 호환 · 사내 LLM)
//   rollup-logic.test.mjs  : 보고 단계 · 보고서 취합(팀원 → 파트리더 → 팀장 → 임원, 파일로 주고받기)
await import('./collect-logic.test.mjs');
await import('./report-logic.test.mjs');
await import('./ai-endpoint.test.mjs');
await import('./rollup-logic.test.mjs');
