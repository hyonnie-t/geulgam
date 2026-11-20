// 구글 서치콘솔 캐시(searchconsole.local.json, gsc.js --write가 만듦)를 카드·최근 글에 붙이고 «손볼 글»을 고른다 (2026-11-20).
// build.js가 쓴다. API는 부르지 않는다(캐시만 읽음). 캐시가 없으면 아무것도 안 붙인다.
const fs = require('fs'), path = require('path');
const FILE = path.resolve(__dirname, '..', 'searchconsole.local.json');

// 주소 맞추기: 퍼센트 인코딩·http(s)·m. 도메인·티스토리 모바일 /m/ 경로·끝 슬래시·? # 차이를 없앤다
function normUrl(u) {
  let s = String(u || '').trim();
  try { s = decodeURI(s); } catch (e) { /* 그대로 */ }
  return s.replace(/^https?:\/\//, '').replace(/^m\./, '').replace(/[?#].*$/, '').replace(/^([^/]+)\/m(?=\/|$)/, '$1').replace(/\/+$/, '').normalize('NFC');
}
const squash = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
function load(file = FILE) { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return j && j.pages ? j : null; } catch (e) { return null; } }

const r1 = (x) => Math.round(x * 10) / 10;
// 같은 글의 PC·모바일 주소를 한 글로 합친다. 평균 순위는 노출로 가중(서치콘솔 평균 순위도 노출마다 잰 값의 평균)
function index(cache) {
  const m = new Map();
  for (const [u, p] of Object.entries(cache.pages || {})) {
    const k = normUrl(u);
    const o = m.get(k) || { k, i: 0, c: 0, pw: 0, q: new Map() };
    o.i += p.i; o.c += p.c; o.pw += p.pos * p.i;
    for (const x of p.q || []) {
      const e = o.q.get(x.q) || { q: x.q, i: 0, c: 0, pw: 0 };
      e.i += x.i; e.c += x.c; e.pw += x.pos * x.i; o.q.set(x.q, e);
    }
    m.set(k, o);
  }
  return m;
}
const fin = (o) => ({ i: o.i, c: o.c, pos: o.i ? r1(o.pw / o.i) : 0 });
const topQ = (qmap, n) => [...qmap.values()].sort((a, b) => b.i - a.i).slice(0, n).map((e) => ({ q: e.q, ...fin(e) }));

// 여러 주소(한 노트가 블로그에 여러 번 나간 경우)를 합친 숫자
function stat(m, urls, nq = 5) {
  const o = { i: 0, c: 0, pw: 0, q: new Map() };
  const seen = new Set();
  for (const u of urls) {
    const k = normUrl(u); if (seen.has(k)) continue; seen.add(k);
    const p = m.get(k); if (!p) continue;
    o.i += p.i; o.c += p.c; o.pw += p.pw;
    for (const e of p.q.values()) { const x = o.q.get(e.q) || { q: e.q, i: 0, c: 0, pw: 0 }; x.i += e.i; x.c += e.c; x.pw += e.pw; o.q.set(e.q, x); }
  }
  return o.i ? { ...fin(o), q: topQ(o.q, nq) } : undefined;
}

// 손볼 글(Claude 판단 눈금, 2026-11-20 — 효니 블로그 90일 노출 1,476·클릭 61 기준으로 잡음. 글이 쌓이면 다시 맞춘다)
//  ctr  : 노출 50 이상인데 클릭률 2% 미만 → 사람들이 친 말이 제목·첫 문장에 없을 때가 많다
//  near : 평균 8~20위, 노출 20 이상 → 2쪽 문턱. 본문 보강·관련 글 링크로 1쪽에
//  twin : 같은 검색어(노출 10 이상)에 내 글 두 개가 같이 보임 → 서로 다투니 링크로 잇거나 하나를 대표로
const TIP = { ctrMinI: 50, ctrMax: 0.02, ctrMaxPos: 10, nearMin: 8, nearMax: 20, nearMinI: 20, twinMinI: 10, twinEachI: 3, max: 4 };
function tips(m, posts) {
  const title = (k) => { const p = posts.find((x) => x.u && normUrl(x.u) === k); return p ? p.t : k.replace(/^[^/]+/, '').replace(/^\/entry\//, '').replace(/-/g, ' ') || '블로그 첫 화면'; }; // k는 normUrl에서 이미 풀린 주소(다시 풀면 «100%» 같은 제목에서 멈춤 — 검토 지적)
  const url = (k) => { const p = posts.find((x) => x.u && normUrl(x.u) === k); return p ? p.u : 'https://' + k; };
  const out = [], used = new Set();
  // 지금 블로그에 있는 글 주소만(첫 화면·카테고리·주소를 바꾸기 전 옛 주소는 뺀다 — 2026-11-20 첫 실행에서
  // 수능 AI 안경 글의 옛 주소와 새 주소가 «같은 말로 다투는 두 글»로 잘못 잡혔다. 옛 주소는 구글이 시간이 지나면 새 주소로 합친다)
  const live = new Set(posts.filter((x) => x.k === '블로그' && x.u).map((x) => normUrl(x.u)));
  const pages = [...m.values()].filter((p) => /\/(entry\/|\d+$)/.test(p.k) && (!live.size || live.has(p.k))); // 티스토리 글 주소: /entry/제목 또는 /숫자
  // 1) 같은 말로 다투는 두 글
  const byQ = new Map();
  for (const p of pages) for (const e of p.q.values()) if (e.i >= TIP.twinEachI) (byQ.get(e.q) || byQ.set(e.q, []).get(e.q)).push({ p, e });
  const twins = [...byQ.entries()].filter(([, l]) => l.length >= 2 && l.reduce((s, x) => s + x.e.i, 0) >= TIP.twinMinI)
    .sort((a, b) => b[1].reduce((s, x) => s + x.e.i, 0) - a[1].reduce((s, x) => s + x.e.i, 0));
  for (const [q, l] of twins) {
    const [a, b] = l.sort((x, y) => y.e.i - x.e.i);
    const key = [a.p.k, b.p.k].sort().join('|');
    if (used.has(key)) continue; used.add(key);
    out.push({ kind: 'twin', u: url(a.p.k), t: title(a.p.k), ...fin(a.p), q: [q], with: { u: url(b.p.k), t: title(b.p.k) } });
  }
  // 2) 보이는데 안 눌림 3) 2쪽 문턱 — 노출 많은 순
  const twinK = new Set(out.flatMap((x) => [normUrl(x.u), x.with && normUrl(x.with.u)]).filter(Boolean));
  for (const p of pages.sort((a, b) => b.i - a.i)) {
    if (twinK.has(p.k)) continue; // 다툼 카드에 이미 나온 글은 한 번만
    const f = fin(p);
    // «안 눌림»은 1쪽(평균 10위 안)에 있는데도 클릭률이 낮을 때만 — 2쪽 글은 원래 덜 눌리니 «2쪽 문턱»으로(제미나이 검토 지적, 2026-11-20)
    const kind = f.pos <= TIP.ctrMaxPos && f.i >= TIP.ctrMinI && f.c / f.i < TIP.ctrMax ? 'ctr' : f.pos >= TIP.nearMin && f.pos <= TIP.nearMax && f.i >= TIP.nearMinI ? 'near' : '';
    if (!kind) continue;
    out.push({ kind, u: url(p.k), t: title(p.k), ...f, q: topQ(p.q, 3).map((x) => x.q) });
  }
  // twin은 최대 1개, 나머지는 노출 순으로 채움
  const tw = out.filter((x) => x.kind === 'twin').slice(0, 1);
  return [...tw, ...out.filter((x) => x.kind !== 'twin')].slice(0, TIP.max);
}

// 글감·초안 카드의 검색어가 이미 구글에서 내 블로그로 들어온 말인지(띄어쓰기 빼고 포함 비교)
function hits(cache, kws) {
  // 세 글자 이상만(«수능»·«역사»처럼 두 글자는 아무 검색어에나 맞음 — 제미나이 검토 지적), 노출 많은 순
  const ks = (kws || []).map(squash).filter((k) => k.length >= 3);
  if (!ks.length) return undefined;
  const l = [...(cache.queries || [])].sort((a, b) => b.i - a.i).filter((q) => ks.some((k) => squash(q.q).includes(k))).slice(0, 3).map((q) => ({ q: q.q, i: q.i, c: q.c, pos: q.pos }));
  return l.length ? l : undefined;
}

// items: 서랍 카드, recent: 최근 나간 글, posts: 블로그+인스타 글(제목 찾기용)
function attach(items, recent, posts, cache = load()) {
  for (const it of items) { delete it.gsc; delete it.gscHit; }
  for (const r of recent) delete r.gsc;
  if (!cache) return null;
  const m = index(cache);
  let cards = 0;
  for (const it of items) {
    const blogUrls = (it.pub || []).filter((p) => p.k === '블로그' && p.u).map((p) => p.u);
    if (it.stage === '발행' && blogUrls.length) { const s = stat(m, blogUrls); if (s) { it.gsc = s; cards++; } }
    else if (it.stage !== '발행') { const h = hits(cache, it.kw); if (h) it.gscHit = h; }
  }
  for (const r of recent) if (r.k === '블로그' && r.u) { const s = stat(m, [r.u], 0); if (s) { delete s.q; r.gsc = s; } }
  return { at: cache.at, start: cache.start, end: cache.end, total: cache.total, tips: tips(m, posts), cards };
}

module.exports = { FILE, normUrl, load, index, stat, tips, hits, attach, TIP };
