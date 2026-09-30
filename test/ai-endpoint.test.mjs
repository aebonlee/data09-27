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

// ── 2026-09-30 답변: 사내 LLM 모델 qwen3.8 ──
const L = require('../js/report-logic.js');
test('qwen3.8: 모델 칸 기본값(주소는 비움), 예전 설정에 모델 칸이 없으면 기본값 · 일부러 비운 것은 그대로', () => {
  const d = E.defaultConfig();
  assert.deepEqual([d.model, d.baseUrl, E.isReady(d)], ['qwen3.8', '', false]);   // 주소를 모르므로 자동 보내기는 아직 꺼짐
  assert.equal(E.cleanConfig({ baseUrl: 'http://10.0.0.5:8000/v1' }).model, 'qwen3.8');
  assert.equal(E.cleanConfig({ model: '' }).model, '');
  assert.equal(E.cleanConfig({ model: ' qwen3:8b ' }).model, 'qwen3:8b');
});
test('qwen3.8: vLLM · Ollama 식 OpenAI 호환 주소로 같은 모양의 요청(/v1/chat/completions · model · messages)', () => {
  for (const [base, url] of [['http://10.0.0.5:8000/v1', 'http://10.0.0.5:8000/v1/chat/completions'],          // vLLM 기본 포트
    ['http://localhost:11434/v1/', 'http://localhost:11434/v1/chat/completions']]) {                                 // Ollama 기본 포트
    const r = E.buildChatRequest({ baseUrl: base, model: 'qwen3.8' }, E.promptMessages('질문', '시스템'));
    const b = JSON.parse(r.init.body);
    assert.equal(r.url, url);
    assert.deepEqual([b.model, b.messages.map((m) => m.role).join(','), b.temperature, 'stream' in b], ['qwen3.8', 'system,user', 0.2, false]);
  }
});
test('qwen3.8: <think>…</think> 떼기 — 여러 번 · 닫는 표시만 · 잘림', () => {
  assert.deepEqual(E.stripThinking('<think>\n메일 3통을 보면 [M0001] 은…\n</think>\n\n[{"a":1}]'), { text: '[{"a":1}]', truncated: false });
  assert.deepEqual(E.stripThinking('<THINK>a</THINK>답1 <think>b</think>답2'), { text: '답1 답2', truncated: false });
  assert.deepEqual(E.stripThinking('생각이 여기서부터\n</think>\n\n확인'), { text: '확인', truncated: false });     // 여는 표시는 서버 템플릿 쪽
  assert.deepEqual(E.stripThinking('<think>메일을 읽어 보면'), { text: '', truncated: true });
  assert.deepEqual(E.stripThinking('그냥 답'), { text: '그냥 답', truncated: false });
});
test('qwen3.8: 응답 읽기가 생각 부분을 떼고 답만 — 생각만 오고 잘리면 알아볼 수 있게', () => {
  const think = '<think>\n사용자는 JSON 배열을 원한다. 예: [{"text":"예시"}] 형태…\n</think>\n\n';
  const answer = '[{"category":"실적","text":"B안 시안 확정","evidence":["M0001"]}]';
  assert.equal(E.parseChatResponse({ choices: [{ message: { role: 'assistant', content: think + answer } }] }), answer);
  assert.throws(() => E.parseChatResponse({ choices: [{ message: { content: '<think>메일 9통 중에서' }, finish_reason: 'length' }] }), /잘렸습니다/);
  assert.throws(() => E.parseChatResponse({ choices: [{ message: { content: '<think>생각</think>' } }] }), /생각하는 과정/);
  // 반자동으로 붙여 넣은 답(생각 포함)도 생각 안의 [ ] 를 배열로 잡지 않는다
  assert.deepEqual(L.extractJsonArray(think + answer).map((x) => x.text), ['B안 시안 확정']);
  assert.deepEqual(L.extractJsonArray('…[참고]…\n</think>\n' + answer).length, 1);
});
test('qwen3.8: 모델 목록(GET /v1/models) — vLLM · Ollama 모양, 표기가 조금 다르면 서버 이름을 권함', () => {
  const r = E.buildModelsRequest({ baseUrl: 'http://localhost:11434/v1/chat/completions', apiKey: '' });
  assert.deepEqual([r.url, r.init.method, Object.keys(r.init.headers).length], ['http://localhost:11434/v1/models', 'GET', 0]);
  assert.deepEqual(E.parseModelsResponse({ object: 'list', data: [{ id: 'qwen3:8b', object: 'model' }, { id: 'bge-m3' }] }), ['qwen3:8b', 'bge-m3']);
  assert.deepEqual(E.parseModelsResponse({ models: [{ name: 'Qwen3.8' }] }), ['Qwen3.8']);
  assert.deepEqual(E.matchModel('qwen3.8', ['qwen3.8', 'x']), { exact: true, suggest: 'qwen3.8' });
  assert.deepEqual(E.matchModel('qwen3.8', ['Qwen3-8', 'x']), { exact: false, suggest: 'Qwen3-8' });
  assert.deepEqual(E.matchModel('qwen3.8', ['qwen3:8b']), { exact: false, suggest: '' });                  // 8b 는 다른 이름 — 추측해서 바꾸지 않음
  assert.throws(() => E.parseModelsResponse({ error: { message: 'unauthorized' } }), /unauthorized/);
});
test('qwen3.8: 호출 전체 — 가짜 서버가 생각 + 답을 보내면 답만 돌려준다', async () => {
  const srv = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ choices: [{ message: { content: '<think>짧게 답하자</think>\n\n확인' } }] })) });
  assert.equal(await E.callChat({ baseUrl: 'http://10.0.0.5:8000/v1', model: 'qwen3.8' }, E.promptMessages('연결 확인'), { fetch: srv }), '확인');
  const models = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{"data":[{"id":"qwen3.8"}]}') });
  assert.deepEqual(await E.callModels({ baseUrl: 'http://10.0.0.5:8000/v1' }, { fetch: models }), ['qwen3.8']);
});

await Promise.all(pending);
console.log('\n[AI] ' + passed + '개 통과' + (failed ? ' · 실패 ' + failed : ''));
