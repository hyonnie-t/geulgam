// 네이버 월 검색수 캐시(searchvol.local.json) 읽기와 카드에 붙이기 (2026-11-18).
// build.js와 searchvol.js가 같이 쓴다. 캐시는 *.local.json이라 레포에 안 올라간다.
const fs = require('fs'), path = require('path');
const FILE = path.resolve(__dirname, '..', 'searchvol.local.json');
const FRESH_DAYS = 7; // 같은 검색어는 7일 안에 다시 안 부른다(약관·속도 제한)

// 노트 속성 «검색어: 임진왜란, 이순신 장군» → ['임진왜란', '이순신장군'] (API는 띄어쓰기를 뺀 말로 조회, 최대 2개)
function parseKw(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || '').split(/[,，、]/);
  // 인라인 목록 `[a, b]`·따옴표 `"a", "b"` 형식도 받는다
  return [...new Set(list.map((s) => s.replace(/[\[\]"'“”‘’]/g, '').replace(/\s+/g, '').trim()).filter(Boolean))].slice(0, 2);
}
function load(file = FILE) {
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); return j && j.kw ? j : { v: 1, kw: {} }; } catch (e) { return { v: 1, kw: {} }; }
}
function save(cache, file = FILE) { fs.writeFileSync(file, JSON.stringify(cache)); }
const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const isFresh = (e, today) => !!e && dayDiff(e.at, today) < FRESH_DAYS;

// 카드(items)에 vol을 붙인다. kw가 없거나 조회 결과가 없으면 vol 없음. 합계는 검색어 중 큰 쪽(겹치는 검색어를 더하지 않으려고).
function attach(items, cache) {
  let n = 0, at = '';
  for (const it of items) {
    delete it.vol; delete it.volNone;
    const all = (it.kw || []).map((k) => ({ k, ...(cache.kw[k] || {}) }));
    const kws = all.filter((x) => x.at && !x.none);
    if (!kws.length) { if (all.length && all.every((x) => x.none)) it.volNone = true; continue; } // 네이버에 결과가 없는 검색어
    const total = Math.max(...kws.map((x) => (x.pc || 0) + (x.mo || 0)));
    it.vol = {
      kws: kws.map((x) => ({ k: x.k, pc: x.pc, mo: x.mo, comp: x.comp, low: x.low || undefined })),
      total, low: kws.every((x) => x.low) || undefined, at: kws.map((x) => x.at).sort().pop(),
    };
    n++; if (it.vol.at > at) at = it.vol.at;
  }
  return { cards: n, at };
}
module.exports = { FILE, FRESH_DAYS, parseKw, load, save, isFresh, attach, dayDiff };
