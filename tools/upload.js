// 서랍 자료를 Firebase users/{주인uid}/geulgam 에 올린다(주인만 읽는 경로). 먼저 build.js로 drawer.local.json을 만든다.
// 사용: node tools/upload.js [--dry]   (--dry: 올리지 않고 크기·개수만)
// firebase-tools CLI 로그인(효니 계정)이 필요하다. 내용은 출력하지 않는다.
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
const OWNER_UID = 'uPzJdaRI9JSHxy0IX0PyUMeXR963';
const FILE = path.resolve(__dirname, '..', 'drawer.local.json');
if (!fs.existsSync(FILE)) { console.error('drawer.local.json이 없습니다. 먼저 node tools/build.js'); process.exit(1); }
const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
console.log(`올릴 자료: 서랍 ${d.items.length} · 깊숙이 ${d.deep.length} · ${(fs.statSync(FILE).size / 1024).toFixed(1)}KB · 기준일 ${d.today}`);
if (process.argv.includes('--dry')) process.exit(0);
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
execFileSync(npx, ['-y', 'firebase-tools', 'database:set', `/users/${OWNER_UID}/geulgam`, FILE, '--project', 'timetable-af612', '-f'], { stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' });
console.log('올렸습니다.');
