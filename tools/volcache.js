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
      kws: kws.map((x) => ({ k: x.k, pc: x.pc, mo: x.mo, comp: x.comp, low: x.low || undefined, rel: x.rel && x.rel.length ? x.rel : undefined })), // rel = 같이 찾는 말(상세 창)
      total, low: kws.every((x) => x.low) || undefined, at: kws.map((x) => x.at).sort().pop(),
    };
    it.vol.g = grade(it.vol.kws, it.kwFit);
    n++; if (it.vol.at > at) at = it.vol.at;
  }
  return { cards: n, at };
}

// 검색 기대 등급(2026-11-18, 먼저 쓸 글 순서용. 눈금은 Claude 판단 — 효니 블로그는 한 달 조회 20~120이라 «큰 말»에서는 큰 사이트에 밀린다고 봄).
// 검색어마다: 30 미만 «하» · 30~99 «중» · 100~2,999 «상» · 3,000 이상 «중»(big: 찾는 사람은 많지만 큰 말). 카드 등급은 검색어 중 가장 좋은 것.
// 처음엔 300~9,999를 «상»으로 잡았다가 낮췄다: 지금까지 실제 검색 유입 5번이 모두 작은 틈새 말(역사 게임 수업 등)이었고, 제미나이 검토도 같은 지적.
// 노트에 `검색맞음: 약함`이 있으면(생각 글 — 찾는 사람이 바라는 답과 글이 다름) 숫자와 상관없이 «하».
function gradeOne(x) {
  const t = (x.pc || 0) + (x.mo || 0);
  if (x.low || t < 30) return { lv: '하', k: x.k, t };
  if (t < 100) return { lv: '중', k: x.k, t };
  if (t < 3000) return { lv: '상', k: x.k, t };
  return { lv: '중', k: x.k, t, big: true };
}
function grade(kws, fit) {
  // r = 줄 세울 때 쓰는 값 하나(먼저 쓸 글·앱 «검색 기대순»이 같은 순서를 쓰게): 상 4 > 중 3 > 큰 말 2 > 하 1 > 맞음 약함 0
  const rOf = (g) => (g.lv === '상' ? 4 : g.lv === '중' ? (g.big ? 2 : 3) : 1);
  // 검색어가 둘이면 r이 높은 것, 같으면 많이 찾는 것(같은 «중»에서 큰 말이 작은 말을 이기지 않게 — 검토 지적)
  const best = kws.map(gradeOne).sort((a, b) => rOf(b) - rOf(a) || b.t - a.t)[0];
  const g = fit === '약함' ? { ...best, lv: '하', big: undefined, weak: true } : best;
  g.r = g.weak ? 0 : rOf(g);
  return g;
}

// 노트 없는 임시저장 글의 검색어 파일(볼트 «5-개인/글 초안/임시저장 검색어.md»): `- 제목 일부 = 키1, 키2` (+ 끝에 «(약함)»)
const LOOSE_REL = path.join('5-개인', '글 초안', '임시저장 검색어.md');
function parseLooseLine(line) {
  const m = String(line).match(/^\s*-\s+(.+?)\s+=\s+(.+?)\s*$/);
  if (!m) return null;
  const weak = /\(약함\)\s*$/;
  return { key: m[1].trim(), kw: parseKw(m[2].replace(weak, '')), fit: weak.test(m[2]) ? '약함' : '' };
}
function readLooseKw(vault) {
  try { return fs.readFileSync(path.join(vault, LOOSE_REL), 'utf8').split(/\r?\n/).map(parseLooseLine).filter((x) => x && x.key.length >= 2); } catch (e) { return []; }
}
module.exports = { FILE, FRESH_DAYS, parseKw, load, save, isFresh, attach, dayDiff, grade, LOOSE_REL, parseLooseLine, readLooseKw };
