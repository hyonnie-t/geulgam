// 구글 서치콘솔 조회 도구 (2026-11-20, 출처: 효니 말 «붙이고 서치 콘솔값도 분석 더 할 거 없는지 봐주라»)
// 효니 블로그(0hyonnie.tistory.com)가 구글에서 어떤 검색어로 몇 번 보였고(노출) 몇 번 눌렸는지(클릭), 평균 몇 위인지 읽는다.
// 권한은 읽기 전용 하나(webmasters.readonly). 내 사이트 자료라 네이버 검색광고 API 같은 용도 제한은 없다.
//
//   node tools/gsc.js login        브라우저가 열리면 서치콘솔 주인 계정으로 허락(한 번만). 열쇠는 PC마다 %USERPROFILE%\claude-mcp\search-console\token.json
//   node tools/gsc.js sites        이 계정으로 볼 수 있는 속성 목록
//   node tools/gsc.js --write      최근 90일 자료를 searchconsole.local.json(캐시, gitignore)에 저장. 같은 날 다시 부르지 않음(--force로 무시)
//   node tools/gsc.js --report     캐시로 분석 요약(숫자·검색어만 출력, 노트 내용 없음)
//
// 열쇠·토큰 값은 출력하지 않는다. 클라이언트는 구글 MCP와 같은 것(~/claude-mcp/google-mcp/credentials.json)을 읽기만 한다.
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), crypto = require('crypto');
const { execFile } = require('child_process');

const HOME = os.homedir();
const CRED = process.env.GSC_CRED || path.join(HOME, 'claude-mcp', 'google-mcp', 'credentials.json');
const TOKEN_DIR = path.join(HOME, 'claude-mcp', 'search-console');
const TOKEN = path.join(TOKEN_DIR, 'token.json');
const CACHE = path.resolve(__dirname, '..', 'searchconsole.local.json');
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const SITE_HINT = '0hyonnie';
const DAYS = 90;

function client() {
  const j = JSON.parse(fs.readFileSync(CRED, 'utf8'));
  const c = j.installed || j.web;
  if (!c) throw new Error('클라이언트 파일 형식을 모르겠어요(installed/web 없음)');
  return { id: c.client_id, secret: c.client_secret };
}
const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function postForm(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`토큰 요청 실패 ${r.status} ${j.error || ''} ${j.error_description || ''}`.trim());
  return j;
}

async function login() {
  const c = client();
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  const srv = http.createServer();
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const redirect = `http://127.0.0.1:${srv.address().port}`;
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: c.id, redirect_uri: redirect, response_type: 'code', scope: SCOPE,
    access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256', state,
  });
  const code = await new Promise((ok, no) => {
    const timer = setTimeout(() => { srv.close(); no(new Error('5분 안에 허락이 오지 않아 멈췄어요')); }, 5 * 60e3);
    srv.on('request', (req, res) => {
      const q = new URL(req.url, redirect).searchParams;
      if (!q.get('code') && !q.get('error')) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(q.get('code') && q.get('state') === state ? '<p style="font:16px sans-serif">서치콘솔 허락 끝났어요. 이 창은 닫아도 돼요.</p>' : '<p>허락이 안 됐어요. Claude에게 알려 주세요.</p>');
      clearTimeout(timer); srv.close();
      if (q.get('state') !== state) no(new Error('state가 맞지 않아요'));
      else if (q.get('error')) no(new Error('허락 거절/오류: ' + q.get('error')));
      else ok(q.get('code'));
    });
    console.log('브라우저에서 서치콘솔 주인 계정으로 허락해 주세요(읽기 전용).');
    execFile('cmd', ['/c', 'start', '', url.replace(/&/g, '^&')], { windowsHide: true }, () => {});
    console.log('창이 안 열리면 이 주소를 여세요:\n' + url);
  });
  const t = await postForm('https://oauth2.googleapis.com/token', {
    code, client_id: c.id, client_secret: c.secret, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier,
  });
  if (!t.refresh_token) throw new Error('refresh_token이 오지 않았어요');
  fs.mkdirSync(TOKEN_DIR, { recursive: true });
  fs.writeFileSync(TOKEN, JSON.stringify({ refresh_token: t.refresh_token, scope: t.scope, at: new Date().toISOString() }));
  console.log('로그인 됨. 열쇠 저장:', TOKEN);
}

async function accessToken() {
  if (!fs.existsSync(TOKEN)) throw new Error('서치콘솔 로그인이 아직 없어요: node tools/gsc.js login');
  const c = client();
  const { refresh_token } = JSON.parse(fs.readFileSync(TOKEN, 'utf8'));
  const t = await postForm('https://oauth2.googleapis.com/token', { client_id: c.id, client_secret: c.secret, refresh_token, grant_type: 'refresh_token' });
  return t.access_token;
}

async function api(tok, method, url, body) {
  const r = await fetch(url, { method, headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`서치콘솔 API ${r.status}: ${(j.error && j.error.message) || ''}`.slice(0, 400));
  return j;
}
const SITES = 'https://www.googleapis.com/webmasters/v3/sites';

async function pickSite(tok) {
  const s = (await api(tok, 'GET', SITES)).siteEntry || [];
  const mine = s.filter((x) => x.siteUrl.includes(SITE_HINT) && x.permissionLevel !== 'siteUnverifiedUser');
  if (!mine.length) throw new Error('이 계정에 0hyonnie 속성이 없어요. 서치콘솔 주인 계정으로 다시 로그인해 주세요.');
  return (mine.find((x) => x.siteUrl.startsWith('sc-domain:')) || mine[0]).siteUrl;
}

const ymd = (d) => d.toISOString().slice(0, 10);
const { normUrl } = require('./gsccache.js'); // 주소 맞추기는 gsccache 한 곳

async function write(force) {
  const today = ymd(new Date());
  const old = loadCache();
  if (!force && old && old.at === today) { console.log('오늘 이미 받음(' + today + '). 다시 받으려면 --force'); return; }
  const tok = await accessToken();
  const site = await pickSite(tok);
  // 서치콘솔 자료는 2~3일 늦게 차므로 끝 날짜를 3일 전으로
  const end = new Date(Date.now() - 3 * 864e5), start = new Date(end.getTime() - (DAYS - 1) * 864e5);
  const q = (dimensions, rowLimit = 5000) => api(tok, 'POST', `${SITES}/${encodeURIComponent(site)}/searchAnalytics/query`, {
    startDate: ymd(start), endDate: ymd(end), dimensions, rowLimit, dataState: 'final',
  }).then((j) => j.rows || []);
  const [byPage, byPQ, byQuery, byDate, byDevice] = [await q(['page']), await q(['page', 'query']), await q(['query']), await q(['date']), await q(['device'])];
  const r1 = (x) => Math.round(x * 10) / 10;
  const row = (r) => ({ c: r.clicks, i: r.impressions, pos: r1(r.position) });
  const pages = {};
  for (const r of byPage) pages[r.keys[0]] = { ...row(r), q: [] };
  for (const r of byPQ) { const p = pages[r.keys[0]]; if (p) p.q.push({ q: r.keys[1], ...row(r) }); }
  for (const p of Object.values(pages)) p.q.sort((a, b) => b.i - a.i), p.q = p.q.slice(0, 15);
  const cache = {
    v: 1, at: today, site, start: ymd(start), end: ymd(end),
    total: byDate.reduce((s, r) => ({ c: s.c + r.clicks, i: s.i + r.impressions }), { c: 0, i: 0 }),
    pages, queries: byQuery.map((r) => ({ q: r.keys[0], ...row(r) })).sort((a, b) => b.i - a.i).slice(0, 300),
    days: byDate.map((r) => ({ d: r.keys[0], c: r.clicks, i: r.impressions })),
    device: byDevice.map((r) => ({ k: r.keys[0], ...row(r) })),
  };
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  console.log(`받음: ${cache.start}~${cache.end} · 글 ${byPage.length}개 · 검색어 ${byQuery.length}개 · 노출 ${cache.total.i} · 클릭 ${cache.total.c}`);
}

function loadCache() { try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch (e) { return null; } }

function report() {
  const c = loadCache();
  if (!c) { console.log('캐시 없음: node tools/gsc.js --write'); return; }
  const ctr = (x) => (x.i ? Math.round((x.c / x.i) * 1000) / 10 : 0) + '%';
  const short = (u) => normUrl(u).replace(/^[^/]+/, '').slice(0, 50); // normUrl이 이미 풀어 줌(다시 풀면 % 든 제목에서 멈춤)
  console.log(`기간 ${c.start}~${c.end} · 노출 ${c.total.i} · 클릭 ${c.total.c} · 클릭률 ${ctr(c.total)}`);
  console.log('\n[기기]'); for (const d of c.device) console.log(`  ${d.k}: 노출 ${d.i} 클릭 ${d.c} 평균 ${d.pos}위`);
  const pages = Object.entries(c.pages).map(([u, p]) => ({ u, ...p }));
  console.log('\n[노출 많은 글 15]');
  for (const p of pages.sort((a, b) => b.i - a.i).slice(0, 15)) console.log(`  ${short(p.u)} | 노출 ${p.i} 클릭 ${p.c} ${ctr(p)} ${p.pos}위 | ${p.q.slice(0, 3).map((x) => x.q).join(' / ')}`);
  console.log('\n[거의 다 온 글: 평균 5~20위·노출 20 이상]');
  for (const p of pages.filter((p) => p.pos >= 5 && p.pos <= 20 && p.i >= 20).sort((a, b) => b.i - a.i)) console.log(`  ${short(p.u)} | 노출 ${p.i} 클릭 ${p.c} ${p.pos}위`);
  console.log('\n[보이는데 안 눌리는 글: 노출 50 이상·클릭률 1% 미만]');
  for (const p of pages.filter((p) => p.i >= 50 && p.c / p.i < 0.01)) console.log(`  ${short(p.u)} | 노출 ${p.i} 클릭 ${p.c} ${p.pos}위`);
  console.log('\n[검색어 30(노출순)]');
  for (const q of c.queries.slice(0, 30)) console.log(`  ${q.q} | 노출 ${q.i} 클릭 ${q.c} ${q.pos}위`);
  const weeks = {};
  for (const d of c.days) { const w = d.d.slice(0, 8) + (Number(d.d.slice(8)) <= 15 ? '전반' : '후반'); weeks[w] = weeks[w] || { c: 0, i: 0 }; weeks[w].c += d.c; weeks[w].i += d.i; }
  console.log('\n[반달별]'); for (const [w, v] of Object.entries(weeks)) console.log(`  ${w} 노출 ${v.i} 클릭 ${v.c}`);
}

module.exports = { loadCache, CACHE };
if (require.main === module) {
  const a = process.argv.slice(2);
  const run = a[0] === 'login' ? login() : a[0] === 'sites' ? accessToken().then((t) => api(t, 'GET', SITES)).then((j) => (j.siteEntry || []).forEach((s) => console.log(s.siteUrl, s.permissionLevel)))
    : a.includes('--write') ? write(a.includes('--force')) : a.includes('--report') ? Promise.resolve(report()) : Promise.resolve(console.log('쓰는 법: login | sites | --write [--force] | --report'));
  run.catch((e) => { console.error('멈춤:', e.message); process.exit(1); });
}
