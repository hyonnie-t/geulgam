// 글감 서랍 화면 (2026-11-14). 앱은 보기만 한다. 상태를 바꾸는 곳은 옵시디언 노트의 «글감:» 속성이다.
// 자료 받는 곳: ?demo=1 → demo/drawer.json / 내 PC(localhost) → drawer.local.json / 그 밖 → 주인 로그인 뒤 Firebase
import * as fb from './fb.js';

const STAGES = [
  { key: '글감', label: '글감', emoji: '💡', empty: '꺼내 둔 글감이 없어요. 월요일마다 «이번 주 글감» 3개가 들어와요.' },
  { key: '초안', label: '초안', emoji: '✏️', empty: '쓰는 중인 글이 없어요. 옵시디언에서 그 노트에 «글감: 초안»을 적으면 여기로 와요.' },
  { key: '발행', label: '발행', emoji: '📮', empty: '최근 60일에 나간 글과 이어진 노트가 없어요.' },
];
const SRC_EMOJI = { 책: '📚', 수업: '🏫', 대학원: '🎓', 오데이: '🎙️', 수신함: '📥', 개인: '🌿', 업무: '🗂️' };
const OLD = 21, VERY_OLD = 42; // 묵은 글감 기준(일)
const VAULT = '효니노트';
const CACHE = 'geulgam-cache';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const arr = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []); // Firebase는 빈 목록을 지운다
const fmtDay = (d) => { if (!d) return ''; const [, m, day] = d.split('-'); return `${+m}월 ${+day}일`; };
const params = new URLSearchParams(location.search);
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);

let data = null;
const view = { src: '전체', where: '전체', stage: '글감' };
try { Object.assign(view, JSON.parse(localStorage.getItem('geulgam-view') || '{}')); } catch (e) {}
const saveView = () => { try { localStorage.setItem('geulgam-view', JSON.stringify(view)); } catch (e) {} };

// ---------- 시작 (호출은 파일 맨 끝: 캐시로 바로 그릴 때 아래 const들이 준비돼 있어야 한다) ----------
async function start() {
  $('#refresh').addEventListener('click', hardRefresh);
  $('#signin').addEventListener('click', onSignIn);
  $('#signout').addEventListener('click', onSignOut);
  setupDialog();
  registerSW();

  if (params.has('demo')) return show(await getJSON('demo/drawer.json'), '연습 자료');
  if (isLocal && !params.has('fb')) {
    const local = await getJSON('drawer.local.json').catch(() => null);
    if (local) return show(local, '내 PC 자료');
  }
  // 로그인했던 기기면 지난 자료를 먼저 보여 주고 새 자료로 바꾼다
  const cached = fb.wasOwner() ? readCache() : null;
  if (cached) show(cached, '지난번 받은 자료');
  const tok = fb.takeIdToken();
  if (tok) {
    try { const u = await fb.finishRedirect(tok); if (!u) return gate('효니 계정이 아니라 열 수 없어요.'); } catch (e) { return gate('로그인을 마치지 못했어요. 다시 눌러 주세요.'); }
  }
  fb.watchAuth(async (user) => {
    if (!fb.isOwner(user)) { if (!cached) gate(); return; }
    $('#signout').hidden = false;
    try {
      const d = await fb.readDrawer();
      if (!d) return stamp('아직 올라온 자료가 없어요. PC에서 «글감 서랍 올려줘»라고 하면 올라와요.');
      writeCache(d); show(d, '');
    } catch (e) {
      stamp(cached ? '새 자료를 못 받아 지난 자료를 보여 줘요.' : '자료를 못 받았어요. 새로고침해 보세요.');
    }
  });
}
async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return r.json();
}
function readCache() { try { return JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch (e) { return null; } }
function writeCache(d) { try { localStorage.setItem(CACHE, JSON.stringify(d)); } catch (e) {} }

function gate(msg = '') {
  $('#content').hidden = true; $('#gate').hidden = false; $('#signout').hidden = true;
  $('#gate-msg').textContent = msg;
  stamp('');
  fb.warm(); // 팝업이 막히지 않게 미리 불러 둔다
}
async function onSignIn() {
  $('#gate-msg').textContent = '';
  try {
    const u = await fb.signIn();
    if (u === 'redirect') return;
    if (!u) return gate('효니 계정이 아니라 열 수 없어요.');
    location.reload();
  } catch (e) { $('#gate-msg').textContent = '로그인 창이 닫혔거나 막혔어요. 다시 눌러 주세요.'; }
}
async function onSignOut() {
  await fb.signOut();
  try { localStorage.removeItem(CACHE); } catch (e) {}
  location.reload();
}
function stamp(html) { $('#stamp').innerHTML = html; }

// ---------- 그리기 ----------
function show(d, note) {
  data = {
    ...d,
    items: arr(d.items).map((i) => ({ ...i, where: arr(i.where), picks: arr(i.picks), used: arr(i.used), pub: arr(i.pub) })),
    deep: arr(d.deep), recent: arr(d.recent), week: { ...(d.week || {}), ids: arr(d.week && d.week.ids) },
  };
  $('#gate').hidden = true; $('#content').hidden = false;
  const at = new Date(d.at);
  const when = isNaN(at) ? '' : `${at.getMonth() + 1}월 ${at.getDate()}일 ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  const st = d.stats || {};
  stamp(`볼트 읽은 때 <b>${esc(when)}</b>${note ? ' · ' + esc(note) : ''} · 쓰인 노트 <b>${st.usedNotes ?? 0}</b>개 / 본문 있는 노트 ${st.withBody ?? '?'}개`);
  renderWeek(); renderFilters(); renderBoard(); renderDeep(); renderRecent();
}

function renderWeek() {
  const ids = data.week.ids;
  $('#week-date').textContent = data.week.date ? `${fmtDay(data.week.date)} 뽑음` : '';
  const list = $('#week-list');
  if (!ids.length) { list.innerHTML = '<li class="week-empty">아직 뽑힌 글감이 없어요. 월요일 아침에 3개가 들어와요.</li>'; return; }
  list.innerHTML = ids.map((id, n) => {
    const it = data.items.find((i) => i.id === id);
    if (!it) return '';
    const p = it.picks.find((x) => x.d === data.week.date) || it.picks[0] || {};
    const st = STAGES.find((s) => s.key === it.stage);
    return `<li><button type="button" class="week-card" data-id="${esc(id)}" data-stage="${esc(it.stage)}">
      <span class="n" aria-hidden="true">${n + 1}</span>
      <span class="t">${esc(it.title)}</span>
      <span class="st" title="지금 칸">${st.emoji}<span class="vh"> 지금 ${esc(it.stage)}</span></span>
    </button></li>`;
  }).join('');
}

const srcOf = (items) => ['전체', ...new Set(items.map((i) => i.src))];
function passes(i) {
  return (view.src === '전체' || i.src === view.src) && (view.where === '전체' || i.where.includes(view.where));
}
function renderFilters() {
  const srcs = srcOf(data.items);
  if (!srcs.includes(view.src)) view.src = '전체';
  const chip = (name, val, cur, label, count) => `<label><input type="radio" name="${name}" value="${esc(val)}"${val === cur ? ' checked' : ''}><span>${esc(label)}${count != null ? `<span class="count">${count}</span>` : ''}</span></label>`;
  $('#f-src').innerHTML = '<legend class="vh">어디서 온 글감</legend>' + srcs.map((s) => chip('src', s, view.src, s === '전체' ? '전체' : `${SRC_EMOJI[s] || ''} ${s}`, s === '전체' ? data.items.length : data.items.filter((i) => i.src === s).length)).join('');
  $('#f-where').innerHTML = '<legend class="vh">어디에 쓸 글</legend>' + ['전체', '블로그', '인스타'].map((w) => chip('where', w, view.where, w === '전체' ? '쓸 곳 전부' : w)).join('');
  for (const f of ['#f-src', '#f-where']) $(f).onchange = (e) => { view[e.target.name] = e.target.value; saveView(); renderBoard(); };
}

function card(it, n) {
  const tags = [`<span class="tag">${SRC_EMOJI[it.src] || ''} ${esc(it.src)}</span>`, ...it.where.map((w) => `<span class="tag where">${esc(w)}</span>`)];
  if (data.week.ids.includes(it.id)) tags.unshift('<span class="tag thisweek">⭐ 이번 주</span>');
  if (it.stage === '글감' && it.age >= OLD) tags.push(`<span class="tag old${it.age >= VERY_OLD ? ' very' : ''}">묵은 지 ${it.age}일</span>`);
  let line = '';
  if (it.stage === '발행') {
    const last = it.pub[it.pub.length - 1];
    line = last ? `${fmtDay(last.d)} ${last.k}에 나감` : esc(it.stageWhy);
  } else {
    const p = it.picks[it.picks.length - 1];
    line = p && p.why ? esc(p.why) : esc(it.head || it.stageWhy);
  }
  return `<li class="rise" style="--i:${n}"><button type="button" class="card" data-id="${esc(it.id)}">
    <span class="t">${esc(it.title)}</span>
    <span class="meta">${tags.join('')}</span>
    ${line ? `<span class="line">${line}</span>` : ''}
  </button></li>`;
}

function renderBoard() {
  const items = data.items.filter(passes);
  const counts = Object.fromEntries(STAGES.map((s) => [s.key, items.filter((i) => i.stage === s.key).length]));
  $('#stage-tabs').innerHTML = '<legend class="vh">보는 칸</legend>' + STAGES.map((s) => `<label data-stage="${s.key}"><input type="radio" name="stage" value="${s.key}"${view.stage === s.key ? ' checked' : ''}><span>${s.emoji} ${s.label} <span class="count">${counts[s.key]}</span></span></label>`).join('');
  $('#stage-tabs').onchange = (e) => { view.stage = e.target.value; saveView(); for (const c of document.querySelectorAll('.col')) c.classList.toggle('on', c.dataset.stage === view.stage); };
  $('#board').innerHTML = STAGES.map((s) => {
    const list = items.filter((i) => i.stage === s.key);
    return `<section class="col${view.stage === s.key ? ' on' : ''}" data-stage="${s.key}" aria-label="${s.label} 칸">
      <h3 class="col-head">${s.emoji} ${s.label} <span class="count">${list.length}</span></h3>
      ${list.length ? `<ul class="col-list">${list.map(card).join('')}</ul>` : `<p class="col-empty">${esc(s.empty)}</p>`}
    </section>`;
  }).join('');
  reveal();
}

function renderDeep() {
  $('#deep-note').textContent = `${data.deep.length}개`;
  $('#deep-list').innerHTML = data.deep.map((d) => `<li><button type="button" class="deep-item" data-deep="${esc(d.id)}">
    <span class="t">${SRC_EMOJI[d.src] || ''} ${esc(d.title)}</span><span class="line">${esc(d.len)}자 · ${esc(d.head)}</span></button></li>`).join('');
}
function renderRecent() {
  const list = data.recent;
  $('#recent-list').innerHTML = list.length ? list.map((r) => `<li><span class="d">${fmtDay(r.d)}</span>
    <a href="${esc(r.u)}" target="_blank" rel="noopener">${r.k === '인스타' ? '📷' : '📝'} ${esc(r.t || r.k + ' 글')}</a>
    <span class="link-state">${r.linked ? '노트와 이어짐' : '노트 없이'}</span></li>`).join('') : '<li>45일 안에 나간 글이 없어요.</li>';
}

// 보이는 순간 한 장씩 떠오름
let io;
function reveal() {
  if (!('IntersectionObserver' in window)) { document.querySelectorAll('.rise').forEach((e) => e.classList.add('show')); return; }
  io ??= new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('show'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -5% 0px' });
  document.querySelectorAll('.rise:not(.show)').forEach((e) => io.observe(e));
}

// ---------- 상세 창 ----------
const obsidianUrl = (file) => `obsidian://open?vault=${encodeURIComponent(VAULT)}&file=${encodeURIComponent(file.replace(/\.md$/, ''))}`;
function askFor(it) {
  const p = it.picks.find((x) => x.ask);
  if (p) return p.ask;
  if (it.stage === '초안') return `[[${it.name}]] 초안 이어서 다듬자`;
  if (it.src === '책') return `[[${it.name}]]로 ${it.where.includes('인스타') ? '책 인스타 글' : '티스토리 서평'} 초안 같이 쓰자`;
  return `[[${it.name}]]로 티스토리 글 초안 같이 쓰자`;
}
function openItem(id) {
  const it = data.items.find((i) => i.id === id);
  if (!it) return;
  const stage = STAGES.find((s) => s.key === it.stage);
  const dlg = $('#detail');
  dlg.style.setProperty('--stage-c', `var(--${{ 글감: 'idea', 초안: 'draft', 발행: 'pub' }[it.stage]})`);
  $('#d-tags').innerHTML = `<span class="tag">${stage.emoji} ${esc(it.stage)}</span><span class="tag">${SRC_EMOJI[it.src] || ''} ${esc(it.src)}</span>` +
    it.where.map((w) => `<span class="tag where">${esc(w)}</span>`).join('') +
    (it.stage === '글감' && it.age >= OLD ? `<span class="tag old${it.age >= VERY_OLD ? ' very' : ''}">묵은 지 ${it.age}일</span>` : '');
  $('#d-title').textContent = it.title + (it.author ? ` · ${it.author}` : '');
  const sec = (h, body) => body ? `<section class="d-sec"><h3>${h}</h3>${body}</section>` : '';
  const next = it.stage === '글감' ? '쓰기 시작하면 노트에 <code>글감: 초안</code>' : it.stage === '초안' ? '글이 나가면 블로그·인스타 제목으로 저절로 «발행»에 와요' : '';
  const before = it.stage !== '발행' && it.pub.length ? `<ul>${it.pub.map((p) => `<li>${fmtDay(p.d)} ${esc(p.k)}에 쓴 적 있음 — <a href="${esc(p.u)}" target="_blank" rel="noopener">${esc(p.t || '열기')}</a></li>`).join('')}</ul>` : '';
  $('#d-body').innerHTML = [
    sec('왜 여기 있나', `<p>${esc(it.stageWhy || '')}${it.since ? ` · ${fmtDay(it.since)}부터` : ''}${next ? `<br><span class="hint">다음: ${next}</span>` : ''}</p>`),
    sec('뽑힌 이유', it.picks.filter((p) => p.why).map((p) => `<p class="d-quote">${esc(p.why)}<br><span class="hint">${fmtDay(p.d)} 이번 주 글감</span></p>`).join('')),
    sec('노트 첫 줄', it.head ? `<p class="hint">${esc(it.head)}${it.len ? ` (본문 ${it.len}자)` : ''}</p>` : ''),
    sec('나간 글', it.stage === '발행' ? `<ul>${it.pub.map((p) => `<li>${fmtDay(p.d)} ${esc(p.k)} — <a href="${esc(p.u)}" target="_blank" rel="noopener">${esc(p.t || '열기')}</a></li>`).join('')}</ul>` : before),
    sec('쓰임', it.used.length ? `<ul>${it.used.map((u) => `<li>${esc(u)}</li>`).join('')}</ul>` : (it.stage === '발행' ? '<p class="hint">노트의 «쓰임»이 비어 있어요. 이 글을 쓰임에 적어 두면 «쓰인 노트»로 세요.</p>' : '')),
    sec('Claude에게 부탁할 말', `<p class="d-quote">${esc(askFor(it))}</p>`),
    `<div class="d-actions">
      <button type="button" class="primary" data-copy="${esc(askFor(it))}"><lucian-copy state="idle" size="20" tone="line"></lucian-copy> 부탁할 말 복사</button>
      <a class="ghost" href="${esc(obsidianUrl(it.file))}">🪨 옵시디언에서 노트 열기</a>
      ${it.stage === '글감' ? `<button type="button" class="ghost" data-copy="글감: 초안"><lucian-copy state="idle" size="20" tone="line"></lucian-copy> «글감: 초안» 줄 복사 <small>노트 맨 위 속성에 붙이기</small></button>` : ''}
    </div>`,
  ].join('');
  dlg.showModal();
}
function openDeep(id) {
  const d = data.deep.find((x) => x.id === id);
  if (!d) return;
  const dlg = $('#detail');
  dlg.style.setProperty('--stage-c', 'var(--line)');
  $('#d-tags').innerHTML = `<span class="tag">${SRC_EMOJI[d.src] || ''} ${esc(d.src)}</span><span class="tag where">서랍 깊숙이</span>`;
  $('#d-title').textContent = d.title;
  $('#d-body').innerHTML = `<section class="d-sec"><h3>노트 첫 줄</h3><p class="hint">${esc(d.head)}… (본문 ${d.len}자)</p></section>
    <div class="d-actions">
      <button type="button" class="ghost" data-copy="글감: 글감"><lucian-copy state="idle" size="20" tone="line"></lucian-copy> «글감: 글감» 줄 복사 <small>꺼내 두기</small></button>
      <a class="ghost" href="${esc(obsidianUrl(d.file))}">🪨 옵시디언에서 노트 열기</a>
    </div>`;
  dlg.showModal();
}
function setupDialog() {
  const dlg = $('#detail');
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-id]'); if (c) return openItem(c.dataset.id);
    const d = e.target.closest('[data-deep]'); if (d) return openDeep(d.dataset.deep);
    const cp = e.target.closest('[data-copy]'); if (cp) return copy(cp);
  });
  // closedby="any"를 못 쓰는 브라우저(사파리): 바깥(배경)을 눌렀다 뗄 때 닫는다
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    const outside = (e) => { const r = dlg.getBoundingClientRect(); return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom; };
    let downOut = false;
    dlg.addEventListener('pointerdown', (e) => { downOut = outside(e); });
    dlg.addEventListener('pointerup', (e) => { if (downOut && outside(e)) closeDialog(); });
  }
  // 나갈 때도 흐려지게: overlay 전환을 못 하는 브라우저는 data-closing으로 먼저 흐린 뒤 닫는다
  dlg.addEventListener('cancel', (e) => { if (!supportsExit()) { e.preventDefault(); closeDialog(); } });
  dlg.querySelector('form').addEventListener('submit', (e) => { if (!supportsExit()) { e.preventDefault(); closeDialog(); } });
}
let exitOK;
function supportsExit() {
  if (exitOK !== undefined) return exitOK;
  if (!window.CSS?.supports?.('overlay', 'auto') || !CSS.supports('transition-behavior', 'allow-discrete')) return (exitOK = false);
  const p = document.createElement('div');
  p.style.cssText = 'transition: display 1s allow-discrete !important; display: block;';
  document.body.appendChild(p); getComputedStyle(p).display; p.style.display = 'none';
  exitOK = getComputedStyle(p).display === 'block'; p.remove();
  return exitOK;
}
async function closeDialog() {
  const dlg = $('#detail');
  if (!dlg.open) return;
  dlg.setAttribute('data-closing', '');
  const anims = dlg.getAnimations({ subtree: true });
  if (anims.length) await Promise.race([Promise.allSettled(anims.map((a) => a.finished)), new Promise((r) => setTimeout(r, 400))]);
  dlg.removeAttribute('data-closing');
  dlg.close();
}

// ---------- 복사·알림 ----------
async function copy(btn) {
  const icon = btn.querySelector('lucian-copy');
  try {
    await navigator.clipboard.writeText(btn.dataset.copy);
    icon?.setState?.('copied');
    toast('복사했어요');
    setTimeout(() => icon?.setState?.('idle'), 1600);
  } catch (e) { toast('복사가 막혔어요. 길게 눌러 직접 복사해 주세요.'); }
}
let tt;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 1800); }

// ---------- 새로고침(홈 화면 앱용) ----------
async function hardRefresh() {
  $('#refresh lucian-refresh')?.setState?.('loading');
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.() || [];
    await Promise.all(regs.map((r) => r.update().catch(() => {})));
    const keys = await caches?.keys?.() || [];
    await Promise.all(keys.filter((k) => k.startsWith('geulgam-')).map((k) => caches.delete(k)));
  } catch (e) {}
  location.reload();
}
function registerSW() {
  if ('serviceWorker' in navigator && !isLocal) navigator.serviceWorker.register('sw.js').catch(() => {});
}

start();
