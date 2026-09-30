/* AI 연결 설정 — OpenAI 호환(Chat Completions) 엔드포인트 (data09-10 에서 가져옴, 저장 칸만 data09-27 로 바꿈).
   2026-09-29 오후 늦게 수강생 질문 「내부 폐쇄망 LLM 을 써서 Agent 를 설계할 수 있는지」에 대한 구현.

   · 주소(Base URL)·모델 이름·키(선택)를 사용자가 넣습니다. 고정된 외부 주소는 없습니다.
     - 외부 서비스 예: https://api.openai.com/v1
     - 사내 서버 예: 사내 온프레미스 LLM 서버가 「OpenAI 호환 API」를 열어 두었다면 그 주소(예: https://llm.사내도메인/v1).
       vLLM·Ollama 같은 오픈소스 서버는 이런 호환 API 를 제공합니다(주소·포트는 사내 설정에 따름).
   · 키는 비워 둘 수 있습니다(사내 서버가 키 없이 열려 있을 때). 넣으면 Authorization: Bearer 로 보냅니다.
   · 키는 코드·리포에 없고, 「이 브라우저에 기억」을 고른 경우에만 localStorage 에 둡니다.
   · 브라우저에서 직접 부르므로 서버가 CORS 를 허용해야 하고, https 페이지에서 http 주소는 브라우저가 막습니다(혼합 콘텐츠).
     그런 때는 이 도구를 file:// 로 열거나(내 PC 에서 index.html 더블클릭) 사내 서버를 https 로 열어야 합니다.
   반자동(프롬프트 복사 → 붙여 넣기)은 그대로 기본값이고, 이 설정은 「자동 보내기」를 쓸 때만 필요합니다.

   2026-09-30 답변 「사내 LLM 모델: qwen3.8」 반영
   · 모델 이름 칸의 기본값을 qwen3.8 로 둡니다(DEFAULT_MODEL). 주소는 아직 모르므로 비워 둡니다.
     서버에 올라간 이름이 조금 다를 수 있어(예: Ollama 는 qwen3:8b 처럼 콜론을 씀) 「모델 목록 불러오기」(GET …/v1/models)로 확인할 수 있게 했습니다.
   · Qwen3 는 「생각하는 모드」에서 답 앞에 <think>…</think> 를 붙여 보낼 수 있습니다(vLLM · Ollama 설정에 따라 다름).
     그 부분을 떼고 답만 씁니다(stripThinking). 생각만 오고 답이 잘렸으면 알아볼 수 있는 오류로 알립니다. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AIEndpoint = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STORE_KEY = 'data09-27.ai';
  var DEFAULT_MODEL = 'qwen3.8';   // 2026-09-30 수강생 답변(사내 LLM 모델) — 서버의 실제 이름은 「모델 목록 불러오기」로 확인
  var PRESETS = [
    { id: 'custom', label: '사내·기타 OpenAI 호환 서버(주소 직접 입력)', baseUrl: '' },
    { id: 'openai', label: 'OpenAI (외부 서비스)', baseUrl: 'https://api.openai.com/v1' },
    { id: 'local', label: '내 PC 에서 띄운 서버 예시(http://localhost:8000/v1)', baseUrl: 'http://localhost:8000/v1' }
  ];

  function str(v) { return v == null ? '' : String(v).trim(); }
  function defaultConfig() { return { baseUrl: '', model: DEFAULT_MODEL, apiKey: '', remember: false, temperature: 0.2, timeoutSec: 120 }; }

  /* 주소 정리 — 끝의 / 와 /chat/completions 를 떼어 「…/v1」 형태로 둡니다 */
  function normalizeBaseUrl(url) {
    var u = str(url).replace(/\s+/g, '');
    u = u.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '').replace(/\/+$/, '');
    return u;
  }
  function endpointUrl(cfg) { return normalizeBaseUrl(cfg && cfg.baseUrl) + '/chat/completions'; }
  function isLocalHost(host) {
    return /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/i.test(host) || /\.(local|internal|lan|corp)$/i.test(host);
  }

  /* 설정 점검 — errors 가 있으면 보내지 않습니다. pageProtocol 은 location.protocol('https:' · 'file:' …) */
  function validateConfig(cfg, pageProtocol) {
    var errors = [], warnings = [];
    var base = normalizeBaseUrl(cfg && cfg.baseUrl);
    var m = /^(https?):\/\/([^/:?#]+|\[[^\]]+\])(:\d+)?(\/[^?#]*)?$/i.exec(base);
    if (!base) errors.push('AI 서버 주소(Base URL)를 적어 주세요.');
    else if (!m) errors.push('주소는 http:// 또는 https:// 로 시작해야 합니다(예: https://llm.example.com/v1).');
    if (!str(cfg && cfg.model)) errors.push('모델 이름을 적어 주세요(서버에 올라가 있는 모델 이름 그대로).');
    if (m) {
      var scheme = m[1].toLowerCase(), host = m[2];
      if (scheme === 'http' && pageProtocol === 'https:')
        errors.push('이 페이지는 https 라서 http 주소로는 보낼 수 없습니다(브라우저가 막음). 이 도구를 내 PC 에서 파일로 열거나(file://), 서버를 https 로 열어 주세요.');
      if (scheme === 'http' && str(cfg.apiKey) && !isLocalHost(host))
        warnings.push('키가 암호화되지 않은 http 로 전송됩니다. 사내망 안이라도 https 를 권합니다.');
      if (/api\.openai\.com$/i.test(host)) warnings.push('외부 서비스입니다. 메일·사내 자료를 보내도 되는지 회사 보안정책을 먼저 확인해 주세요.');
      if (!/\/v\d+$/i.test(m[4] || '')) warnings.push('주소가 보통 「…/v1」로 끝납니다. 서버 안내의 주소를 확인해 주세요.');
    }
    return { errors: errors, warnings: warnings };
  }

  /* 요청 만들기 — fetch(url, init) 에 그대로 넘깁니다. 키가 비면 Authorization 머리글을 넣지 않습니다 */
  function buildChatRequest(cfg, messages, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    var key = str(cfg && cfg.apiKey);
    if (key) headers.Authorization = 'Bearer ' + key;
    var body = { model: str(cfg && cfg.model), messages: messages, temperature: cfg && cfg.temperature != null ? Number(cfg.temperature) : 0.2 };
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;
    return { url: endpointUrl(cfg), init: { method: 'POST', headers: headers, body: JSON.stringify(body) } };
  }
  /* 프롬프트 한 덩어리 → messages */
  function promptMessages(prompt, system) {
    var out = [];
    if (system) out.push({ role: 'system', content: system });
    out.push({ role: 'user', content: String(prompt) });
    return out;
  }
  /* Qwen3 등 생각하는 모델의 <think>…</think> 떼기
     - <think>…</think> 가 여러 번 있어도 모두 뗍니다.
     - 서버 템플릿이 여는 <think> 를 프롬프트 쪽에 넣어 답에는 </think> 만 오는 경우 → 마지막 </think> 앞을 모두 뗍니다.
     - <think> 로 시작했는데 닫히지 않음(답 길이 제한에 걸려 생각만 오고 끝남) → truncated: true */
  function stripThinking(text) {
    var t = str(text), truncated = false;
    t = t.replace(/<think>[\s\S]*?<\/think>/gi, '');
    var close = t.toLowerCase().lastIndexOf('</think>');
    if (close >= 0) t = t.slice(close + '</think>'.length);
    var open = t.search(/<think>/i);
    if (open >= 0) { truncated = !t.slice(0, open).trim(); t = t.slice(0, open); }
    return { text: t.trim(), truncated: truncated };
  }
  /* 응답 읽기 — choices[0].message.content. 서버 오류는 알아볼 수 있는 문장으로 */
  function parseChatResponse(json) {
    if (!json || typeof json !== 'object') throw new Error('AI 서버 응답이 JSON 이 아닙니다.');
    if (json.error) throw new Error('AI 서버 오류: ' + (json.error.message || JSON.stringify(json.error)));
    var c = json.choices && json.choices[0];
    var text = c && (c.message ? c.message.content : c.text);
    if (Array.isArray(text)) text = text.map(function (p) { return p && (p.text || ''); }).join('');
    if (typeof text !== 'string' || !text.trim()) throw new Error('AI 서버 응답에 답 글(choices[0].message.content)이 없습니다.');
    var s = stripThinking(text);
    if (!s.text) throw new Error(s.truncated ? 'AI 가 생각하는 과정(<think>)만 보내고 답이 잘렸습니다. 서버의 답 길이 제한을 늘리거나 생각하는 모드를 꺼 달라고 사내 LLM 담당에 문의해 주세요.'
      : 'AI 서버 응답에 생각하는 과정(<think>)만 있고 답 글이 없습니다.');
    return s.text;
  }
  /* 모델 목록 — GET …/v1/models (OpenAI 호환 서버 공통: vLLM · Ollama · LM Studio 등). 서버에 올라간 정확한 모델 이름 확인용 */
  function buildModelsRequest(cfg) {
    var headers = {}, key = str(cfg && cfg.apiKey);
    if (key) headers.Authorization = 'Bearer ' + key;
    return { url: normalizeBaseUrl(cfg && cfg.baseUrl) + '/models', init: { method: 'GET', headers: headers } };
  }
  function parseModelsResponse(json) {
    if (!json || typeof json !== 'object') throw new Error('모델 목록 응답이 JSON 이 아닙니다.');
    if (json.error) throw new Error('AI 서버 오류: ' + (json.error.message || JSON.stringify(json.error)));
    var list = Array.isArray(json.data) ? json.data : Array.isArray(json.models) ? json.models : [];
    return list.map(function (m) { return str(m && (m.id || m.name || m.model)); }).filter(Boolean);
  }
  /* 적은 모델 이름과 서버 목록 비교 — 같으면 exact, 대소문자 · 기호(. : - _)만 다르면 그 이름을 suggest */
  function matchModel(model, list) {
    var want = str(model), key = function (x) { return str(x).toLowerCase().replace(/[.:_\-\s]/g, ''); };
    if ((list || []).indexOf(want) >= 0) return { exact: true, suggest: want };
    var near = (list || []).filter(function (x) { return key(x) === key(want); });
    return { exact: false, suggest: near[0] || '' };
  }
  function callModels(cfg, opts) {
    opts = opts || {};
    var f = opts.fetch || (typeof fetch === 'function' ? fetch : null);
    if (!f) return Promise.reject(new Error('이 환경에서는 fetch 를 쓸 수 없습니다.'));
    var req = buildModelsRequest(cfg);
    return f(req.url, req.init).then(function (res) {
      return res.text().then(function (t) {
        var j = null; try { j = JSON.parse(t); } catch (e) { /* 아래에서 */ }
        if (!res.ok) throw new Error('모델 목록 요청에 서버가 ' + res.status + ' 로 답했습니다. ' + (j && j.error ? (j.error.message || '') : t.slice(0, 200)));
        return parseModelsResponse(j);
      });
    }, function (e) { throw new Error('AI 서버에 연결하지 못했습니다. 주소·사내망 연결·서버의 CORS 허용 설정을 확인해 주세요. (' + (e && e.message || e) + ')'); });
  }
  /* 실제 호출 — fetchImpl 은 테스트용 */
  function callChat(cfg, messages, opts) {
    opts = opts || {};
    var f = opts.fetch || (typeof fetch === 'function' ? fetch : null);
    if (!f) return Promise.reject(new Error('이 환경에서는 fetch 를 쓸 수 없습니다.'));
    var req = buildChatRequest(cfg, messages, opts);
    var timer = null, ctl = typeof AbortController === 'function' ? new AbortController() : null;
    if (ctl) { req.init.signal = ctl.signal; timer = setTimeout(function () { ctl.abort(); }, (Number(cfg.timeoutSec) || 120) * 1000); }
    return f(req.url, req.init).then(function (res) {
      return res.text().then(function (t) {
        var j = null; try { j = JSON.parse(t); } catch (e) { /* 아래에서 */ }
        if (!res.ok) throw new Error('AI 서버가 ' + res.status + ' 로 답했습니다. ' + (j && j.error ? (j.error.message || '') : t.slice(0, 200)));
        return parseChatResponse(j);
      });
    }, function (e) {
      throw new Error(e && e.name === 'AbortError' ? 'AI 서버가 제한 시간 안에 답하지 않았습니다.'
        : 'AI 서버에 연결하지 못했습니다. 주소·사내망 연결·서버의 CORS 허용 설정을 확인해 주세요. (' + (e && e.message || e) + ')');
    }).then(function (x) { if (timer) clearTimeout(timer); return x; }, function (e) { if (timer) clearTimeout(timer); throw e; });
  }

  /* 저장 — 키는 remember 일 때만 남깁니다 */
  function toStored(cfg) {
    var c = cleanConfig(cfg);
    if (!c.remember) c.apiKey = '';
    return c;
  }
  function cleanConfig(p) {
    var c = defaultConfig();
    if (!p || typeof p !== 'object') return c;
    c.baseUrl = normalizeBaseUrl(p.baseUrl);
    c.model = p.model == null ? DEFAULT_MODEL : str(p.model);   // 예전에 저장한 설정에 모델 칸이 없으면 기본값
    c.apiKey = str(p.apiKey);
    c.remember = !!p.remember;
    var t = Number(p.temperature); if (isFinite(t) && t >= 0 && t <= 2) c.temperature = t;
    var s = Number(p.timeoutSec); if (isFinite(s) && s >= 10 && s <= 600) c.timeoutSec = Math.round(s);
    return c;
  }
  function isReady(cfg) { return !!(cfg && normalizeBaseUrl(cfg.baseUrl) && str(cfg.model)); }
  function describe(cfg) {
    if (!isReady(cfg)) return '자동 보내기 설정 없음(반자동만)';
    var host = (/^https?:\/\/([^/]+)/i.exec(normalizeBaseUrl(cfg.baseUrl)) || [])[1] || '';
    return host + ' · ' + str(cfg.model) + (str(cfg.apiKey) ? ' · 키 있음' : ' · 키 없음');
  }

  /* 브라우저 저장 */
  var session = null; // 기억하지 않는 키는 이 창에서만
  function load() {
    var c = defaultConfig();
    try { c = cleanConfig(JSON.parse(localStorage.getItem(STORE_KEY) || 'null')); } catch (e) { /* 막힌 저장소 */ }
    if (session && !c.apiKey) c.apiKey = session.apiKey;
    return c;
  }
  function save(cfg) {
    var c = cleanConfig(cfg);
    session = { apiKey: c.apiKey };
    try { localStorage.setItem(STORE_KEY, JSON.stringify(toStored(c))); return true; } catch (e) { return false; }
  }

  return {
    STORE_KEY: STORE_KEY, DEFAULT_MODEL: DEFAULT_MODEL, PRESETS: PRESETS, stripThinking: stripThinking,
    buildModelsRequest: buildModelsRequest, parseModelsResponse: parseModelsResponse, matchModel: matchModel, callModels: callModels, defaultConfig: defaultConfig, normalizeBaseUrl: normalizeBaseUrl, endpointUrl: endpointUrl,
    validateConfig: validateConfig, buildChatRequest: buildChatRequest, promptMessages: promptMessages, parseChatResponse: parseChatResponse,
    callChat: callChat, cleanConfig: cleanConfig, toStored: toStored, isReady: isReady, describe: describe, load: load, save: save
  };
});
