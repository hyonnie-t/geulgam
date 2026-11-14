// 글감 서랍 자료 만들기 (2026-11-14)
// 볼트(효니노트)와 이미 공개된 글(티스토리 RSS, 책장 인스타 글)을 읽어 drawer.local.json 하나를 만든다.
// 볼트 파일은 읽기만 한다. 결과 파일은 비공개라 레포에 올리지 않는다(.gitignore).
// 쓰는 법: node tools/build.js [--vault 경로] [--out 파일] [--date YYYY-MM-DD] [--offline]
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const VAULT = path.resolve(opt('--vault', path.join(ROOT, '..', '..', '클로드작업', '옵시디언', '효니노트')));
const SHELF = path.resolve(ROOT, '..', 'bookshelf', 'data');
const OUT = path.resolve(opt('--out', path.join(ROOT, 'drawer.local.json')));
const TODAY = opt('--date', new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10));
const OFFLINE = args.includes('--offline');
const RSS = 'https://0hyonnie.tistory.com/rss';

// 어디서 온 글감인지(폴더 → 출처), 어디에 쓸 만한지
const SOURCES = [
  { dir: '4-독서·문화', src: '책', where: ['인스타', '블로그'] },
  { dir: '2-수업', src: '수업', where: ['블로그'] },
  { dir: '3-대학원', src: '대학원', where: ['블로그'] },
  { dir: '0-수신함', src: '수신함', where: ['블로그'] },
  { dir: '5-개인', src: '개인', where: ['블로그'] },
  { dir: '1-업무', src: '업무', where: ['블로그'] },
];
const STAGES = ['글감', '초안', '발행'];

// ---------- 볼트 읽기 ----------
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}
function split(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return { fm: m ? m[1] : '', body: m ? text.slice(m[0].length) : text };
}
const unq = (s) => s.trim().replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim();
function prop(fm, key) {
  const m = fm.match(new RegExp('^' + key + ':[ \\t]*(.*)$', 'm'));
  return m ? unq(m[1]) : '';
}
// 목록 속성: key: [a, b] / key:\n  - a
function listProp(fm, key) {
  const inline = fm.match(new RegExp('^' + key + ':[ \\t]*\\[(.*)\\]', 'm'));
  if (inline) return inline[1].split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(unq).filter(Boolean);
  const block = fm.match(new RegExp('^' + key + ':[ \\t]*(?:#.*)?\\r?\\n((?:[ \\t]+-.*\\r?\\n?)+)', 'm'));
  if (block) return block[1].split(/\r?\n/).filter((l) => l.trim().startsWith('-')).map((l) => unq(l.trim().slice(1)));
  return [];
}
const cleanBody = (b) => b.replace(/<!--[\s\S]*?-->/g, '').replace(/%%[\s\S]*?%%/g, '');
const plain = (b) => cleanBody(b)
  .replace(/^#+\s.*$/gm, ' ')                     // 소제목은 첫 줄에서 뺀다
  .replace(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g, ' ')
  .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/^>\s?\[![^\]]*\][^\n]*$/gm, ' ').replace(/[*_`>#|-]+/g, ' ')
  .replace(/\s+/g, ' ').trim();
const norm = (s) => (s || '').normalize('NFC').replace(/[\s·:,.!?'"“”‘’\-–—~()（）\[\]<>《》〈〉『』「」&+_/]/g, '').toLowerCase();
const isDate = (s) => /^\d{4}-\d{2}-\d{2}/.test(s || '');

const notes = new Map(); // 노트 이름 → 정보
for (const s of SOURCES) {
  for (const file of walk(path.join(VAULT, s.dir))) {
    const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    const { fm, body } = split(text);
    const name = path.basename(file, '.md');
    const rel = path.relative(VAULT, file).replace(/\\/g, '/');
    const type = prop(fm, 'type');
    const p = plain(body);
    const n = {
      name, rel, folder: path.dirname(rel), src: s.src, where: s.where.slice(), type,
      title: prop(fm, '제목') || name,
      author: prop(fm, '저자'),
      stageProp: prop(fm, '글감'),
      origin: prop(fm, '출처'),
      used: listProp(fm, '쓰임'),
      date: [prop(fm, '글감날짜'), prop(fm, '독서일'), prop(fm, '일자'), prop(fm, 'created'), prop(fm, '날짜')].find(isDate) || '',
      len: cleanBody(body).replace(/\s/g, '').length,
      head: p.slice(0, 140),
    };
    if (n.date) n.date = n.date.slice(0, 10);
    // 오데이 녹음에서 온 글감 노트(0-수신함, type: 글감, 출처: 오데이 …)
    if (type === '글감' && /오데이|auday/i.test(n.origin)) n.src = '오데이';
    // 메일 소재(클라우드 루틴 «주간 블로그 소재 큐레이션» 보고서에서 옮긴 글감 노트, 출처: 메일 …)
    if (type === '글감' && /메일|뉴스레터/.test(n.origin)) n.src = '메일';
    const w = prop(fm, '쓸곳');
    if (w) n.where = w.split(/[,\s·]+/).filter(Boolean);
    if (!notes.has(name)) notes.set(name, n);
  }
}

// ---------- 일지의 «이번 주 글감» ----------
const picks = []; // { date, name, why, ask }
const diaryDir = path.join(VAULT, '일지');
for (const f of fs.existsSync(diaryDir) ? fs.readdirSync(diaryDir).sort() : []) {
  const d = f.slice(0, 10);
  if (!isDate(d)) continue;
  const t = fs.readFileSync(path.join(diaryDir, f), 'utf8');
  const sec = t.match(/## 이번 주 글감\r?\n([\s\S]*?)(?=\r?\n## |$)/);
  if (!sec) continue;
  const lines = sec[1].split(/\r?\n/);
  lines.forEach((l, i) => {
    const m = l.match(/^\s*\d+\.\s*\[\[([^\]|#]+)(?:[^\]]*)\]\]\s*[—–-]?\s*(.*)$/);
    if (!m) return;
    const next = (lines[i + 1] || '').match(/^\s*→\s*«(.+)»\s*$/);
    picks.push({ date: d, name: path.basename(m[1].trim()), why: m[2].trim(), ask: next ? next[1] : '' });
  });
}

// ---------- 이미 나간 글 ----------
async function blogPosts() {
  const keep = [];
  const old = path.join(SHELF, 'blog.json');
  if (fs.existsSync(old)) for (const p of JSON.parse(fs.readFileSync(old, 'utf8')).posts || []) keep.push({ k: '블로그', d: p.d, t: p.t, u: p.u });
  if (OFFLINE) return keep;
  try {
    const res = await fetch(RSS, { headers: { 'User-Agent': 'Mozilla/5.0 (geulgam drawer)' } });
    if (!res.ok) throw new Error('RSS ' + res.status);
    const xml = await res.text();
    const dec = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').trim();
    const grab = (s, tag) => { const m = s.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>')); return m ? dec(m[1]) : ''; };
    for (const it of xml.split('<item>').slice(1)) {
      const u = grab(it, 'link'), t = grab(it, 'title'), pd = grab(it, 'pubDate');
      const d = pd ? new Date(new Date(pd).getTime() + 9 * 3600e3).toISOString().slice(0, 10) : '';
      if (u && !keep.some((p) => p.u === u)) keep.push({ k: '블로그', d, t, u });
    }
  } catch (e) {
    console.warn('티스토리 RSS를 못 읽어 책장의 blog.json만 씁니다:', e.message);
  }
  return keep;
}
function instaPosts() {
  const f = path.join(SHELF, 'public.json');
  if (!fs.existsSync(f)) return [];
  const pub = JSON.parse(fs.readFileSync(f, 'utf8'));
  const books = new Map((pub.books || []).map((b) => [b.id, b]));
  return (pub.posts || []).map((p) => {
    const b = books.get(p.w);
    const tags = [...(p.x || '').matchAll(/#([^\s#]+)/g)].map((m) => norm(m[1])).filter((t) => !/^(도서제공|읽는중|책스타그램|북스타그램|서평|독서|책추천)$/.test(t));
    return { k: '인스타', d: p.d, t: b ? b.t : '', tags, u: 'https://www.instagram.com/p/' + p.c + '/', first: (p.x || '').split('\n')[0].slice(0, 60) };
  });
}

// 노트와 글 맞추기: 책 노트는 책 제목, 다른 노트는 노트 이름(4글자 이상)
// 노트 이름의 «(출판사) », «서평 제출 - », 끝의 «(…)»를 떼고 맞춘다
const bare = (s) => (s || '').replace(/^\([^)]*\)\s*/, '').replace(/^.*?\s-\s/, '').replace(/\s*\([^)]*\)\s*$/, '');
// 쓰임 줄의 «글 제목»: "2026-11-10 블로그 «제목»"
const usedTitles = (used) => used.map((u) => (u.match(/«([^»]+)»/) || [])[1]).filter(Boolean).map(norm).filter((t) => t.length >= 4);
function matchPosts(n, posts) {
  const keys = [...new Set([norm(n.title), norm(n.name), norm(bare(n.name)), norm(bare(n.title))])].filter((k) => k.length >= 2);
  const byUsed = usedTitles(n.used);
  const nameKey = norm(n.name);
  return posts.filter((p) => {
    const pt = norm(p.t);
    // 쓰임에 적어 둔 글 제목과 같으면 어떤 노트든 그 글
    if (byUsed.some((u) => pt === u || (u.length >= 6 && pt.includes(u)))) return true;
    if (!keys.length) return false;
    // 책 제목으로 맞추기는 책 노트만(수업 노트 «인생»이 책 «인생» 인스타에 붙지 않게)
    if (n.src !== '책') return p.k === '블로그' && keys.some((k) => k.length >= 6 && pt.includes(k));
    if (p.k === '인스타') {
      if (p.t && keys.includes(pt)) return true;
      return (p.tags || []).some((t) => t.length >= 4 && keys.includes(t));
    }
    // 책 제목 괄호는 『』《》만(강조에 쓰는 <>·「」는 빼고)
    const br = [...(p.t || '').matchAll(/[『《]([^』》]{1,40})[』》]/g)].map((m) => norm(m[1]));
    if (br.some((b) => keys.includes(b) || (b.length >= 4 && nameKey.includes(b)))) return true;
    return keys.some((k) => k.length >= 6 && pt.includes(k));
  });
}
// ---------- 티스토리 임시저장 ----------
// tools/drafts-snippet.js를 내장 브라우저에서 돌려 저장한 파일(비공개, gitignore). 없으면 건너뛴다.
const DRAFTS = path.resolve(opt('--drafts', path.join(ROOT, 'tistory-drafts.local.json')));
function tistoryDrafts() {
  if (!fs.existsSync(DRAFTS)) return { at: '', drafts: [] };
  try {
    const j = JSON.parse(fs.readFileSync(DRAFTS, 'utf8').replace(/^﻿/, ''));
    const list = Array.isArray(j.drafts) ? j.drafts : [];
    // 제목 없이 저장한 글·번호 없는 항목도 카드가 겹치거나 빈칸이 되지 않게
    return { at: j.at || '', drafts: list.map((d, i) => ({ ...d, seq: d.seq ?? 'n' + i, title: (d.title || '').trim(), untitled: !(d.title || '').trim() })) };
  } catch (e) {
    console.warn('임시저장 파일을 못 읽었습니다:', e.message);
    return { at: '', drafts: [] };
  }
}
const draftInfo = (d) => ({
  seq: d.seq, updated: d.updated, created: d.created, minutes: d.minutes, chars: d.chars,
  imgs: d.imgs, fill: d.fill, guess: d.guess, tags: d.tags, cat: d.cat,
});

const usedKind = (u) => (u.match(/^\d{4}-\d{2}-\d{2}\s+(\S+)/) || [])[1] || '';
const WRITE_KIND = /블로그|서평|인스타|티스토리|글/;
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);

(async () => {
  if (!fs.existsSync(VAULT)) throw new Error('볼트를 못 찾았습니다: ' + VAULT);
  const blog = await blogPosts();
  const insta = instaPosts();
  const posts = [...blog, ...insta];

  // 서랍에 올릴 노트: 이번 주 글감에 나온 것 + 글감 속성이 있는 것 + 오데이 글감 + 글쓰기 쓰임이 있는 것
  const chosen = new Map();
  const add = (n, why) => { if (n && !chosen.has(n.name)) chosen.set(n.name, n); };
  for (const p of picks) add(notes.get(p.name));
  for (const n of notes.values()) {
    if (n.stageProp || n.type === '글감' || n.used.some((u) => WRITE_KIND.test(usedKind(u)))) add(n);
  }
  // 최근 60일에 이미 나간 글과 이어지는 노트도 «발행» 칸에(노트 → 글이 실제로 된 것)
  const recentPub = posts.filter((p) => p.d && daysBetween(p.d, TODAY) <= 60);
  for (const n of notes.values()) {
    if (n.src === '책' && matchPosts(n, recentPub).length) add(n);
  }

  // 티스토리 임시저장: 제목이 맞는 노트가 있으면 그 노트 카드에 붙이고(초안 칸), 없으면 따로 카드를 만든다
  const td = tistoryDrafts();
  const draftByNote = new Map();
  const loose = [];
  for (const d of td.drafts) {
    if (d.untitled) { loose.push(d); continue; }
    const pseudo = [{ k: '블로그', t: d.title }];
    // 임시저장 제목의 『책 제목』이 노트 이름(«블로그 초안 - 카스트»처럼 앞머리를 뗀 것)과 같아도 같은 글로 본다.
    // 수업 노트 «인생»이 책 『인생』 글에 붙지 않게 책 노트·이름에 «초안»이 든 노트만.
    const br = [...(d.title || '').matchAll(/[『《]([^』》]{1,40})[』》]/g)].map((m) => norm(m[1])).filter((b) => b.length >= 2);
    const brMatch = (n) => br.length && (n.src === '책' || /초안/.test(n.name)) && [norm(bare(n.name)), norm(bare(n.title))].some((k) => br.includes(k));
    const cands = [...notes.values()].filter((n) => brMatch(n) || matchPosts(n, pseudo).length);
    // 이미 서랍에 있는 노트 > 책 노트 > 나머지
    cands.sort((a, b) => (chosen.has(b.name) - chosen.has(a.name)) || ((b.src === '책') - (a.src === '책')));
    const n = cands.find((c) => !draftByNote.has(c.name));
    if (n) { draftByNote.set(n.name, d); add(n); } else loose.push(d);
  }

  const items = [];
  for (const n of chosen.values()) {
    const mine = picks.filter((p) => p.name === n.name);
    const pub = matchPosts(n, posts).sort((a, b) => (a.d < b.d ? -1 : 1));
    const writeUsed = n.used.filter((u) => WRITE_KIND.test(usedKind(u)));
    let stage = '글감', why = '';
    const sp = n.stageProp.replace(/\s/g, '');
    if (STAGES.includes(sp)) { stage = sp; why = '노트 속성 «글감: ' + sp + '»'; }
    // 글감이 된 날(뽑힌 날 > 글감날짜) 이전에 나간 글(예: 2년 전 인스타)은 «쓴 적 있음»으로만 보이고 발행으로 치지 않는다.
    // 속성(글감·초안)을 적어 두고 기준 날짜가 없으면 속성이 이긴다. 속성도 날짜도 없으면 맞는 글이 곧 발행.
    const anchor = mine.length ? mine[0].date : (n.stageProp ? n.date : '');
    const fresh = pub.filter((p) => (anchor ? (p.d || '') >= anchor : !n.stageProp));
    if (fresh.length && stage !== '발행') { stage = '발행'; why = fresh[fresh.length - 1].k + ' 글과 제목이 같음'; }
    else if (stage === '글감' && writeUsed.length) { stage = '초안'; why = '쓰임에 글쓰기 기록이 있음'; }
    const draft = draftByNote.get(n.name);
    // 임시저장본이 있으면 아직 안 나간 글이다(발행되면 임시저장 목록에서 빠진다).
    // 같은 노트로 앞편(예: «(1)»)이 나갔어도 이 임시저장본과 제목이 같은 글이 없으면 초안으로 둔다.
    if (draft && !pub.some((p) => norm(p.t) === norm(draft.title))) { stage = '초안'; why = '티스토리 임시저장에 있음'; }
    const since = mine.length ? mine[0].date : (n.date || '');
    items.push({
      id: n.rel,
      name: n.name,
      // 임시저장본이 있으면 실제 글 제목을 보인다(노트 이름은 상세 창 «부탁할 말»에 남음)
      title: draft ? draft.title : n.src === '책' && n.title !== n.name ? n.title : n.name,
      author: n.author || undefined,
      file: n.rel,
      src: n.src,
      where: n.where,
      stage,
      stageWhy: why || (mine.length ? '이번 주 글감으로 뽑힘' : n.type === '글감' ? '글감 노트' : ''),
      since: since || undefined,
      age: since ? daysBetween(since, TODAY) : undefined,
      picks: mine.map((p) => ({ d: p.date, why: p.why, ask: p.ask })),
      used: n.used,
      pub: pub.map((p) => ({ k: p.k, d: p.d, t: p.t || p.first, u: p.u })),
      len: n.len,
      head: n.head,
      draft: draft ? { ...draftInfo(draft), title: draft.title } : undefined,
    });
  }
  // 노트와 이어지지 않은 임시저장본도 초안 칸에
  for (const d of loose) {
    // 임시저장 파일이 묵어서 이미 발행된 글이 남아 있으면 뺀다(제목이 같은 공개 글이 있음)
    if (!d.untitled && blog.some((p) => norm(p.t) === norm(d.title))) continue;
    const since = d.created || '';
    const t = d.untitled ? '(제목 없음)' : d.title;
    items.push({
      id: 'tistory-draft-' + d.seq,
      name: t,
      title: t,
      file: '',
      src: '임시저장',
      where: ['블로그'],
      stage: '초안',
      stageWhy: '티스토리 임시저장에 있음(이어진 노트 없음)',
      since: since || undefined,
      age: since ? daysBetween(since, TODAY) : undefined,
      picks: [], used: [], pub: [],
      len: d.chars,
      head: d.head || '',
      draft: { ...draftInfo(d), title: t },
    });
  }
  // 초안 칸은 임시저장본 먼저, 그 안에서는 많이 쓴 글 먼저
  const draftRank = (i) => (i.draft ? 1 : 0);
  items.sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage)
    || (a.stage === '초안' && (draftRank(b) - draftRank(a) || ((b.draft && b.draft.chars) || 0) - ((a.draft && a.draft.chars) || 0)))
    || (b.age ?? -1) - (a.age ?? -1));

  // 먼저 쓸 글: 볼트 «5-개인/글 초안/먼저 쓸 글.md»의 번호 목록(1. 제목 일부 — 왜). 카드 제목·노트 이름에 그 말이 들어 있으면 잇는다.
  const next = [];
  const nextFile = path.join(VAULT, '5-개인', '글 초안', '먼저 쓸 글.md');
  if (fs.existsSync(nextFile)) {
    for (const line of split(fs.readFileSync(nextFile, 'utf8')).body.split(/\r?\n/)) {
      const m = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
      if (!m) continue;
      const [key, ...rest] = m[2].split(/\s+[—–]\s+/);
      const k = norm(key);
      if (k.length < 2) continue;
      const hit = items.find((i) => !i.next && [i.title, i.name].some((t) => norm(t).includes(k)));
      const n = next.length + 1;
      if (hit) hit.next = n;
      next.push({ n, key: key.trim(), why: rest.join(' — ').trim(), id: hit ? hit.id : '', stage: hit ? hit.stage : '' });
    }
  }

  // 가장 최근 «이번 주 글감»
  const lastDate = picks.length ? picks[picks.length - 1].date : '';
  const week = { date: lastDate, ids: picks.filter((p) => p.date === lastDate).map((p) => (notes.get(p.name) || {}).rel).filter(Boolean) };

  // 서랍 깊숙이: 아직 안 꺼낸 노트(본문 200자 이상, 쓰임 없음, 서랍에 없음) — 글감후보.js와 같은 기준
  const deep = [...notes.values()]
    .filter((n) => ['책', '수업', '대학원'].includes(n.src) && !chosen.has(n.name) && !n.used.length && n.len >= 200)
    .sort((a, b) => b.len - a.len)
    .slice(0, 40)
    .map((n) => ({ id: n.rel, title: n.src === '책' && n.title !== n.name ? n.title : n.name, file: n.rel, src: n.src, len: n.len, head: n.head.slice(0, 90) }));

  const allNotes = [...notes.values()].filter((n) => ['책', '수업', '대학원'].includes(n.src));
  const recentPosts = posts.filter((p) => p.d && daysBetween(p.d, TODAY) <= 45).sort((a, b) => (a.d < b.d ? 1 : -1)).slice(0, 12)
    .map((p) => ({ k: p.k, d: p.d, t: p.t || p.first, u: p.u, linked: items.some((i) => i.pub.some((q) => q.u === p.u)) }));

  const out = {
    v: 1,
    at: new Date().toISOString(),
    today: TODAY,
    week,
    next,
    items,
    deep,
    recent: recentPosts,
    stats: {
      notes: allNotes.length,
      withBody: allNotes.filter((n) => n.len >= 200).length,
      usedNotes: allNotes.filter((n) => n.used.length).length,
      picks: picks.length,
      drafts: td.drafts.length,
      draftsAt: td.at || undefined,
    },
  };
  fs.writeFileSync(OUT, JSON.stringify(out));
  const cnt = STAGES.map((s) => s + ' ' + items.filter((i) => i.stage === s).length).join(' · ');
  // 내용은 출력하지 않고 숫자만
  console.log(`기준일 ${TODAY} · 서랍 ${items.length}개(${cnt}) · 깊숙이 ${deep.length} · 최근 글 ${recentPosts.length} · 블로그 ${blog.length}/인스타 ${insta.length} · 임시저장 ${td.drafts.length}(노트와 이어짐 ${draftByNote.size}) · 메일 글감 ${items.filter((i) => i.src === '메일').length} · 먼저 쓸 글 ${next.length}(이어짐 ${next.filter((x) => x.id).length})`);
  console.log('→ ' + path.relative(process.cwd(), OUT));
})().catch((e) => { console.error(e.message); process.exit(1); });
