#!/usr/bin/env node
// 쪽지 글감 옮기기 (2026-11-15, 출처: 효니 말 «글감 떠오른 거 메모는 쪽지함에 넣어? 여기에 넣어?» → 쪽지함으로, «쪽지 글감 잇기도 해»)
// 폰 쪽지함(idea-box, Firebase users/{uid}/ideas)에서 주제가 «글·블로그»인 쪽지를 읽어
// 볼트 0-수신함에 `type: 글감`, `출처: 쪽지 YYYY-MM-DD` 노트로 만든다 → build.js가 서랍에 «💌 쪽지»로 올린다.
// 이미 옮긴 쪽지는 노트 속성 `쪽지id:`(볼트 어디로 옮겼든)와 ideas-moved.local.json(노트를 지웠어도)으로 알아보고 다시 만들지 않는다.
//   node tools/ideas.js            미리보기: 옮길 쪽지 수만 출력(아무것도 쓰지 않음)
//   node tools/ideas.js --write    노트 만들기
//   node tools/ideas.js --write --reply   노트 만들고, 그 쪽지를 «끝남» + 답장 «글감 서랍으로 옮겼어요»로(쪽지함 inbox.js done과 같은 칸)
// 쪽지 글(t)은 효니의 생각이라 볼트 노트 본문에만 옮긴다. 화면 출력은 건수만.
// 끝난(st: done) 쪽지는 이미 처리된 것으로 보고 옮기지 않는다. 사진만 있는 쪽지는 글이 없어 건너뛴다.
process.noDeprecation = true;
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const VAULT = path.resolve(opt('--vault', path.join(ROOT, '..', '..', '클로드작업', '옵시디언', '효니노트')));
const INBOX = path.join(VAULT, '0-수신함');
const WRITE = args.includes('--write');
const REPLY = args.includes('--reply');
const TAG = '글·블로그';
const REPLY_TEXT = '글감 서랍(💌 쪽지)으로 옮겼어요. 볼트 0-수신함에 노트가 있어요.';

const UID = 'uPzJdaRI9JSHxy0IX0PyUMeXR963';
const PROJECT = 'timetable-af612';
const BASE = `/users/${UID}/ideas`;
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const q = (s) => (process.platform === 'win32' ? `"${s}"` : s);

function fbcli(a) {
  const r = spawnSync(NPX, ['--yes', 'firebase-tools', ...a, '--project', PROJECT], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32', env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || '').trim().split('\n').slice(-3).join('\n');
    console.error('firebase-tools 실패:', err);
    if (/login|auth|credentials/i.test(err)) console.error('→ 효니 터미널에서: npx firebase-tools login');
    process.exit(1);
  }
  return r.stdout;
}

// 볼트에서 이미 옮긴 쪽지 id 모으기(효니가 노트를 다른 폴더로 옮겼어도 다시 안 만들게 볼트 전체)
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}
if (!fs.existsSync(INBOX)) { console.error('볼트 0-수신함을 못 찾았어요:', INBOX); process.exit(1); }
const known = new Set();
const names = new Set(); // 볼트 전체 노트 이름(build.js는 이름이 같으면 먼저 읽은 노트만 남기므로 겹치지 않게)
for (const f of walk(VAULT)) {
  names.add(path.basename(f, '.md').normalize('NFC').toLowerCase());
  const fm = (fs.readFileSync(f, 'utf8').replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || '';
  const m = fm.match(/^쪽지id:[ \t]*["']?([\w-]+)/m);
  if (m) known.add(m[1]);
}
// 한 번 옮긴 쪽지 id 기억(효니가 노트를 지워도 다시 안 만들게). 비공개라 *.local.json(gitignore)
const MOVED = path.join(ROOT, 'ideas-moved.local.json');
let moved = [];
try { moved = JSON.parse(fs.readFileSync(MOVED, 'utf8')).ids || []; } catch (e) {}
for (const id of moved) known.add(id);

// 한국 날짜
const kday = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
// 노트 이름: 첫 줄을 줄여서. 파일 이름에 못 쓰는 글자·옵시디언 링크 글자는 뺀다
function titleOf(t) {
  const line = String(t).split(/\r?\n/).map((s) => s.trim()).find(Boolean) || '';
  let s = line.replace(/https?:\/\/\S+/g, '').replace(/[\\/:*?"<>|#^\[\]]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
  if ([...s].length > 40) s = [...s].slice(0, 40).join('').trim() + '…';
  return s;
}

const data = JSON.parse(fbcli(['database:get', BASE]).trim() || '{}') || {};
const all = Object.entries(data).map(([id, v]) => ({ id, ...v })).filter((x) => x.tag === TAG);
const todo = all.filter((x) => /^[\w-]+$/.test(x.id) && x.st !== 'done' && !known.has(x.id) && String(x.t || '').trim());
const skipped = { done: all.filter((x) => x.st === 'done' && !known.has(x.id)).length, moved: all.filter((x) => known.has(x.id)).length, noText: all.filter((x) => x.st !== 'done' && !known.has(x.id) && !String(x.t || '').trim()).length };

let made = 0, replied = 0;
const madeIds = [];
for (const x of todo.sort((a, b) => a.at - b.at)) {
  const day = kday(x.at || Date.now());
  let name = titleOf(x.t) || `쪽지 글감 ${day}`;
  // 볼트 어디든 같은 이름이 있거나 Windows 예약 이름(CON·NUL…)이면 쪽지 id 끝 4글자를 붙인다
  const taken = (s) => names.has(s.normalize('NFC').toLowerCase()) || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s);
  if (taken(name)) name = `${name} (쪽지 ${x.id.slice(-4)})`;
  const nPh = (Array.isArray(x.ph) ? x.ph : Object.values(x.ph || {})).filter(Boolean).length;
  const text = String(x.t).replace(/\r\n/g, '\n').trim();
  // 본문은 쪽지 글만(서랍 카드 첫 줄 140자가 쪽지 글이 되게). 설명은 속성으로
  const note = [
    '---',
    'type: 글감',
    `출처: 쪽지 ${day}`,
    `글감날짜: ${day}`,
    '쓸곳: 블로그',
    'tags: [글감, 쪽지]',
    `쪽지id: ${x.id}`,
    ...(x.hot ? ['급해요: true'] : []),
    ...(nPh ? [`쪽지사진: ${nPh}장(쪽지함에)`] : []),
    '---',
    '<!-- 폰 쪽지함에서 옮긴 글감(geulgam tools/ideas.js). 노트를 지워도 다시 만들지 않는다. 글은 효니 경험과 문체로. -->',
    text,
    '',
  ].join('\n');
  if (WRITE) {
    fs.writeFileSync(path.join(INBOX, name + '.md'), note, 'utf8');
    names.add(name.normalize('NFC').toLowerCase());
    made++;
    madeIds.push(x.id);
    moved.push(x.id);
    fs.writeFileSync(MOVED, JSON.stringify({ ids: moved }));
  }
}

if (WRITE && REPLY) {
  // 이번에 만든 것 + 전에 노트만 만들고 아직 안 끝난 쪽지
  const ids = [...madeIds, ...all.filter((x) => known.has(x.id) && x.st !== 'done').map((x) => x.id)];
  for (const id of ids) {
    const tmp = path.join(os.tmpdir(), `geulgam-idea-${id}.json`);
    fs.writeFileSync(tmp, JSON.stringify({ st: 'done', re: REPLY_TEXT, rat: Date.now() }));
    try { fbcli(['database:update', q(`${BASE}/${id}`), q(tmp), '--force']); replied++; } finally { fs.rmSync(tmp, { force: true }); }
  }
}

console.log(`쪽지 글감: «${TAG}» ${all.length}개 · 옮길 것 ${todo.length} · ${WRITE ? `노트 만듦 ${made}` : '미리보기(--write로 만들기)'}${REPLY ? ` · 쪽지 끝남 표시 ${replied}` : ''} · 이미 옮김 ${skipped.moved} · 끝난 쪽지 ${skipped.done} · 글 없음 ${skipped.noText}`);
