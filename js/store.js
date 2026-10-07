// Capa de datos: Firebase Firestore (tiempo real, compartido) o
// almacenamiento local (modo demo, solo este dispositivo).
//
// where = [[campo, op, valor], ...] con op en '==', '>=', '<='.
// update() acepta rutas con punto: { 'items.ap01.done': true }.

import { FIREBASE_CONFIG } from './config.js';

const FB = 'https://www.gstatic.com/firebasejs/10.12.2';

let backend = null;

export async function initStore() {
  if (FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId) {
    backend = await firebaseBackend(FIREBASE_CONFIG);
  } else {
    backend = localBackend();
  }
  return backend.mode;
}

export const store = {
  get: (c, id) => backend.get(c, id),
  set: (c, id, d) => backend.set(c, id, withoutId(d)),
  update: (c, id, patch) => backend.update(c, id, patch),
  remove: (c, id) => backend.remove(c, id),
  list: (c, where) => backend.list(c, where || []),
  watch: (c, where, cb, onError) => backend.watch(c, where || [], cb, onError),
  exportAll: () => backend.exportAll(),
  get auth() { return backend.auth; },
};

export const isPermissionError = (e) => /permission|insufficient/i.test(String(e?.code || e?.message || e));

function withoutId(d) {
  const { id, ...rest } = d;
  return rest;
}

async function firebaseBackend(cfg) {
  const [appM, fs, authM] = await Promise.all([
    import(`${FB}/firebase-app.js`),
    import(`${FB}/firebase-firestore.js`),
    import(`${FB}/firebase-auth.js`),
  ]);
  const app = appM.initializeApp(cfg);
  const db = fs.initializeFirestore(app, { ignoreUndefinedProperties: true });
  const auth = authM.getAuth(app);
  try {
    await authM.getRedirectResult(auth);
  } catch (e) {
    console.warn(e);
  }
  await auth.authStateReady();
  if (!auth.currentUser) await authM.signInAnonymously(auth);
  const q = (c, where) => fs.query(fs.collection(db, c), ...where.map(([f, o, v]) => fs.where(f, o, v)));
  const toDoc = (s) => ({ ...s.data(), id: s.id });
  const COLLECTIONS = ['workers', 'workerPins', 'shiftTypes', 'tasks', 'checklists', 'alerts'];
  return {
    mode: 'firebase',
    auth: {
      uid: () => auth.currentUser?.uid || null,
      isGoogle: () => !!auth.currentUser && !auth.currentUser.isAnonymous,
      name: () => auth.currentUser?.displayName || auth.currentUser?.email || '',
      async google() {
        const provider = new authM.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        try {
          await authM.signInWithPopup(auth, provider);
        } catch (e) {
          if (/popup-blocked|operation-not-supported/.test(e.code || '')) return authM.signInWithRedirect(auth, provider);
          throw e;
        }
      },
      async anon() {
        await authM.signOut(auth);
        await authM.signInAnonymously(auth);
      },
    },
    async get(c, id) {
      const s = await fs.getDoc(fs.doc(db, c, id));
      return s.exists() ? toDoc(s) : null;
    },
    set: (c, id, d) => fs.setDoc(fs.doc(db, c, id), d),
    update: (c, id, p) => fs.updateDoc(fs.doc(db, c, id), p),
    remove: (c, id) => fs.deleteDoc(fs.doc(db, c, id)),
    async list(c, where) {
      return (await fs.getDocs(q(c, where))).docs.map(toDoc);
    },
    watch(c, where, cb, onError) {
      return fs.onSnapshot(q(c, where), (s) => cb(s.docs.map(toDoc)), (e) => {
        console.error(e);
        onError?.(e);
      });
    },
    async exportAll() {
      const out = {};
      for (const c of COLLECTIONS) out[c] = await this.list(c, []);
      return out;
    },
  };
}

function localBackend() {
  const KEY = 'heladeria-demo-db';
  const read = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || {};
    } catch {
      return {};
    }
  };
  let data = read();
  const watchers = new Set();
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel(KEY) : null;
  const notify = () => watchers.forEach((w) => setTimeout(w.run, 0));
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {}
    bc?.postMessage('changed');
    notify();
  };
  if (bc) bc.onmessage = () => { data = read(); notify(); };
  window.addEventListener('storage', (e) => { if (e.key === KEY) { data = read(); notify(); } });

  const col = (c) => data[c] || (data[c] = {});
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const match = (d, where) =>
    where.every(([f, op, v]) => (op === '==' ? d[f] === v : op === '>=' ? d[f] >= v : op === '<=' ? d[f] <= v : true));
  const all = (c, where) => Object.entries(col(c)).map(([id, d]) => ({ ...clone(d), id })).filter((d) => match(d, where));
  const setPath = (obj, path, value) => {
    const parts = path.split('.');
    let o = obj;
    for (const p of parts.slice(0, -1)) o = o[p] && typeof o[p] === 'object' ? o[p] : (o[p] = {});
    o[parts.at(-1)] = value;
  };

  return {
    mode: 'demo',
    auth: { uid: () => 'demo', isGoogle: () => false, name: () => '', async google() {}, async anon() {} },
    async get(c, id) {
      const d = col(c)[id];
      return d ? { ...clone(d), id } : null;
    },
    async set(c, id, d) {
      col(c)[id] = clone(d);
      save();
    },
    async update(c, id, patch) {
      const d = col(c)[id];
      if (!d) throw new Error('El documento no existe');
      for (const [k, v] of Object.entries(patch)) setPath(d, k, v);
      save();
    },
    async remove(c, id) {
      delete col(c)[id];
      save();
    },
    async list(c, where) {
      return all(c, where);
    },
    watch(c, where, cb) {
      const w = { run: () => cb(all(c, where)) };
      watchers.add(w);
      setTimeout(w.run, 0);
      return () => watchers.delete(w);
    },
    async exportAll() {
      const out = {};
      for (const c of Object.keys(data)) out[c] = all(c, []);
      return out;
    },
    reset() {
      data = {};
      save();
    },
  };
}

export function resetDemo() {
  backend?.reset?.();
}
