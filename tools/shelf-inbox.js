// 책장 «글감 서랍으로 보내기» → 볼트 0-수신함 글감 노트 (2026-11-15)
// 책장 앱이 Firebase users/{주인uid}/bookshelf/meta/toGeulgam/{책id} = {t 제목, a 저자, why 고른 까닭, at 날짜}에 남긴 목록을
// 읽기만 하고(책장 칸에는 쓰지 않음), 볼트에 옮긴다.
//  - 같은 책 노트(4-독서·문화, 제목 속성이나 노트 이름이 같음)가 있으면 새로 만들지 않고 «글감: 글감» 속성만 더한다(이미 글감 속성이 있으면 그대로).
//  - 없으면 0-수신함에 type: 글감, 출처: 책장 <at>, 책장id: <책id> 노트를 만든다.
//  - 이미 옮긴 책(볼트 어디든 같은 책장id 노트, 책장 출처 같은 제목 노트, shelf-moved.local.json 기록)은 건너뛴다. 몇 번 돌려도 같고,
//    효니가 노트를 옮기거나 지워도 다시 만들지 않는다.
// 쓰는 법: node tools/shelf-inbox.js [--dry] [--vault 경로] [--file 받은.json] [--moved 기록.json]
//   --dry: 볼트에 쓰지 않고 건수만. --file: Firebase 대신 미리 받아 둔 JSON(시험용).
// 내용·제목은 출력하지 않고 건수만 보인다. firebase-tools CLI 로그인(효니 계정)이 필요하다.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DRY = args.includes('--dry');
const VAULT = path.resolve(opt('--vault', path.join(ROOT, '..', '..', '클로드작업', '옵시디언', '효니노트')));
const OWNER_UID = 'uPzJdaRI9JSHxy0IX0PyUMeXR963';
// 한 번 옮긴 책 id 기억(비공개라 *.local.json, gitignore). --moved로 바꿀 수 있다(시험용)
const MOVED = path.resolve(opt('--moved', path.join(ROOT, 'shelf-moved.local.json')));
const TODAY = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

function readList() {
  const file = opt('--file');
  if (file) return JSON.parse(fs.readFileSync(file, 'utf8')) || {};
  const win = process.platform === 'win32';
  const out = execFileSync(win ? 'npx.cmd' : 'npx',
    ['-y', 'firebase-tools', 'database:get', `/users/${OWNER_UID}/bookshelf/meta/toGeulgam`, '--project', 'timetable-af612'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], shell: win, maxBuffer: 16 << 20 });
  return JSON.parse(out.trim() || 'null') || {};
}

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
const fmOf = (text) => { const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/); return m ? m[1] : ''; };
const prop = (fm, key) => { const m = fm.match(new RegExp('^' + key + ':[ \\t]*(.*)$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''; };
// build.js와 같은 맞추기 기준(띄어쓰기·문장부호·괄호 무시)
const norm = (s) => (s || '').normalize('NFC').replace(/[\s·:,.!?'"“”‘’\-–—~()（）\[\]<>《》〈〉『』「」&+_/]/g, '').toLowerCase();
// 노트 이름의 «(출판사) », 끝의 «(…)»를 뗀다
const bare = (s) => (s || '').replace(/^\([^)]*\)\s*/, '').replace(/\s*\([^)]*\)\s*$/, '');
const yq = (s) => JSON.stringify(String(s || '').replace(/\s+/g, ' ').trim()); // YAML 안전한 큰따옴표 문자열

(() => {
  if (!fs.existsSync(VAULT)) throw new Error('볼트를 못 찾았습니다');
  const list = readList();
  const books = Object.entries(list).filter(([, b]) => b && b.t);

  // 4-독서·문화 책 노트: 제목·이름 → 파일
  const bookNotes = new Map();
  for (const f of walk(path.join(VAULT, '4-독서·문화'))) {
    const name = path.basename(f, '.md');
    const fm = fmOf(fs.readFileSync(f, 'utf8'));
    const keys = new Set([norm(prop(fm, '제목')), norm(name), norm(bare(name))]);
    for (const k of keys) if (k.length >= 2 && !bookNotes.has(k)) bookNotes.set(k, f);
  }
  // 이미 옮긴 책: 볼트 어디로 옮겼든 `책장id:` 속성 + shelf-moved.local.json(효니가 노트를 지우거나 속성을 빼도 다시 안 만듦)
  const inboxDir = path.join(VAULT, '0-수신함');
  const moved = (() => { try { return JSON.parse(fs.readFileSync(MOVED, 'utf8')); } catch { return {}; } })();
  const doneIds = new Set(Object.keys(moved)), doneTitles = new Set();
  for (const f of walk(VAULT)) {
    if (/[\\/]\.(obsidian|trash)[\\/]/.test(f)) continue;
    const fm = fmOf(fs.readFileSync(f, 'utf8'));
    const sid = prop(fm, '책장id');
    if (sid) doneIds.add(sid);
    if (sid || /책장/.test(prop(fm, '출처'))) doneTitles.add(norm(prop(fm, '제목') || path.basename(f, '.md')));
  }

  const c = { 받음: books.length, 새노트: 0, 속성더함: 0, 이미있음: 0 };
  for (const [id, b] of books) {
    const key = norm(b.t);
    if (doneIds.has(id) || doneTitles.has(key)) { c.이미있음++; continue; }
    const hit = bookNotes.get(key) || bookNotes.get(norm(bare(b.t)));
    if (hit) {
      const text = fs.readFileSync(hit, 'utf8');
      const fm = fmOf(text);
      if (/^글감:/m.test(fm)) { c.이미있음++; continue; }
      if (!fm) { c.이미있음++; continue; } // frontmatter 없는 노트는 건드리지 않는다
      // frontmatter 닫는 줄 바로 앞에 한 줄 더한다(나머지 내용은 그대로)
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      const m = text.match(/^(---\r?\n[\s\S]*?)(\r?\n---)/);
      if (!DRY) fs.writeFileSync(hit, m[1] + eol + '글감: 글감' + m[2] + text.slice(m[0].length));
      moved[id] = { at: TODAY, how: '속성' };
      c.속성더함++;
      continue;
    }
    const at = /^\d{4}-\d{2}-\d{2}/.test(b.at || '') ? b.at.slice(0, 10) : TODAY;
    let fname = String(b.t).replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || id;
    if (fs.existsSync(path.join(inboxDir, fname + '.md'))) fname += ' (책장)';
    const body = [
      '---',
      'type: 글감',
      `출처: 책장 ${at}`,
      `글감날짜: ${at}`,
      '쓸곳: 인스타, 블로그',
      `제목: ${yq(b.t)}`,
      b.a ? `저자: ${yq(b.a)}` : null,
      `책장id: ${yq(id)}`,
      'tags: [글감, 책장]',
      '---',
      `책장 앱에서 «글감 서랍으로 보내기»로 고른 책.`,
      '',
      b.why ? `- 고른 까닭: ${String(b.why).replace(/\s+/g, ' ').trim()}` : null,
      '- 이 책 독서 노트(4-독서·문화)는 아직 없다. 서평 초안·메모는 여기서 시작하거나 독서 노트를 만든 뒤 옮긴다.',
      '- 책장 쪽에서 빼도 이 노트는 남는다(지울 때는 직접).',
      '',
    ].filter((l) => l !== null).join('\n');
    if (!DRY) { fs.mkdirSync(inboxDir, { recursive: true }); fs.writeFileSync(path.join(inboxDir, fname + '.md'), body); }
    doneIds.add(id); doneTitles.add(key);
    moved[id] = { at: TODAY, how: '노트' };
    c.새노트++;
  }
  if (!DRY && (c.새노트 || c.속성더함)) fs.writeFileSync(MOVED, JSON.stringify(moved));
  console.log(`책장 보낼 목록 ${c.받음}권 · 새 글감 노트 ${c.새노트} · 책 노트에 글감 속성 ${c.속성더함} · 이미 옮김 ${c.이미있음}${DRY ? ' (--dry: 쓰지 않음)' : ''}`);
})();
