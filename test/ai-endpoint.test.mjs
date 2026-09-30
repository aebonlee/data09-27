// AI 연결 설정(OpenAI 호환 엔드포인트) — 실행: node test/ai-endpoint.test.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('../js/ai-endpoint.js');

let passed = 0, failed = 0;
const pending = [];
function test(name, fn) {
  const done = () => { passed++; console.log('  ok  ' + name); };
  const fail = (e) => { failed++; console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; };
  try { const r = fn(); if (r && r.then) pending.push(r.then(done, fail)); else done(); } catch (e) { fail(e); }
}
console.log('\n[AI] AI 연결 설정 — OpenAI 호환 엔드포인트 (사내 온프레미스 LLM 포함)');

test('주소 정리: 끝 / · /chat/completions 떼기, 요청 주소는 …/v1/chat/completions', () => {
  assert.equal(E.normalizeBaseUrl(' https://llm.corp.example/v1/ '), 'https://llm.corp.example/v1');
  assert.equal(E.normalizeBaseUrl('http://10.0.0.5:8000/v1/chat/completions'), 'http://10.0.0.5:8000/v1');
  assert.equal(E.endpointUrl({ baseUrl: 'http://localhost:11434/v1' }), 'http://localhost:11434/v1/chat/completions');
});
test('요청 만들기: 설정한 주소·모델로, 키가 비면 Authorization 머리글 없음', () => {
  const msgs = E.promptMessages('안녕', '시스템');
  const a = E.buildChatRequest({ baseUrl: 'https://llm.corp.example/v1', model: 'corp-llm-8b', apiKey: '' }, msgs);
  assert.equal(a.url, 'https://llm.corp.example/v1/chat/completions');
  assert.equal(a.init.method, 'POST');
  assert.deepEqual(Object.keys(a.init.headers), ['Content-Type']);
  const body = JSON.parse(a.init.body);
  assert.deepEqual([body.model, body.messages.length, body.messages[0].role, body.messages[1].content, body.temperature], ['corp-llm-8b', 2, 'system', '안녕', 0.2]);
  const b = E.buildChatRequest({ baseUrl: 'https://x/v1', model: 'm', apiKey: ' sk-test ' }, msgs, { maxTokens: 20 });
  assert.equal(b.init.headers.Authorization, 'Bearer sk-test');
  assert.equal(JSON.parse(b.init.body).max_tokens, 20);
  assert.ok(!a.url.includes('api.openai.com'));                     // 고정 주소 없음
});
test('설정 점검: 빈 값 · 형식 · https 페이지에서 http 주소(혼합 콘텐츠) · 평문 키 · 외부 서비스 안내', () => {
  assert.equal(E.validateConfig({}, 'https:').errors.length, 2);
  assert.ok(E.validateConfig({ baseUrl: 'llm.corp/v1', model: 'm' }, 'file:').errors[0].includes('http://'));
  assert.ok(E.validateConfig({ baseUrl: 'http://10.1.2.3:8000/v1', model: 'm' }, 'https:').errors[0].includes('https'));
  assert.deepEqual(E.validateConfig({ baseUrl: 'http://10.1.2.3:8000/v1', model: 'm' }, 'file:').errors, []);   // 파일로 열면 사내 http 서버 가능
  assert.deepEqual(E.validateConfig({ baseUrl: 'http://localhost:8000/v1', model: 'm', apiKey: 'k' }, 'file:').warnings, []);
  assert.ok(E.validateConfig({ baseUrl: 'http://llm.corp.com/v1', model: 'm', apiKey: 'k' }, 'file:').warnings.some((w) => w.includes('암호화')));
  assert.ok(E.validateConfig({ baseUrl: 'https://api.openai.com/v1', model: 'm' }, 'https:').warnings.some((w) => w.includes('보안정책')));
  assert.ok(E.validateConfig({ baseUrl: 'https://llm.corp.com', model: 'm' }, 'https:').warnings.some((w) => w.includes('/v1')));
});
test('응답 읽기: choices[0].message.content · 오류 객체 · 빈 답', () => {
  assert.equal(E.parseChatResponse({ choices: [{ message: { content: '확인' } }] }), '확인');
  assert.equal(E.parseChatResponse({ choices: [{ text: '옛 형식' }] }), '옛 형식');
  assert.throws(() => E.parseChatResponse({ error: { message: 'model not found' } }), /model not found/);
  assert.throws(() => E.parseChatResponse({ choices: [] }), /답 글/);
  assert.throws(() => E.parseChatResponse(null), /JSON/);
});
test('저장: 「기억」을 끄면 키를 남기지 않음, 이상한 값은 기본값', () => {
  assert.equal(E.toStored({ baseUrl: 'https://x/v1', model: 'm', apiKey: 'k', remember: false }).apiKey, '');
  assert.equal(E.toStored({ baseUrl: 'https://x/v1', model: 'm', apiKey: 'k', remember: true }).apiKey, 'k');
  const c = E.cleanConfig({ temperature: 9, timeoutSec: 1 });
  assert.deepEqual([c.temperature, c.timeoutSec, E.isReady(c)], [0.2, 120, false]);
  assert.equal(E.describe({ baseUrl: 'http://10.0.0.5:8000/v1', model: 'corp' }), '10.0.0.5:8000 · corp · 키 없음');
});
test('호출: 가짜 fetch 로 성공 · 서버 오류 · 연결 실패', async () => {
  const cfg = { baseUrl: 'http://10.0.0.5:8000/v1', model: 'corp', timeoutSec: 30 };
  let seen = null;
  const ok = (url, init) => { seen = { url, init }; return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ choices: [{ message: { content: '[]' } }] })) }); };
  assert.equal(await E.callChat(cfg, E.promptMessages('p'), { fetch: ok }), '[]');
  assert.equal(seen.url, 'http://10.0.0.5:8000/v1/chat/completions');
  const bad = () => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('{"error":{"message":"The model `x` does not exist"}}') });
  await assert.rejects(E.callChat(cfg, E.promptMessages('p'), { fetch: bad }), /404 .*does not exist/);
  const down = () => Promise.reject(new TypeError('Failed to fetch'));
  await assert.rejects(E.callChat(cfg, E.promptMessages('p'), { fetch: down }), /CORS/);
});

await Promise.all(pending);
console.log('\n[AI] ' + passed + '개 통과' + (failed ? ' · 실패 ' + failed : ''));
