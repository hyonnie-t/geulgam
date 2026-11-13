// 주인 로그인과 서랍 자료 읽기. 책장·시간표 앱과 같은 Firebase 프로젝트의 users/{주인uid}/geulgam 하나만 읽는다.
// 앱은 읽기만 한다. 자료는 PC의 tools/upload.js가 볼트에서 만들어 올린다.
// 로그인 방식은 책장 앱(js/fb.js)과 같다: 브라우저는 팝업, 홈 화면 앱은 구글 로그인 페이지로 이동했다가 #id_token으로 돌아온다.
const OWNER_UID = 'uPzJdaRI9JSHxy0IX0PyUMeXR963';
const V = '10.12.0';
const config = {
  apiKey: 'AIzaSyBJnR447EvbToLxtRAHFNtSlhkg61QkdfA',
  authDomain: 'timetable-af612.firebaseapp.com',
  projectId: 'timetable-af612',
  appId: '1:797690266953:web:bfd4ba739900b625090698',
  databaseURL: 'https://timetable-af612-default-rtdb.firebaseio.com',
};
let sdk;
async function load() {
  if (sdk) return sdk;
  const [appM, authM, dbM] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-database.js`),
  ]);
  const app = appM.initializeApp(config, 'geulgam'); // 같은 주소의 다른 앱 로그인과 섞이지 않게 이름을 따로 준다
  const auth = authM.initializeAuth(app, {
    persistence: [authM.indexedDBLocalPersistence, authM.browserLocalPersistence],
    popupRedirectResolver: authM.browserPopupRedirectResolver,
  });
  sdk = { authM, dbM, auth, db: dbM.getDatabase(app) };
  return sdk;
}
export const isOwner = (user) => !!user && user.uid === OWNER_UID;

const FLAG = 'geulgam-owner';
const flag = {
  get() { try { return localStorage.getItem(FLAG) === '1'; } catch (e) { return false; } },
  set(v) { try { v ? localStorage.setItem(FLAG, '1') : localStorage.removeItem(FLAG); } catch (e) {} },
};
export const wasOwner = () => flag.get();

export async function watchAuth(cb) {
  if (!flag.get()) return cb(null);
  const s = await load();
  s.authM.onAuthStateChanged(s.auth, cb);
}
export function warm() { load().catch(() => {}); }

const CLIENT = '797690266953-4eeq083i7vukr0hgi0kqteni30kbj8k8.apps.googleusercontent.com'; // 공개 값(파이어베이스 웹 클라이언트)
const REDIRECT = 'https://hyonnie-t.github.io/geulgam/'; // 구글 클라우드 콘솔의 승인된 리디렉션 주소에 더해야 홈 화면 앱 로그인이 된다
const NONCE = 'geulgam-nonce';
export const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
function startRedirect() {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  try { localStorage.setItem(NONCE, nonce); } catch (e) {}
  const q = new URLSearchParams({ client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'id_token', scope: 'openid email profile', nonce, prompt: 'select_account' });
  location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + q);
}
export function takeIdToken() {
  if (!/[#&]id_token=/.test(location.hash)) return '';
  const tok = new URLSearchParams(location.hash.slice(1)).get('id_token') || '';
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  return tok;
}
export async function finishRedirect(idToken) {
  let p = {};
  try { p = JSON.parse(decodeURIComponent(escape(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); } catch (e) { throw new Error('bad token'); }
  let want = ''; try { want = localStorage.getItem(NONCE) || ''; localStorage.removeItem(NONCE); } catch (e) {}
  if (!want || p.nonce !== want || p.aud !== CLIENT) throw new Error('nonce mismatch');
  const s = await load();
  const r = await s.authM.signInWithCredential(s.auth, s.authM.GoogleAuthProvider.credential(idToken));
  if (!isOwner(r.user)) { await s.authM.signOut(s.auth); return null; }
  flag.set(true);
  return r.user;
}
export async function signIn() {
  if (isStandalone()) { startRedirect(); return 'redirect'; }
  const s = sdk || await load();
  const prov = new s.authM.GoogleAuthProvider();
  prov.setCustomParameters({ prompt: 'select_account' });
  const r = await s.authM.signInWithPopup(s.auth, prov);
  if (!isOwner(r.user)) { await s.authM.signOut(s.auth); return null; }
  flag.set(true);
  return r.user;
}
export async function signOut() {
  flag.set(false);
  if (!sdk) return;
  await sdk.authM.signOut(sdk.auth);
}
export async function readDrawer() {
  const s = await load();
  const snap = await s.dbM.get(s.dbM.ref(s.db, `users/${OWNER_UID}/geulgam`));
  return snap.exists() ? snap.val() : null;
}
