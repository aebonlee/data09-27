/* 첨부 파일 → 글 (브라우저 안에서만 읽습니다. 파일은 어디로도 보내지 않습니다)
   PDF · PDF 호환 일러스트(.ai) : vendor/pdf.min.js (pdf.js). file:// 에서는 Worker 가 막히므로 worker 스크립트를
          일반 스크립트로 먼저 넣어 화면 스레드에서 돌립니다(data09-26 과 같은 방식).
          한글 CID 글꼴 표(vendor/cmaps/)는 온라인(https)에서만 불러집니다. 글자 층이 없는 스캔 PDF 는 읽지 못합니다(OCR 은 2단계).
   워드 · PPT · 엑셀 : vendor/jszip.min.js 로 zip 을 풀어 CollectLogic.ooxmlTextFromZip (수집기와 같은 규칙).
   수집기가 이미 뽑은 글이 있으면 그것을 쓰고, 여기서는 PDF 와 직접 넣은 .eml 의 첨부만 읽습니다. */
(function (root) {
  'use strict';
  var C = root.CollectLogic;
  var pdfLoading = null;
  function addScript(src) {
    return new Promise(function (ok, bad) {
      var s = document.createElement('script'); s.src = src;
      s.onload = ok; s.onerror = function () { s.remove(); bad(new Error(src + ' 를 불러오지 못했습니다.')); };
      document.head.appendChild(s);
    });
  }
  function withPdf() {
    if (root.pdfjsLib && root.pdfjsWorker) return Promise.resolve(root.pdfjsLib);
    if (!pdfLoading) pdfLoading = addScript('vendor/pdf.worker.min.js').then(function () { return addScript('vendor/pdf.min.js'); }).then(function () {
      root.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
      return root.pdfjsLib;
    }, function (e) { pdfLoading = null; throw new Error('PDF 읽기 도구를 불러오지 못했습니다. 폴더째 받았는지 확인해 주세요. (' + e.message + ')'); });
    return pdfLoading;
  }
  function pdfText(bytes) {
    return withPdf().then(function (lib) {
      var opts = { data: bytes, isEvalSupported: false, disableFontFace: true };
      if (location.protocol !== 'file:') { opts.cMapUrl = 'vendor/cmaps/'; opts.cMapPacked = true; }
      return lib.getDocument(opts).promise;
    }).then(function (doc) {
      var pages = [], p = Promise.resolve(), max = Math.min(doc.numPages, 30);   // 첨부 한 개에서 앞 30쪽까지만
      for (var i = 1; i <= max; i++) (function (n) {
        p = p.then(function () { return doc.getPage(n); }).then(function (pg) { return pg.getTextContent(); }).then(function (tc) {
          pages.push(tc.items.map(function (it) { return { str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height || Math.abs(it.transform[3]) }; }));
        });
      })(i);
      return p.then(function () { doc.destroy(); return C.pdfPagesToText(pages); });
    });
  }
  function ooxmlText(bytes, kind) {
    if (!root.JSZip) return Promise.reject(new Error('Office 파일 읽기 도구(vendor/jszip.min.js)를 불러오지 못했습니다.'));
    return root.JSZip.loadAsync(bytes).then(function (zip) { return C.ooxmlTextFromZip(zip, kind); });
  }
  function plainText(bytes) {
    var t = new TextDecoder('utf-8').decode(bytes);
    if ((t.match(/�/g) || []).length > 3) { try { t = new TextDecoder('euc-kr').decode(bytes); } catch (e) { /* 그대로 */ } }
    return t.replace(/^﻿/, '');
  }
  /* 첨부 객체(a)에 글을 채웁니다. bytes 는 Uint8Array. 결과: a.extract · a.text · a.note 갱신 */
  function fillAttachment(a, bytes) {
    var kind = a.kind || C.kindOf(a.name);
    var job;
    if (kind === 'word' || kind === 'ppt' || kind === 'excel') job = ooxmlText(bytes, kind);
    else if ((kind === 'pdf' || kind === 'illustrator') && C.looksPdf(bytes)) job = pdfText(bytes);
    else if (kind === 'text') job = Promise.resolve(plainText(bytes));
    else {
      a.extract = kind === 'old-office' || kind === 'hwp' ? 'unsupported' : 'meta';
      if (kind === 'illustrator') a.note = 'PDF 호환으로 저장되지 않은 일러스트 — 이름 · 크기만';
      return Promise.resolve(a);
    }
    return job.then(function (t) {
      a.text = String(t || '').slice(0, C.TEXT_CAP);
      a.extract = a.text.replace(/\[(쪽|슬라이드|시트) [^\]]+\]/g, '').trim() ? 'ok' : 'empty';
      if (a.extract === 'empty' && (kind === 'pdf' || kind === 'illustrator')) a.note = '글자 층이 없는 PDF(스캔 · 그림) — 글자 읽기(OCR)는 2단계';
      return a;
    }, function (e) { a.extract = 'error'; a.note = '읽다가 오류: ' + e.message; return a; });
  }
  function base64ToBytes(b64) {
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function fileBytes(file) {
    return new Promise(function (ok, bad) {
      var fr = new FileReader();
      fr.onload = function () { ok(new Uint8Array(fr.result)); };
      fr.onerror = function () { bad(new Error(file.name + ': 파일을 읽지 못했습니다.')); };
      fr.readAsArrayBuffer(file);
    });
  }
  function fileText(file) { return fileBytes(file).then(function (b) { return new TextDecoder('utf-8').decode(b); }); }
  root.P27Readers = { fillAttachment: fillAttachment, pdfText: pdfText, base64ToBytes: base64ToBytes, fileBytes: fileBytes, fileText: fileText, addScript: addScript };
})(window);
