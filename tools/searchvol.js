// 글감 카드의 «네이버 월 검색수» 조회 (2026-11-18, 효니 «글감 목록 웹앱에 붙여서 네가 연동해서 쓸 방법 없니?»)
// 네이버 검색광고 API 키워드도구를 쓴다. 약관상 «광고 관리» 밖 사용이라 중단될 수 있고, 그러면 효니가 웹 «키워드 도구» 캡처로 대신한다.
// 지킬 것: 한 번에 키워드 5개 이하 · 같은 키워드는 7일 안에 다시 안 부름(캐시 searchvol.local.json) · 한 번 돌릴 때 최대 4번 호출 ·
//          실패(429 등)하면 다시 시도하지 않고 멈춘다 · 검색수 숫자를 블로그 글에 그대로 싣지 않는다 · 키 값은 출력·기록하지 않는다.
// 사용:
//   node tools/searchvol.js            미리보기: 검색어가 정해진 카드, 새로 부를 키워드 수(호출 안 함)
//   node tools/searchvol.js --write    새로 부를 키워드를 조회해 캐시·drawer.local.json에 반영(weekly-vault-check 4-1 build 뒤, upload 앞)
//   node tools/searchvol.js --todo     «글감·초안» 카드 중 검색어가 아직 없는 노트 이름(Claude가 검색어를 정할 때)
//   node tools/searchvol.js --set "노트이름=임진왜란,이순신"   그 노트 맨 위 속성에 `검색어: 임진왜란, 이순신` 한 줄(1~2개)
// 검색어는 노트 속성 `검색어:`(앱은 보기만 하고 입력이 없어서 Claude가 정해 노트에 쓴다).
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const vc = require('./volcache');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const VAULT = path.resolve(opt('--vault', path.join(ROOT, '..', '..', '클로드작업', '옵시디언', '효니노트')));
const DRAWER = path.resolve(opt('--drawer', path.join(ROOT, 'drawer.local.json')));
const CACHE = path.resolve(opt('--cache', vc.FILE));
const TODAY = opt('--date', new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10));
const MAX_CALLS = Number(opt('--max-calls', 4)); // 한 번 돌릴 때 호출 상한
const BATCH = 5; // 한 번에 키워드 5개 이하(약관)
const KEY_FILE = path.join(process.env.USERPROFILE || process.env.HOME || '', 'claude-mcp', 'naver-searchad', 'api_key_naver_searchad.txt');

const readDrawer = () => { if (!fs.existsSync(DRAWER)) { console.error('drawer.local.json이 없습니다. 먼저 node tools/build.js'); process.exit(1); } return JSON.parse(fs.readFileSync(DRAWER, 'utf8')); };

// ---------- --todo / --set : 볼트 노트 ----------
function findNote(name) {
  const hits = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (e.name === name + '.md') hits.push(p);
    }
  })(VAULT);
  return hits;
}
function setKw(spec) {
  const i = spec.indexOf('=');
  const name = spec.slice(0, i).trim(), kws = vc.parseKw(spec.slice(i + 1));
  if (i < 1 || !kws.length) { console.error('형식: --set "노트이름=키워드1,키워드2"'); process.exit(1); }
  const hits = findNote(name);
  if (hits.length !== 1) { console.error(`노트 «${name}»를 ${hits.length}개 찾음 — 하나만 있어야 씁니다.`); process.exit(1); }
  const raw = fs.readFileSync(hits[0], 'utf8');
  const nl = raw.includes('\r\n') ? '\r\n' : '\n';
  const bom = raw.startsWith('﻿') ? '﻿' : '';
  const text = bom ? raw.slice(1) : raw;
  const line = '검색어: ' + kws.join(', ');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  let out;
  if (!m) out = `---${nl}${line}${nl}---${nl}${text}`;
  else if (/^검색어:/m.test(m[1])) out = text.replace(/^검색어:.*$/m, line);
  else out = text.replace(/^---\r?\n/, `---${nl}`).replace(m[1], m[1] + nl + line);
  fs.writeFileSync(hits[0], bom + out);
  console.log(`«${name}» ← ${line} (다음에 node tools/build.js 와 node tools/searchvol.js --write)`);
}

// ---------- 조회 ----------
function loadKey() {
  const kv = {};
  for (const l of fs.readFileSync(KEY_FILE, 'utf8').split(/\r?\n/)) { const i = l.indexOf('='); if (i > 0) kv[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
  if (!kv.CUSTOMER_ID || !kv.ACCESS_LICENSE || !kv.SECRET_KEY) throw new Error('키 파일에 빈 칸이 있음');
  return kv;
}
async function query(kv, hints) {
  const uri = '/keywordstool', ts = String(Date.now());
  const sig = crypto.createHmac('sha256', kv.SECRET_KEY).update(`${ts}.GET.${uri}`).digest('base64');
  const r = await fetch('https://api.searchad.naver.com' + uri + '?showDetail=1&hintKeywords=' + encodeURIComponent(hints.join(',')),
    { headers: { 'X-Timestamp': ts, 'X-API-KEY': kv.ACCESS_LICENSE, 'X-Customer': kv.CUSTOMER_ID, 'X-Signature': sig } });
  const text = await r.text();
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
  return JSON.parse(text).keywordList || [];
}
// «< 10»은 문자열로 온다 → 5로 두고 low 표시
const num = (v) => (typeof v === 'number' ? { n: v } : { n: 5, low: true });

(async () => {
  if (opt('--set')) return setKw(opt('--set'));
  const d = readDrawer();
  const cards = d.items.filter((i) => i.kw && i.kw.length);
  const cache = vc.load(CACHE);
  if (args.includes('--todo')) {
    const need = d.items.filter((i) => !(i.kw && i.kw.length) && i.stage !== '발행' && i.file);
    console.log(`검색어가 없는 글감·초안 노트 ${need.length}개 (이름만):`);
    for (const i of need) console.log('- ' + i.name);
    return;
  }
  const want = [...new Set(cards.flatMap((i) => i.kw))];
  const stale = want.filter((k) => !vc.isFresh(cache.kw[k], TODAY));
  console.log(`검색어가 있는 카드 ${cards.length}장 · 키워드 ${want.length}개 · 7일 안 캐시 ${want.length - stale.length}개 · 새로 부를 것 ${stale.length}개(호출 ${Math.ceil(stale.length / BATCH)}번)`);
  if (!args.includes('--write')) return;

  let calls = 0;
  if (stale.length) {
    const kv = loadKey();
    for (let i = 0; i < stale.length && calls < MAX_CALLS; i += BATCH) {
      const hints = stale.slice(i, i + BATCH);
      if (calls) await new Promise((r) => setTimeout(r, 1500));
      let list;
      try { list = await query(kv, hints); calls++; } catch (e) {
        console.error(`조회 멈춤(${e.message}). 다시 시도하지 않습니다. 막히면 효니가 웹 «키워드 도구» 캡처로 대신합니다.`);
        break;
      }
      for (const k of hints) {
        const row = list.find((x) => String(x.relKeyword).replace(/\s+/g, '').toLowerCase() === k.toLowerCase());
        if (!row) { cache.kw[k] = { none: true, at: TODAY }; continue; }
        const pc = num(row.monthlyPcQcCnt), mo = num(row.monthlyMobileQcCnt);
        cache.kw[k] = { pc: pc.n, mo: mo.n, comp: row.compIdx, low: pc.low && mo.low ? true : undefined, at: TODAY };
      }
    }
    vc.save(cache, CACHE);
  }
  const left = want.filter((k) => !vc.isFresh(cache.kw[k], TODAY)).length;
  const r = vc.attach(d.items, cache);
  d.volAt = r.at || undefined;
  fs.writeFileSync(DRAWER, JSON.stringify(d));
  console.log(`호출 ${calls}번 · 월 검색수가 붙은 카드 ${r.cards}장 · 조회 못 했거나 남은 키워드 ${left}개 · 결과가 없는 키워드 ${want.filter((k) => cache.kw[k] && cache.kw[k].none).length}개`);
  console.log('→ 이어서 node tools/upload.js');
})().catch((e) => { console.error(e.message); process.exit(1); });
